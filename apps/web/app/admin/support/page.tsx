import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminSupportDashboard } from "./_dashboard";

export default async function AdminSupportPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/admin/login");
  }
  return <AdminSupportDashboard />;
}
