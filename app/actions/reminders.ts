"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notify } from "@/lib/notifications";
import { sendPaymentReminderEmail } from "@/lib/mail";
import { can } from "@/lib/rbac";

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}

/**
 * Scan all overdue invoices for the user's current company and trigger reminders.
 */
export async function scanAndSendReminders() {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "payment.record") && !can(session.user as any, "receipt.record")) {
    return { success: false, error: "Forbidden: Missing permissions to send reminders" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) return { success: false, error: "Company not found" };

    const overdueInvoices = await db.salesInvoice.findMany({
      where: {
        companyId,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        dueDate: { lt: new Date() },
        deletedAt: null,
      },
    });

    if (overdueInvoices.length === 0) {
      return { success: true, count: 0, message: "No overdue invoices found." };
    }

    const customerIds = overdueInvoices.map((inv) => inv.customerId);
    const customers = await db.customer.findMany({
      where: { id: { in: customerIds }, companyId },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    let sentCount = 0;

    for (const inv of overdueInvoices) {
      const cust = customerMap.get(inv.customerId);
      if (!cust) {
        console.log(`[REMINDER AGENT] Skip invoice ${inv.number}: Customer not found`);
        continue;
      }
      const email = cust.contactEmail;
      const outstanding = inv.totalAmount - inv.paidAmount;

      if (!email) {
        console.log(`[REMINDER AGENT] Skip invoice ${inv.number}: Customer has no contact email`);
        continue;
      }

      await db.$transaction(async (tx) => {
        // Send email (falls back to console log mock email if SMTP is not configured)
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

        // Update invoice counters
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: {
            reminderCount: { increment: 1 },
            lastReminderSentAt: new Date(),
          },
        });

        // In-app notification to accounts team
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

        await logAudit(tx, companyId, actorId, "SEND_REMINDER", "SalesInvoice", inv.id, { reminderCount: inv.reminderCount }, { reminderCount: inv.reminderCount + 1 });
      });

      sentCount++;
    }

    revalidatePath("/sales/reminders");
    revalidatePath("/sales/invoices");
    return { success: true, count: sentCount };
  } catch (err: any) {
    console.error("Error running payment reminder agent:", err);
    return { success: false, error: err.message || "Failed to run reminder agent" };
  }
}

/**
 * Manually send a payment reminder for a specific invoice.
 */
export async function sendSingleReminder(invoiceId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  if (!can(session.user as any, "payment.record") && !can(session.user as any, "receipt.record")) {
    return { success: false, error: "Forbidden: Missing permissions to send reminders" };
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) return { success: false, error: "Company not found" };

    const inv = await db.salesInvoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
    });

    if (!inv) return { success: false, error: "Invoice not found" };
    if (inv.status === "PAID" || inv.status === "CANCELLED") {
      return { success: false, error: "Cannot send reminder for paid or cancelled invoice" };
    }

    const customer = await db.customer.findFirst({
      where: { id: inv.customerId, companyId, deletedAt: null },
    });
    if (!customer) return { success: false, error: "Customer not found" };

    const email = customer.contactEmail;
    if (!email) {
      return { success: false, error: "Customer does not have a contact email configured" };
    }

    const outstanding = inv.totalAmount - inv.paidAmount;

    await db.$transaction(async (tx) => {
      // Send email
      await sendPaymentReminderEmail({
        email,
        customerName: customer.name,
        invoiceNo: inv.number,
        amount: outstanding,
        dueDate: inv.dueDate || new Date(),
        companyName: company.name,
      });

      // Log reminder
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
        title: `Overdue Payment Reminder manually sent for Invoice ${inv.number}`,
        body: `Reminder sent to ${customer.name} (${email}) for ₹${outstanding.toLocaleString("en-IN")}`,
        deepLink: `/sales/invoices`,
        entityType: "SalesInvoice",
        entityId: inv.id,
      });

      await logAudit(tx, companyId, actorId, "SEND_REMINDER", "SalesInvoice", inv.id, { reminderCount: inv.reminderCount }, { reminderCount: inv.reminderCount + 1 });
    });

    revalidatePath("/sales/reminders");
    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (err: any) {
    console.error("Error sending manual reminder:", err);
    return { success: false, error: err.message || "Failed to send payment reminder" };
  }
}
