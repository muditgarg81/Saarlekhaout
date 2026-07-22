import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import QuotationsList from "./QuotationsList";
import { getFreshUser } from "@/app/actions/auth";

export default async function QuotationsPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  const companyId = user.companyId;

  const [quotations, customers, items, termsTemplates] = await Promise.all([
    db.customerQuotation.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true, code: true } }, lines: true },
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
  ]);

  const mapped = quotations.map((q) => ({
    id: q.id,
    number: q.number,
    customer: `${q.customer.name} (${q.customer.code})`,
    status: q.status,
    quotationDate: q.quotationDate.toISOString(),
    validUpto: q.validUpto?.toISOString() || null,
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
      user={user as any}
    />
  );
}
