import { NextResponse } from "next/server";
import { registerAccount, createSessionForCredentials } from "@/lib/db";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth-session";
import { checkRateLimit, clientIpFromHeaders, clientRateLimitKey, requestOriginIsAllowed } from "@/lib/request-utils";

export async function POST(request: Request) {
  try {
    if (!requestOriginIsAllowed(request)) {
      return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
    }

    const ipAddress = clientIpFromHeaders(request.headers);
    const rateLimitKey = clientRateLimitKey(request, "register");
    if (!(await checkRateLimit(rateLimitKey, 5, 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          email?: string;
          password?: string;
          adminSetupCode?: string;
        }
      | null;

    if (!body?.email || !body?.password) {
      return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
    }

    const emailRateLimitKey = `register:email:${body.email.trim().toLowerCase()}`;
    if (!(await checkRateLimit(emailRateLimitKey, 3, 60 * 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const result = await registerAccount({
      email: body.email,
      password: body.password,
      adminSetupCode: body.adminSetupCode,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: 400 });
    }

    const auth = await createSessionForCredentials({
      email: body.email,
      password: body.password,
      ipAddress,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    if (!auth.ok) {
      return NextResponse.json({ message: auth.message }, { status: 500 });
    }

    const response = NextResponse.json({ user: auth.user }, { status: 201 });
    response.cookies.set(SESSION_COOKIE_NAME, auth.token, sessionCookieOptions(auth.expiresAt));
    return response;
  } catch {
    return NextResponse.json({ message: "Signup failed due to a server error." }, { status: 500 });
  }
}
