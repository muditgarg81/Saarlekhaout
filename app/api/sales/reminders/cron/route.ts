import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPaymentReminderEmail } from "@/lib/mail";
import { notify } from "@/lib/notifications";

// Simple webhook route for cron/scheduler triggers to run the reminder agent.
export async function POST(req: Request) {
  try {
    // Optionally check secret auth header if configured in environment
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Scan all active companies
    const companies = await db.company.findMany();
    let totalRemindersSent = 0;

    for (const company of companies) {
      const companyId = company.id;

      const overdueInvoices = await db.salesInvoice.findMany({
        where: {
          companyId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          dueDate: { lt: new Date() },
          deletedAt: null,
        },
      });

      const customerIds = overdueInvoices.map((inv) => inv.customerId);
      const customers = await db.customer.findMany({
        where: { id: { in: customerIds }, companyId },
      });
      const customerMap = new Map(customers.map((c) => [c.id, c]));

      for (const inv of overdueInvoices) {
        const cust = customerMap.get(inv.customerId);
        if (!cust) continue;
        const email = cust.contactEmail;
        const outstanding = inv.totalAmount - inv.paidAmount;

        if (!email) continue;

        try {
          await db.$transaction(async (tx) => {
            // Send email
            await sendPaymentReminderEmail({
              email,
              customerName: cust.name,
              invoiceNo: inv.number,
              amount: outstanding,
              dueDate: inv.dueDate || new Date(),
              companyName: company.name,
            });

            // Log history
            await tx.paymentReminder.create({
              data: {
                companyId,
                invoiceId: inv.id,
                customerId: inv.customerId,
                sentTo: email,
                status: "SENT",
                method: "EMAIL",
              },
            });

            // Update counters
            await tx.salesInvoice.update({
              where: { id: inv.id },
              data: {
                reminderCount: { increment: 1 },
                lastReminderSentAt: new Date(),
              },
            });

            // Notify accounts
            await notify({
              companyId,
              audience: { role: "ACCOUNTS" },
              category: "PAYMENT",
              severity: "WARNING",
              title: `Overdue Payment Reminder sent for Invoice ${inv.number}`,
              body: `Reminder sent to ${cust.name} (${email}) for ₹${outstanding.toLocaleString("en-IN")}`,
              deepLink: `/sales/invoices`,
              entityType: "SalesInvoice",
              entityId: inv.id,
            });

            // Write to audit log
            await tx.auditLog.create({
              data: {
                companyId,
                actorId: "system-cron",
                action: "SEND_REMINDER",
                entity: "SalesInvoice",
                entityId: inv.id,
                before: { reminderCount: inv.reminderCount },
                after: { reminderCount: inv.reminderCount + 1 },
              },
            });
          });

          totalRemindersSent++;
        } catch (txnError) {
          console.error(`Cron failed to process invoice ${inv.number}:`, txnError);
        }
      }
    }

    return NextResponse.json({ success: true, remindersSent: totalRemindersSent });
  } catch (err: any) {
    console.error("Cron reminders scan failed:", err);
    return NextResponse.json({ error: err.message || "Failed to scan reminders" }, { status: 500 });
  }
}
