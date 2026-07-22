"use client";

import { useState, useMemo } from "react";
import { 
  TrendingUp, 
  BarChart3, 
  Calendar, 
  Users, 
  Clock, 
  ShieldAlert, 
  Printer, 
  RefreshCw,
  Search,
  ChevronDown,
  Boxes
} from "lucide-react";

interface MappedOrder {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customer: string;
  orderDate: string;
  status: string;
  orderedValue: number;
  dispatchedValue: number;
  pendingValue: number;
  linesCount: number;
}

interface CustOpt {
  id: string;
  code: string;
  name: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  CONFIRMED: "Approved",
  PARTIALLY_DISPATCHED: "Partially Dispatched",
  DISPATCHED: "Fully Dispatched",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-200",
  PARTIALLY_DISPATCHED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  DISPATCHED: "bg-green-100 text-green-800 border-green-200",
  COMPLETED: "bg-green-100 text-green-800 border-green-200",
  INVOICED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

export default function SoReportClient({
  initialOrders,
  customers,
}: {
  initialOrders: MappedOrder[];
  customers: CustOpt[];
}) {
  const [orders] = useState<MappedOrder[]>(initialOrders);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchSearch =
        o.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.customer.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCustomer = selectedCustomerId ? o.customerId === selectedCustomerId : true;
      const matchStatus = selectedStatus ? o.status === selectedStatus : true;

      const orderTime = new Date(o.orderDate).getTime();
      const matchStart = startDate ? orderTime >= new Date(startDate).getTime() : true;
      // Add 23:59:59 to end date to include the whole end day
      const matchEnd = endDate ? orderTime <= new Date(endDate).getTime() + 86400000 : true;

      return matchSearch && matchCustomer && matchStatus && matchStart && matchEnd;
    });
  }, [orders, searchTerm, selectedCustomerId, selectedStatus, startDate, endDate]);

  // Aggregate stats based on FILTERED orders
  const stats = useMemo(() => {
    const active = filteredOrders.filter(o => o.status !== "CANCELLED");
    const totalVal = active.reduce((s, o) => s + o.orderedValue, 0);
    const dispVal = active.reduce((s, o) => s + o.dispatchedValue, 0);
    const pendVal = active.reduce((s, o) => s + o.pendingValue, 0);
    const count = filteredOrders.length;
    return { totalVal, dispVal, pendVal, count };
  }, [filteredOrders]);

  // Customer aggregations (top 5 customers by order value)
  const customerSummary = useMemo(() => {
    const map = new Map<string, { name: string; ordered: number; pending: number }>();
    for (const o of filteredOrders.filter(x => x.status !== "CANCELLED")) {
      const entry = map.get(o.customerId) || { name: o.customerName, ordered: 0, pending: 0 };
      entry.ordered += o.orderedValue;
      entry.pending += o.pendingValue;
      map.set(o.customerId, entry);
    }
    return [...map.values()].sort((a, b) => b.ordered - a.ordered).slice(0, 5);
  }, [filteredOrders]);

  // Status breakdown counts
  const statusSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of filteredOrders) {
      map.set(o.status, (map.get(o.status) || 0) + 1);
    }
    return [...map.entries()].map(([status, count]) => ({
      status,
      count,
      label: STATUS_LABELS[status] || status,
    })).sort((a, b) => b.count - a.count);
  }, [filteredOrders]);

  const handlePrint = () => {
    window.print();
  };

  const resetFilters = () => {
    setSearchTerm("");
    setSelectedCustomerId("");
    setSelectedStatus("");
    setStartDate("");
    setEndDate("");
  };

  const inputCls = "text-xs px-3 py-2 bg-cream-light/40 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron outline-none";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 print:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
            <BarChart3 size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Sales Order Analytics &amp; Reports</h1>
            <p className="text-xs text-onyx/50">Track delivery progress, pending values, status distribution, and top buyers.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 border border-onyx/10 text-onyx hover:bg-onyx/5 font-semibold px-4 py-2 rounded-lg text-xs transition"
          >
            <RefreshCw size={13} />
            <span>Reset</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-saffron hover:bg-saffron-dark text-onyx font-bold px-4 py-2 rounded-lg text-xs transition shadow-sm"
          >
            <Printer size={13} />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Print-only Header */}
      <div className="hidden print:block border-b border-onyx/10 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-onyx">Saarlekha Sales Order Report</h1>
        <p className="text-xs text-onyx/60">
          Generated on {new Date().toLocaleDateString("en-IN", { dateStyle: "long" })} | Filters Applied: 
          {selectedCustomerId ? ` Customer: ${customers.find(c => c.id === selectedCustomerId)?.name},` : ""}
          {selectedStatus ? ` Status: ${selectedStatus},` : ""}
          {startDate || endDate ? ` Period: ${startDate || "Start"} to ${endDate || "End"},` : ""}
          {searchTerm ? ` Search: "${searchTerm}"` : " None"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={<TrendingUp size={16} />} label="Total Active Orders" value={inr(stats.totalVal)} subtitle="Excluding Cancelled" />
        <KpiCard icon={<Boxes size={16} />} label="Dispatched Value" value={inr(stats.dispVal)} subtitle={`${Math.round((stats.dispVal / (stats.totalVal || 1)) * 100)}% Fulfilled`} accent="text-green-600" />
        <KpiCard icon={<Clock size={16} />} label="WIP / Pending Dispatch" value={inr(stats.pendVal)} subtitle={`${Math.round((stats.pendVal / (stats.totalVal || 1)) * 100)}% Remaining`} accent="text-amber-600" />
        <KpiCard icon={<Users size={16} />} label="Order Count" value={String(stats.count)} subtitle="Total orders matching filters" />
      </div>

      {/* Visual Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:hidden">
        {/* Top Customers chart */}
        <div className="bg-white border border-onyx/10 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-onyx/60">Top 5 Customers (Active Order Value)</h3>
          <div className="space-y-3">
            {customerSummary.map((item, idx) => {
              const percent = stats.totalVal > 0 ? (item.ordered / stats.totalVal) * 100 : 0;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-onyx">
                    <span className="truncate max-w-[200px]">{item.name}</span>
                    <span className="font-bold">{inr(item.ordered)} <span className="text-[10px] text-onyx/40 font-normal">(WIP: {inr(item.pending)})</span></span>
                  </div>
                  <div className="w-full bg-onyx/5 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-saffron h-full transition-all duration-300" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
            {customerSummary.length === 0 && (
              <p className="text-xs text-onyx/40 italic py-6 text-center">No customer order data to display.</p>
            )}
          </div>
        </div>

        {/* Status Distribution */}
        <div className="bg-white border border-onyx/10 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-onyx/60">Status Distribution (Order Count)</h3>
          <div className="space-y-3">
            {statusSummary.map((item, idx) => {
              const percent = stats.count > 0 ? (item.count / stats.count) * 100 : 0;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-onyx">
                    <span>{item.label}</span>
                    <span className="font-bold">{item.count} order{item.count > 1 ? "s" : ""}</span>
                  </div>
                  <div className="w-full bg-onyx/5 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-onyx/60 h-full transition-all duration-300" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
            {statusSummary.length === 0 && (
              <p className="text-xs text-onyx/40 italic py-6 text-center">No status data to display.</p>
            )}
          </div>
        </div>
      </div>

      {/* Filter Bar (Print: hidden) */}
      <div className="bg-white border border-onyx/10 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 print:hidden">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 text-onyx/40" size={14} />
          <input
            type="text"
            className={`${inputCls} pl-8 w-full`}
            placeholder="Search SO #, customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div>
          <select
            className={`${inputCls} w-full`}
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
          >
            <option value="">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <select
            className={`${inputCls} w-full`}
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-onyx/40 font-bold uppercase">From</span>
          <input
            type="date"
            className={`${inputCls} w-full`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-onyx/40 font-bold uppercase">To</span>
          <input
            type="date"
            className={`${inputCls} w-full`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden shadow-sm print:border-none print:shadow-none">
        <div className="px-4 py-3 border-b border-onyx/10 font-bold text-onyx text-xs uppercase tracking-wide bg-cream-light/35 print:hidden">
          Sales Orders Listing
        </div>
        <table className="w-full text-sm">
          <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">SO #</th>
              <th className="text-left px-4 py-3 font-semibold">Customer</th>
              <th className="text-left px-4 py-3 font-semibold">Order Date</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-right px-4 py-3 font-semibold">Ordered Value</th>
              <th className="text-right px-4 py-3 font-semibold">Dispatched</th>
              <th className="text-right px-4 py-3 font-semibold">Pending (WIP)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onyx/5">
            {filteredOrders.map((o) => (
              <tr key={o.id} className="hover:bg-cream-light/40 transition-colors">
                <td className="px-4 py-3.5 font-bold text-onyx">{o.number}</td>
                <td className="px-4 py-3.5 text-onyx">{o.customer}</td>
                <td className="px-4 py-3.5 text-onyx/70 text-xs">
                  {new Date(o.orderDate).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                </td>
                <td className="px-4 py-3.5">
                  <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLORS[o.status] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right font-medium text-onyx">{inr(o.orderedValue)}</td>
                <td className="px-4 py-3.5 text-right text-green-600 text-xs">
                  {o.status === "CANCELLED" ? "—" : inr(o.dispatchedValue)}
                </td>
                <td className="px-4 py-3.5 text-right font-semibold text-saffron-dark text-xs">
                  {o.status === "CANCELLED" ? "—" : inr(o.pendingValue)}
                </td>
              </tr>
            ))}
            {filteredOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-onyx/40 text-sm">
                  No Sales Orders matching the filters found.
                </td>
              </tr>
            )}
          </tbody>
          {filteredOrders.length > 0 && (
            <tfoot className="bg-cream-light/60 font-semibold text-onyx border-t border-onyx/10">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-left">Summary Total</td>
                <td className="px-4 py-3 text-right">{inr(stats.totalVal)}</td>
                <td className="px-4 py-3 text-right text-green-600">{inr(stats.dispVal)}</td>
                <td className="px-4 py-3 text-right text-saffron-dark">{inr(stats.pendVal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, subtitle, accent }: { icon: React.ReactNode; label: string; value: string; subtitle?: string; accent?: string }) {
  return (
    <div className="bg-white border border-onyx/10 rounded-xl p-4 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-1.5 text-onyx/40 text-xs font-bold uppercase mb-2">
          {icon} <span>{label}</span>
        </div>
        <div className={`text-xl font-heading font-extrabold ${accent || "text-onyx"}`}>{value}</div>
      </div>
      {subtitle && (
        <span className="text-[10px] text-onyx/45 font-medium mt-1 block border-t border-onyx/5 pt-1.5">{subtitle}</span>
      )}
    </div>
  );
}
