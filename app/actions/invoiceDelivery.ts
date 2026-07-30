"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { sendInvoiceEmail } from "@/lib/mail";

// Deliver an invoice to the customer over email (SMTP) or WhatsApp (wa.me share).
// Email needs SMTP_* env to actually send — otherwise it logs a mock and reports
// so. WhatsApp needs no setup; the client opens a wa.me link with the message.

export async function emailInvoice(invoiceId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false as const, error: "Unauthorized" };
  if (!can(session.user as any, "sales.invoice")) {
    return { success: false as const, error: "Forbidden: Missing sales.invoice permission" };
  }
  const companyId = (session.user as any).companyId;

  try {
    const inv = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId, deletedAt: null } });
    if (!inv) return { success: false as const, error: "Invoice not found" };
    const customer = await db.customer.findFirst({ where: { id: inv.customerId, companyId } });
    if (!customer?.contactEmail) {
      return { success: false as const, error: "Customer has no email address on file" };
    }
    const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });

    const res = await sendInvoiceEmail({
      email: customer.contactEmail,
      customerName: customer.name,
      invoiceNo: inv.number,
      outstanding: inv.totalAmount - inv.paidAmount,
      totalAmount: inv.totalAmount,
      dueDate: inv.dueDate,
      companyName: company?.legalName || company?.name || "",
    });
    if (!res.success) return { success: false as const, error: "Failed to send email" };
    return { success: true as const, to: customer.contactEmail, mock: (res as any).mock === true };
  } catch (err: any) {
    console.error("Error emailing invoice:", err);
    return { success: false as const, error: err.message || "Failed to email invoice" };
  }
}

export async function getInvoiceWhatsApp(invoiceId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false as const, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const inv = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId, deletedAt: null } });
    if (!inv) return { success: false as const, error: "Invoice not found" };
    const customer = await db.customer.findFirst({ where: { id: inv.customerId, companyId } });
    const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });

    // Normalise to wa.me format (digits only; assume +91 for a bare 10-digit number).
    const digits = (customer?.contactPhone || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? `91${digits}` : digits;

    const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-IN") : "on receipt";
    const outstanding = (inv.totalAmount - inv.paidAmount).toLocaleString("en-IN");
    const text =
      `Dear ${customer?.name || "Customer"},\n\n` +
      `Invoice ${inv.number} from ${company?.legalName || company?.name || ""}.\n` +
      `Amount due: ₹${outstanding}\n` +
      `Due date: ${due}\n\n` +
      `Thank you for your business.`;

    return { success: true as const, phone, text };
  } catch (err: any) {
    console.error("Error building WhatsApp share:", err);
    return { success: false as const, error: err.message || "Failed to build WhatsApp message" };
  }
}
