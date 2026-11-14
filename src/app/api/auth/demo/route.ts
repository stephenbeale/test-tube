import { NextResponse, type NextRequest } from "next/server";
import { DEMO_USER, seedDemo } from "@/lib/demo";
import { createSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  await seedDemo();
  await createSession(DEMO_USER);
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
