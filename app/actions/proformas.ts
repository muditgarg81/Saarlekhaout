"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ProformaStatus, SoStatus, SoLineStatus } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { can } from "@/lib/rbac";

// Proforma Invoice — a preliminary invoice a customer pays against before goods
// ship. It can be seeded from a quotation, printed as a PDF, and later
// "captured" into a confirmed Sales Order, from which the existing Dispatch
// (delivery note) and Tax Invoice flows take over.

const lineSchema = z.object({
  itemId: z.string().min(1, "Item is required"),
  uom: z.string().optional().nullable(),
  qty: z.number().positive("Qty must be > 0"),
  rate: z.number().nonnegative(),
  discount: z.number().min(0).max(100).default(0),
  gstRate: z.number().min(0).default(0),
  specification: z.string().optional().nullable(),
});

const proformaSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  quotationId: z.string().optional().nullable(),
  validUpto: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  deliveryTerms: z.string().optional().nullable(),
  placeOfSupply: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  otherCharges: z.number().nonnegative().default(0),
  advanceReceived: z.number().nonnegative().default(0),
  lines: z.array(lineSchema).min(1, "Add at least one line"),
});

async function logAudit(tx: any, companyId: string, actorId: string, action: string, entity: string, entityId: string, before: any, after: any) {
  await tx.auditLog.create({
    data: { companyId, actorId, action, entity, entityId, before: before ? JSON.parse(JSON.stringify(before)) : null, after: after ? JSON.parse(JSON.stringify(after)) : null },
  });
}

function computeTotals(lines: { qty: number; rate: number; discount?: number; gstRate?: number }[], placeOfSupply: string, sellerState: string, otherCharges: number) {
  const intraState = !!sellerState && !!placeOfSupply && sellerState === placeOfSupply;
  let taxable = 0, totalTax = 0;
  for (const l of lines) {
    const t = l.qty * l.rate * (1 - (l.discount || 0) / 100);
    taxable += t;
    totalTax += (t * (l.gstRate || 0)) / 100;
  }
  const cgst = intraState ? totalTax / 2 : 0;
  const sgst = intraState ? totalTax / 2 : 0;
  const igst = intraState ? 0 : totalTax;
  const preRound = taxable + totalTax + otherCharges;
  const totalAmount = Math.round(preRound);
  const roundOff = +(totalAmount - preRound).toFixed(2);
  return {
    taxableAmount: +taxable.toFixed(2),
    cgst: +cgst.toFixed(2),
    sgst: +sgst.toFixed(2),
    igst: +igst.toFixed(2),
    roundOff,
    totalAmount,
  };
}

export async function createProforma(data: z.infer<typeof proformaSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) return { success: false, error: "Forbidden: Missing sales.invoice permission" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = proformaSchema.parse(data);
    const customer = await db.customer.findFirst({ where: { id: validated.customerId, companyId, deletedAt: null } });
    if (!customer) return { success: false, error: "Customer not found" };

    // Fall back to the customer's first saved address (multi-address list, then legacy single).
    const firstAddr = (list: any, legacy: string | null | undefined) => {
      if (Array.isArray(list) && list.length > 0 && list[0]?.address) return String(list[0].address);
      return legacy || null;
    };
    const billingAddress = validated.billingAddress || firstAddr((customer as any).billingAddresses, customer.billingAddress);
    const shippingAddress = validated.shippingAddress || firstAddr((customer as any).shippingAddresses, customer.shippingAddress);

    const company = await db.company.findUnique({ where: { id: companyId } });
    const sellerState = company?.gstin?.slice(0, 2) || "";
    const placeOfSupply = validated.placeOfSupply || customer.stateCode || customer.gstin?.slice(0, 2) || "";
    const totals = computeTotals(validated.lines, placeOfSupply, sellerState, validated.otherCharges);

    const number = await getNextSequence(companyId, "PI");

    const result = await db.$transaction(async (tx) => {
      const pi = await tx.proformaInvoice.create({
        data: {
          companyId,
          number,
          customerId: customer.id,
          quotationId: validated.quotationId || null,
          status: ProformaStatus.DRAFT,
          validUpto: validated.validUpto ? new Date(validated.validUpto) : null,
          paymentTerms: validated.paymentTerms || customer.paymentTerms || null,
          deliveryTerms: validated.deliveryTerms || null,
          placeOfSupply,
          billingAddress,
          shippingAddress,
          notes: validated.notes || null,
          otherCharges: validated.otherCharges,
          advanceReceived: validated.advanceReceived || 0,
          ...totals,
          createdById: actorId,
          lines: {
            create: validated.lines.map((l) => ({
              itemId: l.itemId, uom: l.uom || null, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification || null,
            })),
          },
        },
        include: { lines: true },
      });
      await logAudit(tx, companyId, actorId, "CREATE", "ProformaInvoice", pi.id, null, pi);
      return pi;
    });

    revalidatePath("/sales/proforma");
    return { success: true, proforma: result };
  } catch (err: any) {
    console.error("Error creating proforma:", err);
    return { success: false, error: err.message || "Failed to create proforma" };
  }
}

export async function sendProforma(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) return { success: false, error: "Forbidden" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  try {
    const pi = await db.proformaInvoice.findFirst({ where: { id, companyId } });
    if (!pi) return { success: false, error: "Proforma not found" };
    if (pi.status !== ProformaStatus.DRAFT) return { success: false, error: `Cannot send from ${pi.status}` };
    await db.$transaction(async (tx) => {
      await tx.proformaInvoice.update({ where: { id }, data: { status: ProformaStatus.SENT } });
      await logAudit(tx, companyId, actorId, "SEND", "ProformaInvoice", id, { status: pi.status }, { status: ProformaStatus.SENT });
    });
    revalidatePath("/sales/proforma");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to send proforma" };
  }
}

export async function cancelProforma(id: string, reason: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) return { success: false, error: "Forbidden" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  try {
    const pi = await db.proformaInvoice.findFirst({ where: { id, companyId } });
    if (!pi) return { success: false, error: "Proforma not found" };
    if (pi.status === ProformaStatus.CONVERTED) return { success: false, error: "Already converted to a sales order" };
    await db.$transaction(async (tx) => {
      await tx.proformaInvoice.update({ where: { id }, data: { status: ProformaStatus.CANCELLED } });
      await logAudit(tx, companyId, actorId, "CANCEL", "ProformaInvoice", id, { status: pi.status }, { status: ProformaStatus.CANCELLED, reason });
    });
    revalidatePath("/sales/proforma");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to cancel proforma" };
  }
}

// Capture the proforma into a confirmed Sales Order — the pivot from which the
// existing Dispatch (delivery note) and Tax Invoice flows produce the goods and
// the final invoice.
export async function convertProformaToSalesOrder(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) return { success: false, error: "Forbidden" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const pi = await db.proformaInvoice.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!pi) return { success: false, error: "Proforma not found" };
    if (pi.status === ProformaStatus.CONVERTED) return { success: false, error: "Proforma already converted" };
    if (pi.status === ProformaStatus.CANCELLED) return { success: false, error: "Proforma is cancelled" };
    if (pi.lines.length === 0) return { success: false, error: "Proforma has no lines" };

    const soNumber = await getNextSequence(companyId, "SO");

    const result = await db.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: {
          companyId,
          number: soNumber,
          customerId: pi.customerId,
          status: SoStatus.CONFIRMED,
          quotationId: pi.quotationId || null,
          paymentTerms: pi.paymentTerms,
          billingAddress: pi.billingAddress,
          shippingAddress: pi.shippingAddress,
          placeOfSupply: pi.placeOfSupply,
          leadTime: pi.deliveryTerms,
          otherCharges: pi.otherCharges,
          approvedById: actorId,
          approvedAt: new Date(),
          lines: {
            create: pi.lines.map((l) => ({
              itemId: l.itemId, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification, status: SoLineStatus.OPEN,
            })),
          },
        },
      });
      await tx.proformaInvoice.update({ where: { id }, data: { status: ProformaStatus.CONVERTED, soId: so.id } });
      await logAudit(tx, companyId, actorId, "CONVERT", "ProformaInvoice", id, { status: pi.status }, { status: ProformaStatus.CONVERTED, soId: so.id });
      return so;
    });

    revalidatePath("/sales/proforma");
    revalidatePath("/sales/orders");
    return { success: true, salesOrderNumber: result.number };
  } catch (err: any) {
    console.error("Error converting proforma:", err);
    return { success: false, error: err.message || "Failed to convert proforma" };
  }
}

export async function recordProformaAdvance(id: string, advanceReceived: number) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) return { success: false, error: "Forbidden" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const pi = await db.proformaInvoice.findFirst({ where: { id, companyId } });
    if (!pi) return { success: false, error: "Proforma not found" };

    const val = Number(advanceReceived) || 0;
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.proformaInvoice.update({
        where: { id },
        data: { advanceReceived: val },
      });
      await logAudit(tx, companyId, actorId, "UPDATE_ADVANCE", "ProformaInvoice", id, { advanceReceived: pi.advanceReceived }, { advanceReceived: val });
      return updated;
    });

    revalidatePath("/sales/proforma");
    return { success: true, proforma: result };
  } catch (err: any) {
    console.error("Error updating advance received:", err);
    return { success: false, error: err.message || "Failed to record advance amount" };
  }
}
