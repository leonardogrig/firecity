"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const GITHUB_ORG_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export default function Home() {
  const [org, setOrg] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed) return;

    if (!GITHUB_ORG_RE.test(trimmed)) {
      setValidationError(
        "Invalid org name. Only letters, numbers, and hyphens allowed (no leading/trailing hyphen)."
      );
      return;
    }

    // Validate website URL if provided
    const urlTrimmed = websiteUrl.trim();
    if (urlTrimmed) {
      try {
        new URL(urlTrimmed);
      } catch {
        setValidationError("Invalid website URL. Please enter a full URL like https://example.com");
        return;
      }
    }

    setValidationError(null);

    // Store the user's API key in sessionStorage so the city page can read it
    const key = apiKey.trim();
    if (key) {
      sessionStorage.setItem("firecrawl_api_key", key);
    } else {
      sessionStorage.removeItem("firecrawl_api_key");
    }

    // Store the website URL in sessionStorage
    if (urlTrimmed) {
      sessionStorage.setItem("website_url", urlTrimmed);
    } else {
      sessionStorage.removeItem("website_url");
    }

    router.push(`/city/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="landing">
      <h1>FIRECITY</h1>
      <p>
        Enter a GitHub organization name to generate a city skyline.
        Each building represents a repository. The number of floors
        corresponds to the number of stars.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="e.g. mendableai"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          autoFocus
        />
        <button type="submit">Build City</button>
      </form>
      {validationError && (
        <p style={{ color: "#ff6b6b", fontSize: 13 }}>
          {validationError}
        </p>
      )}
      <div className="website-section">
        <input
          type="url"
          placeholder="Website URL (optional) e.g. https://firecrawl.dev"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          className="website-input"
        />
        <span className="website-hint">
          Adds branding colors, screenshot billboard, and site info to your city
        </span>
      </div>
      <div className="api-key-section">
        <input
          type="password"
          placeholder="Firecrawl API key (optional)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="api-key-input"
        />
        <span className="api-key-hint">
          Overrides the default key. Get yours at firecrawl.dev
        </span>
      </div>
    </div>
  );
}
