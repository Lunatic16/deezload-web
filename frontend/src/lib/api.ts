import type { Job, Kind, LibraryItem, SearchItem, Settings, Status } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    let msg = r.statusText || `HTTP ${r.status}`;
    try {
      const j = await r.json();
      const d = j.detail ?? j.error;
      if (d) msg = typeof d === "string" ? d : JSON.stringify(d);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export const api = {
  status: () => req<Status>("/status"),
  settings: () => req<Settings>("/settings"),
  saveSettings: (body: Partial<Settings> & { arl?: string }) =>
    req<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
  search: (q: string, type: Kind) =>
    req<SearchItem[]>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  resolve: (url: string) =>
    req<SearchItem>("/resolve", { method: "POST", body: JSON.stringify({ url }) }),
  jobs: () => req<Job[]>("/jobs"),
  createJob: (type: Kind, id: string, quality?: string) =>
    req<Job>("/jobs", { method: "POST", body: JSON.stringify({ type, id, quality: quality || null }) }),
  cancelJob: (id: string) => req<{ ok: boolean }>(`/jobs/${id}`, { method: "DELETE" }),
  clearJobs: () => req<{ removed: number }>("/jobs/clear", { method: "POST" }),
  library: (path: string) =>
    req<{ path: string; items: LibraryItem[] }>(`/library?path=${encodeURIComponent(path)}`),
  deleteLibrary: (path: string) =>
    req<{ ok: boolean }>(`/library?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  fileUrl: (path: string, inline = false) =>
    `/api/library/file?path=${encodeURIComponent(path)}${inline ? "&inline=1" : ""}`,
  zipUrl: (path: string) => `/api/library/zip?path=${encodeURIComponent(path)}`,
};

export function formatBytes(n: number): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function isDeezerUrl(s: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)?(deezer\.com|deezer\.page\.link|link\.deezer\.com)\//i.test(s.trim());
}
