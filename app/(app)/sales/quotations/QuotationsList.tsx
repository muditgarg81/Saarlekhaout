"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createQuotation,
  submitQuotation,
  approveQuotation,
  rejectQuotation,
  cancelQuotation,
  convertToSalesOrder,
  deleteQuotation,
  updateQuotation,
} from "@/app/actions/quotations";
import { Plus, X, Trash2, Send, Check, Ban, FileText, ShoppingCart, Eye, Download, Pencil } from "lucide-react";
import { generatePDF } from "../pdfGenerator";
import { can, SessionUser } from "@/lib/rbac";
import { QuotationStatus } from "@prisma/client";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchableItemSelect } from "@/components/SearchableItemSelect";
import { quickCreateItem } from "@/app/actions/items";
import { quickCreateCustomer } from "@/app/actions/customers";

interface Quotation {
  id: string;
  number: string;
  customerId?: string;
  customer: string;
  status: string;
  quotationDate: string;
  validUpto: string | null;
  value: number;
  paymentTerms?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  placeOfSupply?: string | null;
  termsConditions?: string | null;
  leadTime?: string | null;
  otherCharges?: number;
  lines?: any[];
  lineCount: number;
}
interface CustomerOpt { id: string; code: string; name: string; stateCode: string | null; paymentTerms: string | null; billingAddresses?: any; shippingAddresses?: any; billingAddress?: string | null; shippingAddress?: string | null; }
interface ItemOpt { id: string; code: string; name: string; baseUom: string; gstRate: number | null; specification: string | null }

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  SENT: "bg-blue-100 text-blue-800 border-blue-200",
  ACCEPTED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  EXPIRED: "bg-orange-100 text-orange-800 border-orange-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

type Line = { itemId: string; qty: number; rate: number; discount: number; gstRate: number; specification: string };

export default function QuotationsList({
  initialQuotations,
  customers,
  items,
  termsTemplates,
  presetTerms,
  company,
  user,
}: {
  initialQuotations: Quotation[];
  customers: CustomerOpt[];
  items: ItemOpt[];
  termsTemplates: any[];
  presetTerms: string;
  company: any;
  user: SessionUser;
}) {
  const router = useRouter();
  const quotations = initialQuotations;
  const [localItems, setLocalItems] = useState<ItemOpt[]>(items);
  const [localCustomers, setLocalCustomers] = useState<CustomerOpt[]>(customers);
  const [isOpen, setIsOpen] = useState(false);
  const [reviewQuotation, setReviewQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [validUpto, setValidUpto] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [termsConditions, setTermsConditions] = useState(presetTerms || "");
  const [leadTime, setLeadTime] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
  const [billingAddressOptions, setBillingAddressOptions] = useState<any[]>([]);
  const [shippingAddressOptions, setShippingAddressOptions] = useState<any[]>([]);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !termsConditions) {
      const defaultTemplate = termsTemplates.find(t => t.isDefault);
      if (defaultTemplate) {
        setTermsConditions(defaultTemplate.content);
      }
    }
  }, [isOpen, termsTemplates, termsConditions]);

  // When presetTerms updates (e.g. settings change), keep it updated
  useEffect(() => {
    if (!termsConditions) {
      setTermsConditions(presetTerms || "");
    }
  }, [presetTerms]);

  const canCreate = can(user, "quotation.create") || ["ADMIN", "OWNER"].includes(user.role);
  const canApprove = can(user, "quotation.approve") || ["ADMIN", "OWNER"].includes(user.role);

  const itemById = new Map(localItems.map((i) => [i.id, i]));
  const lineTotal = (l: Line) => l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
  const quotationTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  const handleQuickCreateItem = async (name: string) => {
    const res = await quickCreateItem({ name });
    if (res.success && res.item) {
      const newItem: ItemOpt = {
        id: res.item.id,
        code: res.item.code,
        name: res.item.name,
        baseUom: res.item.baseUom,
        gstRate: res.item.gstRate,
        specification: null,
      };
      setLocalItems((prev) => [...prev, newItem]);
      router.refresh();
      return newItem;
    } else {
      alert(res.error || "Failed to create item");
      return null;
    }
  };

  const addLine = () => setLines([...lines, { itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const onItemPick = (i: number, itemId: string) => {
    const it = itemById.get(itemId);
    setLine(i, { itemId, gstRate: it?.gstRate ?? 18, specification: it?.specification || "" });
  };

  const handleCustomerPick = (id: string) => {
    setCustomerId(id);
    const cust = localCustomers.find((c) => c.id === id);
    if (cust) {
      setPaymentTerms(cust.paymentTerms || "");
      setPlaceOfSupply(cust.stateCode || "");
      
      const bAddresses = cust.billingAddresses ? JSON.parse(JSON.stringify(cust.billingAddresses)) : [];
      const sAddresses = cust.shippingAddresses ? JSON.parse(JSON.stringify(cust.shippingAddresses)) : [];
      
      setBillingAddressOptions(bAddresses);
      setShippingAddressOptions(sAddresses);

      if (bAddresses.length > 0) {
        setBillingAddress(bAddresses[0].address);
      } else {
        setBillingAddress(cust.billingAddress || "");
      }

      if (sAddresses.length > 0) {
        setShippingAddress(sAddresses[0].address);
      } else {
        setShippingAddress(cust.shippingAddress || "");
      }
    } else {
      setPaymentTerms("");
      setPlaceOfSupply("");
      setBillingAddressOptions([]);
      setShippingAddressOptions([]);
      setBillingAddress("");
      setShippingAddress("");
    }
  };

  const handleQuickCreateCustomer = async (name: string) => {
    const res = await quickCreateCustomer({ name });
    if (res.success && res.customer) {
      const newCust: CustomerOpt = {
        id: res.customer.id,
        code: res.customer.code,
        name: res.customer.name,
        paymentTerms: res.customer.paymentTerms,
        stateCode: res.customer.stateCode,
        billingAddresses: [],
        shippingAddresses: [],
      };
      setLocalCustomers((prev) => [...prev, newCust]);
      setCustomerId(newCust.id);
      setPaymentTerms("");
      setPlaceOfSupply("");
      setBillingAddressOptions([]);
      setShippingAddressOptions([]);
      setBillingAddress("");
      setShippingAddress("");
      router.refresh();
      return { value: newCust.id, label: `${newCust.name} (${newCust.code})` };
    } else {
      alert(res.error || "Failed to create customer");
      return null;
    }
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const payload = {
      customerId,
      validUpto: validUpto || null,
      paymentTerms: paymentTerms || null,
      billingAddress: billingAddress || null,
      shippingAddress: shippingAddress || null,
      placeOfSupply: placeOfSupply || null,
      termsConditions: termsConditions || null,
      leadTime: leadTime || null,
      otherCharges: 0,
      lines: lines
        .filter((l) => l.itemId)
        .map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
          rate: Number(l.rate),
          discount: Number(l.discount),
          gstRate: Number(l.gstRate),
          specification: l.specification || null,
        })),
    };

    const res = editingQuotationId
      ? await updateQuotation(editingQuotationId, payload)
      : await createQuotation(payload);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to create quotation");
      return;
    }
    setIsOpen(false);
    setCustomerId("");
    setValidUpto("");
    setPaymentTerms("");
    setBillingAddress("");
    setShippingAddress("");
    setPlaceOfSupply("");
    setTermsConditions(presetTerms || "");
    setLeadTime("");
    setEditingQuotationId(null);
    setLines([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
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
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Customer Quotations</h1>
            <p className="text-xs text-onyx/50">Draft quotation → approve → send to customer → convert to Sales Order</p>
          </div>
        </div>
        {canCreate && (
          <button
            onClick={() => {
              setEditingQuotationId(null);
              setCustomerId("");
              setValidUpto("");
              setPaymentTerms("");
              setBillingAddress("");
              setShippingAddress("");
              setPlaceOfSupply("");
              setTermsConditions(presetTerms || "");
              setLeadTime("");
              setLines([{ itemId: "", qty: 1, rate: 0, discount: 0, gstRate: 18, specification: "" }]);
              setIsOpen(true);
            }}
            className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm"
          >
            <Plus size={16} /> New Quotation
          </button>
        )}
      </div>

      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">QT #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Valid Upto</th>
              <th className="text-right px-4 py-3 font-semibold">Value</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {quotations.map((q) => (
              <tr key={q.id} className="hover:bg-cream-light/40 cursor-pointer">
                <td onClick={() => setReviewQuotation(q)} className="px-4 py-3 font-mono text-xs text-onyx/70">{q.number}</td>
                <td onClick={() => setReviewQuotation(q)} className="px-4 py-3 text-onyx">{q.customer}</td>
                <td onClick={() => setReviewQuotation(q)} className="px-4 py-3 text-onyx/60 text-xs">{q.validUpto ? new Date(q.validUpto).toLocaleDateString("en-IN") : "—"}</td>
                <td onClick={() => setReviewQuotation(q)} className="px-4 py-3 text-right font-medium text-onyx">
                  ₹{q.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
                <td onClick={() => setReviewQuotation(q)} className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${STATUS_STYLES[q.status]}`}>
                    {q.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Review Details" onClick={() => setReviewQuotation(q)} className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70">
                      <Eye size={15} />
                    </button>
                    {(q.status === "DRAFT" || q.status === "SENT") && canCreate && (
                      <>
                        <button
                          title="Edit Quotation"
                          onClick={() => {
                            setEditingQuotationId(q.id);
                            setCustomerId(q.customerId || "");
                            setValidUpto(q.validUpto ? q.validUpto.slice(0, 10) : "");
                            setPaymentTerms(q.paymentTerms || "");
                            setBillingAddress(q.billingAddress || "");
                            setShippingAddress(q.shippingAddress || "");
                            setPlaceOfSupply(q.placeOfSupply || "");
                            setTermsConditions(q.termsConditions || "");
                            setLeadTime(q.leadTime || "");

                            const cust = localCustomers.find((c) => c.id === q.customerId);
                            if (cust) {
                              const bAddresses = cust.billingAddresses ? JSON.parse(JSON.stringify(cust.billingAddresses)) : [];
                              const sAddresses = cust.shippingAddresses ? JSON.parse(JSON.stringify(cust.shippingAddresses)) : [];
                              setBillingAddressOptions(bAddresses);
                              setShippingAddressOptions(sAddresses);
                            } else {
                              setBillingAddressOptions([]);
                              setShippingAddressOptions([]);
                            }

                            setLines(q.lines?.map((l: any) => ({
                              itemId: l.itemId,
                              qty: l.qty,
                              rate: l.rate,
                              discount: l.discount,
                              gstRate: l.gstRate,
                              specification: l.specification || "",
                            })) || []);
                            setIsOpen(true);
                          }}
                          className="p-1.5 rounded hover:bg-onyx/5 text-onyx/70"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          title="Delete Quotation"
                          onClick={async () => {
                            if (confirm(`Are you sure you want to delete quotation ${q.number}?`)) {
                              const res = await deleteQuotation(q.id);
                              if (!res.success) alert(res.error || "Failed to delete quotation");
                              else router.refresh();
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                    {q.status === "DRAFT" && canCreate && (
                      <button title="Submit for Approval" onClick={() => act(() => submitQuotation(q.id))} className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                        <Send size={15} />
                      </button>
                    )}
                    {q.status === "PENDING_APPROVAL" && canApprove && (
                      <>
                        <button title="Approve" onClick={() => act(() => approveQuotation(q.id))} className="p-1.5 rounded hover:bg-green-50 text-green-600">
                          <Check size={15} />
                        </button>
                        <button title="Reject" onClick={() => act(() => rejectQuotation(q.id, "Rejected"))} className="p-1.5 rounded hover:bg-red-50 text-red-600">
                          <Ban size={15} />
                        </button>
                      </>
                    )}
                    {q.status === "SENT" && canCreate && (
                      <button title="Convert to Sales Order" onClick={() => act(() => convertToSalesOrder(q.id))} className="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-1 border border-green-200 rounded hover:bg-green-100">
                        <ShoppingCart size={13} />
                        <span>Accept & Convert</span>
                      </button>
                    )}
                    {[QuotationStatus.DRAFT, QuotationStatus.PENDING_APPROVAL, QuotationStatus.SENT].includes(q.status as any) && canCreate && (
                      <button title="Cancel" onClick={() => act(() => cancelQuotation(q.id, "Cancelled"))} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {quotations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">No quotations generated yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border border-onyx/10 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-6">
            <div className="flex justify-between items-center pb-4 border-b border-onyx/5 mb-6">
              <h3 className="text-lg font-heading font-bold text-onyx">
                {editingQuotationId ? "Edit Customer Quotation" : "Generate Customer Quotation"}
              </h3>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx hover:bg-cream-light p-1 rounded-lg">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="bg-red-50 text-red-800 border-l-4 border-red-500 p-4 text-xs font-semibold rounded-md mb-6">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Customer</label>
                <SearchableSelect
                  options={localCustomers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
                  value={customerId}
                  onChange={(val) => handleCustomerPick(val)}
                  placeholder="Select Customer..."
                  onCreateOption={handleQuickCreateCustomer}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Valid Upto</label>
                <input
                  type="date"
                  value={validUpto}
                  onChange={(e) => setValidUpto(e.target.value)}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Payment Terms</label>
                <input
                  type="text"
                  placeholder="e.g. 30 Days Net"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Place of Supply (State Code)</label>
                <input
                  type="text"
                  placeholder="e.g. 27"
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Lead Time / Delivery Period</label>
                <input
                  type="text"
                  placeholder="e.g. 2-3 Weeks"
                  value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Billing Address</label>
                {billingAddressOptions.length > 0 && (
                  <select
                    className="w-full text-xs px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron mb-2"
                    onChange={(e) => {
                      const selected = billingAddressOptions.find(o => o.id === e.target.value);
                      if (selected) {
                        setBillingAddress(selected.address);
                        if (selected.stateCode) {
                          setPlaceOfSupply(selected.stateCode);
                        }
                      }
                    }}
                  >
                    {billingAddressOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.label}: {opt.address.slice(0, 40)}...</option>
                    ))}
                  </select>
                )}
                <textarea
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  rows={2}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1">Shipping Address</label>
                {shippingAddressOptions.length > 0 && (
                  <select
                    className="w-full text-xs px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron mb-2"
                    onChange={(e) => {
                      const selected = shippingAddressOptions.find(o => o.id === e.target.value);
                      if (selected) {
                        setShippingAddress(selected.address);
                      }
                    }}
                  >
                    {shippingAddressOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.label}: {opt.address.slice(0, 40)}...</option>
                    ))}
                  </select>
                )}
                <textarea
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  rows={2}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-onyx/70 uppercase mb-1 flex items-center justify-between">
                  <span>Terms & Conditions</span>
                  {termsTemplates && termsTemplates.length > 0 && (
                    <select
                      onChange={(e) => {
                        const t = termsTemplates.find(x => x.id === e.target.value);
                        if (t) setTermsConditions(t.content);
                        e.target.value = "";
                      }}
                      className="bg-transparent text-[10px] font-bold text-saffron-dark hover:text-saffron-dark/80 focus:outline-none border-none cursor-pointer"
                      defaultValue=""
                    >
                      <option value="" disabled>Apply Terms Template...</option>
                      {termsTemplates.map((t: any) => (
                        <option key={t.id} value={t.id} className="text-onyx">{t.title}</option>
                      ))}
                    </select>
                  )}
                </label>
                <textarea
                  value={termsConditions}
                  onChange={(e) => setTermsConditions(e.target.value)}
                  placeholder="Warranty details, validity, delivery schedules or apply a template..."
                  rows={3}
                  className="w-full text-sm px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron"
                />
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-onyx/70 uppercase tracking-wide">Line Items</h4>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-xs font-semibold text-saffron hover:underline"
                >
                  + Add Line
                </button>
              </div>

              <div className="space-y-3">
                {lines.length > 0 && (
                  <div className="flex items-center gap-3 px-3 text-[10px] font-bold text-onyx/50 uppercase tracking-wider select-none mb-1">
                    <div className="flex-1 min-w-[200px]">Item Name / Code</div>
                    <div className="w-20 text-center">Qty</div>
                    <div className="w-24 text-center">Basic Price (Rate)</div>
                    <div className="w-20 text-center">Discount %</div>
                    <div className="w-20 text-center">GST %</div>
                    <div className="w-24 text-right pr-4">Subtotal</div>
                    <div className="w-10"></div>
                  </div>
                )}
                {lines.map((l, idx) => (
                  <div key={idx} className="border border-onyx/5 p-3 rounded-lg bg-cream-light/10 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-[200px]">
                        <SearchableItemSelect
                          items={localItems.map((i) => ({ id: i.id, code: i.code, name: i.name }))}
                          value={l.itemId}
                          onChange={(val) => onItemPick(idx, val)}
                          placeholder="Pick Item"
                          onCreateItem={handleQuickCreateItem}
                        />
                      </div>

                      <div className="w-20">
                        <input
                          type="number"
                          placeholder="Qty"
                          value={l.qty}
                          onChange={(e) => setLine(idx, { qty: Number(e.target.value) })}
                          className="w-full text-xs px-2.5 py-1.5 bg-cream-light/40 border border-onyx/10 rounded-md"
                        />
                      </div>

                      <div className="w-24">
                        <input
                          type="number"
                          placeholder="Rate"
                          value={l.rate}
                          onChange={(e) => setLine(idx, { rate: Number(e.target.value) })}
                          className="w-full text-xs px-2.5 py-1.5 bg-cream-light/40 border border-onyx/10 rounded-md"
                        />
                      </div>

                      <div className="w-20">
                        <input
                          type="number"
                          placeholder="Disc %"
                          value={l.discount}
                          onChange={(e) => setLine(idx, { discount: Number(e.target.value) })}
                          className="w-full text-xs px-2.5 py-1.5 bg-cream-light/40 border border-onyx/10 rounded-md"
                        />
                      </div>

                      <div className="w-20">
                        <input
                          type="number"
                          placeholder="GST %"
                          value={l.gstRate}
                          onChange={(e) => setLine(idx, { gstRate: Number(e.target.value) })}
                          className="w-full text-xs px-2.5 py-1.5 bg-cream-light/40 border border-onyx/10 rounded-md"
                        />
                      </div>

                      <div className="w-24 text-right text-xs font-semibold text-onyx">
                        ₹{lineTotal(l).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Technical Specification Row */}
                    <div className="flex items-center gap-2 pl-1">
                      <span className="text-[9px] font-bold text-onyx/40 uppercase tracking-wider shrink-0">Tech Spec:</span>
                      <input
                        type="text"
                        placeholder="e.g. Dimensions, Grade, Material specifications"
                        value={l.specification}
                        onChange={(e) => setLine(idx, { specification: e.target.value })}
                        className="flex-1 text-[11px] px-2 py-1 bg-white border border-onyx/10 rounded focus:outline-none focus:border-saffron placeholder-onyx/30"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-onyx/5">
              <div className="text-sm font-semibold text-onyx">
                Total Quotation Value: <span className="text-saffron-dark font-bold text-base">₹{quotationTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-light text-onyx rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !customerId || lines.some(l => !l.itemId)}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {loading ? "Saving..." : editingQuotationId ? "Update Quotation" : "Create Quotation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reviewQuotation && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 font-body">
            
            {/* Header */}
            <div className="flex justify-between items-center pb-4 border-b border-onyx/5 mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-heading font-bold text-onyx font-sans">Quotation {reviewQuotation.number}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_STYLES[reviewQuotation.status]}`}>
                    {reviewQuotation.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-[11px] text-onyx/50 mt-1">
                  Raised on {new Date(reviewQuotation.quotationDate).toLocaleDateString("en-IN", { dateStyle: "long" })}
                </p>
              </div>
              <button 
                onClick={() => setReviewQuotation(null)} 
                className="text-onyx/40 hover:text-onyx hover:bg-cream-light p-1.5 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-3 gap-6 mb-6 text-xs bg-cream-light/10 p-4 rounded-xl border border-onyx/5">
              <div className="col-span-2">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Customer</span>
                <span className="font-semibold text-onyx text-sm">{reviewQuotation.customer}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Valid Upto</span>
                <span className="font-medium text-onyx">{reviewQuotation.validUpto ? new Date(reviewQuotation.validUpto).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Payment Terms</span>
                <span className="font-medium text-onyx">{reviewQuotation.paymentTerms || "—"}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Place of Supply</span>
                <span className="font-medium text-onyx">{reviewQuotation.placeOfSupply || "—"}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Lead Time</span>
                <span className="font-medium text-onyx">{reviewQuotation.leadTime || "—"}</span>
              </div>
              <div className="col-span-3 grid grid-cols-2 gap-4 pt-3 border-t border-onyx/5">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Billing Address</span>
                  <p className="text-onyx/80 whitespace-pre-wrap leading-relaxed">{reviewQuotation.billingAddress || "—"}</p>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/40 mb-1">Shipping Address</span>
                  <p className="text-onyx/80 whitespace-pre-wrap leading-relaxed">{reviewQuotation.shippingAddress || "—"}</p>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="mb-6">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-onyx/50 mb-2">Line Items</h4>
              <div className="border border-onyx/5 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-cream-light text-onyx/60 font-semibold text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Item Details</th>
                      <th className="text-center px-3 py-2 w-20">Qty</th>
                      <th className="text-right px-3 py-2 w-28">Basic Price</th>
                      <th className="text-center px-3 py-2 w-20">Disc %</th>
                      <th className="text-center px-3 py-2 w-20">GST %</th>
                      <th className="text-right px-3 py-2 w-28 pr-4">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-onyx/5 bg-white">
                    {reviewQuotation.lines?.map((l: any, idx: number) => {
                      const item = itemById.get(l.itemId);
                      const subtotal = l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
                      return (
                        <tr key={l.id || idx} className="hover:bg-cream-light/10">
                          <td className="px-3 py-2.5">
                            <span className="font-semibold text-onyx block">{item?.name || "Unknown Item"}</span>
                            <span className="text-[10px] text-onyx/50 font-mono block mt-0.5">{item?.code || ""}</span>
                            {l.specification && (
                              <span className="text-[10px] text-saffron-dark bg-saffron/5 px-1.5 py-0.5 rounded font-mono inline-block mt-1">
                                Spec: {l.specification}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center font-medium text-onyx">{l.qty}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-onyx">₹{l.rate.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2.5 text-center text-onyx/75">{l.discount}%</td>
                          <td className="px-3 py-2.5 text-center text-onyx/75">{l.gstRate}%</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-onyx pr-4">
                            ₹{subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Terms & Conditions Section */}
            {reviewQuotation.termsConditions && (
              <div className="mb-6 p-4 bg-cream-light/20 border border-onyx/5 rounded-xl">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-onyx/50 mb-2">Terms & Conditions</span>
                <p className="text-xs text-onyx/80 whitespace-pre-wrap leading-relaxed font-mono">
                  {reviewQuotation.termsConditions}
                </p>
              </div>
            )}

            {/* Bottom Row: Totals & Modal actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pt-4 border-t border-onyx/5 gap-4">
              <div className="text-sm font-semibold text-onyx">
                Grand Total: <span className="text-saffron-dark font-bold text-base">₹{reviewQuotation.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={async () => {
                    const linesWithNames = reviewQuotation.lines?.map((l: any) => {
                      const item = itemById.get(l.itemId);
                      return {
                        ...l,
                        itemName: item ? `${item.name} (${item.code})` : "Unknown Item"
                      };
                    });
                    await generatePDF("Quotation", { ...reviewQuotation, lines: linesWithNames }, company);
                  }}
                  className="px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs flex items-center gap-1 shadow-sm"
                >
                  <Download size={14} />
                  <span>Download PDF</span>
                </button>

                {/* Pending Approval Admin Review Actions */}
                {reviewQuotation.status === "PENDING_APPROVAL" && canApprove && (
                  <>
                    <button
                      onClick={async () => {
                        setLoading(true);
                        const res = await approveQuotation(reviewQuotation.id);
                        setLoading(false);
                        if (res.success) {
                          setReviewQuotation(null);
                          router.refresh();
                        } else {
                          alert(res.error);
                        }
                      }}
                      disabled={loading}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>Approve</span>
                    </button>
                    <button
                      onClick={async () => {
                        const reason = prompt("Enter rejection reason:");
                        if (reason === null) return;
                        setLoading(true);
                        const res = await rejectQuotation(reviewQuotation.id, reason || "Rejected");
                        setLoading(false);
                        if (res.success) {
                          setReviewQuotation(null);
                          router.refresh();
                        } else {
                          alert(res.error);
                        }
                      }}
                      disabled={loading}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <Ban size={14} />
                      <span>Reject</span>
                    </button>
                  </>
                )}

                <button
                  onClick={() => setReviewQuotation(null)}
                  className="px-4 py-2 border border-onyx/10 hover:bg-cream-light text-onyx rounded-lg text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
