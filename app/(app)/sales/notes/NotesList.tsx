"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSalesNote, postSalesNote, deleteSalesNote } from "@/app/actions/salesNotes";
import { Plus, X, FileMinus, CheckCircle2, Trash2 } from "lucide-react";
import { SalesNoteType } from "@prisma/client";
import { can, SessionUser } from "@/lib/rbac";

interface Note {
  id: string;
  number: string;
  type: string;
  customer: string;
  invoiceNumber: string | null;
  refType: string | null;
  amount: number;
  reason: string | null;
  posted: boolean;
  createdAt: string;
}
interface CustomerOpt { id: string; code: string; name: string }
interface InvoiceOpt { id: string; number: string; customerId: string; outstanding: number }
interface ItemOpt { id: string; code: string; name: string }

const REF_TYPES = ["SALES_RETURN", "RATE_DIFF", "DISCOUNT", "OTHER"];

export default function NotesList({
  initialNotes,
  customers,
  invoices,
  items,
  user,
}: {
  initialNotes: Note[];
  customers: CustomerOpt[];
  invoices: InvoiceOpt[];
  items: ItemOpt[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [notes] = useState(initialNotes);
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<SalesNoteType>(SalesNoteType.CREDIT);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [refType, setRefType] = useState("SALES_RETURN");
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [itemId, setItemId] = useState("");
  const [returnQty, setReturnQty] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = can(user, "sales.invoice") || ["ADMIN", "OWNER", "ACCOUNTS"].includes(user.role);
  const custInvoices = invoices.filter((i) => i.customerId === customerId);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv && type === SalesNoteType.CREDIT && amount === 0) setAmount(inv.outstanding);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const isReturn = type === SalesNoteType.CREDIT && refType === "SALES_RETURN";
    const res = await createSalesNote({
      type,
      customerId,
      invoiceId: invoiceId || null,
      refType,
      amount: Number(amount),
      reason: reason || null,
      itemId: isReturn && itemId ? itemId : null,
      returnQty: isReturn && returnQty > 0 ? Number(returnQty) : null,
    } as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to create note");
      return;
    }
    setIsOpen(false);
    setCustomerId("");
    setInvoiceId("");
    setAmount(0);
    setReason("");
    setItemId("");
    setReturnQty(0);
    router.refresh();
  };

  const act = async (fn: () => Promise<any>) => {
    const res = await fn();
    if (!res.success) alert(res.error);
    router.refresh();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <FileMinus size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Credit / Debit Notes</h1>
            <p className="text-xs text-onyx/50">Sales returns, rate differences &amp; adjustments</p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setIsOpen(true)} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
            <Plus size={16} /> New Note
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Note #</th>
              <th className="text-left px-4 py-3 font-semibold">Type</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Against Invoice</th>
              <th className="text-left px-4 py-3 font-semibold">Reason</th>
              <th className="text-right px-4 py-3 font-semibold">Amount</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {notes.map((n) => (
              <tr key={n.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{n.number}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${n.type === "CREDIT" ? "bg-green-100 text-green-800 border-green-200" : "bg-orange-100 text-orange-800 border-orange-200"}`}>
                    {n.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-onyx">{n.customer}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs font-mono">{n.invoiceNumber || "—"}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">
                  {n.refType?.replace(/_/g, " ") || "—"}
                  {n.reason && <span className="block text-[10px] text-onyx/40">{n.reason}</span>}
                </td>
                <td className="px-4 py-3 text-right font-medium text-onyx">₹{n.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${n.posted ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    {n.posted ? "POSTED" : "DRAFT"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {canManage && !n.posted && (
                      <>
                        <button title="Post (make final)" onClick={() => act(() => postSalesNote(n.id))} className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                          <CheckCircle2 size={15} />
                        </button>
                        <button title="Delete draft" onClick={() => { if (confirm(`Delete draft note ${n.number}?`)) act(() => deleteSalesNote(n.id)); }} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {notes.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-onyx/40 text-sm">No credit/debit notes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10">
              <h2 className="font-heading font-bold text-onyx">New Credit / Debit Note</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                {[SalesNoteType.CREDIT, SalesNoteType.DEBIT].map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold border ${type === t ? "bg-saffron text-onyx border-saffron" : "bg-white text-onyx/60 border-onyx/15"}`}
                  >
                    {t === "CREDIT" ? "Credit Note (customer owes less)" : "Debit Note (customer owes more)"}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer *</label>
                <select className={inputCls} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); }}>
                  <option value="">Select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Against invoice (optional)</label>
                <select className={inputCls} value={invoiceId} onChange={(e) => pickInvoice(e.target.value)} disabled={!customerId}>
                  <option value="">Not linked</option>
                  {custInvoices.map((i) => (
                    <option key={i.id} value={i.id}>{i.number} — outstanding ₹{i.outstanding.toLocaleString("en-IN")}</option>
                  ))}
                </select>
                {type === "CREDIT" && invoiceId && (
                  <p className="text-[11px] text-onyx/40 mt-1">Posting will reduce this invoice's outstanding by the note amount.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Reason</label>
                  <select className={inputCls} value={refType} onChange={(e) => setRefType(e.target.value)}>
                    {REF_TYPES.map((r) => (
                      <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Amount (₹) *</label>
                  <input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </div>
              </div>
              {type === SalesNoteType.CREDIT && refType === "SALES_RETURN" && (
                <div className="grid grid-cols-2 gap-4 rounded-lg bg-green-50/50 border border-green-100 p-3">
                  <div>
                    <label className="block text-xs font-semibold text-onyx/60 mb-1">Returned product</label>
                    <select className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                      <option value="">Not itemised</option>
                      {items.map((it) => (<option key={it.id} value={it.id}>{it.name} ({it.code})</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-onyx/60 mb-1">Qty returned</label>
                    <input type="number" className={inputCls} value={returnQty} onChange={(e) => setReturnQty(Number(e.target.value))} />
                  </div>
                  <p className="col-span-2 text-[11px] text-green-700/70">Posting will add this quantity back into stock.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Note / remarks</label>
                <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 5 units returned, damaged in transit" />
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !customerId || amount <= 0} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Saving…" : "Create note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
