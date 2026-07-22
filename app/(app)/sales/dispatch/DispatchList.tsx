"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDispatch, generateEWayBill, markDispatchDelivered, deleteDispatch, updateDispatch, postDispatch } from "@/app/actions/dispatches";
import { Plus, X, Truck, FileCheck2, PackageCheck, Pencil, Trash2, Eye, Send, Printer } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";
import { SearchableSelect } from "@/components/SearchableSelect";
import { generatePDF } from "../pdfGenerator";
import CopySelectorModal from "@/components/CopySelectorModal";

interface DispatchRow {
  id: string;
  number: string;
  soNumber: string | null;
  customer: string;
  status: string;
  dispatchDate: string;
  storeId: string | null;
  vehicleNo: string | null;
  transporterName: string | null;
  lrNo: string | null;
  distanceKm: number | null;
  ewayBillNo: string | null;
  ewayBillStatus: string;
  lineCount: number;
  packingListNumber: string | null;
  lines: { id: string; itemId: string; itemName: string; qty: number; batchNo: string | null }[];
}
interface OpenLine { soLineId: string; itemId: string; itemName: string; open: number; rate: number }
interface OpenOrder { id: string; number: string; customer: string; lines: OpenLine[] }
interface StoreOpt { id: string; code: string; name: string }
interface PackingListOpt { id: string; number: string; soId: string | null }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  PACKED: "bg-amber-100 text-amber-800 border-amber-200",
  DISPATCHED: "bg-blue-100 text-blue-800 border-blue-200",
  DELIVERED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};
const EWAY_STYLES: Record<string, string> = {
  NOT_REQUIRED: "text-onyx/40",
  PENDING: "text-amber-600",
  GENERATED: "text-green-600",
  CANCELLED: "text-red-500",
  EXPIRED: "text-orange-600",
  FAILED: "text-red-600",
};

export default function DispatchList({
  initialDispatches,
  openOrders,
  stores,
  packingLists,
  user,
  company,
}: {
  initialDispatches: DispatchRow[];
  openOrders: OpenOrder[];
  stores: StoreOpt[];
  packingLists: PackingListOpt[];
  user: SessionUser;
  company: any;
}) {
  const router = useRouter();
  const [rows] = useState(initialDispatches);
  const [printTarget, setPrintTarget] = useState<any | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [soId, setSoId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [lrNo, setLrNo] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [packingListId, setPackingListId] = useState("");
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const [reviewDispatch, setReviewDispatch] = useState<DispatchRow | null>(null);
  const [editingDispatchId, setEditingDispatchId] = useState<string | null>(null);

  const canDispatch = can(user, "dispatch.create") || ["ADMIN", "OWNER"].includes(user.role);
  const canEway = can(user, "ewaybill.generate") || ["ADMIN", "OWNER"].includes(user.role);

  const order = openOrders.find((o) => o.id === soId);

  const pickOrder = (id: string) => {
    setSoId(id);
    setPackingListId("");
    const o = openOrders.find((x) => x.id === id);
    const init: Record<string, number> = {};
    o?.lines.forEach((l) => (init[l.soLineId] = l.open));
    setQtys(init);
  };

  const resetForm = () => {
    setSoId("");
    setPackingListId("");
    setStoreId("");
    setVehicleNo("");
    setTransporterName("");
    setLrNo("");
    setDistanceKm(0);
    setQtys({});
  };

  const handleCancelModal = () => {
    setIsOpen(false);
    setEditingDispatchId(null);
    resetForm();
  };

  const submit = async () => {
    setLoading(true);
    setError(null);

    if (editingDispatchId) {
      const res = await updateDispatch(editingDispatchId, {
        storeId: storeId || null,
        vehicleNo: vehicleNo || null,
        transporterName: transporterName || null,
        lrNo: lrNo || null,
        distanceKm: distanceKm || null,
      });
      setLoading(false);
      if (!res.success) {
        setError(res.error || "Failed to update dispatch");
        return;
      }
      setIsOpen(false);
      setEditingDispatchId(null);
      resetForm();
      router.refresh();
      return;
    }

    if (!order) {
      setLoading(false);
      return;
    }
    const lines = order.lines
      .map((l) => ({ soLineId: l.soLineId, itemId: l.itemId, qty: Number(qtys[l.soLineId] || 0) }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) {
      setError("Enter at least one dispatch quantity");
      setLoading(false);
      return;
    }
    const res = await createDispatch({
      soId,
      storeId: storeId || null,
      vehicleNo: vehicleNo || null,
      transporterName: transporterName || null,
      lrNo: lrNo || null,
      distanceKm: distanceKm || null,
      packingListId: packingListId || null,
      lines,
    } as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to create dispatch");
      return;
    }
    setIsOpen(false);
    resetForm();
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
            <Truck size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Dispatch & Delivery</h1>
            <p className="text-xs text-onyx/50">Outward goods, stock issue & GST e-way bill</p>
          </div>
        </div>
        {canDispatch && (
          <button onClick={() => setIsOpen(true)} className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm">
            <Plus size={16} /> New Dispatch
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">DC #</th>
              <th className="text-left px-4 py-3 font-semibold">Order</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Packing List</th>
              <th className="text-left px-4 py-3 font-semibold">Vehicle</th>
              <th className="text-left px-4 py-3 font-semibold">E-way Bill</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{d.number}</td>
                <td className="px-4 py-3 text-onyx/70 text-xs">{d.soNumber || "—"}</td>
                <td className="px-4 py-3 text-onyx">{d.customer}</td>
                <td className="px-4 py-3 font-mono text-xs text-onyx/60">{d.packingListNumber || "—"}</td>
                <td className="px-4 py-3 text-onyx/60 text-xs">{d.vehicleNo || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={EWAY_STYLES[d.ewayBillStatus]}>
                    {d.ewayBillNo || d.ewayBillStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_STYLES[d.status]}`}>
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Review Details" onClick={() => setReviewDispatch(d)} className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70">
                      <Eye size={15} />
                    </button>
                    {d.status !== "DRAFT" && (
                      <button
                        title="Export PDF / Print"
                        onClick={() => setPrintTarget(d)}
                        className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70 cursor-pointer"
                      >
                        <Printer size={15} />
                      </button>
                    )}
                    {d.status === "DRAFT" && canDispatch && (
                      <>
                        <button
                          title="Edit Dispatch"
                          onClick={() => {
                            setEditingDispatchId(d.id);
                            setSoId(d.soNumber || "");
                            setPackingListId(d.packingListNumber || "");
                            setStoreId(d.storeId || "");
                            setVehicleNo(d.vehicleNo || "");
                            setTransporterName(d.transporterName || "");
                            setLrNo(d.lrNo || "");
                            setDistanceKm(d.distanceKm || 0);
                            setIsOpen(true);
                          }}
                          className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          title="Post / Confirm Dispatch"
                          onClick={() => {
                            if (confirm(`Are you sure you want to post dispatch challan ${d.number}? This will update stock levels and Sales Order fulfillment.`)) {
                              act(() => postDispatch(d.id));
                            }
                          }}
                          className="p-1.5 rounded hover:bg-green-50 text-green-600"
                        >
                          <Send size={15} />
                        </button>
                        <button
                          title="Delete Draft"
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete draft dispatch ${d.number}? The linked packing list status will revert to DRAFT.`)) {
                              act(() => deleteDispatch(d.id));
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                    {canEway && ["PENDING"].includes(d.ewayBillStatus) && (
                      <button title="Generate e-way bill" onClick={() => act(() => generateEWayBill(d.id))} className="p-1.5 rounded hover:bg-green-50 text-green-600">
                        <FileCheck2 size={15} />
                      </button>
                    )}
                    {d.status === "DISPATCHED" && (
                      <button title="Mark delivered" onClick={() => act(() => markDispatchDelivered(d.id))} className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                        <PackageCheck size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-onyx/40 text-sm">No dispatches yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10 sticky top-0 bg-white">
              <h2 className="font-heading font-bold text-onyx">{editingDispatchId ? "Edit Dispatch Details" : "New Dispatch"}</h2>
              <button onClick={handleCancelModal} className="text-onyx/40 hover:text-onyx"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Sales Order</label>
                  {editingDispatchId ? (
                    <input type="text" className={`${inputCls} bg-cream-dark/10 border-onyx/10 text-onyx/50 cursor-not-allowed`} value={soId} disabled readOnly />
                  ) : (
                    <SearchableSelect
                      options={openOrders.map((o) => ({ value: o.id, label: `${o.number} — ${o.customer}` }))}
                      value={soId}
                      onChange={(val) => pickOrder(val)}
                      placeholder="Select order..."
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Issue from store</label>
                  <select className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">Company default</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {soId && (
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Link Packing List (Supporting Document)</label>
                  {editingDispatchId ? (
                    <input type="text" className={`${inputCls} bg-cream-dark/10 border-onyx/10 text-onyx/50 cursor-not-allowed`} value={packingListId || "—"} disabled readOnly />
                  ) : (
                    <select className={inputCls} value={packingListId} onChange={(e) => setPackingListId(e.target.value)}>
                      <option value="">-- No Packing List --</option>
                      {packingLists.filter(p => p.soId === soId).map((p) => (
                        <option key={p.id} value={p.id}>{p.number}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {!editingDispatchId && order && (
                <div className="border border-onyx/10 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-cream-light text-onyx/60 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="px-3 py-2 w-24">Open</th>
                        <th className="px-3 py-2 w-28">Dispatch qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((l) => (
                        <tr key={l.soLineId} className="border-t border-onyx/5">
                          <td className="px-3 py-2">{l.itemName}</td>
                          <td className="px-3 py-2 text-onyx/60">{l.open}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              max={l.open}
                              min={0}
                              className={cellCls}
                              value={qtys[l.soLineId] ?? 0}
                              onChange={(e) => setQtys({ ...qtys, [l.soLineId]: Number(e.target.value) })}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Vehicle no</label>
                  <input className={inputCls} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Transporter</label>
                  <input className={inputCls} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">LR / Docket</label>
                  <input className={inputCls} value={lrNo} onChange={(e) => setLrNo(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Distance (km)</label>
                  <input type="number" className={inputCls} value={distanceKm} onChange={(e) => setDistanceKm(Number(e.target.value))} />
                </div>
              </div>
              <p className="text-[11px] text-onyx/40">
                Consignment value over ₹50,000 flags an e-way bill for generation after dispatch.
              </p>
              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={handleCancelModal} className="px-4 py-2 text-sm text-onyx/60">Cancel</button>
              <button onClick={submit} disabled={loading || (!editingDispatchId && !soId)} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50">
                {loading ? "Saving…" : editingDispatchId ? "Update Details" : "Create dispatch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Details Modal */}
      {reviewDispatch && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 font-body">
            {/* Header */}
            <div className="flex justify-between items-center pb-4 border-b border-onyx/5 mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-heading font-bold text-onyx font-sans">Dispatch Challan {reviewDispatch.number}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_STYLES[reviewDispatch.status]}`}>
                    {reviewDispatch.status}
                  </span>
                </div>
                <p className="text-[11px] text-onyx/50 mt-1">
                  Created on {new Date(reviewDispatch.dispatchDate).toLocaleDateString("en-IN")}
                </p>
              </div>
              <button onClick={() => setReviewDispatch(null)} className="text-onyx/40 hover:text-onyx cursor-pointer p-1">
                <X size={20} />
              </button>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Left Column */}
              <div className="space-y-2 bg-cream-light/10 p-4 border border-onyx/5 rounded-xl text-xs">
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Customer:</span><span className="font-semibold text-onyx">{reviewDispatch.customer}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Sales Order:</span><span className="font-semibold text-onyx">{reviewDispatch.soNumber || "—"}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Packing List:</span><span className="font-semibold text-onyx">{reviewDispatch.packingListNumber || "—"}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Issuing Store:</span><span className="font-semibold text-onyx">{stores.find(s => s.id === reviewDispatch.storeId)?.name || "Default Store"}</span></div>
              </div>

              {/* Right Column */}
              <div className="space-y-2 bg-cream-light/10 p-4 border border-onyx/5 rounded-xl text-xs">
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Vehicle No:</span><span className="font-semibold text-onyx">{reviewDispatch.vehicleNo || "—"}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Transporter:</span><span className="font-semibold text-onyx">{reviewDispatch.transporterName || "—"}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">LR / Docket No:</span><span className="font-semibold text-onyx">{reviewDispatch.lrNo || "—"}</span></div>
                <div className="flex justify-between"><span className="text-onyx/50 font-medium">Distance (km):</span><span className="font-semibold text-onyx">{reviewDispatch.distanceKm || "—"}</span></div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-onyx/10 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-xs">
                <thead className="bg-cream-light text-onyx/60 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-bold">Item Description</th>
                    <th className="text-right px-4 py-2.5 font-bold">Qty Dispatched</th>
                    <th className="text-left px-4 py-2.5 font-bold">Batch No</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {reviewDispatch.lines?.map((line, idx) => (
                    <tr key={line.id || idx} className="hover:bg-cream-light/10">
                      <td className="px-4 py-3 font-semibold text-onyx">{line.itemName}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-onyx">{line.qty}</td>
                      <td className="px-4 py-3 font-mono text-onyx/60">{line.batchNo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex justify-between items-center pt-4 border-t border-onyx/5">
              <div>
                {reviewDispatch.status !== "DRAFT" && (
                  <button
                    onClick={() => {
                      setPrintTarget(reviewDispatch);
                      setReviewDispatch(null);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-onyx/15 hover:bg-cream-light/30 text-onyx/80 font-bold rounded-lg text-xs transition cursor-pointer"
                  >
                    <Printer size={14} /> Print / Export Copies
                  </button>
                )}
              </div>
              <button onClick={() => setReviewDispatch(null)} className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs shadow-sm cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Copy Selector Modal */}
      <CopySelectorModal
        isOpen={!!printTarget}
        docNumber={printTarget?.number || ""}
        onClose={() => setPrintTarget(null)}
        onConfirm={async (selected) => {
          if (printTarget) {
            await generatePDF("Delivery Challan", printTarget, company, selected);
            setPrintTarget(null);
          }
        }}
      />
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
const cellCls = "w-full px-2 py-1 border border-onyx/15 rounded text-xs outline-none focus:ring-1 focus:ring-saffron/40";
