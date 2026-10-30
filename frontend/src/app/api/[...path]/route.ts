import { NextRequest } from "next/server";

// Runtime reverse proxy to the Python backend, so BACKEND_URL can be
// changed without rebuilding the image. Streams bodies (audio, zips).
export const dynamic = "force-dynamic";

const BACKEND = (process.env.BACKEND_URL || "http://backend:8000").replace(/\/$/, "");

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of ["host", "connection", "authorization", "content-length", "accept-encoding"]) {
    headers.delete(h);
  }

  const init: RequestInit = { method: req.method, headers, redirect: "manual", cache: "no-store" };
  if (!["GET", "HEAD"].includes(req.method)) init.body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch {
    return Response.json({ detail: "Backend unreachable" }, { status: 502 });
  }

  const out = new Headers(upstream.headers);
  for (const h of ["content-encoding", "transfer-encoding", "connection"]) out.delete(h);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as HEAD };
