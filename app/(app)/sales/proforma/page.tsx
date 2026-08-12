export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import ProformaList from "./ProformaList";
import { getFreshUser } from "@/app/actions/auth";

export default async function ProformaPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [proformas, customers, items, quotations, company, docSettings] = await Promise.all([
    db.proformaInvoice.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true, code: true, gstin: true, pan: true } }, lines: true },
      take: 200,
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true, stateCode: true, paymentTerms: true, gstin: true, pan: true, billingAddress: true, shippingAddress: true, billingAddresses: true, shippingAddresses: true },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true, baseUom: true, gstRate: true, specification: true, hsnCode: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    db.customerQuotation.findMany({
      where: { companyId, deletedAt: null, status: { not: "CANCELLED" } },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, gstin: true, pan: true, cin: true, contactEmail: true, contactPhone: true, city: true, governingPlace: true, logoUrl: true },
    }),
    db.companyDocumentSettings.findUnique({ where: { companyId } }),
  ]);

  const mappedProformas = proformas.map((p) => ({
    id: p.id,
    number: p.number,
    customerId: p.customerId,
    customer: `${p.customer.name} (${p.customer.code})`,
    customerGstin: p.customer.gstin,
    customerPan: p.customer.pan,
    status: p.status,
    soId: p.soId,
    quotationId: p.quotationId,
    proformaDate: p.proformaDate.toISOString(),
    validUpto: p.validUpto?.toISOString() || null,
    paymentTerms: p.paymentTerms,
    deliveryTerms: p.deliveryTerms,
    placeOfSupply: p.placeOfSupply,
    billingAddress: p.billingAddress,
    shippingAddress: p.shippingAddress,
    notes: p.notes,
    otherCharges: p.otherCharges,
    taxableAmount: p.taxableAmount,
    cgst: p.cgst,
    sgst: p.sgst,
    igst: p.igst,
    totalAmount: p.totalAmount,
    advanceReceived: p.advanceReceived || 0,
    lines: p.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification })),
  }));

  const quotationOpts = quotations.map((q) => ({
    id: q.id,
    number: q.number,
    customerId: q.customerId,
    lines: q.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate, specification: l.specification })),
    paymentTerms: q.paymentTerms,
    deliveryTerms: (q as any).deliveryTerms ?? null,
    placeOfSupply: q.placeOfSupply,
    billingAddress: q.billingAddress,
    shippingAddress: q.shippingAddress,
  }));

  return (
    <ProformaList
      initialProformas={mappedProformas}
      customers={customers}
      items={items}
      quotations={quotationOpts}
      company={company}
      docSettings={docSettings}
      user={user as any}
    />
  );
}
