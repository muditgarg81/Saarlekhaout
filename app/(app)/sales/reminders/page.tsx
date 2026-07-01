import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import RemindersDashboard from "./RemindersDashboard";
import { getFreshUser } from "@/app/actions/auth";

export default async function RemindersPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  // 1. Fetch overdue invoices and customers
  const [overdueInvoices, customers] = await Promise.all([
    db.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        dueDate: { lt: new Date() },
        deletedAt: null,
      },
      orderBy: { dueDate: "asc" },
    }),
    db.customer.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, contactEmail: true },
    }),
  ]);

  const customerMap = new Map(customers.map((c) => [c.id, c]));

  // 2. Fetch reminder history log
  const remindersLog = await db.paymentReminder.findMany({
    where: { companyId },
    include: {
      invoice: { select: { number: true } },
      customer: { select: { name: true } },
    },
    orderBy: { sentAt: "desc" },
    take: 100,
  });

  const formattedInvoices = overdueInvoices.map((inv) => {
    const cust = customerMap.get(inv.customerId);
    return {
      id: inv.id,
      number: inv.number,
      customerName: cust ? `${cust.name} (${cust.code})` : "—",
      customerEmail: cust?.contactEmail || "No Email",
      totalAmount: inv.totalAmount,
      paidAmount: inv.paidAmount,
      outstandingAmount: inv.totalAmount - inv.paidAmount,
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      reminderCount: inv.reminderCount,
      lastReminderSentAt: inv.lastReminderSentAt ? inv.lastReminderSentAt.toISOString() : null,
    };
  });

  const formattedLog = remindersLog.map((log) => ({
    id: log.id,
    invoiceNo: log.invoice.number,
    customerName: log.customer.name,
    sentAt: log.sentAt.toISOString(),
    sentTo: log.sentTo,
    status: log.status,
    method: log.method,
  }));

  return (
    <RemindersDashboard
      overdueInvoices={formattedInvoices}
      remindersLog={formattedLog}
      user={user as any}
    />
  );
}
