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
});

const packingListSchema = z.object({
  soId: z.string().optional().nullable(),
  customerId: z.string().min(1, "Customer is required"),
  lines: z.array(packingListLineSchema).min(1, "Add at least one line"),
});

export async function createPackingList(data: z.infer<typeof packingListSchema>) {
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
        status: "DRAFT",
        lines: {
          create: validated.lines.map((l) => ({
            boxNo: l.boxNo,
            itemId: l.itemId,
            qty: l.qty,
            grossWeight: l.grossWeight || null,
            netWeight: l.netWeight || null,
            dimensions: l.dimensions || null,
          })),
        },
      },
      include: { lines: true },
    });

    revalidatePath("/sales/packing-list");
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
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to delete packing list" };
  }
}
