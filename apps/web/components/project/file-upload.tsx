"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  projectId: string;
  purpose: "template" | "reference";
  accept?: Record<string, string[]>;
  onUploadComplete?: (data: { s3Key: string; fileName: string }) => void;
  className?: string;
}

type UploadStatus = "idle" | "uploading" | "processing" | "done" | "error";

export function FileUpload({
  projectId,
  purpose,
  accept = {
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    "application/pdf": [".pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  },
  onUploadComplete,
  className,
}: FileUploadProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [fileName, setFileName] = useState<string>("");

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setFileName(file.name);
      setStatus("uploading");

      try {
        const { signedUrl, key } = await api.getPresignedUrl({
          fileName: file.name,
          contentType: file.type,
          purpose,
        });

        await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });

        setStatus("processing");

        if (purpose === "template") {
          await api.addTemplate(projectId, key);
        } else {
          await api.addReference(projectId, {
            s3Key: key,
            fileName: file.name,
            fileType: file.name.split(".").pop() || "",
            fileSize: file.size,
          });
        }

        setStatus("done");
        onUploadComplete?.({ s3Key: key, fileName: file.name });
        toast.success(`${file.name} uploaded`);
      } catch (err) {
        setStatus("error");
        toast.error(`Upload failed: ${(err as Error).message}`);
      }
    },
    [projectId, purpose, onUploadComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    disabled: status === "uploading" || status === "processing",
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-4 transition-colors duration-150 cursor-pointer hover:border-primary/30 hover:bg-primary/[0.02]",
        isDragActive && "border-primary/40 bg-primary/5",
        status === "done" && "border-green-600/30",
        status === "error" && "border-destructive/30",
        className
      )}
    >
      <input {...getInputProps()} />
      {status === "idle" && <Upload className="h-5 w-5 text-muted-foreground/40" />}
      {(status === "uploading" || status === "processing") && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
      {status === "done" && <CheckCircle className="h-5 w-5 text-green-500" />}
      {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
      <p className="mt-1.5 text-xs text-center text-muted-foreground">
        {status === "idle" && (purpose === "template" ? "Drop a .pptx template" : "Drop reference files")}
        {status === "uploading" && "Uploading..."}
        {status === "processing" && "Processing..."}
        {status === "done" && fileName}
        {status === "error" && "Failed. Try again."}
      </p>
      {status === "idle" && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/50">.pptx, .pdf, .docx</p>
      )}
      {status === "done" && (
        <Badge variant="default" className="mt-1.5 text-[10px]">
          {purpose === "template" ? "Theme Extracted" : "Text Extracted"}
        </Badge>
      )}
    </div>
  );
}

interface FileListItemProps {
  fileName: string;
  status: string;
  fileSize?: number;
  onDelete?: () => void;
}

export function FileListItem({ fileName, status, fileSize, onDelete }: FileListItemProps) {
  const statusColors: Record<string, string> = {
    pending: "secondary",
    processing: "default",
    done: "secondary",
    failed: "destructive",
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-2 group transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <span className="text-xs truncate">{fileName}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {fileSize && (
          <span className="text-[10px] text-muted-foreground/50">{(fileSize / 1024).toFixed(0)}KB</span>
        )}
        <Badge variant={statusColors[status] as "default" | "secondary" | "destructive" || "secondary"} className="text-[10px]">
          {status}
        </Badge>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10"
          >
            <XCircle className="h-3 w-3 text-destructive/60" />
          </button>
        )}
      </div>
    </div>
  );
}
