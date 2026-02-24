import Redis from "ioredis";

const MAX_ORGS = 100;
const CACHE_KEY_PREFIX = "org:cache:";
const ACCESS_SET = "org:access"; // sorted set: member=orgName, score=timestamp
const RATE_PREFIX = "ratelimit:";
const DAILY_LIMIT = 5;

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
    redis.on("error", () => {
      /* swallow – we fall through to GitHub API on failure */
    });
    return redis;
  } catch {
    return null;
  }
}

/**
 * Try to read an org's cached response. Updates its access timestamp on hit.
 */
export async function getCached<T>(org: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const raw = await r.get(`${CACHE_KEY_PREFIX}${org}`);
    if (!raw) return null;

    // Touch the access timestamp so this org stays "recently used"
    await r.zadd(ACCESS_SET, Date.now(), org);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Store an org's response. If we already have MAX_ORGS cached, evict the
 * least-recently-fetched org first.
 */
export async function setCached<T>(org: string, data: T): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    const count = await r.zcard(ACCESS_SET);

    if (count >= MAX_ORGS) {
      // Evict the least-recently-accessed org(s) to make room
      const toEvict = count - MAX_ORGS + 1;
      const victims = await r.zrange(ACCESS_SET, 0, toEvict - 1);
      if (victims.length) {
        const pipeline = r.pipeline();
        for (const v of victims) {
          pipeline.del(`${CACHE_KEY_PREFIX}${v}`);
        }
        pipeline.zrem(ACCESS_SET, ...victims);
        await pipeline.exec();
      }
    }

    // Store the data and record the access timestamp
    await r
      .pipeline()
      .set(`${CACHE_KEY_PREFIX}${org}`, JSON.stringify(data))
      .zadd(ACCESS_SET, Date.now(), org)
      .exec();
  } catch {
    /* best-effort – caller still has the data */
  }
}

// ── Site scrape cache ─────────────────────────────────────────────

const SITE_CACHE_PREFIX = "site:cache:";
const SITE_CACHE_TTL = 86400 * 2; // 2 days

export async function getSiteCached<T>(url: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(`${SITE_CACHE_PREFIX}${url}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setSiteCached<T>(url: string, data: T): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`${SITE_CACHE_PREFIX}${url}`, JSON.stringify(data), "EX", SITE_CACHE_TTL);
  } catch {
    /* best-effort */
  }
}

// ── Rate limiting ──────────────────────────────────────────────────

/**
 * Check if an IP has exceeded the daily request limit.
 * Returns { allowed: true, remaining } or { allowed: false, remaining: 0 }.
 * If Redis is unavailable, requests are allowed (fail-open).
 */
export async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const r = getRedis();
  if (!r) return { allowed: true, remaining: DAILY_LIMIT };

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${RATE_PREFIX}${today}:${ip}`;

  try {
    const count = await r.incr(key);

    // Set expiry on first use — 24h is enough (key naturally becomes irrelevant tomorrow)
    if (count === 1) {
      await r.expire(key, 86400);
    }

    if (count > DAILY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: DAILY_LIMIT - count };
  } catch {
    return { allowed: true, remaining: DAILY_LIMIT };
  }
}
