import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasKey: !!process.env.FIRECRAWL_API_KEY,
  });
}
