"use client";

import { useRouter, usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Home, LogOut, FileStack, PenTool, Settings, Plus, Search, Upload, MessageCircleQuestion, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { PresoLogoIcon } from "@/components/preso-logo";
import { NotificationBell } from "@/components/notifications/notification-bell";

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
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-50 w-[72px] border-r border-border/40 flex-col items-center py-4 gap-1 bg-background">
        {/* Preso logo — links to dashboard */}
        <button
          onClick={() => router.push("/dashboard")}
          className="mb-4 px-1 py-2 transition-transform hover:scale-105 active:scale-95"
          title="preso.ai — Home"
        >
          <PresoLogoIcon className="text-[19px]" />
        </button>

        <nav className="flex-1 flex flex-col items-center gap-0.5">
          <SidebarItem icon={Home} label="Home" active={pathname === "/dashboard" || pathname?.startsWith("/projects")} onClick={() => router.push("/dashboard")} />
          <SidebarItem icon={Upload} label="Uploads" active={pathname?.startsWith("/uploads")} onClick={() => router.push("/uploads")} />
          <SidebarItem icon={Search} label="Find" active={pathname === "/find"} onClick={() => router.push("/find")} />
          <SidebarItem icon={Palette} label="Catalog" active={pathname?.startsWith("/catalog")} onClick={() => router.push("/catalog")} />

          <div className="w-6 h-px bg-border/40 my-2" />
          <SidebarItem icon={FileStack} label="Files" active={activePanel === "files"} onClick={() => onOpenPanel?.("files")} />
          <SidebarItem icon={PenTool} label="Editor" active={activePanel === "editor"} onClick={() => onOpenPanel?.("editor")} />

          <div className="w-6 h-px bg-border/40 my-2" />
          <SidebarItem icon={Plus} label="New" onClick={() => router.push("/dashboard")} />
        </nav>

        <div className="flex flex-col items-center gap-1 mt-auto">
          <NotificationBell />
          <SidebarItem icon={Settings} label="Settings" active={pathname === "/settings"} onClick={() => router.push("/settings")} />
          <ThemeToggle />
          <SidebarItem
            icon={MessageCircleQuestion}
            label="Support"
            active={pathname?.startsWith("/support")}
            onClick={() => router.push("/support")}
          />
          <SidebarItem icon={LogOut} label="Sign out" onClick={() => signOut({ callbackUrl: "/" })} />
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-semibold text-primary mt-1" title={session?.user?.name || session?.user?.email || ""}>
            {initial}
          </div>
        </div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/40 flex items-center justify-around px-2 py-1 safe-area-inset-bottom">
        <MobileNavItem icon={Home} label="Home" active={pathname === "/dashboard" || pathname?.startsWith("/projects")} onClick={() => router.push("/dashboard")} />
        <MobileNavItem icon={Search} label="Find" active={pathname === "/find"} onClick={() => router.push("/find")} />
        <MobileNavItem icon={Plus} label="New" onClick={() => router.push("/dashboard")} highlight />
        <MobileNavItem icon={Palette} label="Catalog" active={pathname?.startsWith("/catalog")} onClick={() => router.push("/catalog")} />
        <MobileNavItem icon={Settings} label="Settings" active={pathname === "/settings"} onClick={() => router.push("/settings")} />
      </nav>
    </>
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

function MobileNavItem({ icon: Icon, label, active, onClick, highlight }: { icon: React.ElementType; label: string; active?: boolean; onClick?: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors min-w-[48px]",
        highlight
          ? "bg-primary text-primary-foreground"
          : active
            ? "text-primary"
            : "text-muted-foreground/60 hover:text-foreground"
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={active || highlight ? 2 : 1.5} />
      <span className="text-[9px] leading-tight font-medium">{label}</span>
    </button>
  );
}
