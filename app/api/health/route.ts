import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "tato-admin-mvp",
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
