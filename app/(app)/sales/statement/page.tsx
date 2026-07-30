export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getFreshUser } from "@/app/actions/auth";
import StatementClient from "./StatementClient";

export default async function StatementPage() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");

  const customers = await db.customer.findMany({
    where: { companyId: user.companyId, deletedAt: null },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  return <StatementClient customers={customers} />;
}
