import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import SalesInvoicesList from "./SalesInvoicesList";
import { getFreshUser } from "@/app/actions/auth";

export default async function SalesInvoicesPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [invoices, dispatches, customers, companySettings, companyData, items] = await Promise.all([
    db.salesInvoice.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        dispatch: { select: { number: true, vehicleNo: true, transporterName: true, lrNo: true, distanceKm: true } },
        so: true,
        lines: true,
      },
      take: 200,
    }),
    db.dispatch.findMany({
      where: { companyId, deletedAt: null, soId: { not: null }, status: { in: ["DISPATCHED", "DELIVERED"] } },
      include: { invoices: { select: { id: true } }, so: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.customer.findMany({
      where: { companyId },
      select: { id: true, name: true, gstin: true, pan: true, billingAddress: true, shippingAddress: true },
    }),
    db.companyDocumentSettings.findUnique({ where: { companyId } }),
    db.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, gstin: true, pan: true, cin: true, contactEmail: true, contactPhone: true, city: true, governingPlace: true, logoUrl: true },
    }),
    db.item.findMany({ where: { companyId, deletedAt: null }, select: { id: true, code: true, name: true, hsnCode: true } }),
  ]);

  const customerInfo = new Map(customers.map((c) => [c.id, c]));
  const itemInfo = new Map(items.map((i) => [i.id, { name: i.name, code: i.code, hsnCode: i.hsnCode }]));

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

  const mappedInvoices = invoices.map((inv) => {
    const cust = customerInfo.get(inv.customerId);
    return {
      id: inv.id,
      number: inv.number,
      customer: cust?.name || "—",
      customerGstin: cust?.gstin || "—",
      customerPan: cust?.pan || "—",
      dispatchNumber: inv.dispatch?.number || null,
      invoiceDate: inv.invoiceDate.toISOString(),
      dueDate: inv.dueDate?.toISOString() || null,
      taxableAmount: inv.taxableAmount,
      cgst: inv.cgst,
    sgst: inv.sgst,
    igst: inv.igst,
    otherCharges: inv.otherCharges,
    roundOff: inv.roundOff,
    totalAmount: inv.totalAmount,
    paidAmount: inv.paidAmount,
    status: inv.status,
    einvoiceStatus: inv.einvoiceStatus,
    irn: inv.irn,
    placeOfSupply: inv.placeOfSupply || "—",
    billingAddress: inv.so?.billingAddress || cust?.billingAddress || "—",
    shippingAddress: inv.so?.shippingAddress || cust?.shippingAddress || "—",
    paymentTerms: inv.so?.paymentTerms || "—",
    termsConditions: inv.so?.termsConditions || "—",
    vehicleNo: inv.dispatch?.vehicleNo || null,
    transporterName: inv.dispatch?.transporterName || null,
    lrNo: inv.dispatch?.lrNo || null,
    distanceKm: inv.dispatch?.distanceKm || null,
    lines: inv.lines.map((l) => {
      const info = itemInfo.get(l.itemId);
      return {
        id: l.id,
        itemId: l.itemId,
        itemName: info ? `${info.name} (${info.code})` : l.itemId,
        hsnCode: l.hsnCode || info?.hsnCode || "—",
        qty: l.qty,
        rate: l.rate,
        discount: l.discount,
        gstRate: l.gstRate,
      };
    }),
  }; });

  const eligible = dispatches
    .filter((d) => d.invoices.length === 0)
    .map((d) => ({
      id: d.id,
      label: `${d.number} — ${customerInfo.get(d.customerId)?.name || ""} (${d.so?.number || ""})`,
    }));

  return (
    <SalesInvoicesList
      initialInvoices={mappedInvoices}
      eligibleDispatches={eligible}
      user={user as any}
      company={company}
    />
  );
}
