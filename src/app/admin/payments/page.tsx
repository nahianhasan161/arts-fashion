import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Payments — Admin" };

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl font-bold text-primary">Payments</h2>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <PaymentsTable />
      </Suspense>
    </div>
  );
}

async function PaymentsTable() {
  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-text-muted">Service not configured</p>;

  const { data: payments } = await supabase
    .from("payments")
    .select("id, order_id, type, provider, provider_txn_id, amount, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!payments || payments.length === 0) {
    return (
      <div className="bg-surface-card border border-border-light rounded-xl p-12 text-center">
        <p className="text-text-muted text-sm">No payments found.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-border-light rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-subtle">
            <tr>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">ID</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Order</th>
              <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Type</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Provider</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Txn ID</th>
              <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Amount</th>
              <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border-light last:border-b-0">
                <td className="px-4 py-3 text-sm font-mono text-on-surface">{p.id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-sm font-mono text-on-surface">{p.order_id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.type === "charge" ? "bg-blue-100 text-blue-700" :
                    p.type === "refund" ? "bg-green-100 text-green-700" :
                    "bg-purple-100 text-purple-700"
                  }`}>{p.type}</span>
                </td>
                <td className="px-4 py-3 text-sm text-on-surface">{p.provider}</td>
                <td className="px-4 py-3 text-sm text-text-muted font-mono">{p.provider_txn_id || "—"}</td>
                <td className="px-4 py-3 text-sm text-on-surface text-right">৳ {Number(p.amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === "successful" ? "bg-green-100 text-green-700" :
                    p.status === "failed" ? "bg-red-100 text-red-700" :
                    p.status === "refunded" ? "bg-purple-100 text-purple-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>{p.status}</span>
                </td>
                <td className="px-4 py-3 text-sm text-text-muted">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}