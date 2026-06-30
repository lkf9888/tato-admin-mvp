import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";

const ADMIN_COOKIE = "turo-admin-session";

export async function GET() {
  const user = await getCurrentAdminUser();

  if (!user) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    response.cookies.delete(ADMIN_COOKIE);
    return response;
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}
