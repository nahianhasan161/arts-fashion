"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Tag,
  Users,
  LogOut,
  Shield,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const sidebarItems: SidebarItem[] = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Products", href: "/admin/products", icon: Package },
  { name: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { name: "Categories", href: "/admin/categories", icon: Tag },
  { name: "Users", href: "/admin/users", icon: Users },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAdmin, loading, signOut } = useAuth();

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
      {/* Mobile sidebar toggle removed for simplicity; sidebar is desktop-only */}

      {/* Sidebar */}
      <aside className="w-64 bg-primary text-white flex flex-col shadow-xl">
        <div className="p-6 border-b border-primary-container">
          <h1 className="font-display text-xl font-bold text-accent-gold">
            Admin Panel
          </h1>
          <p className="text-on-primary-container text-xs mt-1">
            {user?.email}
          </p>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent-gold text-primary"
                    : "text-on-primary-container hover:bg-primary-container hover:text-white"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-primary-container">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-on-primary-container hover:bg-primary-container hover:text-white rounded-md transition-colors w-full"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-surface-card border-b border-border-light px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="font-display text-lg font-bold text-primary">
            {sidebarItems.find((item) => pathname === item.href)?.name ?? "Admin"}
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
