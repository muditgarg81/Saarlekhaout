"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ErpType, ErpConnStatus } from "@prisma/client";

// ERP / Tally connection management. The debtor-side ledger mapping and statement
// sync live in app/actions/salesErp.ts; this file owns the connection + bridge
// agent token only.

export async function saveErpConnection(data: {
  type: ErpType;
  erpCompanyName: string;
  writebackEnabled: boolean;
  demoMode: boolean;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const conn = await db.erpConnection.upsert({
      where: {
        companyId_type_erpCompanyName: {
          companyId,
          type: data.type,
          erpCompanyName: data.erpCompanyName
        }
      },
      update: {
        writebackEnabled: data.writebackEnabled,
        status: data.demoMode ? ErpConnStatus.ACTIVE : ErpConnStatus.AGENT_OFFLINE,
        config: { demoMode: data.demoMode }
      },
      create: {
        companyId,
        type: data.type,
        erpCompanyName: data.erpCompanyName,
        writebackEnabled: data.writebackEnabled,
        status: data.demoMode ? ErpConnStatus.ACTIVE : ErpConnStatus.AGENT_OFFLINE,
        config: { demoMode: data.demoMode }
      }
    });

    revalidatePath("/integration");
    return { success: true, connection: conn };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to save ERP configuration" };
  }
}

export async function generateBridgeAgentToken(connectionId: string, name: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;

  try {
    const agent = await db.bridgeAgent.create({
      data: {
        companyId,
        connectionId,
        name,
        tokenHash: `agent_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`,
        version: "1.0.0"
      }
    });

    revalidatePath("/integration");
    return { success: true, token: agent.id };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to register bridge agent" };
  }
}
