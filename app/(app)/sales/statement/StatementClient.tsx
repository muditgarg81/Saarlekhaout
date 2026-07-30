"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { FileText, Download, Loader2 } from "lucide-react";
import { getCustomerStatement, type StatementRow } from "@/app/actions/statements";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function fyDefaults() {
  const now = new Date();
  // Indian FY: 1 Apr – 31 Mar
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const from = new Date(y, 3, 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(now) };
}

interface CustomerOpt { id: string; code: string; name: string }

export default function StatementClient({ customers }: { customers: CustomerOpt[] }) {
  const def = fyDefaults();
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<null | {
    customer: { code: string; name: string; gstin: string | null; billingAddress: string | null };
    company: { name: string; gstin: string; address: string };
    opening: number;
    closing: number;
    periodDebit: number;
    periodCredit: number;
    rows: StatementRow[];
  }>(null);

  const load = async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    const res = await getCustomerStatement(customerId, from, to);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to load");
      setData(null);
      return;
    }
    setData({
      customer: res.customer as any,
      company: res.company,
      opening: res.opening,
      closing: res.closing,
      periodDebit: res.periodDebit,
      periodCredit: res.periodCredit,
      rows: res.rows,
    });
  };

  const exportExcel = () => {
    if (!data) return;
    const header = [
      { A: data.company.name, B: "", C: "", D: "", E: "" },
      { A: `GSTIN: ${data.company.gstin}`, B: "", C: "", D: "", E: "" },
      { A: `Statement of Account: ${data.customer.name} (${data.customer.code})`, B: "", C: "", D: "", E: "" },
      { A: `Period: ${from} to ${to}`, B: "", C: "", D: "", E: "" },
      {},
    ];
    const rows = [
      { Date: "", Type: "", Reference: "", Particulars: "Opening Balance", Debit: "", Credit: "", Balance: data.opening },
      ...data.rows.map((r) => ({
        Date: r.date, Type: r.type, Reference: r.ref, Particulars: r.particulars,
        Debit: r.debit || "", Credit: r.credit || "", Balance: r.balance,
      })),
      { Date: "", Type: "", Reference: "", Particulars: "Closing Balance", Debit: data.periodDebit, Credit: data.periodCredit, Balance: data.closing },
    ];
    const ws = XLSX.utils.json_to_sheet(header, { header: ["A", "B", "C", "D", "E"], skipHeader: true });
    XLSX.utils.sheet_add_json(ws, rows, { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");
    XLSX.writeFile(wb, `Statement_${data.customer.code}_${from}_to_${to}.xlsx`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
          <FileText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-onyx">Customer Statement of Account</h1>
          <p className="text-xs text-onyx/50">Running ledger of invoices, receipts &amp; notes — share for reconciliation</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-onyx/10 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-[220px]">
          <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer</label>
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-onyx/60 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-onyx/60 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <button onClick={load} disabled={loading || !customerId} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}{loading ? "Loading…" : "Load"}
        </button>
        {data && (
          <button onClick={exportExcel} className="px-5 py-2 bg-onyx hover:bg-onyx-light text-cream-light font-semibold rounded-lg text-sm flex items-center gap-2">
            <Download size={15} /> Export Excel
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {data && (
        <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-onyx/10">
            <div className="font-heading font-bold text-onyx">{data.customer.name} <span className="text-onyx/40 font-normal">({data.customer.code})</span></div>
            {data.customer.gstin && <div className="text-xs text-onyx/50 font-mono">GSTIN: {data.customer.gstin}</div>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-onyx/5">
            {[
              { label: "Opening", value: inr(data.opening) },
              { label: "Debits (period)", value: inr(data.periodDebit) },
              { label: "Credits (period)", value: inr(data.periodCredit) },
              { label: "Closing balance", value: inr(data.closing), strong: true },
            ].map((k) => (
              <div key={k.label} className="bg-white p-4">
                <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">{k.label}</div>
                <div className={`mt-1 font-heading font-bold ${k.strong ? "text-lg text-onyx" : "text-base text-onyx/80"}`}>{k.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 font-semibold">Reference</th>
                  <th className="text-left px-4 py-3 font-semibold">Particulars</th>
                  <th className="text-right px-4 py-3 font-semibold">Debit</th>
                  <th className="text-right px-4 py-3 font-semibold">Credit</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onyx/5">
                <tr className="bg-cream-light/40">
                  <td className="px-4 py-2" colSpan={4}><span className="font-semibold text-onyx/70">Opening Balance</span></td>
                  <td></td><td></td>
                  <td className="px-4 py-2 text-right font-semibold text-onyx">{inr(data.opening)}</td>
                </tr>
                {data.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-cream-light/40">
                    <td className="px-4 py-2 text-onyx/60">{r.date}</td>
                    <td className="px-4 py-2 text-onyx/70">{r.type}</td>
                    <td className="px-4 py-2 font-mono text-xs text-onyx/70">{r.ref}</td>
                    <td className="px-4 py-2 text-onyx/60 text-xs">{r.particulars}</td>
                    <td className="px-4 py-2 text-right text-onyx">{r.debit ? inr(r.debit) : "—"}</td>
                    <td className="px-4 py-2 text-right text-green-700">{r.credit ? inr(r.credit) : "—"}</td>
                    <td className="px-4 py-2 text-right font-medium text-onyx">{inr(r.balance)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-onyx/40">No transactions in this period.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-cream-light/60 font-semibold text-onyx">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>Closing Balance</td>
                  <td className="px-4 py-3 text-right">{inr(data.periodDebit)}</td>
                  <td className="px-4 py-3 text-right">{inr(data.periodCredit)}</td>
                  <td className="px-4 py-3 text-right">{inr(data.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
