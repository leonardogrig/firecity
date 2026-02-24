import { NextRequest, NextResponse } from "next/server";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  if (!GITHUB_NAME_RE.test(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  // Try org first, then user
  const orgRes = await fetch(`https://api.github.com/orgs/${name}`, {
    headers: ghHeaders(),
  });

  if (orgRes.ok) {
    const data = await orgRes.json();
    return NextResponse.json({
      blog: data.blog || "",
      name: data.name || data.login,
      type: "Organization",
    });
  }

  const userRes = await fetch(`https://api.github.com/users/${name}`, {
    headers: ghHeaders(),
  });

  if (userRes.ok) {
    const data = await userRes.json();
    return NextResponse.json({
      blog: data.blog || "",
      name: data.name || data.login,
      type: "User",
    });
  }

  return NextResponse.json(
    { error: `"${name}" not found on GitHub.` },
    { status: 404 }
  );
}
