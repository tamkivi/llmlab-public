import { cookies } from "next/headers";
import { getUserFromSessionToken, type PublicUser } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth-session";

export { type PublicUser };

export async function requireAuth(): Promise<{ user: PublicUser } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await getUserFromSessionToken(token);
  if (!user) return null;
  return { user };
}
