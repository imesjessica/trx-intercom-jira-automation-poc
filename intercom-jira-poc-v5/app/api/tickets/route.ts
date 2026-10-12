import { NextResponse } from "next/server";
import { listTickets, intercomMode } from "@/lib/intercom";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tickets = await listTickets();
    return NextResponse.json({ mode: intercomMode(), tickets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load tickets" }, { status: 502 });
  }
}
