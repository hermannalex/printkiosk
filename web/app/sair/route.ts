import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";

export async function GET(request: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/entrar", request.url));
}
