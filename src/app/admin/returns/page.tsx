import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Returns — Admin" };

export default function ReturnsPage() {
  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl font-bold text-primary">Returns</h2>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <ReturnsTable />
      </Suspense>
    </div>
  );
}

async function ReturnsTable() {
  const { getSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-text-muted">Service not configured</p>;

  const { data: returns } = await supabase
    .from("returns")
    .select("id, order_id, reason, status, refund_amount, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!returns || returns.length === 0) {
    return (
      <div className="bg-surface-card border border-border-light rounded-xl p-12 text-center">
        <p className="text-text-muted text-sm">No returns found.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-border-light rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-subtle">
            <tr>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Return ID</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Order</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Reason</th>
              <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Refund</th>
              <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id} className="border-b border-border-light last:border-b-0">
                <td className="px-4 py-3 text-sm font-mono text-on-surface">{r.id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-sm font-mono text-on-surface">{r.order_id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-sm text-on-surface">{r.reason || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.status === "completed" ? "bg-green-100 text-green-700" :
                    r.status === "rejected" ? "bg-red-100 text-red-700" :
                    r.status === "approved" ? "bg-blue-100 text-blue-700" :
                    r.status === "received" ? "bg-yellow-100 text-yellow-700" :
                    "bg-surface-subtle text-text-muted"
                  }`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-sm text-on-surface text-right">
                  {r.refund_amount ? `৳ ${Number(r.refund_amount).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-sm text-text-muted">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}