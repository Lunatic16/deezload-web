"use client";

import { useState } from "react";
import { Check, Disc3, Download, ListMusic, Loader2, Music, User } from "lucide-react";
import type { Kind, SearchItem } from "@/lib/types";
import { useApp } from "./Providers";

const ICONS: Record<Kind, typeof Music> = {
  track: Music,
  album: Disc3,
  artist: User,
  playlist: ListMusic,
};

const BADGE: Record<Kind, string> = {
  track: "text-cyan",
  album: "text-violet",
  artist: "text-gold",
  playlist: "text-ok",
};

export function ResultCard({ item, quality }: { item: SearchItem; quality: string }) {
  const { activeKeys, enqueue } = useApp();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const Icon = ICONS[item.type];
  const active = activeKeys.has(`${item.type}:${item.id}`);

  const go = async () => {
    setBusy(true);
    await enqueue(item.type, item.id, item.title, quality || undefined);
    setBusy(false);
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  };

  return (
    <div className="panel group flex gap-3 p-3 transition-colors hover:border-line">
      <div
        className={`relative h-20 w-20 shrink-0 overflow-hidden bg-raised ${
          item.type === "artist" ? "rounded-full" : "rounded-lg"
        }`}
      >
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <Icon className="absolute inset-0 m-auto h-7 w-7 text-mute" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider ${BADGE[item.type]}`}>
          <Icon className="h-3 w-3" />
          {item.type}
        </div>
        <div className="truncate text-sm font-semibold text-fg" title={item.title}>
          {item.title}
        </div>
        <div className="truncate text-xs text-dim" title={item.subtitle}>
          {item.subtitle || " "}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <span className="truncate text-[11px] text-mute">{item.meta}</span>
          <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={go} disabled={busy || active}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : sent ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {active ? "In queue" : sent ? "Queued" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
