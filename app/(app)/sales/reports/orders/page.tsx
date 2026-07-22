import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import SoReportClient from "./SoReportClient";

export default async function SalesOrderReportsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [orders, customers] = await Promise.all([
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        lines: {
          select: {
            qty: true,
            dispatchedQty: true,
            rate: true,
            discount: true,
            gstRate: true,
          }
        }
      },
      orderBy: { createdAt: "desc" },
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const mappedOrders = orders.map((o) => {
    // Calculate precise pending (undelivered) value from line items
    let totalOrderedValue = 0;
    let totalDispatchedValue = 0;
    let totalPendingValue = 0;

    for (const l of o.lines) {
      const lineTotal = l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
      totalOrderedValue += lineTotal;

      const dispTotal = l.dispatchedQty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
      totalDispatchedValue += dispTotal;

      const pendQty = Math.max(0, l.qty - l.dispatchedQty);
      const pendTotal = pendQty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
      totalPendingValue += pendTotal;
    }

    return {
      id: o.id,
      number: o.number,
      customerId: o.customerId,
      customerName: o.customer.name,
      customerCode: o.customer.code,
      customer: `${o.customer.name} (${o.customer.code})`,
      orderDate: o.orderDate.toISOString(),
      status: o.status,
      orderedValue: totalOrderedValue,
      dispatchedValue: totalDispatchedValue,
      pendingValue: totalPendingValue,
      linesCount: o.lines.length,
    };
  });

  return (
    <SoReportClient
      initialOrders={mappedOrders}
      customers={customers}
    />
  );
}
