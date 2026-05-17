import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID!;
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET!;

async function uploadToCanva(
  accessToken: string,
  presentationId: string
): Promise<string> {
  const presentation = await prisma.presentation.findFirst({
    where: { id: presentationId },
    include: { project: true },
  });

  if (!presentation?.s3Key) throw new Error("Presentation not found");

  // Download PPTX from S3
  const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
  const pptxRes = await fetch(downloadUrl);
  if (!pptxRes.ok) throw new Error("Failed to download PPTX from storage");
  const pptxBytes = new Uint8Array(await pptxRes.arrayBuffer());

  // Canva Connect API asset upload: raw binary + Asset-Upload-Metadata header
  const fileName = `${presentation.title || "presentation"}.pptx`;
  const metadata = Buffer.from(JSON.stringify({ name_base: fileName })).toString("base64");

  const uploadRes = await fetch("https://api.canva.com/rest/v1/asset-uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Asset-Upload-Metadata": metadata,
    },
    body: pptxBytes,
  });

  if (!uploadRes.ok) {
    const txt = await uploadRes.text();
    throw new Error(`Canva asset upload failed: ${txt}`);
  }

  const uploadResult = await uploadRes.json();
  const assetJobId = uploadResult.job?.id || uploadResult.id;

  // Create import job
  const importRes = await fetch("https://api.canva.com/rest/v1/imports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      import_source: { type: "asset_upload", asset_upload_job_id: assetJobId },
      title: presentation.title || "SlideForge Presentation",
    }),
  });

  if (!importRes.ok) {
    const txt = await importRes.text();
    throw new Error(`Canva import failed: ${txt}`);
  }

  const importResult = await importRes.json();
  const importJobId = importResult.job?.id || importResult.id;

  // Poll until complete (max ~20 s)
  let editUrl: string | null = null;
  let designId: string | null = null;

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(
      `https://api.canva.com/rest/v1/imports/${importJobId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!statusRes.ok) continue;

    const s = await statusRes.json();
    const status = s.job?.status || s.status;

    if (status === "completed" || status === "success") {
      designId = s.job?.result?.design?.id || s.design?.id;
      editUrl =
        s.job?.result?.design?.urls?.edit_url ||
        s.design?.urls?.edit_url ||
        (designId ? `https://www.canva.com/design/${designId}/edit` : null);
      break;
    }
    if (status === "failed") throw new Error("Canva import job failed");
  }

  if (!editUrl && designId) editUrl = `https://www.canva.com/design/${designId}/edit`;
  if (!editUrl) throw new Error("Canva import timed out");

  if (designId) {
    await prisma.presentation.update({
      where: { id: presentation.id },
      data: { canvaDesignId: designId },
    }).catch(() => {}); // non-fatal
  }

  return editUrl;
}

// HTML page shown while the server does the upload in the background.
// It polls a status endpoint we'll write below, then redirects to Canva.
function loadingHtml(presentationId: string, accessToken: string) {
  const token = Buffer.from(accessToken).toString("base64url");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Opening in Canva…</title>
<style>
  body{margin:0;display:flex;align-items:center;justify-content:center;
       min-height:100vh;background:#f5f5f3;font-family:system-ui,sans-serif}
  .card{background:#fff;border:1px solid #e4e3df;border-radius:16px;
        padding:40px 48px;text-align:center;max-width:360px}
  .logo{width:56px;height:56px;border-radius:14px;background:#7D2AE8;
        display:inline-flex;align-items:center;justify-content:center;
        color:#fff;font-size:24px;font-weight:700;margin-bottom:20px}
  h2{margin:0 0 8px;font-size:16px;color:#1a1c23}
  p{margin:0 0 24px;font-size:13px;color:#6b6d78;line-height:1.5}
  .spinner{width:24px;height:24px;border:2.5px solid #e4e3df;
           border-top-color:#0d9488;border-radius:50%;
           animation:spin .8s linear infinite;margin:0 auto}
  @keyframes spin{to{transform:rotate(360deg)}}
  .err{color:#dc2626;font-size:13px;margin-top:12px}
</style>
</head><body>
<div class="card">
  <div class="logo">C</div>
  <h2>Opening in Canva…</h2>
  <p>Importing your presentation.<br>This usually takes 5–15 seconds.</p>
  <div class="spinner" id="spin"></div>
  <p class="err" id="err" style="display:none"></p>
</div>
<script>
(async()=>{
  try{
    const r=await fetch('/api/integrations/canva/do-upload',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({presentationId:${JSON.stringify(presentationId)},t:${JSON.stringify(token)}})
    });
    const d=await r.json();
    if(!r.ok||!d.editUrl) throw new Error(d.error||'Upload failed');
    window.location.href=d.editUrl;
  }catch(e){
    document.getElementById('spin').style.display='none';
    const el=document.getElementById('err');
    el.style.display='block';
    el.textContent=e.message+' — go back and try again.';
  }
})();
</script>
</body></html>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    logger.warn({ error }, "Canva OAuth error returned");
    return NextResponse.redirect(
      new URL(`/dashboard?canva_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/dashboard?canva_error=missing_params", request.url));
  }

  let codeVerifier: string;
  let presentationId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    codeVerifier = decoded.codeVerifier;
    presentationId = decoded.presentationId;
  } catch {
    return NextResponse.redirect(new URL("/dashboard?canva_error=invalid_state", request.url));
  }

  if (!presentationId) {
    return NextResponse.redirect(new URL("/dashboard?canva_error=missing_presentation", request.url));
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/canva/oauth/callback`;

  const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CANVA_CLIENT_ID,
      client_secret: CANVA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    logger.error({ status: tokenRes.status, body: errText }, "Canva token exchange failed");
    return NextResponse.redirect(new URL("/dashboard?canva_error=token_exchange_failed", request.url));
  }

  const { access_token } = await tokenRes.json();

  // Return an HTML loading page that immediately POSTs to /api/integrations/canva/do-upload.
  // Passing the token via the JS POST body avoids all cookie SameSite/redirect issues.
  return new NextResponse(loadingHtml(presentationId, access_token), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
