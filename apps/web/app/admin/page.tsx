import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminDashboard } from "./_dashboard";

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch {
    redirect("/admin/login");
  }
  return <AdminDashboard />;
}
