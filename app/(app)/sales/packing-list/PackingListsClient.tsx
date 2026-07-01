"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPackingList, deletePackingList } from "@/app/actions/packingLists";
import { Plus, X, Trash2, Boxes, FileText, Scale } from "lucide-react";
import { can, SessionUser } from "@/lib/rbac";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";

interface PackingListRow {
  id: string;
  number: string;
  customer: string;
  customerId: string;
  soNumber: string | null;
  soId: string | null;
  status: string;
  createdAt: string;
  lineCount: number;
  boxCount: number;
  totalQty: number;
  totalGrossWeight: number;
  totalNetWeight: number;
}

interface SoLine {
  soLineId: string;
  itemId: string;
  itemName: string;
  qty: number;
}

interface SoOpt {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  lines: SoLine[];
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
  qty: number;
  grossWeight: number;
  netWeight: number;
  dimensions: string;
}

export default function PackingListsClient({
  initialPackingLists,
  salesOrders,
  items,
  customers,
  user,
}: {
  initialPackingLists: PackingListRow[];
  salesOrders: SoOpt[];
  items: ItemOpt[];
  customers: CustOpt[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [packingLists] = useState<PackingListRow[]>(initialPackingLists);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [soId, setSoId] = useState("");
  const [lines, setLines] = useState<LineInput[]>([
    { boxNo: "Box 1", itemId: "", qty: 1, grossWeight: 0, netWeight: 0, dimensions: "" },
  ]);

  const canCreate = can(user, "dispatch.create") || ["ADMIN", "OWNER", "STORE_MANAGER"].includes(user.role);

  const handleSoPick = (id: string) => {
    setSoId(id);
    const order = salesOrders.find((o) => o.id === id);
    if (order) {
      setCustomerId(order.customerId);
      // Pre-fill lines from Sales Order
      const initialLines = order.lines.map((l, index) => ({
        boxNo: `Box ${index + 1}`,
        itemId: l.itemId,
        qty: l.qty,
        grossWeight: 0,
        netWeight: 0,
        dimensions: "",
      }));
      setLines(initialLines.length > 0 ? initialLines : [{ boxNo: "Box 1", itemId: "", qty: 1, grossWeight: 0, netWeight: 0, dimensions: "" }]);
    } else {
      setSoId("");
    }
  };

  const addLine = () => {
    const lastBoxNo = lines.length > 0 ? lines[lines.length - 1].boxNo : "Box 1";
    // Try to auto-increment box number
    let nextBoxNo = lastBoxNo;
    const match = lastBoxNo.match(/Box\s+(\d+)/i);
    if (match) {
      nextBoxNo = `Box ${parseInt(match[1]) + 1}`;
    }
    setLines([
      ...lines,
      { boxNo: nextBoxNo, itemId: "", qty: 1, grossWeight: 0, netWeight: 0, dimensions: "" },
    ]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, idx) => idx !== index));
  };

  const updateLine = (index: number, patch: Partial<LineInput>) => {
    setLines(lines.map((l, idx) => (idx === index ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    if (!customerId) {
      setError("Customer is required");
      return;
    }
    const filteredLines = lines.filter((l) => l.itemId);
    if (filteredLines.length === 0) {
      setError("At least one line item is required");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await createPackingList({
      customerId,
      soId: soId || null,
      lines: filteredLines,
    });

    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to create packing list");
      return;
    }

    setIsOpen(false);
    setCustomerId("");
    setSoId("");
    setLines([{ boxNo: "Box 1", itemId: "", qty: 1, grossWeight: 0, netWeight: 0, dimensions: "" }]);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this packing list?")) return;
    const res = await deletePackingList(id);
    if (!res.success) {
      alert(res.error);
    }
    router.refresh();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <Boxes size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Packing Lists</h1>
            <p className="text-xs text-onyx/50">Carton breakdown, gross/net weights & packaging logs</p>
          </div>
        </div>
        {canCreate && (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            <Plus size={16} /> New Packing List
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">PL #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Sales Order</th>
              <th className="text-right px-4 py-3 font-semibold">Boxes</th>
              <th className="text-right px-4 py-3 font-semibold">Total Qty</th>
              <th className="text-right px-4 py-3 font-semibold">Gross Wt. (kg)</th>
              <th className="text-right px-4 py-3 font-semibold">Net Wt. (kg)</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {packingLists.map((p) => (
              <tr key={p.id} className="hover:bg-cream-light/40 transition">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70 font-semibold">{p.number}</td>
                <td className="px-4 py-3 text-onyx">{p.customer}</td>
                <td className="px-4 py-3 text-onyx/60">{p.soNumber || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">{p.boxCount}</td>
                <td className="px-4 py-3 text-right text-onyx/80">{p.totalQty}</td>
                <td className="px-4 py-3 text-right text-onyx/60">{p.totalGrossWeight.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-onyx/60">{p.totalNetWeight.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="p-1 text-onyx/40 hover:text-red-600 rounded transition"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {packingLists.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-onyx/40 text-sm">
                  No packing lists found. Create one to support your dispatches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <Boxes size={20} className="text-saffron-dark" />
                <h2 className="font-heading font-bold text-onyx">Create Packing List</h2>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx transition">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Link Sales Order (Optional)</label>
                  <SearchableSelect
                    options={salesOrders.map((o) => ({ value: o.id, label: `${o.number} — ${o.customer}` }))}
                    value={soId}
                    onChange={(val) => handleSoPick(val)}
                    placeholder="Search sales order..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-onyx/60 mb-1">Customer *</label>
                  <SearchableSelect
                    options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
                    value={customerId}
                    onChange={(val) => setCustomerId(val)}
                    placeholder="Search customer..."
                    disabled={!!soId}
                  />
                </div>
              </div>

              <div className="border border-onyx/10 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-cream-light text-onyx/60 uppercase font-semibold">
                    <tr>
                      <th className="text-left px-3 py-2 w-28">Box / Carton</th>
                      <th className="text-left px-3 py-2">Item *</th>
                      <th className="px-3 py-2 w-20">Qty *</th>
                      <th className="px-3 py-2 w-24">Gross Wt (kg)</th>
                      <th className="px-3 py-2 w-24">Net Wt (kg)</th>
                      <th className="px-3 py-2 w-28">Dimensions</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx} className="border-t border-onyx/5 hover:bg-cream-light/10">
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            className={cellCls}
                            value={l.boxNo}
                            onChange={(e) => updateLine(idx, { boxNo: e.target.value })}
                            placeholder="e.g. Box 1"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <SearchableItemSelect
                            items={items.map((i) => ({ id: i.id, code: i.code, name: i.name }))}
                            value={l.itemId}
                            onChange={(val) => updateLine(idx, { itemId: val })}
                            placeholder="Select item..."
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            className={cellCls}
                            value={l.qty}
                            onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                            min={0.001}
                            step="any"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            className={cellCls}
                            value={l.grossWeight}
                            onChange={(e) => updateLine(idx, { grossWeight: Number(e.target.value) })}
                            min={0}
                            step="any"
                            placeholder="0.0"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            className={cellCls}
                            value={l.netWeight}
                            onChange={(e) => updateLine(idx, { netWeight: Number(e.target.value) })}
                            min={0}
                            step="any"
                            placeholder="0.0"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            className={cellCls}
                            value={l.dimensions}
                            onChange={(e) => updateLine(idx, { dimensions: e.target.value })}
                            placeholder="e.g. 10x10x10"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {lines.length > 1 && (
                            <button
                              onClick={() => removeLine(idx)}
                              className="text-red-400 hover:text-red-600 transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={addLine}
                  className="text-xs text-saffron-dark hover:text-saffron-darker font-bold flex items-center gap-1 transition"
                >
                  <Plus size={14} /> Add Box / Item
                </button>
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">{error}</div>}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10 sticky bottom-0 bg-white">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60 hover:text-onyx transition">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={loading || !customerId}
                className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-sm transition disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Packing List"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const cellCls =
  "w-full px-2.5 py-1.5 border border-onyx/15 rounded-lg text-xs outline-none focus:ring-1 focus:ring-saffron/40 bg-cream-light/20 focus:bg-white transition";
