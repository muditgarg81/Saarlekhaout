"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DispatchStatus, EWayBillStatus, SoStatus, SoLineStatus, LedgerTxnType, SalesInvoiceStatus, EInvoiceStatus } from "@prisma/client";
import { getNextSequence } from "@/lib/sequences";
import { postLedgerEntry } from "@/lib/stock";
import { can } from "@/lib/rbac";

// Dispatch / Delivery Challan — the outward mirror of the GRN. Issues stock from
// a store against a confirmed Sales Order, rolls up line + order fulfilment, and
// (optionally) generates a GST e-way bill. Stock moves out as a negative,
// average-rate-valued ledger entry, exactly as a GRN moves it in as a positive.

const dispatchLineSchema = z.object({
  soLineId: z.string().min(1),
  itemId: z.string().min(1),
  qty: z.number().positive("Qty must be > 0"),
  batchNo: z.string().optional().nullable(),
});

const dispatchSchema = z.object({
  soId: z.string().min(1, "Sales order is required"),
  storeId: z.string().optional().nullable(),
  dispatchDate: z.string().optional().nullable(),
  vehicleNo: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  transporterGstin: z.string().optional().nullable(),
  lrNo: z.string().optional().nullable(),
  distanceKm: z.number().int().nonnegative().optional().nullable(),
  lines: z.array(dispatchLineSchema).min(1, "Add at least one line"),
  packingListId: z.string().optional().nullable(),
});

const EWAY_THRESHOLD = 50000; // ₹ consignment value above which an e-way bill is mandatory

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

function rollupSoLineStatus(qty: number, dispatchedQty: number): SoLineStatus {
  if (dispatchedQty <= 0) return SoLineStatus.OPEN;
  if (dispatchedQty >= qty) return SoLineStatus.DISPATCHED;
  return SoLineStatus.PARTIALLY_DISPATCHED;
}

export async function createDispatch(data: z.infer<typeof dispatchSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "dispatch.create")) {
    return { success: false, error: "Forbidden: Missing dispatch.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = dispatchSchema.parse(data);

    const so = await db.salesOrder.findFirst({
      where: { id: validated.soId, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!so) return { success: false, error: "Sales order not found" };
    const dispatchable: SoStatus[] = [SoStatus.CONFIRMED, SoStatus.PARTIALLY_DISPATCHED];
    if (!dispatchable.includes(so.status)) {
      return { success: false, error: `Order must be CONFIRMED to dispatch (currently ${so.status})` };
    }

    // Resolve the issuing store.
    const company = await db.company.findUnique({ where: { id: companyId } });
    const storeId = validated.storeId || company?.defaultStoreId || null;
    if (!storeId) {
      return { success: false, error: "No store selected and no company default store configured" };
    }

    // Validate quantities against the open balance on each SO line.
    const lineById = new Map(so.lines.map((l) => [l.id, l]));
    for (const dl of validated.lines) {
      const sol = lineById.get(dl.soLineId);
      if (!sol) return { success: false, error: `Line ${dl.soLineId} is not on this order` };
      const open = sol.qty - sol.dispatchedQty;
      if (dl.qty > open + 1e-9) {
        return {
          success: false,
          error: `Dispatch qty ${dl.qty} exceeds open balance ${open} on item ${sol.itemId}`,
        };
      }
    }

    const number = await getNextSequence(companyId, "DC");
    const invoiceNumber = await getNextSequence(companyId, "SI");

    const result = await db.$transaction(async (tx) => {
      // Idempotency guard for this SO→Dispatch conversion.
      const idempotencyKey = `SO_TO_DISPATCH:${so.id}:${number}`;
      await tx.salesFlowConversion.create({
        data: { companyId, step: "SO_TO_DISPATCH", sourceId: so.id, idempotencyKey },
      });

      const dispatch = await tx.dispatch.create({
        data: {
          companyId,
          number,
          soId: so.id,
          customerId: so.customerId,
          status: DispatchStatus.DISPATCHED,
          dispatchDate: validated.dispatchDate ? new Date(validated.dispatchDate) : new Date(),
          storeId,
          vehicleNo: validated.vehicleNo || null,
          transporterName: validated.transporterName || null,
          transporterGstin: validated.transporterGstin || null,
          lrNo: validated.lrNo || null,
          distanceKm: validated.distanceKm ?? null,
          packingListId: validated.packingListId || null,
          createdById: actorId,
          lines: {
            create: validated.lines.map((l) => ({
              soLineId: l.soLineId,
              itemId: l.itemId,
              qty: l.qty,
              batchNo: l.batchNo || null,
            })),
          },
        },
        include: { lines: true },
      });

      // Issue stock out (negative qty), valued at the running average rate.
      for (const dl of validated.lines) {
        await postLedgerEntry(tx, {
          companyId,
          itemId: dl.itemId,
          storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -Math.abs(dl.qty),
          refType: "DISPATCH",
          refId: dispatch.id,
          createdById: actorId,
        });

        // Roll up the SO line.
        const sol = lineById.get(dl.soLineId)!;
        const newDispatched = sol.dispatchedQty + dl.qty;
        await tx.soLine.update({
          where: { id: sol.id },
          data: {
            dispatchedQty: newDispatched,
            status: rollupSoLineStatus(sol.qty, newDispatched),
          },
        });
        sol.dispatchedQty = newDispatched; // keep local map in sync for rollup below
      }

      // Roll up the order.
      const allDispatched = so.lines.every((l) => l.dispatchedQty >= l.qty - 1e-9);
      await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: allDispatched ? SoStatus.DISPATCHED : SoStatus.PARTIALLY_DISPATCHED },
      });

      // Compute consignment value to flag e-way bill applicability.
      const value = validated.lines.reduce((s, dl) => {
        const sol = lineById.get(dl.soLineId)!;
        return s + dl.qty * sol.rate * (1 - (sol.discount || 0) / 100) * (1 + (sol.gstRate || 0) / 100);
      }, 0);
      if (value > EWAY_THRESHOLD) {
        await tx.dispatch.update({ where: { id: dispatch.id }, data: { ewayBillStatus: EWayBillStatus.PENDING } });
      }

      // Auto-generate invoice in DRAFT status
      await createDraftInvoiceInternal(tx, dispatch.id, invoiceNumber, companyId, actorId);

      await logAudit(tx, companyId, actorId, "DISPATCH", "Dispatch", dispatch.id, null, dispatch);
      return dispatch;
    });

    revalidatePath("/sales/dispatch");
    revalidatePath("/sales/orders");
    return { success: true, dispatch: result };
  } catch (err: any) {
    console.error("Error creating dispatch:", err);
    return { success: false, error: err.message || "Failed to create dispatch" };
  }
}

/**
 * Builds an NIC-compliant e-way bill payload from a dispatch and issues an EWB
 * number. In demo mode (or until a GSP is wired), the EWB number and validity
 * are generated locally; swapping in the real NIC/GSP call is a single fetch.
 */
export async function generateEWayBill(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "ewaybill.generate")) {
    return { success: false, error: "Forbidden: Missing ewaybill.generate permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({
      where: { id: dispatchId, companyId },
      include: { lines: true, so: true },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.ewayBillStatus === EWayBillStatus.GENERATED) {
      return { success: false, error: "E-way bill already generated for this dispatch" };
    }

    const company = await db.company.findUnique({ where: { id: companyId } });
    const customer = await db.customer.findFirst({ where: { id: dispatch.customerId, companyId } });
    const items = await db.item.findMany({
      where: { companyId, id: { in: dispatch.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, hsnCode: true, gstRate: true, baseUom: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const fromState = company?.gstin?.slice(0, 2) || "";
    const toState = customer?.gstin?.slice(0, 2) || customer?.stateCode || "";
    const intraState = fromState && toState && fromState === toState;
    const distance = dispatch.distanceKm ?? 0;

    const payload = {
      supplyType: "O", // Outward
      subSupplyType: "1", // Supply
      docType: "INV",
      docNo: dispatch.number,
      docDate: dispatch.dispatchDate.toISOString().slice(0, 10),
      fromGstin: company?.gstin || "URP",
      fromTrdName: company?.legalName || company?.name,
      fromStateCode: fromState,
      toGstin: customer?.gstin || "URP",
      toTrdName: customer?.name,
      toStateCode: toState,
      transDistance: String(distance),
      transporterName: dispatch.transporterName || undefined,
      vehicleNo: dispatch.vehicleNo || undefined,
      vehicleType: "R",
      itemList: dispatch.lines.map((l) => {
        const it = itemById.get(l.itemId);
        const taxRate = it?.gstRate || 0;
        return {
          productName: it?.name,
          hsnCode: it?.hsnCode || "",
          quantity: l.qty,
          qtyUnit: it?.baseUom || "NOS",
          ...(intraState
            ? { cgstRate: taxRate / 2, sgstRate: taxRate / 2, igstRate: 0 }
            : { cgstRate: 0, sgstRate: 0, igstRate: taxRate }),
        };
      }),
    };

    // ── Issue the EWB. Replace this block with the NIC/GSP API call. ──
    const ewbNo = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
    const ewayBillDate = new Date();
    // Validity: 1 day per 200 km (Part-B, road), minimum 1 day.
    const validDays = Math.max(1, Math.ceil((distance || 1) / 200));
    const ewayValidUpto = new Date(ewayBillDate);
    ewayValidUpto.setDate(ewayValidUpto.getDate() + validDays);

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          ewayBillNo: ewbNo,
          ewayBillDate,
          ewayValidUpto,
          ewayBillStatus: EWayBillStatus.GENERATED,
          ewayBillData: { request: payload, response: { ewayBillNo: ewbNo, validUpto: ewayValidUpto.toISOString() } } as any,
        },
      });
      await logAudit(tx, companyId, actorId, "EWAYBILL_GENERATE", "Dispatch", dispatchId, { ewayBillStatus: dispatch.ewayBillStatus }, { ewayBillNo: ewbNo });
      return updated;
    });

    revalidatePath("/sales/dispatch");
    return { success: true, ewayBillNo: ewbNo, validUpto: ewayValidUpto, dispatch: result };
  } catch (err: any) {
    console.error("Error generating e-way bill:", err);
    return { success: false, error: err.message || "Failed to generate e-way bill" };
  }
}

export async function markDispatchDelivered(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "dispatch.create")) {
    return { success: false, error: "Forbidden: Missing dispatch.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({ where: { id: dispatchId, companyId } });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.status !== DispatchStatus.DISPATCHED) {
      return { success: false, error: `Cannot mark delivered from ${dispatch.status}` };
    }

    await db.$transaction(async (tx) => {
      await tx.dispatch.update({ where: { id: dispatchId }, data: { status: DispatchStatus.DELIVERED } });
      await logAudit(tx, companyId, actorId, "DELIVERED", "Dispatch", dispatchId, { status: dispatch.status }, { status: DispatchStatus.DELIVERED });
    });

    revalidatePath("/sales/dispatch");
    return { success: true };
  } catch (err: any) {
    console.error("Error marking delivered:", err);
    return { success: false, error: err.message || "Failed to update dispatch" };
  }
}

export async function deleteDispatch(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "dispatch.create")) {
    return { success: false, error: "Forbidden: Missing dispatch.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({
      where: { id: dispatchId, companyId, deletedAt: null },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.status !== DispatchStatus.DRAFT) {
      return { success: false, error: "Only draft dispatches can be deleted" };
    }

    await db.$transaction(async (tx) => {
      if (dispatch.packingListId) {
        await tx.packingList.update({
          where: { id: dispatch.packingListId },
          data: { status: "DRAFT" },
        });
      }

      await tx.dispatchLine.deleteMany({
        where: { dispatchId },
      });

      await tx.dispatch.delete({
        where: { id: dispatchId },
      });

      await logAudit(tx, companyId, actorId, "DELETE", "Dispatch", dispatchId, dispatch, null);
    });

    revalidatePath("/sales/dispatch");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting dispatch:", err);
    return { success: false, error: err.message || "Failed to delete dispatch" };
  }
}

export async function updateDispatch(
  dispatchId: string,
  data: {
    storeId?: string | null;
    vehicleNo?: string | null;
    transporterName?: string | null;
    lrNo?: string | null;
    distanceKm?: number | null;
    dispatchDate?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "dispatch.create")) {
    return { success: false, error: "Forbidden: Missing dispatch.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const dispatch = await db.dispatch.findFirst({
      where: { id: dispatchId, companyId, deletedAt: null },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.status !== DispatchStatus.DRAFT) {
      return { success: false, error: "Only draft dispatches can be updated" };
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.dispatch.update({
        where: { id: dispatchId },
        data: {
          storeId: data.storeId || null,
          vehicleNo: data.vehicleNo || null,
          transporterName: data.transporterName || null,
          lrNo: data.lrNo || null,
          distanceKm: data.distanceKm ?? null,
          dispatchDate: data.dispatchDate ? new Date(data.dispatchDate) : dispatch.dispatchDate,
        },
      });
      await logAudit(tx, companyId, actorId, "UPDATE", "Dispatch", dispatchId, dispatch, u);
      return u;
    });

    revalidatePath("/sales/dispatch");
    return { success: true, dispatch: updated };
  } catch (err: any) {
    console.error("Error updating dispatch:", err);
    return { success: false, error: err.message || "Failed to update dispatch" };
  }
}

export async function postDispatch(dispatchId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "dispatch.create")) {
    return { success: false, error: "Forbidden: Missing dispatch.create permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const invoiceNumber = await getNextSequence(companyId, "SI");
    const dispatch = await db.dispatch.findFirst({
      where: { id: dispatchId, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!dispatch) return { success: false, error: "Dispatch not found" };
    if (dispatch.status !== DispatchStatus.DRAFT) {
      return { success: false, error: "Only draft dispatches can be posted" };
    }

    const soId = dispatch.soId;
    if (!soId) return { success: false, error: "Linked Sales Order not found on dispatch" };

    const so = await db.salesOrder.findFirst({
      where: { id: soId, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!so) return { success: false, error: "Sales Order not found" };

    const storeId = dispatch.storeId;
    if (!storeId) return { success: false, error: "No store selected for stock issue" };

    const lineById = new Map(so.lines.map((l) => [l.id, l]));
    for (const dl of dispatch.lines) {
      if (!dl.soLineId) continue;
      const sol = lineById.get(dl.soLineId);
      if (!sol) return { success: false, error: `SO Line not found for dispatch line` };
      const open = sol.qty - sol.dispatchedQty;
      if (dl.qty > open + 1e-9) {
        return {
          success: false,
          error: `Dispatch qty ${dl.qty} exceeds open balance ${open} on item ${sol.itemId}`,
        };
      }
    }

    await db.$transaction(async (tx) => {
      await tx.dispatch.update({
        where: { id: dispatchId },
        data: { status: DispatchStatus.DISPATCHED },
      });

      for (const dl of dispatch.lines) {
        if (!dl.soLineId) continue;
        const sol = lineById.get(dl.soLineId)!;

        const newDispatchedQty = sol.dispatchedQty + dl.qty;
        const lineStatus = rollupSoLineStatus(sol.qty, newDispatchedQty);

        await tx.soLine.update({
          where: { id: dl.soLineId },
          data: {
            dispatchedQty: newDispatchedQty,
            status: lineStatus,
          },
        });

        await postLedgerEntry(tx, {
          companyId,
          itemId: dl.itemId,
          storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -Math.abs(dl.qty),
          refType: "DISPATCH",
          refId: dispatch.id,
          createdById: actorId,
        });
      }

      const updatedLines = await tx.soLine.findMany({
        where: { soId: so.id },
      });
      const allDispatched = updatedLines.every((l) => l.dispatchedQty >= l.qty - 1e-9);
      const anyDispatched = updatedLines.some((l) => l.dispatchedQty > 0);

      let newStatus: SoStatus = SoStatus.CONFIRMED;
      if (allDispatched) {
        newStatus = SoStatus.DISPATCHED;
      } else if (anyDispatched) {
        newStatus = SoStatus.PARTIALLY_DISPATCHED;
      }

      await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: newStatus },
      });

      // Auto-generate invoice in DRAFT status
      await createDraftInvoiceInternal(tx, dispatchId, invoiceNumber, companyId, actorId);

      await logAudit(tx, companyId, actorId, "POST", "Dispatch", dispatchId, { status: "DRAFT" }, { status: "DISPATCHED" });
    });

    revalidatePath("/sales/dispatch");
    return { success: true };
  } catch (err: any) {
    console.error("Error posting dispatch:", err);
    return { success: false, error: err.message || "Failed to post dispatch" };
  }
}

async function createDraftInvoiceInternal(
  tx: any,
  dispatchId: string,
  invoiceNumber: string,
  companyId: string,
  actorId: string
) {
  const dispatch = await tx.dispatch.findUnique({
    where: { id: dispatchId },
    include: { lines: true, so: { include: { lines: true } } },
  });
  if (!dispatch || !dispatch.soId || !dispatch.so) {
    throw new Error("Dispatch or associated Sales Order not found for invoice auto-generation");
  }

  const already = await tx.salesInvoice.findFirst({
    where: { companyId, dispatchId: dispatch.id, deletedAt: null },
  });
  if (already) return;

  const company = await tx.company.findUnique({ where: { id: companyId } });
  const customer = await tx.customer.findFirst({ where: { id: dispatch.customerId, companyId } });
  if (!customer) throw new Error("Customer not found for invoice auto-generation");

  const fromState = company?.gstin?.slice(0, 2) || "";
  const placeOfSupply = dispatch.so.placeOfSupply || customer.gstin?.slice(0, 2) || customer.stateCode || "";
  const intraState = !!fromState && !!placeOfSupply && fromState === placeOfSupply;

  const soLineById = new Map<string, any>(dispatch.so.lines.map((l: any) => [l.id, l]));
  const items = await tx.item.findMany({
    where: { companyId, id: { in: dispatch.lines.map((l: any) => l.itemId) } },
    select: { id: true, hsnCode: true },
  });
  const hsnById = new Map(items.map((i: any) => [i.id, i.hsnCode]));

  const invoiceLines = dispatch.lines.map((dl: any) => {
    const sol: any = dl.soLineId ? soLineById.get(dl.soLineId) : undefined;
    const rate = sol?.rate ?? 0;
    const discount = sol?.discount ?? 0;
    const gstRate = sol?.gstRate ?? 0;
    const taxable = dl.qty * rate * (1 - discount / 100);
    return { itemId: dl.itemId, hsnCode: hsnById.get(dl.itemId) || null, qty: dl.qty, rate, discount, gstRate, taxable };
  });

  const taxableAmount = invoiceLines.reduce((s: number, l: any) => s + l.taxable, 0);
  const totalTax = invoiceLines.reduce((s: number, l: any) => s + (l.taxable * l.gstRate) / 100, 0);
  const cgst = intraState ? totalTax / 2 : 0;
  const sgst = intraState ? totalTax / 2 : 0;
  const igst = intraState ? 0 : totalTax;
  
  const otherCharges = 0;
  const preRound = taxableAmount + totalTax + otherCharges;
  const totalAmount = Math.round(preRound);
  const roundOff = +(totalAmount - preRound).toFixed(2);

  const invoiceDate = new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (customer.creditDays || 0));

  const eInvoiceEligible = !!customer.gstin;

  const invoice = await tx.salesInvoice.create({
    data: {
      companyId,
      number: invoiceNumber,
      customerId: customer.id,
      soId: dispatch.soId,
      dispatchId: dispatch.id,
      invoiceDate,
      dueDate,
      placeOfSupply,
      taxableAmount: +taxableAmount.toFixed(2),
      cgst: +cgst.toFixed(2),
      sgst: +sgst.toFixed(2),
      igst: +igst.toFixed(2),
      otherCharges,
      roundOff,
      totalAmount,
      status: SalesInvoiceStatus.DRAFT,
      einvoiceStatus: eInvoiceEligible ? EInvoiceStatus.PENDING : EInvoiceStatus.NOT_APPLICABLE,
      createdById: actorId,
      lines: {
        create: invoiceLines.map((l: any) => ({
          itemId: l.itemId,
          hsnCode: l.hsnCode,
          qty: l.qty,
          rate: l.rate,
          discount: l.discount,
          gstRate: l.gstRate,
        })),
      },
    },
  });

  await logAudit(tx, companyId, actorId, "CREATE_DRAFT", "SalesInvoice", invoice.id, null, invoice);
}
