"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProforma, sendProforma, convertProformaToSalesOrder, cancelProforma } from "@/app/actions/proformas";
import { Plus, X, Trash2, Send, ShoppingCart, Ban, Printer, Copy, FileText } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";
import { generatePDF } from "../pdfGenerator";

interface Line { itemId: string; qty: number; rate: number; discount: number; gstRate: number; specification?: string | null }
interface Proforma {
  id: string; number: string; customerId: string; customer: string; customerGstin: string | null; customerPan: string | null;
  status: string; soId: string | null; proformaDate: string; validUpto: string | null;
  paymentTerms: string | null; deliveryTerms: string | null; placeOfSupply: string | null;
  billingAddress: string | null; shippingAddress: string | null; notes: string | null; otherCharges: number;
  taxableAmount: number; cgst: number; sgst: number; igst: number; totalAmount: number; lines: Line[];
}
interface CustomerOpt { id: string; code: string; name: string; stateCode: string | null; paymentTerms: string | null; gstin: string | null; billingAddress: string | null; shippingAddress: string | null; billingAddresses?: any; shippingAddresses?: any }
interface ItemOpt { id: string; code: string; name: string; baseUom: string; gstRate: number | null; specification: string | null; hsnCode: string | null }
interface QuotationOpt { id: string; number: string; customerId: string; lines: Line[]; paymentTerms: string | null; deliveryTerms: string | null; placeOfSupply: string | null; billingAddress: string | null; shippingAddress: string | null }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  SENT: "bg-blue-100 text-blue-800 border-blue-200",
  CONVERTED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function ProformaList({
  initialProformas, customers, items, quotations, company, docSettings, user,
}: {
  initialProformas: Proforma[]; customers: CustomerOpt[]; items: ItemOpt[]; quotations: QuotationOpt[]; company: any; docSettings: any; user: SessionUser;
}) {
  const router = useRouter();
  const [proformas] = useState(initialProformas);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [validUpto, setValidUpto] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [notes, setNotes] = useState("");
  const [otherCharges, setOtherCharges] = useState<number>(0);
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);

  const canManage = can(user, "sales.invoice") || ["ADMIN", "OWNER", "ACCOUNTS"].includes(user.role);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lineGross = (l: Line) => l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
  const total = lines.reduce((s, l) => s + lineGross(l), 0) + Number(otherCharges || 0);

  const addLine = () => setLines([...lines, { itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const onItemPick = (i: number, id: string) => {
    const it = itemById.get(id);
    setLine(i, { itemId: id, gstRate: it?.gstRate ?? 18, specification: it?.specification ?? "" });
  };

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) { setPlaceOfSupply(c.stateCode || ""); if (c.paymentTerms) setPaymentTerms(c.paymentTerms); }
  };

  const copyFromQuotation = (id: string) => {
    if (!id) return;
    const q = quotations.find((x) => x.id === id);
    if (!q) return;
    setLines(q.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification || "" })));
    if (q.paymentTerms) setPaymentTerms(q.paymentTerms);
    if (q.deliveryTerms) setDeliveryTerms(q.deliveryTerms);
    if (q.placeOfSupply) setPlaceOfSupply(q.placeOfSupply);
  };

  const copyFromProforma = (id: string) => {
    if (!id) return;
    const p = proformas.find((x) => x.id === id);
    if (!p) return;
    setLines(p.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification || "" })));
    if (p.paymentTerms) setPaymentTerms(p.paymentTerms);
    if (p.deliveryTerms) setDeliveryTerms(p.deliveryTerms);
    if (p.placeOfSupply) setPlaceOfSupply(p.placeOfSupply);
    if (p.notes) setNotes(p.notes);
    setOtherCharges(p.otherCharges || 0);
  };

  const resetForm = () => {
    setCustomerId(""); setValidUpto(""); setPaymentTerms(""); setDeliveryTerms(""); setPlaceOfSupply(""); setNotes(""); setOtherCharges(0);
    setLines([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
  };

  const submit = async () => {
    setLoading(true); setError(null);
    const res = await createProforma({
      customerId, validUpto: validUpto || null, paymentTerms: paymentTerms || null, deliveryTerms: deliveryTerms || null,
      placeOfSupply: placeOfSupply || null, notes: notes || null, otherCharges: Number(otherCharges) || 0,
      lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), discount: Number(l.discount), gstRate: Number(l.gstRate), specification: l.specification || null })),
    } as any);
    setLoading(false);
    if (!res.success) { setError(res.error || "Failed to create proforma"); return; }
    setIsOpen(false); resetForm(); router.refresh();
  };

  const act = async (fn: () => Promise<any>) => {
    const res = await fn();
    if (!res.success) { alert(res.error); return; }
    if (res.salesOrderNumber) alert(`Sales Order ${res.salesOrderNumber} created. Raise the delivery note & invoice from Sales Orders.`);
    router.refresh();
  };

  const firstAddr = (list: any, legacy: string | null) => {
    if (Array.isArray(list) && list.length > 0 && list[0]?.address) return String(list[0].address);
    return legacy || "";
  };

  const print = async (p: Proforma) => {
    const linesWithNames = p.lines.map((l) => ({ ...l, itemName: itemById.get(l.itemId)?.name || "Item" }));
    const cust = customers.find((c) => c.id === p.customerId);
    const billingAddress = p.billingAddress || firstAddr(cust?.billingAddresses, cust?.billingAddress || null);
    const shippingAddress = p.shippingAddress || firstAddr(cust?.shippingAddresses, cust?.shippingAddress || null);
    const companyForPdf = { ...company, showBankDetails: docSettings?.showBankDetails, bankDetails: docSettings?.bankDetails, authorizedSignatory: docSettings?.authorizedSignatory };
    await generatePDF("Proforma Invoice", {
      number: p.number, customer: p.customer, customerGstin: p.customerGstin, customerPan: p.customerPan,
      proformaDate: p.proformaDate, validUpto: p.validUpto, paymentTerms: p.paymentTerms, deliveryTerms: p.deliveryTerms,
      placeOfSupply: p.placeOfSupply, billingAddress, shippingAddress,
      termsConditions: p.notes || "", lines: linesWithNames, value: p.totalAmount,
      taxableAmount: p.taxableAmount, cgst: p.cgst, sgst: p.sgst, igst: p.igst,
    }, companyForPdf);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center"><FileText size={20} /></div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Proforma Invoices</h1>
            <p className="text-xs text-onyx/50">Advance-payment invoice → capture to Sales Order → dispatch &amp; invoice</p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => { resetForm(); setError(null); setIsOpen(true); }} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
            <Plus size={16} /> New Proforma
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">PI #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Date</th>
              <th className="text-right px-4 py-3 font-semibold">Total</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {proformas.map((p) => (
              <tr key={p.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{p.number}</td>
                <td className="px-4 py-3 text-onyx">{p.customer}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{new Date(p.proformaDate).toLocaleDateString("en-IN")}</td>
                <td className="px-4 py-3 text-right font-medium text-onyx">{inr(p.totalAmount)}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Export PDF / Print" onClick={() => print(p)} className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70"><Printer size={15} /></button>
                    {canManage && p.status === "DRAFT" && (
                      <button title="Mark as sent" onClick={() => act(() => sendProforma(p.id))} className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Send size={15} /></button>
                    )}
                    {canManage && (p.status === "DRAFT" || p.status === "SENT") && (
                      <button title="Capture → Sales Order (then dispatch & invoice)" onClick={() => { if (confirm(`Convert ${p.number} to a confirmed Sales Order?`)) act(() => convertProformaToSalesOrder(p.id)); }} className="p-1.5 rounded hover:bg-green-50 text-green-600"><ShoppingCart size={15} /></button>
                    )}
                    {canManage && p.status !== "CONVERTED" && p.status !== "CANCELLED" && (
                      <button title="Cancel" onClick={() => act(() => cancelProforma(p.id, "Cancelled"))} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Ban size={15} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {proformas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">No proforma invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10 sticky top-0 bg-white z-10">
              <h2 className="font-heading font-bold text-onyx">New Proforma Invoice</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer *</label>
                  <select className={inputCls} value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                    <option value="">Select…</option>
                    {customers.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.code})</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Valid Upto</label>
                  <input type="date" className={inputCls} value={validUpto} onChange={(e) => setValidUpto(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Place of Supply</label>
                  <input className={inputCls} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} placeholder="State code e.g. 27" />
                </div>
              </div>

              {customerId && quotations.some((q) => q.customerId === customerId) && (
                <div className="p-3 rounded-lg bg-saffron/10 border border-saffron/20 flex items-center gap-3">
                  <Copy size={15} className="text-saffron-dark shrink-0" />
                  <label className="text-xs font-bold text-onyx/70 uppercase whitespace-nowrap">From quotation</label>
                  <select value="" onChange={(e) => copyFromQuotation(e.target.value)} className="flex-1 text-sm px-3 py-1.5 bg-white border border-onyx/10 rounded-lg">
                    <option value="">Prefill from a quotation…</option>
                    {quotations.filter((q) => q.customerId === customerId).map((q) => (<option key={q.id} value={q.id}>{q.number} · {q.lines.length} item(s)</option>))}
                  </select>
                </div>
              )}

              {customerId && proformas.some((p) => p.customerId === customerId) && (
                <div className="p-3 rounded-lg bg-onyx/5 border border-onyx/10 flex items-center gap-3">
                  <Copy size={15} className="text-onyx/50 shrink-0" />
                  <label className="text-xs font-bold text-onyx/70 uppercase whitespace-nowrap">From proforma</label>
                  <select value="" onChange={(e) => copyFromProforma(e.target.value)} className="flex-1 text-sm px-3 py-1.5 bg-white border border-onyx/10 rounded-lg">
                    <option value="">Reuse an earlier proforma for this customer…</option>
                    {proformas.filter((p) => p.customerId === customerId).map((p) => (<option key={p.id} value={p.id}>{p.number} · {new Date(p.proformaDate).toLocaleDateString("en-IN")} · {p.lines.length} item(s)</option>))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Payment Terms</label>
                  <input className={inputCls} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 100% advance" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Delivery Terms</label>
                  <input className={inputCls} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder="e.g. FOR Destination" />
                </div>
              </div>

              {/* Line editor */}
              <div className="border border-onyx/10 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-cream-light text-onyx/60 uppercase">
                    <tr>
                      <th className="text-left px-2 py-2">Item</th>
                      <th className="px-2 py-2 w-14">Qty</th>
                      <th className="px-2 py-2 w-20">Rate</th>
                      <th className="px-2 py-2 w-14">Disc%</th>
                      <th className="px-2 py-2 w-14">GST%</th>
                      <th className="px-2 py-2 w-24 text-right">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t border-onyx/5">
                        <td className="px-2 py-1">
                          <select className={cellCls} value={l.itemId} onChange={(e) => onItemPick(i, e.target.value)}>
                            <option value="">Select…</option>
                            {items.map((it) => (<option key={it.id} value={it.id}>{it.name} ({it.code})</option>))}
                          </select>
                        </td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.rate} onChange={(e) => setLine(i, { rate: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.discount} onChange={(e) => setLine(i, { discount: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input type="number" className={cellCls} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1 text-right font-medium">{inr(lineGross(l))}</td>
                        <td className="px-2 py-1 text-center">{lines.length > 1 && (<button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <button onClick={addLine} className="text-sm text-saffron-dark font-semibold flex items-center gap-1"><Plus size={14} /> Add line</button>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-onyx/60">Other charges</label>
                  <input type="number" className="w-28 px-2 py-1 border border-onyx/15 rounded text-xs text-right" value={otherCharges} onChange={(e) => setOtherCharges(Number(e.target.value))} />
                  <div className="text-sm font-bold text-onyx">Total: {inr(total)}</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Notes (payment instructions, etc.)</label>
                <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10 sticky bottom-0 bg-white">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !customerId || lines.every((l) => !l.itemId)} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Creating…" : "Create proforma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
const cellCls = "w-full px-2 py-1 border border-onyx/15 rounded text-xs outline-none focus:ring-1 focus:ring-saffron/40";
