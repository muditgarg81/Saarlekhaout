import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import IntegrationSettings from "./IntegrationSettings";

export default async function IntegrationPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // ERP connections, customer→ledger mappings, customers, bridge agents, debtor statements
  const [connections, mappings, customers, agents, statements] = await Promise.all([
    db.erpConnection.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    }),
    db.customerErpMap.findMany({
      where: { companyId },
    }),
    db.customer.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    db.bridgeAgent.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    }),
    db.debtorStatement.findMany({
      where: { companyId },
      include: { bills: true },
    }),
  ]);

  const mappedConnections = connections.map((c) => {
    let demoMode = true;
    if (c.config) {
      try {
        const parsed = typeof c.config === "string" ? JSON.parse(c.config) : c.config;
        demoMode = (parsed as any).demoMode !== false;
      } catch (e) {
        console.error("Failed to parse connection config", e);
      }
    }
    return {
      id: c.id,
      type: c.type,
      erpCompanyName: c.erpCompanyName,
      writebackEnabled: c.writebackEnabled,
      status: c.status,
      lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
      demoMode,
    };
  });

  const mappedMappings = mappings.map((m) => {
    const customer = customers.find((c) => c.id === m.customerId);
    return {
      id: m.id,
      customerId: m.customerId,
      customerName: customer?.name || "Unknown Customer",
      erpLedgerName: m.erpLedgerName,
      billwise: m.billwise,
      status: m.status,
    };
  });

  const cleanAgents = agents.map((ag) => ({
    id: ag.id,
    name: ag.name,
    lastSeenAt: ag.lastSeenAt ? ag.lastSeenAt.toISOString() : null,
    version: ag.version,
  }));

  const mappedStatements = statements.map((s) => {
    const customer = customers.find((c) => c.id === s.customerId);
    return {
      id: s.id,
      customerId: s.customerId,
      customerName: customer?.name || "Unknown Customer",
      customerCode: customer?.code || "N/A",
      outstanding: s.outstanding,
      asOf: s.asOf.toISOString(),
      bills: s.bills.map((b) => ({
        id: b.id,
        billRef: b.billRef,
        billDate: b.billDate ? b.billDate.toISOString().split("T")[0] : null,
        dueDate: b.dueDate ? b.dueDate.toISOString().split("T")[0] : null,
        openingAmount: b.openingAmount,
        pendingAmount: b.pendingAmount,
        overdueDays: b.overdueDays || 0,
      })),
    };
  });

  return (
    <IntegrationSettings
      connections={mappedConnections}
      mappings={mappedMappings}
      customers={customers}
      agents={cleanAgents}
      statements={mappedStatements}
    />
  );
}
