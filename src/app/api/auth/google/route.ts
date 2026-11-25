import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { newId } from "@/lib/crypto";
import { authUrl, googleConfigured } from "@/lib/google";

/** Starts Google sign-in. `?add=1` connects another channel to the signed-in user instead of switching user. */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) return NextResponse.redirect(new URL("/?error=not_configured", req.url));
  const state = newId();
  const jar = await cookies();
  jar.set("tt_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  if (req.nextUrl.searchParams.get("add") === "1") {
    jar.set("tt_add", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  } else {
    jar.delete("tt_add");
  }
  return NextResponse.redirect(authUrl(req.nextUrl.origin, state));
}
