import { NextResponse } from "next/server";
import { getTicker } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getTicker();
  return NextResponse.json({ items });
}
