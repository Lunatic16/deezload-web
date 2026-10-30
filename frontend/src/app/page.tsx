"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Disc3, Link2, ListMusic, Loader2, Music, Search, User } from "lucide-react";
import { api, isDeezerUrl } from "@/lib/api";
import type { Kind, SearchItem } from "@/lib/types";
import { ResultCard } from "@/components/ResultCard";

const TABS: { id: Kind; label: string; icon: typeof Music }[] = [
  { id: "track", label: "Tracks", icon: Music },
  { id: "album", label: "Albums", icon: Disc3 },
  { id: "artist", label: "Artists", icon: User },
  { id: "playlist", label: "Playlists", icon: ListMusic },
];

const QUALITIES = [
  { id: "", label: "Default quality" },
  { id: "FLAC", label: "FLAC" },
  { id: "MP3_320", label: "MP3 320" },
  { id: "MP3_128", label: "MP3 128" },
];

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState<Kind>("track");
  const [quality, setQuality] = useState("");
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromUrl, setFromUrl] = useState(false);
  const reqId = useRef(0);

  const run = async (query: string, kind: Kind) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      if (isDeezerUrl(trimmed)) {
        const item = await api.resolve(trimmed);
        if (id !== reqId.current) return;
        setResults([item]);
        setFromUrl(true);
      } else {
        const r = await api.search(trimmed, kind);
        if (id !== reqId.current) return;
        setResults(r);
        setFromUrl(false);
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setResults(null);
      setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(q, type);
  };

  // Re-run when switching result type (only for text searches already performed)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (results !== null && !fromUrl && q.trim()) run(q, type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const looksLikeUrl = isDeezerUrl(q);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Find music</h1>
        <p className="mt-1 text-sm text-dim">Search Deezer, or paste a track, album, playlist, artist or share link.</p>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          {looksLikeUrl ? (
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
          ) : (
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          )}
          <input
            className="input !py-3 !pl-10 !text-[15px]"
            placeholder="Artist, track, album… or paste a Deezer link"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="btn-primary absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : looksLikeUrl ? "Resolve" : "Search"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-line/60 bg-panel p-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setType(id)}
                disabled={looksLikeUrl}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                  type === id && !looksLikeUrl ? "bg-raised text-fg" : "text-dim hover:text-fg"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <select className="input !w-auto !py-1.5" value={quality} onChange={(e) => setQuality(e.target.value)}>
            {QUALITIES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </form>

      {error && <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      {results !== null && results.length === 0 && !error && (
        <div className="panel px-4 py-10 text-center text-sm text-dim">
          No results. Try another type or a narrower query.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((item) => (
            <ResultCard key={`${item.type}:${item.id}`} item={item} quality={quality} />
          ))}
        </div>
      )}

      {results === null && !error && !loading && (
        <div className="panel grid place-items-center gap-2 px-4 py-14 text-center">
          <Search className="h-8 w-8 text-mute" />
          <p className="text-sm text-dim">Results will show up here.</p>
        </div>
      )}
    </div>
  );
}
