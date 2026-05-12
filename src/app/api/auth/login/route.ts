import { NextResponse } from "next/server";
import { createSessionForCredentials } from "@/lib/db";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth-session";
import { checkRateLimit, clientIpFromHeaders, clientRateLimitKey, requestOriginIsAllowed } from "@/lib/request-utils";

export async function POST(request: Request) {
  try {
    if (!requestOriginIsAllowed(request)) {
      return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
    }

    const ipAddress = clientIpFromHeaders(request.headers);
    const rateLimitKey = clientRateLimitKey(request, "login");
    if (!(await checkRateLimit(rateLimitKey, 10, 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          email?: string;
          password?: string;
        }
      | null;

    if (!body?.email || !body?.password) {
      return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
    }

    const emailRateLimitKey = `login:email:${body.email.trim().toLowerCase()}`;
    if (!(await checkRateLimit(emailRateLimitKey, 10, 15 * 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const auth = await createSessionForCredentials({
      email: body.email,
      password: body.password,
      ipAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    if (!auth.ok) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const response = NextResponse.json({ user: auth.user });
    response.cookies.set(SESSION_COOKIE_NAME, auth.token, sessionCookieOptions(auth.expiresAt));
    return response;
  } catch {
    return NextResponse.json({ message: "Login failed due to a server error." }, { status: 500 });
  }
}
