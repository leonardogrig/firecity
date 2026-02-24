"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { City, SiteData } from "@/components/City";

interface Repo {
  repo_name: string;
  repo_stars: number;
  repo_description: string;
}

interface OrgData {
  org: string;
  total: number;
  repos: Repo[];
  siteData?: SiteData;
}

export default function CityPage() {
  const params = useParams();
  const org = params.org as string;

  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [siteData, setSiteData] = useState<SiteData | undefined>(undefined);
  const [siteInfoDismissed, setSiteInfoDismissed] = useState(false);

  // Reset state when org changes so stale data never renders
  useEffect(() => {
    setData(null);
    setSiteData(undefined);
    setError(null);
    setLoading(true);
    setSiteInfoDismissed(false);
  }, [org]);

  useEffect(() => {
    async function fetchAll() {
      const userKey = sessionStorage.getItem("firecrawl_api_key");
      const customUrl = sessionStorage.getItem(`website_url:${org}`);

      // Headers for the org endpoint (pass Firecrawl key so it can scrape)
      const orgHeaders: Record<string, string> = {};
      if (userKey) orgHeaders["x-firecrawl-key"] = userKey;

      try {
        // Fetch repos + default site data (from blog) in one call
        const orgRes = await fetch(`/api/org/${encodeURIComponent(org)}`, { headers: orgHeaders });
        const orgJson = await orgRes.json();
        if (!orgRes.ok) throw new Error(orgJson.error || "Failed to load");

        const orgData = orgJson as OrgData;
        setData(orgData);

        // Use bundled site data by default
        if (orgData.siteData) setSiteData(orgData.siteData);

        // If user provided a custom URL, scrape that instead (overrides blog default)
        if (customUrl) {
          const siteHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (userKey) siteHeaders["x-firecrawl-key"] = userKey;

          try {
            const siteRes = await fetch("/api/scrape-site", {
              method: "POST",
              headers: siteHeaders,
              body: JSON.stringify({ url: customUrl }),
            });
            if (siteRes.ok) {
              const customSite = (await siteRes.json()) as SiteData;
              setSiteData(customSite);
            }
          } catch {
            // Keep the default blog site data
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [org]);

  if (loading) {
    return (
      <div className="loading">
        <p>Building city for {decodeURIComponent(org)}...</p>
        <p style={{ fontSize: 11 }}>
          Fetching repositories & branding...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error">
        <p>{error}</p>
        <Link href="/" style={{ color: "#5588ff" }}>
          Go back
        </Link>
      </div>
    );
  }

  if (!data || data.repos.length === 0) {
    return (
      <div className="error">
        <p>No repositories found for &quot;{decodeURIComponent(org)}&quot;</p>
        <Link href="/" style={{ color: "#5588ff" }}>
          Go back
        </Link>
      </div>
    );
  }

  const faviconUrl = siteData?.branding?.images?.favicon || siteData?.metadata?.favicon;
  const siteTitle = siteData?.metadata?.ogTitle || siteData?.metadata?.title;
  const siteUrl = siteData?.metadata?.sourceURL as string | undefined;
  const brandPrimary = siteData?.branding?.colors?.primary;

  const totalStars = data.repos.reduce((sum, r) => sum + r.repo_stars, 0);

  return (
    <div className="city-page">
      <div className="city-header">
        <div>
          <h1>{decodeURIComponent(org)}</h1>
          <span className="city-stats">
            {data.repos.length} repos &middot; {totalStars.toLocaleString()} stars
          </span>
        </div>
        <div className="city-header-right">
          <Link href="/">New city</Link>
          <a
            href="https://github.com/leonardogrig/firecity"
            target="_blank"
            rel="noopener noreferrer"
            className="github-star-inline"
            aria-label="Star on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </div>

      {/* Site info panel overlay */}
      {siteData && !siteInfoDismissed && (
        <div
          className="site-info-panel"
          style={{ borderLeft: brandPrimary ? `3px solid ${brandPrimary}` : undefined }}
        >
          <button
            className="site-info-dismiss"
            onClick={() => setSiteInfoDismissed(true)}
          >
            x
          </button>

          <div className="site-info-header">
            {faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={faviconUrl}
                alt=""
                className="site-info-favicon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            {siteTitle && <div className="site-info-title">{siteTitle}</div>}
          </div>

          {siteUrl && <div className="site-info-url">{siteUrl}</div>}

          {siteData.summary && (
            <>
              <div className="site-info-divider" />
              <div className="site-info-summary">{siteData.summary}</div>
            </>
          )}
        </div>
      )}

      <City repos={data.repos} siteData={siteData} />
    </div>
  );
}
