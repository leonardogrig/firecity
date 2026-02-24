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
  const [blogConfirmed, setBlogConfirmed] = useState(false);

  const router = useRouter();

  // Check if the server has a Firecrawl key in .env
  useEffect(() => {
    fetch("/api/has-firecrawl-key")
      .then((res) => res.json())
      .then((data) => setEnvHasKey(data.hasKey))
      .catch(() => {});
  }, []);

  const hasFirecrawlAccess = envHasKey || apiKeyConfirmed;

  // Blog suggested but user hasn't clicked Yes/No yet — block the button
  const pendingBlogConfirm = blogSuggested && !blogConfirmed;
  // Button says "Build City" when ready, "Next" to trigger the blog lookup
  const readyToBuild = !pendingBlogConfirm && (!hasFirecrawlAccess || websiteUrl.trim() || blogSuggested);
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
      sessionStorage.setItem(`website_url:${trimmedOrg}`, url);
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
      setBlogConfirmed(false);
      setWebsiteUrl("");
    }
  }

  return (
    <div className="landing">
      <a
        href="https://github.com/leonardogrig/firecity"
        target="_blank"
        rel="noopener noreferrer"
        className="github-star"
        aria-label="Star on GitHub"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </a>
      <h1>FIRECITY</h1>
      <p>
        Enter a GitHub organization or username to generate a city skyline.
        Each building represents a repository.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="org-input-wrapper">
          <span className="org-input-prefix">github.com/</span>
          <input
            type="text"
            placeholder="firecrawl"
            value={org}
            onChange={(e) => handleOrgChange(e.target.value)}
            autoFocus
            className="org-input"
          />
        </div>
        <button
          type="submit"
          disabled={searching || pendingBlogConfirm}
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

      {/* Firecrawl API key section — hidden when server key is configured */}
      {!envHasKey && (
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
            {apiKey.trim() && !apiKeyConfirmed && (
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
            {apiKeyConfirmed
              ? "Key confirmed. You can now add a website URL for branding."
              : "Add a Firecrawl key to enable website branding & screenshots. Get yours at firecrawl.dev"
            }
          </span>
        </div>
      )}

      {/* Website URL section — only visible with Firecrawl access */}
      {hasFirecrawlAccess && (
        <div className="website-section">
          {blogSuggested && !blogConfirmed && websiteUrl && (
            <span className="blog-suggestion-hint">
              Is this your website?{" "}
              <button
                type="button"
                className="blog-confirm-link"
                onClick={() => setBlogConfirmed(true)}
              >
                Yes
              </button>
              {" / "}
              <button
                type="button"
                className="blog-confirm-link"
                onClick={() => {
                  setWebsiteUrl("");
                  setBlogSuggested(false);
                  setBlogConfirmed(true);
                }}
              >
                No
              </button>
            </span>
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

      <a
        href="https://firecrawl.dev"
        target="_blank"
        rel="noopener noreferrer"
        className="powered-by"
      >
        powered by firecrawl
      </a>
    </div>
  );
}
