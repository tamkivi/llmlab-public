import { NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/db";
import { requireAuth } from "@/lib/server/auth-helpers";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ user: null });
  }

  const summary = auth.user.role === "ADMIN" || auth.user.role === "DEV" ? await getAccountSummary() : null;
  return NextResponse.json({ user: auth.user, summary });
}
