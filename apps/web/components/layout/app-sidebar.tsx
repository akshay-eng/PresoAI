"use client";

import { useRouter, usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Home, FolderOpen, LogOut, FileStack, PenTool, Settings, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { PresoLogoIcon } from "@/components/preso-logo";

interface AppSidebarProps {
  onOpenPanel?: (panel: string) => void;
  activePanel?: string;
  showProjectTabs?: boolean;
}

export function AppSidebar({ onOpenPanel, activePanel }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  const initial = (session?.user?.name || session?.user?.email || "U").charAt(0).toUpperCase();

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-50 w-[72px] border-r border-border/40 flex flex-col items-center py-4 gap-1 bg-background">
      {/* Preso logo — links to dashboard */}
      <button
        onClick={() => router.push("/dashboard")}
        className="mb-4 px-1 py-2 transition-transform hover:scale-105 active:scale-95"
        title="preso.ai — Home"
      >
        <PresoLogoIcon className="text-[19px]" />
      </button>

      <nav className="flex-1 flex flex-col items-center gap-0.5">
        <SidebarItem icon={Home} label="Home" active={pathname === "/dashboard"} onClick={() => router.push("/dashboard")} />
        <SidebarItem icon={FolderOpen} label="Projects" active={pathname?.startsWith("/projects")} onClick={() => router.push("/dashboard")} />
        <SidebarItem icon={Search} label="Find" active={pathname === "/find"} onClick={() => router.push("/find")} />

        <div className="w-6 h-px bg-border/40 my-2" />
        <SidebarItem icon={FileStack} label="Files" active={activePanel === "files"} onClick={() => onOpenPanel?.("files")} />
        <SidebarItem icon={PenTool} label="Editor" active={activePanel === "editor"} onClick={() => onOpenPanel?.("editor")} />

        <div className="w-6 h-px bg-border/40 my-2" />
        <SidebarItem icon={Plus} label="New" onClick={() => router.push("/dashboard")} />
      </nav>

      <div className="flex flex-col items-center gap-1 mt-auto">
        <SidebarItem icon={Settings} label="Settings" active={pathname === "/settings"} onClick={() => router.push("/settings")} />
        <ThemeToggle />
        <SidebarItem icon={LogOut} label="Sign out" onClick={() => signOut({ callbackUrl: "/" })} />
        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-semibold text-primary mt-1" title={session?.user?.name || session?.user?.email || ""}>
          {initial}
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-10 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors",
        active ? "text-primary" : "text-muted-foreground/50 hover:text-foreground"
      )}
      title={label}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.5} />
      <span className="text-[9px] leading-tight font-medium">{label}</span>
    </button>
  );
}
