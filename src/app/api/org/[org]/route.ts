import { NextRequest, NextResponse } from "next/server";
import { getCached, setCached, checkRateLimit } from "@/lib/cache";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

interface FirecrawlJsonResult {
  repository_list: Repo[];
  total_number_of_repositories: number;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    json?: FirecrawlJsonResult;
  };
  error?: string;
}

interface FirecrawlBatchStartResponse {
  success: boolean;
  id: string;
  url: string;
}

interface FirecrawlBatchStatusResponse {
  status: "scraping" | "completed" | "failed";
  total: number;
  completed: number;
  data?: Array<{
    json?: FirecrawlJsonResult;
  }>;
}

const REPOS_PER_PAGE = 30; // GitHub shows 30 repos per org page

// GitHub org names: alphanumeric + hyphens, no leading/trailing hyphen, max 39 chars
const GITHUB_ORG_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

const SCRAPE_FORMATS = [
  {
    type: "json" as const,
    schema: {
      type: "object",
      required: [],
      properties: {
        repository_list: {
          type: "array",
          items: {
            type: "object",
            required: [],
            properties: {
              repo_name: { type: "string" },
              repo_stars: { type: "number" },
              repo_description: { type: "string" },
            },
          },
        },
        total_number_of_repositories: { type: "number" },
      },
    },
    prompt: "Extract all the repositories and information",
  },
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ org: string }> }
) {
  const { org } = await params;

  if (!GITHUB_ORG_RE.test(org)) {
    return NextResponse.json(
      { error: "Invalid organization name. GitHub names can only contain letters, numbers, and hyphens." },
      { status: 400 }
    );
  }

  // User-provided key (via header) takes priority over the env key
  const userKey = request.headers.get("x-firecrawl-key");
  const apiKey = userKey || process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No Firecrawl API key provided. Enter one on the home page or set FIRECRAWL_API_KEY in .env.local" },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Check Redis cache first — cache hits are free and don't count toward the limit
  const cached = await getCached<{ org: string; total: number; repos: Repo[] }>(org);
  if (cached) {
    return NextResponse.json(cached);
  }

  // Rate limit: 5 fresh fetches per IP per day (skip when RATE_LIMIT_BYPASS is set)
  let remaining = 5;
  if (process.env.RATE_LIMIT_BYPASS !== "true") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    const rl = await checkRateLimit(ip);
    remaining = rl.remaining;

    if (!rl.allowed) {
      const res = NextResponse.json(
        { error: "Daily limit reached (5 lookups per day). Try again tomorrow or revisit a previously loaded org." },
        { status: 429 }
      );
      res.headers.set("X-RateLimit-Remaining", "0");
      return res;
    }
  }

  try {
    // Step 1: Scrape page 1 to get total_number_of_repositories
    const page1Res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: `https://github.com/orgs/${org}/repositories?page=1`,
        onlyMainContent: false,
        maxAge: 172800000,
        formats: SCRAPE_FORMATS,
      }),
    });

    const page1Data: FirecrawlScrapeResponse = await page1Res.json();

    if (!page1Data.success || !page1Data.data?.json) {
      return NextResponse.json(
        { error: page1Data.error || "Failed to fetch organization data" },
        { status: 400 }
      );
    }

    const page1Json = page1Data.data.json;
    const allRepos: Repo[] = page1Json.repository_list || [];
    const totalRepos = page1Json.total_number_of_repositories || allRepos.length;

    // If Firecrawl returned zero repos and zero total, the org likely doesn't exist
    // (GitHub's 404 page has no repo data to extract)
    if (allRepos.length === 0 && totalRepos === 0) {
      return NextResponse.json(
        { error: `Organization "${org}" not found on GitHub.` },
        { status: 404 }
      );
    }

    const totalPages = Math.ceil(totalRepos / REPOS_PER_PAGE);

    // Step 2: If there are more pages, batch scrape them all at once
    if (totalPages > 1) {
      const remainingUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingUrls.push(
          `https://github.com/orgs/${org}/repositories?page=${page}`
        );
      }

      // Start batch scrape
      const batchStartRes = await fetch(
        "https://api.firecrawl.dev/v2/batch/scrape",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            urls: remainingUrls,
            formats: SCRAPE_FORMATS,
            onlyMainContent: false,
            maxAge: 172800000,
          }),
        }
      );

      const batchStart: FirecrawlBatchStartResponse =
        await batchStartRes.json();

      if (!batchStart.success || !batchStart.id) {
        // Batch failed — return what we have from page 1
        return NextResponse.json({
          org,
          total: totalRepos,
          repos: allRepos,
        });
      }

      // Step 3: Poll for batch completion
      const batchUrl = `https://api.firecrawl.dev/v2/batch/scrape/${batchStart.id}`;
      const maxAttempts = 30; // up to ~60 seconds
      let attempt = 0;

      while (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        attempt++;

        const statusRes = await fetch(batchUrl, { headers });
        const status: FirecrawlBatchStatusResponse = await statusRes.json();

        if (status.status === "completed") {
          // Collect repos from all batch results
          if (status.data) {
            for (const item of status.data) {
              if (item.json?.repository_list) {
                allRepos.push(...item.json.repository_list);
              }
            }
          }
          break;
        }

        if (status.status === "failed") {
          break; // Return what we have from page 1
        }
      }
    }

    const result = { org, total: totalRepos, repos: allRepos };

    // Cache the result in Redis (fire-and-forget)
    setCached(org, result).catch(() => {});

    const res = NextResponse.json(result);
    res.headers.set("X-RateLimit-Remaining", String(remaining));
    return res;
  } catch (error) {
    console.error("Firecrawl API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch data from Firecrawl" },
      { status: 500 }
    );
  }
}
