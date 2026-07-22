import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import PackingListsClient from "./PackingListsClient";
import { getFreshUser } from "@/app/actions/auth";

export default async function PackingListsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [packingLists, salesOrders, items, customers] = await Promise.all([
    db.packingList.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { name: true, code: true } },
        so: { select: { number: true } },
        lines: true,
        dispatches: { select: { number: true } },
      },
      take: 200,
    }),
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null, status: { in: ["CONFIRMED", "PARTIALLY_DISPATCHED"] } },
      include: { customer: { select: { name: true, code: true } }, lines: true },
      orderBy: { createdAt: "desc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const itemName = new Map(items.map((i) => [i.id, `${i.name} (${i.code})`]));

  const mappedPackingLists = packingLists.map((p) => ({
    id: p.id,
    number: p.number,
    customer: `${p.customer.name} (${p.customer.code})`,
    customerId: p.customerId,
    soNumber: p.so?.number || null,
    soId: p.soId,
    status: p.status,
    dcNumber: p.dispatches[0]?.number || null,
    createdAt: p.createdAt.toISOString(),
    lineCount: p.lines.length,
    boxCount: new Set(p.lines.map((l) => l.boxNo)).size,
    totalQty: p.lines.reduce((s, l) => s + l.qty, 0),
    totalGrossWeight: p.lines.reduce((s, l) => s + (l.grossWeight || 0), 0),
    totalNetWeight: p.lines.reduce((s, l) => s + (l.netWeight || 0), 0),
  }));

  const mappedOrders = salesOrders.map((o) => ({
    id: o.id,
    number: o.number,
    customerId: o.customerId,
    customer: `${o.customer.name} (${o.customer.code})`,
    lines: o.lines.map((l) => ({
      soLineId: l.id,
      itemId: l.itemId,
      itemName: itemName.get(l.itemId) || l.itemId,
      qty: l.qty,
    })),
  }));

  return (
    <PackingListsClient
      initialPackingLists={mappedPackingLists}
      salesOrders={mappedOrders}
      items={items}
      customers={customers}
      user={user as any}
    />
  );
}
