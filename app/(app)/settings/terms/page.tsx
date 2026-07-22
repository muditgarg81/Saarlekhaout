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

  const templates = await db.termsTemplate.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
  });

  return <TermsSettingsClient initialTemplates={templates} />;
}
