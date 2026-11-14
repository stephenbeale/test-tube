import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { newId } from "@/lib/crypto";
import { authUrl, googleConfigured } from "@/lib/google";

export async function GET(req: NextRequest) {
  if (!googleConfigured()) return NextResponse.redirect(new URL("/?error=not_configured", req.url));
  const state = newId();
  (await cookies()).set("tt_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authUrl(req.nextUrl.origin, state));
}
