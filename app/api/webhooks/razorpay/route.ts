import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { getNextSequence } from "@/lib/sequences";
import { ReceiptMode, SalesInvoiceStatus } from "@prisma/client";

// Razorpay webhook. Configure in the Razorpay dashboard pointing at
//   https://<your-domain>/api/webhooks/razorpay
// subscribe to `payment_link.paid`, and set RAZORPAY_WEBHOOK_SECRET to the same
// secret. On a paid link we create a ReceiptVoucher against the invoice named in
// the link's notes, idempotent on the Razorpay payment id.

const METHOD_MAP: Record<string, ReceiptMode> = {
  upi: ReceiptMode.UPI,
  card: ReceiptMode.CARD,
  netbanking: ReceiptMode.NEFT,
  wallet: ReceiptMode.UPI,
  emi: ReceiptMode.CARD,
};

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature");
  if (!verifyRazorpaySignature(raw, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (event?.event !== "payment_link.paid") {
    return NextResponse.json({ ok: true, ignored: event?.event });
  }

  try {
    const pl = event.payload?.payment_link?.entity;
    const pay = event.payload?.payment?.entity;
    const invoiceId = pl?.notes?.invoiceId as string | undefined;
    const companyId = pl?.notes?.companyId as string | undefined;
    const paymentId = (pay?.id || pl?.id) as string | undefined;
    const amountPaise = Number(pl?.amount_paid ?? pay?.amount ?? 0);

    if (!invoiceId || !companyId || !paymentId || amountPaise <= 0) {
      return NextResponse.json({ ok: true, note: "missing notes/amount" });
    }

    // Idempotency — Razorpay may retry the webhook.
    const existing = await db.receiptVoucher.findFirst({ where: { companyId, reference: paymentId } });
    if (existing) return NextResponse.json({ ok: true, dedup: true });

    const invoice = await db.salesInvoice.findFirst({ where: { id: invoiceId, companyId } });
    if (!invoice || invoice.status === "CANCELLED") {
      return NextResponse.json({ ok: true, note: "no active invoice" });
    }

    const amount = amountPaise / 100;
    const mode = METHOD_MAP[pay?.method] || ReceiptMode.UPI;
    const number = await getNextSequence(companyId, "RV");

    await db.$transaction(async (tx) => {
      await tx.receiptVoucher.create({
        data: {
          companyId,
          number,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          amount,
          receivedOn: new Date(),
          mode,
          reference: paymentId,
          recordedById: "razorpay-webhook",
        },
      });
      const newPaid = invoice.paidAmount + amount;
      const newStatus =
        newPaid >= invoice.totalAmount - 1e-9 ? SalesInvoiceStatus.PAID : SalesInvoiceStatus.PARTIALLY_PAID;
      await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: newPaid, status: newStatus } });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Razorpay webhook handler error:", err);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
