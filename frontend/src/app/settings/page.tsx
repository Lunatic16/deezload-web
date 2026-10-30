"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/components/Providers";
import type { QualityId, Settings } from "@/lib/types";

export default function SettingsPage() {
  const { status, refreshStatus, toast } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [arl, setArl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then(setS).catch((e) => toast((e as Error).message, "error"));
  }, [toast]);

  if (!s) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-mute" />
      </div>
    );
  }

  const patch = (p: Partial<Settings>) => setS({ ...s, ...p });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const next = await api.saveSettings({
        arl: arl.trim() || undefined,
        quality: s.quality,
        min_quality: s.min_quality,
        concurrency: s.concurrency,
        retries: s.retries,
        lyrics: s.lyrics,
      });
      setS(next);
      setArl("");
      toast("Settings saved", "ok");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
      refreshStatus();
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-dim">Stored on the server in the mounted config volume.</p>
      </header>

      <div className="panel flex items-center gap-3 px-4 py-3 text-sm">
        {status?.authenticated ? (
          <>
            <CheckCircle2 className="h-5 w-5 text-ok" />
            <span>
              Connected{status.user ? <> as <b className="font-semibold">{status.user}</b></> : null}
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-5 w-5 text-bad" />
            <span className="text-dim">{status?.error || "Not connected — add your ARL token below."}</span>
          </>
        )}
      </div>

      <form onSubmit={save} className="space-y-6">
        <section className="panel space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-gold" /> Deezer ARL token
          </h2>
          <input
            type="password"
            autoComplete="off"
            className="input font-mono"
            placeholder={s.arl_set ? `Saved (${s.arl_hint}) — paste a new one to replace` : "Paste your arl cookie value"}
            value={arl}
            onChange={(e) => setArl(e.target.value)}
          />
          <p className="text-xs text-mute">
            Log in at deezer.com, then DevTools → Application/Storage → Cookies → <code className="text-dim">arl</code>. It
            grants full access to your account, so keep this UI private (set <code className="text-dim">APP_PASSWORD</code>{" "}
            if it is reachable by others). It is never sent back to the browser.
            {s.arl_from_env && " Currently using the DEEZLOAD_ARL environment variable."}
          </p>
        </section>

        <section className="panel space-y-4 p-5">
          <h2 className="text-sm font-semibold">Downloads</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-dim">Preferred quality</span>
              <select className="input" value={s.quality} onChange={(e) => patch({ quality: e.target.value as QualityId })}>
                <option value="FLAC">FLAC (lossless)</option>
                <option value="MP3_320">MP3 320 kbps</option>
                <option value="MP3_128">MP3 128 kbps</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-dim">Lowest allowed quality</span>
              <select
                className="input"
                value={s.min_quality}
                onChange={(e) => patch({ min_quality: e.target.value as Settings["min_quality"] })}
              >
                <option value="">No floor (fall back to MP3 128)</option>
                <option value="MP3_320">MP3 320 kbps</option>
                <option value="FLAC">FLAC only</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-dim">Parallel tracks (1–8)</span>
              <input
                type="number" min={1} max={8} className="input" value={s.concurrency}
                onChange={(e) => patch({ concurrency: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-dim">Retries per track (1–10)</span>
              <input
                type="number" min={1} max={10} className="input" value={s.retries}
                onChange={(e) => patch({ retries: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox" className="h-4 w-4 accent-[#a238ff]" checked={s.lyrics}
              onChange={(e) => patch({ lyrics: e.target.checked })}
            />
            <span>
              Fetch lyrics <span className="text-mute">(embedded tags + .lrc sidecar when synced)</span>
            </span>
          </label>
        </section>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
        </button>
      </form>
    </div>
  );
}
