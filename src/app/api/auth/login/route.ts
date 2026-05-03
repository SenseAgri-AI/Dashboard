import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const VALID_USERNAME = "mikaniadmin";
const VALID_PASSWORD = "eggs2026";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const session = await getSession();
  session.isLoggedIn = true;
  session.username = username;
  await session.save();

  return NextResponse.json({ ok: true });
}
