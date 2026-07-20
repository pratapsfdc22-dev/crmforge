import Link from "next/link";
import {
  LayoutDashboard,
  Link as LinkIcon,
  Users,
  BarChart3,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/app", label: "Tasks", icon: LayoutDashboard },
  { href: "/app/connections", label: "Connections", icon: LinkIcon },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/usage", label: "Usage", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r bg-muted/40">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center border-b px-6">
            <Link href="/app" className="text-xl font-bold">
              ForgeSF
            </Link>
          </div>
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
