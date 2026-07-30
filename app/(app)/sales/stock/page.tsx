export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import StockClient from "./StockClient";

export default async function StockPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [items, ledger, stores] = await Promise.all([
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true, baseUom: true, reorderLevel: true },
      orderBy: { name: "asc" },
    }),
    db.stockLedger.groupBy({ by: ["itemId"], where: { companyId }, _sum: { qty: true } }),
    db.store.findMany({ where: { companyId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const onHand = new Map(ledger.map((l) => [l.itemId, l._sum.qty || 0]));

  const products = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    baseUom: i.baseUom,
    reorderLevel: i.reorderLevel,
    onHand: +(onHand.get(i.id) || 0).toFixed(3),
  }));

  return <StockClient products={products} stores={stores} />;
}
