"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SalesNoteType, SalesInvoiceStatus, LedgerTxnType } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { postLedgerEntry } from "@/lib/stock";
import { can } from "@/lib/rbac";

// Sales Credit / Debit notes. A CREDIT note (SCN-) reduces what a customer owes
// (sales return, rate difference, discount); when posted against an invoice it
// lowers that invoice's outstanding. A DEBIT note (SDN-) records an extra charge
// to the customer. Notes are immutable once posted.

const noteSchema = z.object({
  type: z.nativeEnum(SalesNoteType),
  customerId: z.string().min(1, "Customer is required"),
  invoiceId: z.string().optional().nullable(),
  refType: z.string().optional().nullable(), // SALES_RETURN | RATE_DIFF | DISCOUNT | OTHER
  amount: z.number().positive("Amount must be > 0"),
  reason: z.string().optional().nullable(),
  itemId: z.string().optional().nullable(), // SALES_RETURN: product returned
  returnQty: z.number().positive().optional().nullable(), // qty re-stocked on post
});

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}

export async function createSalesNote(data: z.infer<typeof noteSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) {
    return { success: false, error: "Forbidden: Missing sales.invoice permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = noteSchema.parse(data);

    const customer = await db.customer.findFirst({ where: { id: validated.customerId, companyId, deletedAt: null } });
    if (!customer) return { success: false, error: "Customer not found" };

    if (validated.invoiceId) {
      const inv = await db.salesInvoice.findFirst({ where: { id: validated.invoiceId, companyId } });
      if (!inv) return { success: false, error: "Invoice not found" };
      if (inv.customerId !== customer.id) return { success: false, error: "Invoice does not belong to this customer" };
      if (inv.status === SalesInvoiceStatus.CANCELLED) return { success: false, error: "Invoice is cancelled" };
    }

    const number = await getNextSequence(companyId, validated.type === SalesNoteType.CREDIT ? "SCN" : "SDN");

    const result = await db.$transaction(async (tx) => {
      const note = await tx.salesNote.create({
        data: {
          companyId,
          number,
          type: validated.type,
          customerId: customer.id,
          invoiceId: validated.invoiceId || null,
          refType: validated.refType || null,
          amount: validated.amount,
          reason: validated.reason || null,
          itemId: validated.itemId || null,
          returnQty: validated.returnQty ?? null,
          createdById: actorId,
        },
      });
      await logAudit(tx, companyId, actorId, "CREATE", "SalesNote", note.id, null, note);
      return note;
    });

    revalidatePath("/sales/notes");
    return { success: true, note: result };
  } catch (err: any) {
    console.error("Error creating sales note:", err);
    return { success: false, error: err.message || "Failed to create note" };
  }
}

export async function postSalesNote(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) {
    return { success: false, error: "Forbidden: Missing sales.invoice permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const note = await db.salesNote.findFirst({ where: { id, companyId } });
    if (!note) return { success: false, error: "Note not found" };
    if (note.posted) return { success: false, error: "Note is already posted" };

    await db.$transaction(async (tx) => {
      await tx.salesNote.update({ where: { id }, data: { posted: true } });

      // A sales-return credit note puts the returned goods back into stock.
      if (note.type === SalesNoteType.CREDIT && note.refType === "SALES_RETURN" && note.itemId && (note.returnQty || 0) > 0) {
        const company = await tx.company.findUnique({ where: { id: companyId } });
        const storeId = company?.defaultStoreId;
        if (storeId) {
          await postLedgerEntry(tx, {
            companyId,
            itemId: note.itemId,
            storeId,
            txnType: LedgerTxnType.RETURN_TO_STORE,
            qty: Math.abs(note.returnQty || 0),
            refType: "SALES_RETURN",
            refId: note.id,
            createdById: actorId,
          });
        }
      }

      // A posted CREDIT note against an invoice reduces its outstanding.
      if (note.type === SalesNoteType.CREDIT && note.invoiceId) {
        const inv = await tx.salesInvoice.findFirst({ where: { id: note.invoiceId, companyId } });
        if (inv && inv.status !== SalesInvoiceStatus.CANCELLED) {
          const outstanding = inv.totalAmount - inv.paidAmount;
          const applied = Math.min(note.amount, Math.max(0, outstanding));
          const newPaid = inv.paidAmount + applied;
          const newStatus =
            newPaid >= inv.totalAmount - 1e-9 ? SalesInvoiceStatus.PAID : SalesInvoiceStatus.PARTIALLY_PAID;
          await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, status: newStatus } });
        }
      }

      await logAudit(tx, companyId, actorId, "POST", "SalesNote", id, { posted: false }, { posted: true });
    });

    revalidatePath("/sales/notes");
    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (err: any) {
    console.error("Error posting sales note:", err);
    return { success: false, error: err.message || "Failed to post note" };
  }
}

export async function deleteSalesNote(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) {
    return { success: false, error: "Forbidden: Missing sales.invoice permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const note = await db.salesNote.findFirst({ where: { id, companyId } });
    if (!note) return { success: false, error: "Note not found" };
    if (note.posted) return { success: false, error: "Cannot delete a posted note" };

    await db.$transaction(async (tx) => {
      await tx.salesNote.delete({ where: { id } });
      await logAudit(tx, companyId, actorId, "DELETE", "SalesNote", id, note, null);
    });

    revalidatePath("/sales/notes");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting sales note:", err);
    return { success: false, error: err.message || "Failed to delete note" };
  }
}
