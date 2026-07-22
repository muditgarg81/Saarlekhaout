import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Run a simple query to keep serverless PG database active
    await db.$executeRawUnsafe("SELECT 1");
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error("Heartbeat DB error:", err);
    return NextResponse.json({ error: err.message || "Database query failed" }, { status: 500 });
  }
}
