"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [org, setOrg] = useState("");
  const [apiKey, setApiKey] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = org.trim();
    if (!trimmed) return;

    // Store the user's API key in sessionStorage so the city page can read it
    const key = apiKey.trim();
    if (key) {
      sessionStorage.setItem("firecrawl_api_key", key);
    } else {
      sessionStorage.removeItem("firecrawl_api_key");
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
          placeholder="e.g. firecrawl"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          autoFocus
        />
        <button type="submit">Build City</button>
      </form>
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
