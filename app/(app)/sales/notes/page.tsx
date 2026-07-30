import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import NotesList from "./NotesList";
import { getFreshUser } from "@/app/actions/auth";

export default async function SalesNotesPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [notes, customers, invoices, items] = await Promise.all([
    db.salesNote.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null, status: { not: "CANCELLED" } },
      select: { id: true, number: true, customerId: true, totalAmount: true, paidAmount: true },
      orderBy: { invoiceDate: "desc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const invNo = new Map(invoices.map((i) => [i.id, i.number]));

  const mappedNotes = notes.map((n) => ({
    id: n.id,
    number: n.number,
    type: n.type,
    customer: custName.get(n.customerId) || "—",
    invoiceNumber: n.invoiceId ? invNo.get(n.invoiceId) || null : null,
    refType: n.refType,
    amount: n.amount,
    reason: n.reason,
    posted: n.posted,
    createdAt: n.createdAt.toISOString(),
  }));

  const invoiceOpts = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    customerId: i.customerId,
    outstanding: +(i.totalAmount - i.paidAmount).toFixed(2),
  }));

  return <NotesList initialNotes={mappedNotes} customers={customers} invoices={invoiceOpts} items={items} user={user as any} />;
}
