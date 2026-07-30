"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addStockEntry } from "@/app/actions/stockEntry";
import { Boxes, Plus, X, Search } from "lucide-react";

interface Product { id: string; code: string; name: string; baseUom: string; reorderLevel: number; onHand: number }
interface StoreOpt { id: string; code: string; name: string }

const ENTRY_TYPES = [
  { value: "OPENING", label: "Opening stock" },
  { value: "RECEIVED", label: "Received / Production" },
  { value: "ADJUSTMENT", label: "Adjustment (±)" },
];

export default function StockClient({ products, stores }: { products: Product[]; stores: StoreOpt[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [entryType, setEntryType] = useState("OPENING");
  const [qty, setQty] = useState<number>(0);
  const [rate, setRate] = useState<number>(0);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase())
  );

  const openFor = (id?: string) => {
    setError(null);
    setItemId(id || "");
    setEntryType("OPENING");
    setQty(0);
    setRate(0);
    setRemarks("");
    setIsOpen(true);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const res = await addStockEntry({
      itemId,
      storeId: storeId || null,
      entryType: entryType as any,
      qty: Number(qty),
      rate: rate ? Number(rate) : null,
      remarks: remarks || null,
    } as any);
    setLoading(false);
    if (!res.success) { setError(res.error || "Failed"); return; }
    setIsOpen(false);
    router.refresh();
  };

  const stockClass = (p: Product) =>
    p.onHand <= 0 ? "text-red-600" : p.onHand < p.reorderLevel ? "text-amber-600" : "text-onyx";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <Boxes size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Stock on Hand</h1>
            <p className="text-xs text-onyx/50">Finished-goods levels — add opening/received stock or adjust</p>
          </div>
        </div>
        <button onClick={() => openFor()} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
          <Plus size={16} /> Stock Entry
        </button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-onyx/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-full pl-9 pr-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none"
        />
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Code</th>
              <th className="text-left px-4 py-3 font-semibold">Product</th>
              <th className="text-right px-4 py-3 font-semibold">On Hand</th>
              <th className="text-left px-4 py-3 font-semibold">UOM</th>
              <th className="text-right px-4 py-3 font-semibold">Reorder</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{p.code}</td>
                <td className="px-4 py-3 text-onyx">{p.name}</td>
                <td className={`px-4 py-3 text-right font-semibold ${stockClass(p)}`}>{p.onHand.toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{p.baseUom}</td>
                <td className="px-4 py-3 text-right text-onyx/50 text-xs">{p.reorderLevel || "—"}</td>
                <td className="px-4 py-3">
                  {p.onHand <= 0 ? (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-red-100 text-red-800 border-red-200">OUT OF STOCK</span>
                  ) : p.onHand < p.reorderLevel ? (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-amber-100 text-amber-800 border-amber-200">LOW</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-green-100 text-green-800 border-green-200">IN STOCK</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openFor(p.id)} className="text-xs text-saffron-dark font-semibold hover:underline">+ Stock</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-onyx/40 text-sm">No products found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10">
              <h2 className="font-heading font-bold text-onyx">Stock Entry</h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Product *</label>
                <select className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Select…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code}) — on hand {p.onHand}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Entry type</label>
                  <select className={inputCls} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                    {ENTRY_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Store</label>
                  <select className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">Company default</option>
                    {stores.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.code})</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">
                    Qty * {entryType === "ADJUSTMENT" && <span className="text-onyx/40">(±)</span>}
                  </label>
                  <input type="number" className={inputCls} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Unit cost (₹)</label>
                  <input type="number" className={inputCls} value={rate} onChange={(e) => setRate(Number(e.target.value))} placeholder="for valuation" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-onyx/60 mb-1">Remarks</label>
                <input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || !itemId || qty === 0} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Saving…" : "Add entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
