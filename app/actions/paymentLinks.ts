"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { createRazorpayPaymentLink, razorpayConfigured } from "@/lib/razorpay";

// Generate a Razorpay payment link for an invoice's outstanding amount. The
// invoiceId + companyId travel in the link's `notes`, so the webhook can create
// the matching ReceiptVoucher when the customer pays — no extra table needed.

export async function createInvoicePaymentLink(invoiceId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "receipt.record")) {
    return { success: false, error: "Forbidden: Missing receipt.record permission" };
  }
  const companyId = (session.user as any).companyId;

  if (!razorpayConfigured()) {
    return { success: false, error: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." };
  }

  try {
    const invoice = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId, deletedAt: null } });
    if (!invoice) return { success: false, error: "Invoice not found" };
    if (invoice.status === "CANCELLED") return { success: false, error: "Invoice is cancelled" };
    const outstanding = invoice.totalAmount - invoice.paidAmount;
    if (outstanding <= 0) return { success: false, error: "Invoice is already fully paid" };

    const customer = await db.customer.findFirst({ where: { id: invoice.customerId, companyId } });

    const link = await createRazorpayPaymentLink({
      amountPaise: Math.round(outstanding * 100),
      description: `Payment for Invoice ${invoice.number}`,
      customer: {
        name: customer?.name || "Customer",
        email: customer?.contactEmail || undefined,
        contact: customer?.contactPhone || undefined,
      },
      notes: { invoiceId: invoice.id, companyId, invoiceNumber: invoice.number },
    });

    return { success: true, url: link.short_url, amount: outstanding };
  } catch (err: any) {
    console.error("Error creating payment link:", err);
    return { success: false, error: err.message || "Failed to create payment link" };
  }
}
