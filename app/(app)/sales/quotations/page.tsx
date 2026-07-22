import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import QuotationsList from "./QuotationsList";
import { getFreshUser } from "@/app/actions/auth";

export default async function QuotationsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [quotations, customers, items, termsTemplates, docSettings, company] = await Promise.all([
    db.customerQuotation.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true, code: true, gstin: true, pan: true } }, lines: true },
      take: 200,
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null, status: "APPROVED" },
      select: { id: true, code: true, name: true, stateCode: true, paymentTerms: true, billingAddresses: true, shippingAddresses: true },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, code: true, name: true, baseUom: true, gstRate: true, specification: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    db.termsTemplate.findMany({
      where: { companyId },
      orderBy: { title: "asc" },
    }),
    db.companyDocumentSettings.findUnique({
      where: { companyId },
    }),
    db.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, gstin: true, pan: true, cin: true, contactEmail: true, contactPhone: true, city: true, governingPlace: true, logoUrl: true },
    }),
  ]);

  const mapped = quotations.map((q) => ({
    id: q.id,
    number: q.number,
    customerId: q.customerId,
    customer: `${q.customer.name} (${q.customer.code})`,
    customerGstin: q.customer.gstin,
    customerPan: q.customer.pan,
    status: q.status,
    quotationDate: q.quotationDate.toISOString(),
    validUpto: q.validUpto?.toISOString() || null,
    paymentTerms: q.paymentTerms,
    billingAddress: q.billingAddress,
    shippingAddress: q.shippingAddress,
    placeOfSupply: q.placeOfSupply,
    termsConditions: q.termsConditions,
    leadTime: q.leadTime,
    otherCharges: q.otherCharges,
    lines: q.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      qty: l.qty,
      rate: l.rate,
      discount: l.discount,
      gstRate: l.gstRate,
      specification: l.specification,
    })),
    value:
      q.lines.reduce(
        (s, l) => s + l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100),
        0
      ) + q.otherCharges,
    lineCount: q.lines.length,
  }));

  return (
    <QuotationsList
      initialQuotations={mapped}
      customers={customers}
      items={items}
      termsTemplates={termsTemplates}
      presetTerms={docSettings?.quotationTerms || ""}
      company={company}
      user={user as any}
    />
  );
}
