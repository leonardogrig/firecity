import { NextRequest, NextResponse } from "next/server";
import { getSiteCached, setSiteCached } from "@/lib/cache";

interface SiteResult {
  screenshot?: string;
  summary?: string;
  branding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Check cache first
  const cached = await getSiteCached<SiteResult>(url);
  if (cached) {
    return NextResponse.json(cached);
  }

  const userKey = request.headers.get("x-firecrawl-key");
  const apiKey = userKey || process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No Firecrawl API key provided" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["screenshot", "summary", "branding"],
      }),
    });

    const data = await res.json();

    if (!data.success) {
      return NextResponse.json(
        { error: data.error || "Failed to scrape website" },
        { status: 400 }
      );
    }

    const result: SiteResult = {
      screenshot: data.data?.screenshot,
      summary: data.data?.summary,
      branding: data.data?.branding,
      metadata: data.data?.metadata,
    };

    // Cache for 2 days (fire-and-forget)
    setSiteCached(url, result).catch(() => {});

    return NextResponse.json(result);
  } catch (error) {
    console.error("Scrape site error:", error);
    return NextResponse.json(
      { error: "Failed to scrape website" },
      { status: 500 }
    );
  }
}
