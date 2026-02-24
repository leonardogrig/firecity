# FireCity

Generate a 3D city skyline from any GitHub organization or user. Each building represents a repository — the more stars, the taller the building.

## Setup

```bash
npm install
cp .env.local.example .env.local  # then fill in your keys
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | No (recommended) | GitHub personal access token. Raises API rate limit from 60 to 5,000 requests/hour. |
| `FIRECRAWL_API_KEY` | No | Firecrawl API key. Only needed for website branding, screenshots, and site info. |
| `REDIS_URL` | No | Redis connection URL. Enables caching and rate limiting. |
| `RATE_LIMIT_BYPASS` | No | Set to `true` to disable per-IP rate limiting during development. |

### Getting a GitHub Token

A token is optional but **strongly recommended** — without one, the GitHub API limits you to 60 requests per hour (shared across all users on the same server IP). With a token you get 5,000 requests/hour.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token** > **Generate new token (classic)**
3. Give it a name (e.g. `firecity`)
4. **No scopes needed** — leave all checkboxes unchecked. Public repo data only requires an unauthenticated or zero-scope token.
5. Click **Generate token**
6. Copy the token and paste it into your `.env.local`:
   ```
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

> **Fine-grained tokens** also work: create one at [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) with **Public Repositories (read-only)** access and no other permissions.

### Getting a Firecrawl API Key

This is only needed if you want website branding (colors, screenshots, site info) in your city.

1. Go to [firecrawl.dev](https://firecrawl.dev) and create an account
2. Navigate to your dashboard and copy your API key
3. Add it to `.env.local`:
   ```
   FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

Users can also provide their own Firecrawl key via the UI — no server key required.
