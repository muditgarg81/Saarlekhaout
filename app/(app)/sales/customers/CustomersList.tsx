"use client";

import { useState } from "react";
import {
  createCustomer,
  updateCustomer,
  updateCustomerStatus,
  deleteCustomer,
} from "@/app/actions/customers";
import {
  Search,
  Plus,
  X,
  Trash2,
  Edit3,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Users,
} from "lucide-react";
import { CustomerStatus, CustomerType } from "@prisma/client";
import { can, SessionUser } from "@/lib/rbac";

interface Customer {
  id: string;
  code: string;
  name: string;
  type: CustomerType;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  billingAddresses?: any;
  shippingAddresses?: any;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  paymentTerms: string | null;
  creditDays: number;
  creditLimit: number;
  tcsApplicable: boolean;
  status: CustomerStatus;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  HOLD: "bg-orange-100 text-orange-800 border-orange-200",
  BLACKLISTED: "bg-red-100 text-red-800 border-red-200",
};

const EMPTY = {
  name: "",
  code: "",
  type: "B2B" as CustomerType,
  gstin: "",
  pan: "",
  stateCode: "",
  billingAddress: "",
  shippingAddress: "",
  billingAddresses: [] as { id: string; label: string; address: string; stateCode?: string }[],
  shippingAddresses: [] as { id: string; label: string; address: string; stateCode?: string }[],
  contactPerson: "",
  contactEmail: "",
  contactPhone: "",
  paymentTerms: "",
  creditDays: 0,
  creditLimit: 0,
  tcsApplicable: false,
};

export default function CustomersList({
  initialCustomers,
  user,
}: {
  initialCustomers: Customer[];
  user: SessionUser;
}) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addBillingAddress = () => {
    setForm((f) => ({
      ...f,
      billingAddresses: [
        ...(f.billingAddresses || []),
        { id: Math.random().toString(), label: "", address: "", stateCode: "" },
      ],
    }));
  };

  const removeBillingAddress = (id: string) => {
    setForm((f) => ({
      ...f,
      billingAddresses: (f.billingAddresses || []).filter((a) => a.id !== id),
    }));
  };

  const updateBillingAddress = (id: string, patch: any) => {
    setForm((f) => ({
      ...f,
      billingAddresses: (f.billingAddresses || []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const addShippingAddress = () => {
    setForm((f) => ({
      ...f,
      shippingAddresses: [
        ...(f.shippingAddresses || []),
        { id: Math.random().toString(), label: "", address: "", stateCode: "" },
      ],
    }));
  };

  const removeShippingAddress = (id: string) => {
    setForm((f) => ({
      ...f,
      shippingAddresses: (f.shippingAddresses || []).filter((a) => a.id !== id),
    }));
  };

  const updateShippingAddress = (id: string, patch: any) => {
    setForm((f) => ({
      ...f,
      shippingAddresses: (f.shippingAddresses || []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const canApprove = can(user, "customer.approve") || ["ADMIN", "OWNER"].includes(user.role);
  const canManage = can(user, "customer.manage") || ["ADMIN", "OWNER"].includes(user.role);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    const matches =
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.gstin?.toLowerCase() || "").includes(q);
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matches && matchesStatus;
  });

  const openCreate = () => {
    setError(null);
    setIsEditing(false);
    setEditId(null);
    setForm({ ...EMPTY });
    setIsOpen(true);
  };

  const openEdit = (c: Customer) => {
    setError(null);
    setIsEditing(true);
    setEditId(c.id);
    setForm({
      name: c.name,
      code: c.code,
      type: c.type,
      gstin: c.gstin || "",
      pan: c.pan || "",
      stateCode: c.stateCode || "",
      billingAddress: c.billingAddress || "",
      shippingAddress: c.shippingAddress || "",
      billingAddresses: c.billingAddresses ? (typeof c.billingAddresses === "string" ? JSON.parse(c.billingAddresses) : c.billingAddresses) : [],
      shippingAddresses: c.shippingAddresses ? (typeof c.shippingAddresses === "string" ? JSON.parse(c.shippingAddresses) : c.shippingAddresses) : [],
      contactPerson: c.contactPerson || "",
      contactEmail: c.contactEmail || "",
      contactPhone: c.contactPhone || "",
      paymentTerms: c.paymentTerms || "",
      creditDays: c.creditDays,
      creditLimit: c.creditLimit,
      tcsApplicable: c.tcsApplicable,
    });
    setIsOpen(true);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const payload = {
      ...form,
      gstin: form.gstin || null,
      pan: form.pan || null,
      stateCode: form.stateCode || null,
      creditDays: Number(form.creditDays) || 0,
      creditLimit: Number(form.creditLimit) || 0,
    };
    const res =
      isEditing && editId
        ? await updateCustomer(editId, { ...payload, code: form.code } as any)
        : await createCustomer(payload as any);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Something went wrong");
      return;
    }
    const saved = (res as any).customer as Customer;
    setCustomers((prev) =>
      isEditing ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]
    );
    setIsOpen(false);
  };

  const changeStatus = async (id: string, status: CustomerStatus) => {
    const res = await updateCustomerStatus(id, status);
    if (res.success) {
      setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this customer?")) return;
    const res = await deleteCustomer(id);
    if (res.success) setCustomers((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Customer Master</h1>
            <p className="text-xs text-onyx/50">Debtors — the sell-side counterpart of vendors</p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            <Plus size={16} /> New Customer
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-onyx/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code or GSTIN…"
            className="w-full pl-9 pr-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-onyx/15 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="HOLD">Hold</option>
          <option value="BLACKLISTED">Blacklisted</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Code</th>
              <th className="text-left px-4 py-3 font-semibold">Name</th>
              <th className="text-left px-4 py-3 font-semibold">Type</th>
              <th className="text-left px-4 py-3 font-semibold">GSTIN</th>
              <th className="text-right px-4 py-3 font-semibold">Credit</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-cream-light/40">
                <td className="px-4 py-3 font-mono text-xs text-onyx/70">{c.code}</td>
                <td className="px-4 py-3 font-medium text-onyx">{c.name}</td>
                <td className="px-4 py-3 text-onyx/70">{c.type}</td>
                <td className="px-4 py-3 font-mono text-xs text-onyx/60">{c.gstin || "—"}</td>
                <td className="px-4 py-3 text-right text-onyx/70">
                  {c.creditDays}d
                  {c.creditLimit > 0 && (
                    <span className="block text-[10px] text-onyx/40">
                      ₹{c.creditLimit.toLocaleString("en-IN")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${
                      STATUS_STYLES[c.status] || ""
                    }`}
                  >
                    {c.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {canApprove && c.status !== "APPROVED" && (
                      <button
                        title="Approve"
                        onClick={() => changeStatus(c.id, CustomerStatus.APPROVED)}
                        className="p-1.5 rounded hover:bg-green-50 text-green-600"
                      >
                        <ShieldCheck size={15} />
                      </button>
                    )}
                    {canApprove && c.status === "APPROVED" && (
                      <button
                        title="Put on hold"
                        onClick={() => changeStatus(c.id, CustomerStatus.HOLD)}
                        className="p-1.5 rounded hover:bg-orange-50 text-orange-600"
                      >
                        <Lock size={15} />
                      </button>
                    )}
                    {canApprove && c.status !== "BLACKLISTED" && (
                      <button
                        title="Blacklist"
                        onClick={() => changeStatus(c.id, CustomerStatus.BLACKLISTED)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600"
                      >
                        <ShieldAlert size={15} />
                      </button>
                    )}
                    {canManage && (
                      <button
                        title="Edit"
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded hover:bg-onyx/5 text-onyx/60"
                      >
                        <Edit3 size={15} />
                      </button>
                    )}
                    {canManage && (
                      <button
                        title="Delete"
                        onClick={() => remove(c.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-onyx/40 text-sm">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-onyx/10 sticky top-0 bg-white">
              <h2 className="font-heading font-bold text-onyx">
                {isEditing ? "Edit Customer" : "New Customer"}
              </h2>
              <button onClick={() => setIsOpen(false)} className="text-onyx/40 hover:text-onyx">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name *">
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Code (auto if blank)">
                <input className={inputCls} value={form.code} disabled={isEditing} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label="Type">
                <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CustomerType })}>
                  {Object.values(CustomerType).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="GSTIN">
                <input className={inputCls} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="PAN">
                <input className={inputCls} value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="State code (POS)">
                <input className={inputCls} value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })} />
              </Field>
              {/* Multiple Billing Addresses */}
              <div className="col-span-full border border-onyx/5 rounded-xl p-4 bg-cream-light/10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-onyx/70 uppercase tracking-wide">Billing Addresses</h3>
                  <button
                    type="button"
                    onClick={addBillingAddress}
                    className="text-xs font-semibold text-saffron hover:underline"
                  >
                    + Add Billing Address
                  </button>
                </div>
                <div className="space-y-3">
                  {(form.billingAddresses || []).map((addr: any) => (
                    <div key={addr.id} className="flex gap-3 items-start border-b border-onyx/5 pb-3 last:border-0 last:pb-0">
                      <div className="w-1/3">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">Label (e.g. Head Office)</label>
                        <input
                          className={inputCls}
                          placeholder="Label"
                          value={addr.label}
                          onChange={(e) => updateBillingAddress(addr.id, { label: e.target.value })}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">Address</label>
                        <textarea
                          className={inputCls}
                          rows={1}
                          placeholder="Full address"
                          value={addr.address}
                          onChange={(e) => updateBillingAddress(addr.id, { address: e.target.value })}
                        />
                      </div>
                      <div className="w-20">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">State Code</label>
                        <input
                          className={inputCls}
                          placeholder="e.g. 27"
                          value={addr.stateCode || ""}
                          onChange={(e) => updateBillingAddress(addr.id, { stateCode: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBillingAddress(addr.id)}
                        className="text-red-500 hover:text-red-700 mt-5 p-1 rounded hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {(form.billingAddresses || []).length === 0 && (
                    <div className="text-xs text-onyx/40 text-center py-2">No billing addresses defined.</div>
                  )}
                </div>
              </div>

              {/* Multiple Shipping Addresses */}
              <div className="col-span-full border border-onyx/5 rounded-xl p-4 bg-cream-light/10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-onyx/70 uppercase tracking-wide">Shipping Addresses</h3>
                  <button
                    type="button"
                    onClick={addShippingAddress}
                    className="text-xs font-semibold text-saffron hover:underline"
                  >
                    + Add Shipping Address
                  </button>
                </div>
                <div className="space-y-3">
                  {(form.shippingAddresses || []).map((addr: any) => (
                    <div key={addr.id} className="flex gap-3 items-start border-b border-onyx/5 pb-3 last:border-0 last:pb-0">
                      <div className="w-1/3">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">Label (e.g. Warehouse Pune)</label>
                        <input
                          className={inputCls}
                          placeholder="Label"
                          value={addr.label}
                          onChange={(e) => updateShippingAddress(addr.id, { label: e.target.value })}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">Address</label>
                        <textarea
                          className={inputCls}
                          rows={1}
                          placeholder="Full address"
                          value={addr.address}
                          onChange={(e) => updateShippingAddress(addr.id, { address: e.target.value })}
                        />
                      </div>
                      <div className="w-20">
                        <label className="block text-[10px] text-onyx/50 mb-0.5">State Code</label>
                        <input
                          className={inputCls}
                          placeholder="e.g. 27"
                          value={addr.stateCode || ""}
                          onChange={(e) => updateShippingAddress(addr.id, { stateCode: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeShippingAddress(addr.id)}
                        className="text-red-500 hover:text-red-700 mt-5 p-1 rounded hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {(form.shippingAddresses || []).length === 0 && (
                    <div className="text-xs text-onyx/40 text-center py-2">No shipping addresses defined.</div>
                  )}
                </div>
              </div>
              <Field label="Contact person">
                <input className={inputCls} value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
              </Field>
              <Field label="Contact phone">
                <input className={inputCls} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </Field>
              <Field label="Contact email">
                <input className={inputCls} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </Field>
              <Field label="Payment terms">
                <input className={inputCls} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
              </Field>
              <Field label="Credit days">
                <input type="number" className={inputCls} value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: Number(e.target.value) })} />
              </Field>
              <Field label="Credit limit (₹)">
                <input type="number" className={inputCls} value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-onyx/70 col-span-full">
                <input type="checkbox" checked={form.tcsApplicable} onChange={(e) => setForm({ ...form, tcsApplicable: e.target.checked })} />
                TCS applicable
              </label>
            </div>
            {error && <div className="px-6 pb-2 text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-onyx/10">
              <button onClick={() => setIsOpen(false)} className="px-4 py-2 text-sm text-onyx/60 hover:text-onyx">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={loading}
                className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50"
              >
                {loading ? "Saving…" : isEditing ? "Save changes" : "Create customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <label className="block text-xs font-semibold text-onyx/60 mb-1">{label}</label>
      {children}
    </div>
  );
}
