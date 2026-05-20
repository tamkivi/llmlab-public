import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET() {
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
  }, { headers: NO_STORE_HEADERS });
}
