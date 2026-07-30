"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LedgerTxnType } from "@prisma/client";
import { postLedgerEntry } from "@/lib/stock";
import { can } from "@/lib/rbac";

// Bring finished goods into stock (opening balance, production/purchase receipt)
// or adjust levels. Writes a signed StockLedger entry so on-hand and dispatch
// stay consistent — the inward counterpart to dispatch's outward issue.

const ENTRY_TYPES = ["OPENING", "RECEIVED", "ADJUSTMENT"] as const;

const entrySchema = z.object({
  itemId: z.string().min(1, "Product is required"),
  storeId: z.string().optional().nullable(),
  entryType: z.enum(ENTRY_TYPES),
  qty: z.number().refine((n) => n !== 0, "Qty must be non-zero"),
  rate: z.number().nonnegative().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

const TXN: Record<(typeof ENTRY_TYPES)[number], LedgerTxnType> = {
  OPENING: LedgerTxnType.OPENING,
  RECEIVED: LedgerTxnType.TRANSFER_IN,
  ADJUSTMENT: LedgerTxnType.ADJUSTMENT,
};

export async function addStockEntry(data: z.infer<typeof entrySchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const role = (session.user as any).role;
  if (!(can(session.user as any, "item.manage") || ["ADMIN", "OWNER"].includes(role))) {
    return { success: false, error: "Forbidden: Missing item.manage permission" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const validated = entrySchema.parse(data);

    // OPENING and RECEIVED are inflows (qty must be positive); ADJUSTMENT may be ±.
    if (validated.entryType !== "ADJUSTMENT" && validated.qty <= 0) {
      return { success: false, error: "Quantity must be positive for opening/received stock" };
    }

    const item = await db.item.findFirst({ where: { id: validated.itemId, companyId, deletedAt: null } });
    if (!item) return { success: false, error: "Product not found" };

    const company = await db.company.findUnique({ where: { id: companyId } });
    const storeId = validated.storeId || company?.defaultStoreId || null;
    if (!storeId) return { success: false, error: "No store selected and no company default store configured" };

    const refId = `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    await db.$transaction(async (tx) => {
      await postLedgerEntry(tx, {
        companyId,
        itemId: validated.itemId,
        storeId,
        txnType: TXN[validated.entryType],
        qty: validated.qty,
        rate: validated.rate ?? null,
        refType: "STOCK_ENTRY",
        refId,
        createdById: actorId,
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "STOCK_ENTRY",
          entity: "StockLedger",
          entityId: refId,
          after: JSON.parse(JSON.stringify({ itemId: validated.itemId, storeId, entryType: validated.entryType, qty: validated.qty, rate: validated.rate, remarks: validated.remarks })),
        },
      });
    });

    revalidatePath("/sales/stock");
    return { success: true };
  } catch (err: any) {
    console.error("Error adding stock entry:", err);
    return { success: false, error: err.message || "Failed to add stock entry" };
  }
}
