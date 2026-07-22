"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { QuotationStatus, SoStatus, SoType } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { can } from "@/lib/rbac";
import { getFreshUser } from "@/app/actions/auth";
import { notify } from "@/lib/notifications";

const quotationLineSchema = z.object({
  itemId: z.string().min(1, "Item is required"),
  qty: z.number().positive("Qty must be > 0"),
  rate: z.number().nonnegative(),
  discount: z.number().min(0).max(100).default(0),
  gstRate: z.number().min(0).default(0),
  specification: z.string().optional().nullable(),
});

const quotationSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  validUpto: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
  placeOfSupply: z.string().optional().nullable(),
  termsConditions: z.string().optional().nullable(),
  leadTime: z.string().optional().nullable(),
  otherCharges: z.number().nonnegative().default(0),
  lines: z.array(quotationLineSchema).min(1, "Add at least one line"),
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

function qLineGross(l: { qty: number; rate: number; discount?: number; gstRate?: number }) {
  const taxable = l.qty * l.rate * (1 - (l.discount || 0) / 100);
  return taxable * (1 + (l.gstRate || 0) / 100);
}

export async function createQuotation(data: z.infer<typeof quotationSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "quotation.create")) {
    return { success: false, error: "Forbidden: Missing quotation.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = quotationSchema.parse(data);

    const customer = await db.customer.findFirst({
      where: { id: validated.customerId, companyId, deletedAt: null },
    });
    if (!customer) return { success: false, error: "Customer not found" };
    if (customer.status === "BLACKLISTED" || customer.status === "HOLD") {
      return { success: false, error: `Customer is ${customer.status}; cannot raise a quotation` };
    }

    const number = await getNextSequence(companyId, "QT");

    const result = await db.$transaction(async (tx) => {
      const q = await tx.customerQuotation.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          status: QuotationStatus.DRAFT,
          validUpto: validated.validUpto ? new Date(validated.validUpto) : null,
          paymentTerms: validated.paymentTerms || customer.paymentTerms || null,
          billingAddress: validated.billingAddress || customer.billingAddress || null,
          shippingAddress: validated.shippingAddress || customer.shippingAddress || null,
          placeOfSupply: validated.placeOfSupply || customer.stateCode || null,
          termsConditions: validated.termsConditions || null,
          leadTime: validated.leadTime || null,
          otherCharges: validated.otherCharges,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              specification: l.specification || null,
            })),
          },
        },
        include: { lines: true },
      });

      await logAudit(tx, companyId, actorId, "CREATE", "CustomerQuotation", q.id, null, q);
      return q;
    });

    revalidatePath("/sales/quotations");
    return { success: true, quotation: result };
  } catch (err: any) {
    console.error("Error creating quotation:", err);
    return { success: false, error: err.message || "Failed to create quotation" };
  }
}

export async function submitQuotation(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "quotation.create")) {
    return { success: false, error: "Forbidden: Missing quotation.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.customerQuotation.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.DRAFT) {
      return { success: false, error: `Cannot submit a quotation in ${q.status} state` };
    }
    if (q.lines.length === 0) return { success: false, error: "Quotation has no lines" };

    await db.$transaction(async (tx) => {
      await tx.customerQuotation.update({ where: { id }, data: { status: QuotationStatus.PENDING_APPROVAL } });
      await logAudit(tx, companyId, actorId, "SUBMIT", "CustomerQuotation", id, { status: q.status }, { status: QuotationStatus.PENDING_APPROVAL });
    });

    const value = q.lines.reduce((s, l) => s + qLineGross(l), 0) + q.otherCharges;
    await notify({
      companyId,
      audience: { permission: "quotation.approve" },
      category: "APPROVAL",
      severity: "ACTION",
      title: `Customer Quotation ${q.number} awaiting approval`,
      body: `Quotation value ₹${value.toLocaleString("en-IN")}`,
      deepLink: `/sales/quotations`,
      entityType: "CustomerQuotation",
      entityId: id,
      dedupeKey: `quotation-approve-${id}`,
    });

    revalidatePath("/sales/quotations");
    return { success: true };
  } catch (err: any) {
    console.error("Error submitting quotation:", err);
    return { success: false, error: err.message || "Failed to submit quotation" };
  }
}

export async function approveQuotation(id: string) {
  const user = await getFreshUser();
  if (!user) return { success: false, error: "Unauthorized" };
  if (!can(user as any, "quotation.approve")) {
    return { success: false, error: "Forbidden: Missing quotation.approve permission" };
  }
  const companyId = user.companyId;

  try {
    const q = await db.customerQuotation.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.PENDING_APPROVAL) {
      return { success: false, error: `Cannot approve a quotation in ${q.status} state` };
    }

    await db.$transaction(async (tx) => {
      await tx.customerQuotation.update({
        where: { id },
        data: { status: QuotationStatus.SENT, approvedById: user.id, approvedAt: new Date() },
      });
      await logAudit(tx, companyId, user.id, "APPROVE", "CustomerQuotation", id, { status: q.status }, { status: QuotationStatus.SENT });
    });

    revalidatePath("/sales/quotations");
    return { success: true };
  } catch (err: any) {
    console.error("Error approving quotation:", err);
    return { success: false, error: err.message || "Failed to approve quotation" };
  }
}

export async function rejectQuotation(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "quotation.approve")) {
    return { success: false, error: "Forbidden: Missing quotation.approve permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.customerQuotation.findFirst({ where: { id, companyId } });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.PENDING_APPROVAL) {
      return { success: false, error: `Cannot reject a quotation in ${q.status} state` };
    }

    await db.$transaction(async (tx) => {
      await tx.customerQuotation.update({ where: { id }, data: { status: QuotationStatus.REJECTED } });
      await logAudit(tx, companyId, actorId, "REJECT", "CustomerQuotation", id, { status: q.status }, { status: QuotationStatus.REJECTED, reason });
    });

    revalidatePath("/sales/quotations");
    return { success: true };
  } catch (err: any) {
    console.error("Error rejecting quotation:", err);
    return { success: false, error: err.message || "Failed to reject quotation" };
  }
}

export async function cancelQuotation(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "quotation.create") && !can(session.user as any, "quotation.approve")) {
    return { success: false, error: "Forbidden: Missing permissions to cancel quotation" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.customerQuotation.findFirst({ where: { id, companyId } });
    if (!q) return { success: false, error: "Quotation not found" };
    const cancellable: QuotationStatus[] = [QuotationStatus.DRAFT, QuotationStatus.PENDING_APPROVAL, QuotationStatus.SENT];
    if (!cancellable.includes(q.status)) {
      return { success: false, error: `Cannot cancel a quotation in ${q.status} state` };
    }

    await db.$transaction(async (tx) => {
      await tx.customerQuotation.update({ where: { id }, data: { status: QuotationStatus.CANCELLED } });
      await logAudit(tx, companyId, actorId, "CANCEL", "CustomerQuotation", id, { status: q.status }, { status: QuotationStatus.CANCELLED, reason });
    });

    revalidatePath("/sales/quotations");
    return { success: true };
  } catch (err: any) {
    console.error("Error cancelling quotation:", err);
    return { success: false, error: err.message || "Failed to cancel quotation" };
  }
}

export async function convertToSalesOrder(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "so.create")) {
    return { success: false, error: "Forbidden: Missing so.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.customerQuotation.findFirst({
      where: { id, companyId },
      include: { lines: true },
    });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.SENT) {
      return { success: false, error: `Cannot convert quotation in ${q.status} state. It must be in SENT (approved) state.` };
    }

    const number = await getNextSequence(companyId, "SO");

    const result = await db.$transaction(async (tx) => {
      // 1. Create SalesOrder
      const so = await tx.salesOrder.create({
        data: {
          companyId,
          number,
          customerId: q.customerId,
          type: SoType.REGULAR,
          status: SoStatus.DRAFT,
          customerPoNo: `Converted from ${q.number}`,
          customerPoDate: new Date(),
          deliveryDate: q.validUpto,
          paymentTerms: q.paymentTerms,
          billingAddress: q.billingAddress,
          shippingAddress: q.shippingAddress,
          placeOfSupply: q.placeOfSupply,
          termsConditions: q.termsConditions,
          leadTime: q.leadTime,
          otherCharges: q.otherCharges,
          quotationId: q.id,
          lines: {
            create: q.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              specification: l.specification,
            })),
          },
        },
      });

      // 2. Mark Quotation as ACCEPTED
      await tx.customerQuotation.update({
        where: { id: q.id },
        data: { status: QuotationStatus.ACCEPTED },
      });

      await logAudit(tx, companyId, actorId, "CONVERT_TO_SO", "CustomerQuotation", q.id, { status: q.status }, { status: QuotationStatus.ACCEPTED, salesOrderId: so.id });
      await logAudit(tx, companyId, actorId, "CREATE", "SalesOrder", so.id, null, so);

      return so;
    });

    revalidatePath("/sales/quotations");
    revalidatePath("/sales/orders");
    return { success: true, salesOrder: result };
  } catch (err: any) {
    console.error("Error converting quotation to sales order:", err);
    return { success: false, error: err.message || "Failed to convert quotation" };
  }
}

export async function deleteQuotation(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const q = await db.customerQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.DRAFT && q.status !== QuotationStatus.SENT) {
      return { success: false, error: `Cannot delete quotation in ${q.status} state.` };
    }

    await db.$transaction(async (tx) => {
      await tx.customerQuotation.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await logAudit(tx, companyId, actorId, "DELETE", "CustomerQuotation", id, q, { deletedAt: new Date() });
    });

    revalidatePath("/sales/quotations");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting quotation:", err);
    return { success: false, error: err.message || "Failed to delete quotation" };
  }
}

export async function updateQuotation(id: string, data: z.infer<typeof quotationSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = quotationSchema.parse(data);

    const q = await db.customerQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true }
    });
    if (!q) return { success: false, error: "Quotation not found" };
    if (q.status !== QuotationStatus.DRAFT && q.status !== QuotationStatus.SENT) {
      return { success: false, error: `Cannot edit quotation in ${q.status} state.` };
    }

    const result = await db.$transaction(async (tx) => {
      await tx.customerQuotationLine.deleteMany({
        where: { quotationId: id }
      });

      const updated = await tx.customerQuotation.update({
        where: { id },
        data: {
          customerId: validated.customerId,
          validUpto: validated.validUpto ? new Date(validated.validUpto) : null,
          paymentTerms: validated.paymentTerms || null,
          billingAddress: validated.billingAddress || null,
          shippingAddress: validated.shippingAddress || null,
          placeOfSupply: validated.placeOfSupply || null,
          termsConditions: validated.termsConditions || null,
          leadTime: validated.leadTime || null,
          otherCharges: validated.otherCharges,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              discount: l.discount,
              gstRate: l.gstRate,
              specification: l.specification || null,
            })),
          },
        },
        include: { lines: true }
      });

      await logAudit(tx, companyId, actorId, "UPDATE", "CustomerQuotation", id, q, updated);
      return updated;
    });

    revalidatePath("/sales/quotations");
    return { success: true, quotation: result };
  } catch (err: any) {
    console.error("Error updating quotation:", err);
    return { success: false, error: err.message || "Failed to update quotation" };
  }
}
