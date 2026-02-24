"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const GITHUB_ORG_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export default function Home() {
  const [org, setOrg] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfirmed, setApiKeyConfirmed] = useState(false);
  const [envHasKey, setEnvHasKey] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Blog suggestion state
  const [searching, setSearching] = useState(false);
  const [blogSuggested, setBlogSuggested] = useState(false);

  const router = useRouter();

  // Check if the server has a Firecrawl key in .env
  useEffect(() => {
    fetch("/api/has-firecrawl-key")
      .then((res) => res.json())
      .then((data) => setEnvHasKey(data.hasKey))
      .catch(() => {});
  }, []);

  const hasFirecrawlAccess = envHasKey || apiKeyConfirmed;

  // Button says "Build City" if user has a URL, or if no Firecrawl access (go straight).
  // Otherwise says "Next" to trigger the blog lookup.
  const readyToBuild = !hasFirecrawlAccess || websiteUrl.trim() || blogSuggested;
  const buttonText = readyToBuild ? "Build City" : "Next";

  function handleConfirmKey() {
    const key = apiKey.trim();
    if (!key) return;
    setApiKeyConfirmed(true);
  }

  function navigate(trimmedOrg: string) {
    const key = apiKey.trim();
    if (key) {
      sessionStorage.setItem("firecrawl_api_key", key);
    } else {
      sessionStorage.removeItem("firecrawl_api_key");
    }

    const url = normalizeUrl(websiteUrl);
    if (url) {
      sessionStorage.setItem("website_url", url);
    } else {
      sessionStorage.removeItem("website_url");
    }

    router.push(`/city/${encodeURIComponent(trimmedOrg)}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed) return;

    if (!GITHUB_ORG_RE.test(trimmed)) {
      setValidationError(
        "Invalid name. Only letters, numbers, and hyphens allowed (no leading/trailing hyphen)."
      );
      return;
    }

    // Validate website URL if provided
    const url = normalizeUrl(websiteUrl);
    if (url) {
      try {
        new URL(url);
      } catch {
        setValidationError("Invalid website URL.");
        return;
      }
    }

    setValidationError(null);

    // If ready to build (has URL, or no Firecrawl, or already checked blog), navigate.
    if (readyToBuild) {
      navigate(trimmed);
      return;
    }

    // Phase 1: Fetch GitHub profile to check for blog URL
    setSearching(true);
    try {
      const res = await fetch(`/api/github-profile/${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const json = await res.json();
        setValidationError(json.error || "Not found on GitHub.");
        setSearching(false);
        return;
      }

      const profile = await res.json();

      if (profile.blog) {
        // Pre-fill the URL field with the blog
        setWebsiteUrl(normalizeUrl(profile.blog));
        setBlogSuggested(true);
        // Don't navigate yet — let the user confirm
      } else {
        // No blog — go straight to the city
        setBlogSuggested(true);
        navigate(trimmed);
      }
    } catch {
      // On error, just navigate without blog
      navigate(trimmed);
    } finally {
      setSearching(false);
    }
  }

  // Reset blog suggestion when org name changes
  function handleOrgChange(value: string) {
    setOrg(value);
    if (blogSuggested) {
      setBlogSuggested(false);
      setWebsiteUrl("");
    }
  }

  return (
    <div className="landing">
      <h1>FIRECITY</h1>
      <p>
        Enter a GitHub organization or username to generate a city skyline.
        Each building represents a repository. The number of floors
        corresponds to the number of stars.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="e.g. firecrawl"
          value={org}
          onChange={(e) => handleOrgChange(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          disabled={searching}
          className={readyToBuild ? "btn-build" : "btn-next"}
        >
          {searching ? "Searching..." : buttonText}
        </button>
      </form>
      {validationError && (
        <p style={{ color: "#ff6b6b", fontSize: 13 }}>
          {validationError}
        </p>
      )}

      {/* Firecrawl API key section */}
      <div className="api-key-section">
        <div className="api-key-row">
          <input
            type="password"
            placeholder="Firecrawl API key (optional)"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (apiKeyConfirmed) setApiKeyConfirmed(false);
            }}
            className="api-key-input"
          />
          {!envHasKey && apiKey.trim() && !apiKeyConfirmed && (
            <button
              type="button"
              onClick={handleConfirmKey}
              className="confirm-key-btn"
            >
              Confirm
            </button>
          )}
        </div>
        <span className="api-key-hint">
          {envHasKey
            ? "Server key detected. You can override it or leave blank."
            : apiKeyConfirmed
              ? "Key confirmed. You can now add a website URL for branding."
              : "Add a Firecrawl key to enable website branding & screenshots. Get yours at firecrawl.dev"
          }
        </span>
      </div>

      {/* Website URL section — only visible with Firecrawl access */}
      {hasFirecrawlAccess && (
        <div className="website-section">
          {blogSuggested && websiteUrl && (
            <span className="blog-suggestion-hint">Is this your website?</span>
          )}
          <input
            type="url"
            placeholder="Website URL (optional) e.g. https://firecrawl.dev"
            value={websiteUrl}
            onChange={(e) => {
              setWebsiteUrl(e.target.value);
              if (!e.target.value.trim()) setBlogSuggested(false);
            }}
            className="website-input"
          />
          <span className="website-hint">
            Adds branding colors, screenshot billboard, and site info to your city (via Firecrawl)
          </span>
        </div>
      )}
    </div>
  );
}
