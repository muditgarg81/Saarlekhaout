import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DispatchList from "./DispatchList";
import { getFreshUser } from "@/app/actions/auth";

export default async function DispatchPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [dispatches, openOrders, stores, items, customers, packingLists, companySettings, companyData] = await Promise.all([
    db.dispatch.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        lines: true,
        so: {
          include: {
            customer: true,
          },
        },
        packingList: { select: { number: true } },
      },
      take: 200,
    }),
    db.salesOrder.findMany({
      where: { companyId, deletedAt: null, status: { in: ["CONFIRMED", "PARTIALLY_DISPATCHED"] } },
      include: { customer: { select: { name: true, code: true } }, lines: true },
      orderBy: { createdAt: "desc" },
    }),
    db.store.findMany({ where: { companyId }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { companyId, deletedAt: null }, select: { id: true, code: true, name: true } }),
    db.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
    db.packingList.findMany({ where: { companyId, deletedAt: null }, select: { id: true, number: true, soId: true } }),
    db.companyDocumentSettings.findUnique({ where: { companyId } }),
    db.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, gstin: true, pan: true, cin: true, contactEmail: true, contactPhone: true, city: true, governingPlace: true, logoUrl: true },
    }),
  ]);

  const itemName = new Map(items.map((i) => [i.id, `${i.name} (${i.code})`]));
  const custName = new Map(customers.map((c) => [c.id, c.name]));

  const company = companyData
    ? {
        name: companyData.name,
        logoUrl: companyData.logoUrl,
        address: companyData.address,
        city: companyData.city,
        governingPlace: companyData.governingPlace,
        gstin: companyData.gstin,
        pan: companyData.pan,
        contactEmail: companyData.contactEmail,
        contactPhone: companyData.contactPhone,
        authorizedSignatory: companySettings?.authorizedSignatory || "Authorized Signatory",
      }
    : null;

  const mappedDispatches = dispatches.map((d) => ({
    id: d.id,
    number: d.number,
    soNumber: d.so?.number || null,
    customer: d.so?.customer.name || custName.get(d.customerId) || "—",
    customerGstin: d.so?.customer.gstin || null,
    customerPan: d.so?.customer.pan || null,
    status: d.status,
    dispatchDate: d.dispatchDate.toISOString(),
    storeId: d.storeId,
    vehicleNo: d.vehicleNo,
    transporterName: d.transporterName,
    lrNo: d.lrNo,
    distanceKm: d.distanceKm,
    ewayBillNo: d.ewayBillNo,
    ewayBillStatus: d.ewayBillStatus,
    lineCount: d.lines.length,
    packingListNumber: d.packingList?.number || null,
    billingAddress: d.so?.billingAddress || "—",
    shippingAddress: d.so?.shippingAddress || "—",
    termsConditions: d.so?.termsConditions || "—",
    lines: d.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemName: itemName.get(l.itemId) || l.itemId,
      qty: l.qty,
      batchNo: l.batchNo,
    })),
  }));

  const mappedOrders = openOrders.map((o) => ({
    id: o.id,
    number: o.number,
    customer: `${o.customer.name} (${o.customer.code})`,
    lines: o.lines
      .map((l) => ({
        soLineId: l.id,
        itemId: l.itemId,
        itemName: itemName.get(l.itemId) || l.itemId,
        open: +(l.qty - l.dispatchedQty).toFixed(3),
        rate: l.rate,
      }))
      .filter((l) => l.open > 0),
  })).filter((o) => o.lines.length > 0);

  return (
    <DispatchList
      initialDispatches={mappedDispatches}
      openOrders={mappedOrders}
      stores={stores}
      packingLists={packingLists}
      user={user as any}
      company={company}
    />
  );
}
