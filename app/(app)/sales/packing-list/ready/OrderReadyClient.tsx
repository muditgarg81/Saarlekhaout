"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPackingList } from "@/app/actions/packingLists";
import { X, Plus, Trash2, ClipboardCheck, Boxes, Scale, ShieldAlert } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";

interface SoLine {
  soLineId: string;
  itemId: string;
  itemName: string;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
}

interface SoOpt {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  orderDate: string;
  lines: SoLine[];
  totalOrdered: number;
  totalDispatched: number;
  totalPending: number;
}

interface ItemOpt {
  id: string;
  code: string;
  name: string;
}

interface CustOpt {
  id: string;
  code: string;
  name: string;
}

interface LineInput {
  boxNo: string;
  itemId: string;
  soLineId: string;
  qty: number;
  grossWeight: number;
  netWeight: number;
  tareWeight: number;
  dimensions: string;
}

export default function OrderReadyClient({
  salesOrders,
  items,
  customers,
  user,
}: {
  salesOrders: SoOpt[];
  items: ItemOpt[];
  customers: CustOpt[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [selectedOrder, setSelectedOrder] = useState<SoOpt | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lines, setLines] = useState<LineInput[]>([
    { boxNo: "Box 1", itemId: "", soLineId: "", qty: 1, grossWeight: 0, netWeight: 0, tareWeight: 0, dimensions: "" },
  ]);

  const canCreate = can(user, "dispatch.create") || ["ADMIN", "OWNER", "STORE_MANAGER", "STORE_KEEPER"].includes(user.role);

  const handleOpenModal = (order: SoOpt) => {
    setSelectedOrder(order);
    setError(null);
    // Initialize with first item of this order
    const firstLine = order.lines[0];
    setLines([
      {
        boxNo: "Box 1",
        itemId: firstLine?.itemId || "",
        soLineId: firstLine?.soLineId || "",
        qty: firstLine ? Math.min(1, firstLine.pendingQty) : 1,
        grossWeight: 0,
        netWeight: 0,
        tareWeight: 0,
        dimensions: "",
      },
    ]);
    setIsOpen(true);
  };

  const handleAddLine = () => {
    const nextBoxNo = `Box ${lines.length + 1}`;
    const firstLine = selectedOrder?.lines[0];
    setLines([
      ...lines,
      {
        boxNo: nextBoxNo,
        itemId: firstLine?.itemId || "",
        soLineId: firstLine?.soLineId || "",
        qty: firstLine ? Math.min(1, firstLine.pendingQty) : 1,
        grossWeight: 0,
        netWeight: 0,
        tareWeight: 0,
        dimensions: "",
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter((_, idx) => idx !== index));
  };

  const setLineField = (index: number, fields: Partial<LineInput>) => {
    setLines(
      lines.map((l, idx) => {
        if (idx !== index) return l;
        const updated = { ...l, ...fields };
        // If itemId changes, update soLineId automatically
        if (fields.itemId && selectedOrder) {
          const matchingLine = selectedOrder.lines.find(x => x.itemId === fields.itemId);
          if (matchingLine) {
            updated.soLineId = matchingLine.soLineId;
          }
        }
        return updated;
      })
    );
  };

  const handleSubmit = async () => {
    if (!selectedOrder) return;
    setError(null);

    // Validate box inputs
    for (const l of lines) {
      if (!l.itemId) {
        setError("Please select an item for all packing bales/pallets.");
        return;
      }
      if (l.qty <= 0) {
        setError("Quantities must be greater than zero.");
        return;
      }
    }

    // Verify quantities do not exceed order pending balance in the UI
    const totalPackedPerItem = new Map<string, number>();
    for (const l of lines) {
      totalPackedPerItem.set(l.itemId, (totalPackedPerItem.get(l.itemId) || 0) + l.qty);
    }

    for (const [itemId, packedQty] of totalPackedPerItem.entries()) {
      const orderLine = selectedOrder.lines.find(x => x.itemId === itemId);
      if (orderLine && packedQty > orderLine.pendingQty) {
        setError(
          `Packed quantity (${packedQty}) for ${orderLine.itemName} exceeds the pending balance of ${orderLine.pendingQty}.`
        );
        return;
      }
    }

    setLoading(true);
    const payload = {
      soId: selectedOrder.id,
      customerId: selectedOrder.customerId,
      lines: lines.map((l) => ({
        boxNo: l.boxNo,
        itemId: l.itemId,
        qty: l.qty,
        grossWeight: l.grossWeight || 0,
        netWeight: l.netWeight || 0,
        tareWeight: l.tareWeight || 0,
        dimensions: l.dimensions || null,
        soLineId: l.soLineId || null,
      })),
    };

    const res = await createPackingList(payload, "PENDING_APPROVAL");
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to submit packing list");
    } else {
      setIsOpen(false);
      router.refresh();
    }
  };

  const inputCls = "w-full text-xs px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-onyx flex items-center gap-2">
            <ClipboardCheck className="text-saffron-dark" size={24} />
            <span>Order Ready (Pending Dispatches)</span>
          </h1>
          <p className="text-xs text-onyx/50">
            View approved Sales Orders, package ready items, and submit packing lists for manager approval.
          </p>
        </div>
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">SO #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Order Date</th>
              <th className="text-center px-4 py-3 font-semibold">Progress</th>
              <th className="text-right px-4 py-3 font-semibold">Pending Items</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {salesOrders.map((o) => {
              const completionPercent = Math.round((o.totalDispatched / o.totalOrdered) * 100);
              return (
                <tr key={o.id} className="hover:bg-cream-light/40 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-onyx">{o.number}</td>
                  <td className="px-4 py-3.5 text-onyx">{o.customer}</td>
                  <td className="px-4 py-3.5 text-onyx/70 text-xs">
                    {new Date(o.orderDate).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-24 bg-onyx/5 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-saffron h-full transition-all duration-300"
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-onyx/60">{completionPercent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-onyx">
                    {o.totalPending} unit{o.totalPending > 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end">
                      {canCreate ? (
                        <button
                          onClick={() => handleOpenModal(o)}
                          className="flex items-center gap-1.5 bg-saffron hover:bg-saffron-dark text-onyx font-bold px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
                        >
                          <Boxes size={13} />
                          <span>Pack & Mark Ready</span>
                        </button>
                      ) : (
                        <span className="text-xs text-onyx/40 italic">View Only</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {salesOrders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">
                  No Sales Orders with pending dispatches found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isOpen && selectedOrder && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10">
              <div>
                <h2 className="font-heading font-bold text-onyx">
                  Prepare Packing List — {selectedOrder.number}
                </h2>
                <p className="text-[10px] text-onyx/50">{selectedOrder.customer}</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-onyx/40 hover:text-onyx hover:bg-onyx/5 p-1 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Order Pending Balance Cards */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-2">
                  Sales Order Pending Balance
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {selectedOrder.lines.map((l) => (
                    <div key={l.soLineId} className="bg-cream-light/30 border border-onyx/5 rounded-xl p-3 text-xs">
                      <span className="font-bold text-onyx block truncate">{l.itemName}</span>
                      <div className="flex items-center justify-between text-onyx/60 mt-1 text-[11px]">
                        <span>Ordered: {l.orderedQty}</span>
                        <span>Dispatched: {l.dispatchedQty}</span>
                        <span className="font-bold text-saffron-dark">Pending: {l.pendingQty}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-xs flex items-center gap-2 font-medium">
                  <ShieldAlert size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Package Details */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-onyx/40">
                    Bales/Pallets & Package Details
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="flex items-center gap-1 text-[10px] font-bold text-saffron-dark hover:text-saffron-dark/85"
                  >
                    <Plus size={12} /> Add Bale/Pallet / Item
                  </button>
                </div>

                <div className="space-y-3">
                  {lines.map((line, idx) => (
                    <div
                      key={idx}
                      className="bg-onyx/[0.02] p-4 rounded-xl border border-onyx/5 relative space-y-3"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1">Bale / Pallet #</label>
                          <input
                            value={line.boxNo}
                            onChange={(e) => setLineField(idx, { boxNo: e.target.value })}
                            className={inputCls}
                            placeholder="e.g. Bale 1"
                          />
                        </div>

                        <div className="sm:col-span-6">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1">Select Item</label>
                          <select
                            value={line.itemId}
                            onChange={(e) => setLineField(idx, { itemId: e.target.value })}
                            className={inputCls}
                          >
                            <option value="" disabled>Select Item...</option>
                            {selectedOrder.lines.map((sol) => (
                              <option key={sol.itemId} value={sol.itemId}>
                                {sol.itemName} (Pending: {sol.pendingQty})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1">Ready Qty</label>
                          <input
                            type="number"
                            value={line.qty}
                            onChange={(e) => setLineField(idx, { qty: Number(e.target.value) })}
                            className={inputCls}
                            min={1}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-2 border-t border-onyx/5">
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1 flex items-center gap-0.5">
                            Net Wt (kg)
                          </label>
                          <input
                            type="number"
                            value={line.netWeight}
                            onChange={(e) => {
                              const net = Number(e.target.value);
                              setLineField(idx, { 
                                netWeight: net,
                                grossWeight: net + line.tareWeight
                              });
                            }}
                            className={inputCls}
                            placeholder="0"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1 flex items-center gap-0.5">
                            Tare Wt (kg)
                          </label>
                          <input
                            type="number"
                            value={line.tareWeight}
                            onChange={(e) => {
                              const tare = Number(e.target.value);
                              setLineField(idx, { 
                                tareWeight: tare,
                                grossWeight: line.netWeight + tare
                              });
                            }}
                            className={inputCls}
                            placeholder="0"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1 flex items-center gap-0.5">
                            <Scale size={10} /> Gross Wt (kg)
                          </label>
                          <input
                            type="number"
                            value={line.grossWeight}
                            className={`${inputCls} bg-onyx/5 font-semibold`}
                            placeholder="0"
                            disabled
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-onyx/50 mb-1">Dimensions</label>
                          <input
                            value={line.dimensions}
                            onChange={(e) => setLineField(idx, { dimensions: e.target.value })}
                            className={inputCls}
                            placeholder="e.g. 12x12x12"
                          />
                        </div>

                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            disabled={lines.length === 1}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-onyx/10 flex justify-end gap-3 bg-cream-light/10">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 border border-onyx/10 text-onyx font-semibold rounded-lg text-sm hover:bg-onyx/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-sm transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>{loading ? "Submitting..." : "Submit for Approval"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
