import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import OrderReadyClient from "./OrderReadyClient";

export default async function OrderReadyPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [salesOrders, items, customers] = await Promise.all([
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null, status: { in: ["CONFIRMED", "PARTIALLY_DISPATCHED"] } },
      include: { 
        customer: { select: { id: true, name: true, code: true } }, 
        lines: {
          select: {
            id: true,
            itemId: true,
            qty: true,
            dispatchedQty: true,
          }
        }
      },
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

  const mappedOrders = salesOrders.map((o) => {
    // Also calculate if there is anything pending to be packed/dispatched
    const lines = o.lines.map((l) => {
      const pendingQty = l.qty - l.dispatchedQty;
      return {
        soLineId: l.id,
        itemId: l.itemId,
        itemName: itemName.get(l.itemId) || l.itemId,
        orderedQty: l.qty,
        dispatchedQty: l.dispatchedQty,
        pendingQty: pendingQty > 0 ? pendingQty : 0,
      };
    });

    const totalOrdered = lines.reduce((s, l) => s + l.orderedQty, 0);
    const totalDispatched = lines.reduce((s, l) => s + l.dispatchedQty, 0);
    const totalPending = lines.reduce((s, l) => s + l.pendingQty, 0);

    return {
      id: o.id,
      number: o.number,
      customerId: o.customerId,
      customer: `${o.customer.name} (${o.customer.code})`,
      orderDate: o.orderDate.toISOString(),
      lines,
      totalOrdered,
      totalDispatched,
      totalPending,
    };
  }).filter(o => o.totalPending > 0); // Only show orders that have pending dispatches

  return (
    <OrderReadyClient
      salesOrders={mappedOrders}
      items={items}
      customers={customers}
      user={user as any}
    />
  );
}
