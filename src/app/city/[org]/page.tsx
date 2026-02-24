"use client";

import { useEffect, useState, useRef } from "react";
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
}

export default function CityPage() {
  const params = useParams();
  const org = params.org as string;

  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [siteData, setSiteData] = useState<SiteData | undefined>(undefined);
  const [siteInfoDismissed, setSiteInfoDismissed] = useState(false);
  const hasWebsiteUrl = useRef(false);

  // Fetch repos AND site data in parallel — wait for both before rendering
  useEffect(() => {
    async function fetchAll() {
      const userKey = sessionStorage.getItem("firecrawl_api_key");

      const websiteUrl = sessionStorage.getItem("website_url");
      hasWebsiteUrl.current = !!websiteUrl;

      // Repos are fetched via GitHub API — no Firecrawl key needed
      const repoFetch = fetch(`/api/org/${encodeURIComponent(org)}`)
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to load");
          return json as OrgData;
        });

      // Site scraping still uses Firecrawl — key is sent via header
      const siteHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (userKey) siteHeaders["x-firecrawl-key"] = userKey;

      const siteFetch = websiteUrl
        ? fetch("/api/scrape-site", {
            method: "POST",
            headers: siteHeaders,
            body: JSON.stringify({ url: websiteUrl }),
          })
            .then(async (res) => (res.ok ? ((await res.json()) as SiteData) : null))
            .catch(() => null)
        : Promise.resolve(null);

      try {
        const [repoResult, siteResult] = await Promise.all([repoFetch, siteFetch]);
        setData(repoResult);
        if (siteResult) setSiteData(siteResult);
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
          {hasWebsiteUrl.current
            ? "Fetching repositories & scraping website branding..."
            : "Fetching repositories from GitHub..."}
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
        <Link href="/">New city</Link>
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
