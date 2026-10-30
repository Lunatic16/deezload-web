"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ChevronRight, Download, FileAudio, FileText, Folder, Home, Image as ImageIcon, Loader2, Play, Trash2, X } from "lucide-react";
import { api, formatBytes } from "@/lib/api";
import { useApp } from "@/components/Providers";
import type { LibraryItem } from "@/lib/types";

const AUDIO = new Set(["flac", "mp3"]);

export default function LibraryPage() {
  const { toast, activeCount } = useApp();
  const [path, setPath] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);

  const load = useCallback(async (p: string) => {
    try {
      const r = await api.library(p);
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    setItems(null);
    load(path);
  }, [path, load]);

  // Refresh while downloads are running so new files appear
  useEffect(() => {
    if (activeCount === 0) return;
    const t = setInterval(() => load(path), 5000);
    return () => clearInterval(t);
  }, [activeCount, path, load]);

  const crumbs = path ? path.split("/") : [];

  const remove = async (it: LibraryItem) => {
    if (!confirm(`Delete “${it.name}”${it.type === "dir" ? " and everything in it" : ""}? This cannot be undone.`)) return;
    try {
      await api.deleteLibrary(it.path);
      if (playing?.path === it.path) setPlaying(null);
      toast(`Deleted “${it.name}”`, "ok");
      load(path);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const iconFor = (it: LibraryItem) => {
    if (it.type === "dir") return <Folder className="h-4 w-4 text-accent" />;
    if (AUDIO.has(it.ext)) return <FileAudio className="h-4 w-4 text-violet" />;
    if (["jpg", "jpeg", "png"].includes(it.ext)) return <ImageIcon className="h-4 w-4 text-cyan" />;
    return <FileText className="h-4 w-4 text-mute" />;
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-dim">Everything downloaded so far. Preview, download or zip it from here.</p>
      </header>

      <nav className="flex flex-wrap items-center gap-1 text-sm">
        <button className="flex items-center gap-1 rounded px-1.5 py-1 text-dim hover:bg-card hover:text-fg" onClick={() => setPath("")}>
          <Home className="h-3.5 w-3.5" /> downloads
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-mute" />
            <button
              className="rounded px-1.5 py-1 text-dim hover:bg-card hover:text-fg"
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
            >
              {c}
            </button>
          </span>
        ))}
      </nav>

      {error && <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      <div className="panel divide-y divide-line/40 overflow-hidden">
        {items === null ? (
          <div className="grid place-items-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-mute" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-dim">This folder is empty.</div>
        ) : (
          items.map((it) => (
            <div key={it.path} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-raised/50">
              <span className="shrink-0">{iconFor(it)}</span>
              {it.type === "dir" ? (
                <button className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-accent" onClick={() => setPath(it.path)}>
                  {it.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-fg" title={it.name}>
                  {it.name}
                </span>
              )}
              <span className="hidden w-20 shrink-0 text-right font-mono text-xs text-mute sm:block">
                {it.type === "file" ? formatBytes(it.size) : ""}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {it.type === "file" && AUDIO.has(it.ext) && (
                  <button className="btn-ghost !px-2 !py-1" title="Play" onClick={() => setPlaying(it)}>
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
                {it.type === "file" && (
                  <a className="btn-ghost !px-2 !py-1" title="Download" href={api.fileUrl(it.path)}>
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                {it.type === "dir" && (
                  <a className="btn-ghost !px-2 !py-1" title="Download as zip" href={api.zipUrl(it.path)}>
                    <Archive className="h-3.5 w-3.5" />
                  </a>
                )}
                <button className="btn-danger !px-2 !py-1" title="Delete" onClick={() => remove(it)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {playing && (
        <div className="fixed inset-x-0 bottom-16 z-40 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <FileAudio className="h-5 w-5 shrink-0 text-violet" />
            <span className="hidden min-w-0 max-w-xs truncate text-sm sm:block">{playing.name}</span>
            <audio key={playing.path} className="h-9 min-w-0 flex-1" controls autoPlay src={api.fileUrl(playing.path, true)} />
            <button className="btn-ghost !px-2" onClick={() => setPlaying(null)} title="Close player">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
