"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  ShoppingCart,
  Clock,
  TrendingUp,
  Calendar,
} from "lucide-react";
import type { Product } from "@/types";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

interface DashboardOrder {
  id: string;
  customer_name: string;
  customer_email?: string;
  total_amount: number;
  status: string;
  created_at: string;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  bgColor: string;
  iconColor: string;
}

function StatCard({ title, value, icon, bgColor, iconColor }: StatCardProps) {
  return (
    <div className={`p-6 rounded-xl ${bgColor} border border-border-light`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">
            {title}
          </p>
          <p className="text-2xl font-bold text-primary mt-1">{value}</p>
        </div>
        <div className={`${iconColor} p-3 rounded-lg bg-white/50`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [productsRes, ordersRes] = await Promise.all([
          fetch("/api/admin/products?limit=1"),
          fetch("/api/admin/orders?limit=1000"),
        ]);

        const productsData: ApiResponse<Product> = await productsRes.json();
        const ordersData: ApiResponse<DashboardOrder> = await ordersRes.json();

        if (!productsRes.ok) throw new Error(productsData.error ?? "Failed to load products");
        if (!ordersRes.ok) throw new Error(ordersData.error ?? "Failed to load orders");

        setProducts(productsData.data);
        setOrders(ordersData.data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load dashboard data"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const totalProducts = products.length;
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce(
    (sum, order) => sum + Number(order.total_amount ?? 0),
    0
  );
  const pendingOrders = orders.filter(
    (o) => o.status === "pending"
  ).length;
  const recentOrders = orders
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at ?? "").getTime() -
        new Date(a.created_at ?? "").getTime()
    )
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-4">
        <p className="text-badge-discount text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Products"
          value={totalProducts}
          icon={<Package className="w-6 h-6" />}
          bgColor="bg-surface-card"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Total Orders"
          value={totalOrders}
          icon={<ShoppingCart className="w-6 h-6" />}
          bgColor="bg-surface-card"
          iconColor="text-purple-500"
        />
        <StatCard
          title="Total Revenue"
          value={`৳ ${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp className="w-6 h-6" />}
          bgColor="bg-surface-card"
          iconColor="text-green-500"
        />
        <StatCard
          title="Pending Orders"
          value={pendingOrders}
          icon={<Clock className="w-6 h-6" />}
          bgColor="bg-surface-card"
          iconColor="text-orange-500"
        />
      </div>

      {/* Recent Orders */}
      <div className="bg-surface-card border border-border-light rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-primary">
            Recent Orders
          </h3>
          <Link
            href="/admin/orders"
            className="text-sm text-primary hover:text-primary-container transition-colors"
          >
            View all
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider pb-3">
                  Order ID
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider pb-3">
                  Customer
                </th>
                <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider pb-3">
                  Total
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider pb-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider pb-3">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-text-muted py-6 text-sm">
                    No orders found.
                  </td>
                </tr>
              ) : (
                recentOrders.map((order) => (
                  <tr key={order.id} className="border-b border-border-light last:border-b-0">
                    <td className="py-3 text-sm font-medium text-on-surface">
                      {order.id}
                    </td>
                    <td className="py-3 text-sm text-on-surface">
                      {order.customer_name}
                    </td>
                    <td className="py-3 text-sm text-on-surface text-right">
                      ৳ {Number(order.total_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          order.status === "delivered"
                            ? "bg-green-100 text-green-700"
                            : order.status === "shipped"
                            ? "bg-blue-100 text-blue-700"
                            : order.status === "processing"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-text-muted">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(order.created_at ?? "").toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
