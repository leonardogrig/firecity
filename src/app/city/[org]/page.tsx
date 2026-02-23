"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { City } from "@/components/City";

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

  useEffect(() => {
    async function fetchData() {
      try {
        const headers: Record<string, string> = {};
        const userKey = sessionStorage.getItem("firecrawl_api_key");
        if (userKey) {
          headers["x-firecrawl-key"] = userKey;
        }

        const res = await fetch(`/api/org/${encodeURIComponent(org)}`, { headers });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || "Failed to load");
          return;
        }
        setData(json);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [org]);

  if (loading) {
    return (
      <div className="loading">
        <p>Building city for {decodeURIComponent(org)}...</p>
        <p style={{ fontSize: 11 }}>Fetching repositories via Firecrawl</p>
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

  return (
    <div className="city-page">
      <div className="city-header">
        <div>
          <h1>{decodeURIComponent(org)}</h1>
          <span className="city-stats">
            {data.repos.length} repos &middot; {data.total} total
          </span>
        </div>
        <Link href="/">New city</Link>
      </div>
      <City repos={data.repos} />
    </div>
  );
}
