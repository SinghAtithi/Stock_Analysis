import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const BOARD_FILE = path.resolve(process.cwd(), "..", "data", "board.json");

async function ensureDir() {
  await fs.mkdir(path.dirname(BOARD_FILE), { recursive: true });
}

export async function GET() {
  try {
    const raw = await fs.readFile(BOARD_FILE, "utf-8");
    const json = JSON.parse(raw);
    return NextResponse.json(json, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT")) {
      return NextResponse.json({ tasks: null, activities: [] }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await ensureDir();
    const payload = {
      tasks: body.tasks ?? [],
      activities: body.activities ?? [],
      updatedAt: Date.now(),
    };
    await fs.writeFile(BOARD_FILE, JSON.stringify(payload, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
