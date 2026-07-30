"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";

// Customer statement of account — the running ledger you send a customer to
// reconcile what they owe. Invoices and posted debit notes are debits (increase
// the balance owed); receipts and posted credit notes are credits (reduce it).

export type StatementRow = {
  date: string;
  type: "Invoice" | "Receipt" | "Credit Note" | "Debit Note";
  ref: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
};

export async function getCustomerStatement(customerId: string, fromISO: string, toISO: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false as const, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    to.setHours(23, 59, 59, 999);

    const customer = await db.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, code: true, name: true, gstin: true, billingAddress: true },
    });
    if (!customer) return { success: false as const, error: "Customer not found" };

    const [invoices, receipts, notes, company] = await Promise.all([
      db.salesInvoice.findMany({
        where: { companyId, customerId, deletedAt: null, status: { not: "CANCELLED" } },
        select: { number: true, invoiceDate: true, totalAmount: true },
      }),
      db.receiptVoucher.findMany({
        where: { companyId, customerId },
        select: { number: true, receivedOn: true, amount: true, mode: true },
      }),
      db.salesNote.findMany({
        where: { companyId, customerId, posted: true },
        select: { number: true, type: true, createdAt: true, amount: true, reason: true },
      }),
      db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true, gstin: true, address: true } }),
    ]);

    type Txn = { at: Date; row: Omit<StatementRow, "balance"> };
    const txns: Txn[] = [];

    for (const i of invoices) {
      txns.push({
        at: i.invoiceDate,
        row: { date: i.invoiceDate.toISOString().slice(0, 10), type: "Invoice", ref: i.number, particulars: "Tax invoice", debit: i.totalAmount, credit: 0 },
      });
    }
    for (const r of receipts) {
      txns.push({
        at: r.receivedOn,
        row: { date: r.receivedOn.toISOString().slice(0, 10), type: "Receipt", ref: r.number, particulars: `Payment received (${r.mode})`, debit: 0, credit: r.amount },
      });
    }
    for (const n of notes) {
      const isCredit = n.type === "CREDIT";
      txns.push({
        at: n.createdAt,
        row: {
          date: n.createdAt.toISOString().slice(0, 10),
          type: isCredit ? "Credit Note" : "Debit Note",
          ref: n.number,
          particulars: n.reason || (isCredit ? "Credit note" : "Debit note"),
          debit: isCredit ? 0 : n.amount,
          credit: isCredit ? n.amount : 0,
        },
      });
    }

    txns.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Opening balance = net of everything strictly before the period.
    let opening = 0;
    for (const t of txns) {
      if (t.at < from) opening += t.row.debit - t.row.credit;
    }

    let balance = opening;
    const rows: StatementRow[] = [];
    let periodDebit = 0;
    let periodCredit = 0;
    for (const t of txns) {
      if (t.at < from || t.at > to) continue;
      balance += t.row.debit - t.row.credit;
      periodDebit += t.row.debit;
      periodCredit += t.row.credit;
      rows.push({ ...t.row, balance: +balance.toFixed(2) });
    }

    return {
      success: true as const,
      customer,
      company: { name: company?.legalName || company?.name || "", gstin: company?.gstin || "", address: company?.address || "" },
      opening: +opening.toFixed(2),
      closing: +balance.toFixed(2),
      periodDebit: +periodDebit.toFixed(2),
      periodCredit: +periodCredit.toFixed(2),
      rows,
      period: { from: fromISO, to: toISO },
    };
  } catch (err: any) {
    console.error("Statement error:", err);
    return { success: false as const, error: err.message || "Failed to build statement" };
  }
}
