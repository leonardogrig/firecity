import { NextRequest, NextResponse } from "next/server";
import { getCached, setCached, checkRateLimit } from "@/lib/cache";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

interface GitHubRepo {
  name: string;
  stargazers_count: number;
  description: string | null;
  fork: boolean;
}

interface SiteData {
  screenshot?: string;
  summary?: string;
  branding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface OrgResult {
  org: string;
  total: number;
  repos: Repo[];
  siteData?: SiteData;
}

// GitHub org/user names: alphanumeric + hyphens, no leading/trailing hyphen, max 39 chars
const GITHUB_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "firecity-app",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

/**
 * Fetch all repos for an org or user, handling pagination (100 per page).
 */
async function fetchAllRepos(baseUrl: string): Promise<GitHubRepo[]> {
  const allRepos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${baseUrl}?per_page=100&sort=stars&direction=desc&page=${page}`,
      { headers: ghHeaders() }
    );

    if (!res.ok) break;

    const repos: GitHubRepo[] = await res.json();
    if (repos.length === 0) break;

    allRepos.push(...repos);

    // If we got fewer than 100, there are no more pages
    if (repos.length < 100) break;
    page++;
  }

  return allRepos;
}

/**
 * Scrape a website for branding/screenshot using Firecrawl.
 */
async function scrapeSite(url: string, apiKey: string): Promise<SiteData | null> {
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
    if (!data.success) return null;

    return {
      screenshot: data.data?.screenshot,
      summary: data.data?.summary,
      branding: data.data?.branding,
      metadata: data.data?.metadata,
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ org: string }> }
) {
  const { org } = await params;

  if (!GITHUB_NAME_RE.test(org)) {
    return NextResponse.json(
      { error: "Invalid name. GitHub names can only contain letters, numbers, and hyphens." },
      { status: 400 }
    );
  }

  // Check Redis cache first — cache hits return repos + siteData together
  const cached = await getCached<OrgResult>(org);
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

  // User-provided Firecrawl key or env key (for site scraping)
  const userFirecrawlKey = request.headers.get("x-firecrawl-key");
  const firecrawlKey = userFirecrawlKey || process.env.FIRECRAWL_API_KEY;

  try {
    // Step 1: Try as organization first — also grab the blog URL
    let reposUrl: string;
    let blogUrl: string | null = null;

    const orgRes = await fetch(`https://api.github.com/orgs/${org}`, {
      headers: ghHeaders(),
    });

    if (orgRes.ok) {
      const orgData = await orgRes.json();
      reposUrl = `https://api.github.com/orgs/${org}/repos`;
      blogUrl = orgData.blog || null;
    } else {
      // Try as user
      const userRes = await fetch(`https://api.github.com/users/${org}`, {
        headers: ghHeaders(),
      });

      if (!userRes.ok) {
        return NextResponse.json(
          { error: `"${org}" not found on GitHub as an organization or user.` },
          { status: 404 }
        );
      }

      const userData = await userRes.json();
      reposUrl = `https://api.github.com/users/${org}/repos`;
      blogUrl = userData.blog || null;
    }

    // Normalize blog URL
    if (blogUrl && !/^https?:\/\//i.test(blogUrl)) {
      blogUrl = `https://${blogUrl}`;
    }

    // Step 2: Fetch repos + scrape site in parallel
    const repoPromise = fetchAllRepos(reposUrl);

    const sitePromise: Promise<SiteData | null> =
      blogUrl && firecrawlKey
        ? scrapeSite(blogUrl, firecrawlKey)
        : Promise.resolve(null);

    const [ghRepos, siteData] = await Promise.all([repoPromise, sitePromise]);

    if (ghRepos.length === 0) {
      return NextResponse.json(
        { error: `No public repositories found for "${org}".` },
        { status: 404 }
      );
    }

    // Step 3: Map to our format
    const repos: Repo[] = ghRepos.map((r) => ({
      repo_name: r.name,
      repo_stars: r.stargazers_count,
      repo_description: r.description || "",
    }));

    const result: OrgResult = { org, total: repos.length, repos };
    if (siteData) result.siteData = siteData;

    // Cache the full result (repos + site data) in Redis
    setCached(org, result).catch(() => {});

    const res = NextResponse.json(result);
    res.headers.set("X-RateLimit-Remaining", String(remaining));
    return res;
  } catch (error) {
    console.error("GitHub API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch data from GitHub" },
      { status: 500 }
    );
  }
}
