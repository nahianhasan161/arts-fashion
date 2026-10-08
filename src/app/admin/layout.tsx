"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Tag,
  Users,
  LogOut,
  Palette,
  Ruler,
  Percent,
  Ticket,
  Shield,
  Images,
  Menu,
  X,
  CreditCard,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const sidebarGroups: SidebarGroup[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
    ],
  },
  {
    label: "Catalog",
    items: [
      { name: "Products", href: "/admin/products", icon: Package },
      { name: "Media", href: "/admin/media", icon: Images },
      { name: "Categories", href: "/admin/categories", icon: Tag },
      { name: "Colors", href: "/admin/colors", icon: Palette },
      { name: "Sizes", href: "/admin/sizes", icon: Ruler },
    ],
  },
  {
    label: "Marketing",
    items: [
      { name: "Promotions", href: "/admin/promotions", icon: Percent },
      { name: "Coupons", href: "/admin/coupons", icon: Ticket },
    ],
  },
  {
    label: "Commerce",
    items: [
      { name: "Orders", href: "/admin/orders", icon: ShoppingCart },
      { name: "Payments", href: "/admin/payments", icon: CreditCard },
    ],
  },
  {
    label: "Returns",
    items: [
      { name: "Returns", href: "/admin/returns", icon: RotateCcw },
    ],
  },
  {
    label: "People",
    items: [
      { name: "Users", href: "/admin/users", icon: Users },
      { name: "User Groups", href: "/admin/user-groups", icon: Shield },
    ],
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAdmin, loading, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) {
      const timer = setTimeout(() => {
        router.push("/admin?denied=1");
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [loading, isAdmin, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-text-muted font-body text-sm">Loading admin panel…</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-badge-discount/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-badge-discount" />
          </div>
          <h1 className="font-display text-2xl font-bold text-primary mb-3">
            Access Denied
          </h1>
          <p className="text-on-surface-variant mb-6">
            You must be an administrator to access this page. If you believe
            this is an error, contact your system administrator.
          </p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:static top-0 left-0 z-50 h-full bg-primary text-white flex flex-col shadow-xl
          transition-all duration-300 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${sidebarCollapsed ? "md:w-16" : "md:w-64"}
          w-64
        `}
      >
        <div className={`p-4 border-b border-primary-container flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
          {!sidebarCollapsed ? (
            <>
              <h1 className="font-display text-xl font-bold text-accent-gold">
                Admin Panel
              </h1>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="hidden md:flex p-1.5 rounded-lg text-on-primary-container hover:bg-primary-container hover:text-white transition-colors"
                title="Collapse sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="hidden md:flex p-1.5 rounded-lg text-on-primary-container hover:bg-primary-container hover:text-white transition-colors"
              title="Expand sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {sidebarGroups.map((group) => (
            <div key={group.label} className="mb-2">
              {!sidebarCollapsed && (
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-on-primary-container/50">
                    {group.label}
                  </p>
                </div>
              )}
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent-gold text-primary"
                        : "text-on-primary-container hover:bg-primary-container hover:text-white"
                    }`}
                    title={sidebarCollapsed ? `${group.label} — ${item.name}` : undefined}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-primary-container">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-on-primary-container hover:bg-primary-container hover:text-white rounded-md transition-colors w-full"
            title={sidebarCollapsed ? "Sign Out" : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-surface-card border-b border-border-light px-4 py-4 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 rounded-lg text-text-muted hover:text-on-surface hover:bg-surface-subtle transition-colors"
            title="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h2 className="font-display text-lg font-bold text-primary">
            {sidebarGroups
              .flatMap((g) => g.items)
              .find((item) => pathname === item.href)?.name ?? "Admin"}
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
