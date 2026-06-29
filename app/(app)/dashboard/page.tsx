import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  Users,
  ClipboardList,
  Truck,
  Receipt,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { getFreshUser } from "@/app/actions/auth";

export default async function DashboardPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;
  const now = new Date();

  const [customersCount, pendingApproval, openOrders, productsCount, openInvoices] = await Promise.all([
    db.customer.count({ where: { companyId, deletedAt: null } }),
    db.salesOrder.count({ where: { companyId, deletedAt: null, status: "PENDING_APPROVAL" } }),
    db.salesOrder.count({ where: { companyId, deletedAt: null, status: { in: ["CONFIRMED", "PARTIALLY_DISPATCHED"] } } }),
    db.item.count({ where: { companyId, deletedAt: null } }),
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      select: { totalAmount: true, paidAmount: true, dueDate: true },
    }),
  ]);

  const receivables = openInvoices.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0);
  const overdueCount = openInvoices.filter((i) => i.dueDate && i.dueDate < now).length;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);

  const cards = [
    { href: "/sales/customers", icon: Users, label: "Customers", value: String(customersCount), sub: "Active debtors" },
    { href: "/sales/orders", icon: ClipboardList, label: "Open Orders", value: String(openOrders), sub: "Confirmed, awaiting dispatch" },
    { href: "/sales/orders", icon: AlertTriangle, label: "Pending Approval", value: String(pendingApproval), sub: "Sales orders to approve" },
    { href: "/sales/dispatch", icon: Truck, label: "Products", value: String(productsCount), sub: "Items available to sell" },
    { href: "/sales/invoices", icon: TrendingUp, label: "Receivables", value: formatCurrency(receivables), sub: "Outstanding on invoices" },
    { href: "/sales/reports", icon: Receipt, label: "Overdue Invoices", value: String(overdueCount), sub: "Past their due date" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-bold text-onyx tracking-tight">
          Welcome back, {user.name || "User"}
        </h1>
        <p className="text-xs text-onyx/50 font-medium mt-1">
          Sales &amp; Dispatch overview — order to cash at a glance.
        </p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="glass-card p-6 rounded-xl border border-onyx/5 flex items-center space-x-4 hover:border-saffron hover:shadow-md transition-all duration-200 group cursor-pointer bg-white"
          >
            <div className="p-3 bg-cream-dark border border-onyx/5 rounded-lg text-saffron-dark group-hover:bg-saffron group-hover:text-onyx transition-all duration-150">
              <c.icon size={24} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">{c.label}</p>
              <p className="text-2xl font-bold text-onyx mt-0.5">{c.value}</p>
              <p className="text-[10px] text-onyx/40 font-medium">{c.sub}</p>
            </div>
          </Link>
        ))}
      </section>

      {overdueCount > 0 && (
        <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl flex items-start space-x-4">
          <AlertTriangle size={20} className="text-red-700 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-red-900">{overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""}</h4>
            <p className="text-xs text-red-800 leading-relaxed mt-1">
              Customers have bills past their due date. Review receivables and follow up on collections.
            </p>
            <div className="mt-3">
              <Link href="/sales/reports" className="text-xs font-bold text-red-900 hover:text-red-950 underline flex items-center">
                <span>View Receivables Report</span>
                <ArrowRight size={12} className="ml-1" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
