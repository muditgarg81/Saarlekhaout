import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = (session.user as any).companyId;
  const userId = (session.user as any).id;

  try {
    const unreadNotificationsCount = await db.notification.count({
      where: {
        companyId,
        userId,
        readAt: null,
      },
    });

    return NextResponse.json({
      unreadNotifications: unreadNotificationsCount,
      activeReminders: 0,
      totalCount: unreadNotificationsCount,
      totalUnits: unreadNotificationsCount,
      hasCritical: false,
    });
  } catch (err) {
    console.error("Error fetching notifications summary:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
