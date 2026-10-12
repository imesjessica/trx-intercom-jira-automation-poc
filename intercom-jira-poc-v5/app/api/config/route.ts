import { NextResponse } from "next/server";
import { appConfig } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(appConfig());
}
