import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import TermsSettingsClient from "./TermsSettingsClient";

export default async function TermsSettingsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const user = session.user as any;
  const isAllowed = can(user, "company.settings.edit") || ["ADMIN", "OWNER"].includes(user.role);

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center font-body bg-white border border-onyx/5 rounded-xl p-8">
        <h2 className="text-lg font-bold text-red-700">Access Denied</h2>
        <p className="text-xs text-onyx/60 mt-2">
          You do not have administrative permissions to define or edit Terms & Conditions templates.
        </p>
      </div>
    );
  }

  let templates = await db.termsTemplate.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
  });

  if (templates.length === 0) {
    const defaultTemplate = await db.termsTemplate.create({
      data: {
        companyId: user.companyId,
        title: "Standard Sales Terms & Conditions",
        content: `1. PRICES & TAXES: Prices are valid for 30 days from the date of quotation. GST and other government levies will be charged extra at actuals at the time of invoicing.
2. PAYMENT TERMS: 100% advance payment with Sales Order unless alternative credit terms are explicitly agreed in writing. Interest at 18% p.a. will be charged on all overdue invoices.
3. DELIVERY & DISPATCH: Deliveries are Ex-Works / FOB. Lead time begins only after receipt of confirmed Purchase Order, advance payment, and approval of technical drawings/specifications (if applicable).
4. INSPECTION: Customer must inspect goods upon delivery. Any claims for damage, shortage, or non-conformance must be reported in writing within 7 business days of receipt, failing which goods shall be deemed accepted.
5. WARRANTY: Products are warranted against manufacturing defects for a period of 12 months from the date of dispatch. Warranty is limited to repair/replacement and does not cover misuse or normal wear and tear.
6. FORCE MAJEURE: We shall not be liable for delay or failure to perform obligations due to acts of God, strikes, lockouts, shortages of raw materials, government regulations, or other causes beyond our control.
7. JURISDICTION: All transactions and disputes arising out of this agreement shall be subject to the exclusive jurisdiction of the local courts where our registered office is located.`,
        isDefault: true,
      },
    });
    templates = [defaultTemplate];
  }

  return <TermsSettingsClient initialTemplates={templates} />;
}
