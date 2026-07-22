"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getNextSequence } from "@/lib/sequences";
import { can } from "@/lib/rbac";

const packingListLineSchema = z.object({
  boxNo: z.string().min(1, "Box number is required"),
  itemId: z.string().min(1, "Item is required"),
  qty: z.number().positive("Qty must be > 0"),
  grossWeight: z.number().nonnegative().optional().nullable(),
  netWeight: z.number().nonnegative().optional().nullable(),
  dimensions: z.string().optional().nullable(),
  soLineId: z.string().optional().nullable(),
});

const packingListSchema = z.object({
  soId: z.string().optional().nullable(),
  customerId: z.string().min(1, "Customer is required"),
  lines: z.array(packingListLineSchema).min(1, "Add at least one line"),
});

export async function createPackingList(data: z.infer<typeof packingListSchema>, status: string = "DRAFT") {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const validated = packingListSchema.parse(data);

    // Get sequential document number
    const number = await getNextSequence(companyId, "PK");

    const pl = await db.packingList.create({
      data: {
        companyId,
        number,
        soId: validated.soId || null,
        customerId: validated.customerId,
        status: status,
        lines: {
          create: validated.lines.map((l) => ({
            boxNo: l.boxNo,
            itemId: l.itemId,
            qty: l.qty,
            grossWeight: l.grossWeight || null,
            netWeight: l.netWeight || null,
            dimensions: l.dimensions || null,
            soLineId: l.soLineId || null,
          })),
        },
      },
      include: { lines: true },
    });

    revalidatePath("/sales/packing-list");
    revalidatePath("/sales/packing-list/ready");
    return { success: true, packingList: pl };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to create packing list" };
  }
}

export async function deletePackingList(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    await db.packingListLine.deleteMany({
      where: { packingListId: id },
    });
    await db.packingList.delete({
      where: { id, companyId },
    });

    revalidatePath("/sales/packing-list");
    revalidatePath("/sales/packing-list/ready");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to delete packing list" };
  }
}

export async function submitPackingListForApproval(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    await db.packingList.update({
      where: { id, companyId },
      data: { status: "PENDING_APPROVAL" },
    });
    revalidatePath("/sales/packing-list");
    revalidatePath("/sales/packing-list/ready");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to submit packing list" };
  }
}

export async function approvePackingList(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const pl = await db.packingList.findFirst({
      where: { id, companyId },
      include: { lines: true },
    });
    if (!pl) return { success: false, error: "Packing list not found" };
    if (pl.status !== "PENDING_APPROVAL") {
      return { success: false, error: "Packing list is not pending approval" };
    }

    if (pl.soId) {
      const so = await db.salesOrder.findFirst({
        where: { id: pl.soId, companyId, deletedAt: null },
        include: { lines: true },
      });
      if (!so) return { success: false, error: "Sales order not found" };

      // Map open quantities
      const openQtyByLineId = new Map(so.lines.map(l => [l.id, l.qty - l.dispatchedQty]));
      
      // Sum packing list quantities by soLineId
      const packingQtyByLineId = new Map<string, number>();
      for (const line of pl.lines) {
        let sId = line.soLineId;
        if (!sId) {
          const matchingSoLine = so.lines.find(x => x.itemId === line.itemId);
          if (matchingSoLine) {
            sId = matchingSoLine.id;
          }
        }
        if (sId) {
          packingQtyByLineId.set(sId, (packingQtyByLineId.get(sId) || 0) + line.qty);
        }
      }

      // Validate quantities
      for (const [soLineId, qty] of packingQtyByLineId.entries()) {
        const open = openQtyByLineId.get(soLineId) || 0;
        if (qty > open + 1e-9) {
          const soLine = so.lines.find(x => x.id === soLineId);
          return {
            success: false,
            error: `Packing qty (${qty}) exceeds Sales Order open balance (${open}) for item ${soLine?.itemId || ""}`
          };
        }
      }

      // Generate Delivery Challan (Dispatch) in DRAFT status
      const dcNumber = await getNextSequence(companyId, "DC");
      const company = await db.company.findUnique({ where: { id: companyId } });
      const storeId = company?.defaultStoreId || null;

      await db.$transaction(async (tx) => {
        const dispatch = await tx.dispatch.create({
          data: {
            companyId,
            number: dcNumber,
            soId: pl.soId,
            customerId: pl.customerId,
            status: "DRAFT",
            storeId,
            createdById: actorId,
            packingListId: pl.id,
            lines: {
              create: Array.from(packingQtyByLineId.entries()).map(([soLineId, qty]) => {
                const soLine = so.lines.find(x => x.id === soLineId)!;
                return {
                  soLineId,
                  itemId: soLine.itemId,
                  qty,
                };
              }),
            },
          },
        });

        await tx.packingList.update({
          where: { id: pl.id },
          data: { status: "APPROVED" },
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            companyId,
            actorId,
            action: "APPROVE",
            entity: "PackingList",
            entityId: pl.id,
            before: { status: "PENDING_APPROVAL" },
            after: { status: "APPROVED", generatedDispatchId: dispatch.id },
          },
        });
      });
    } else {
      await db.packingList.update({
        where: { id: pl.id },
        data: { status: "APPROVED" },
      });
    }

    revalidatePath("/sales/packing-list");
    revalidatePath("/sales/packing-list/ready");
    revalidatePath("/sales/dispatch");
    return { success: true };
  } catch (e: any) {
    console.error("Error approving packing list:", e);
    return { success: false, error: e.message || "Failed to approve packing list" };
  }
}
