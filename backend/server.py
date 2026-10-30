#!/usr/bin/env python3
"""
Deezload Web — FastAPI backend.

Wraps the unmodified deezload.py (DeezerDownloader) with a JSON API:
search / resolve / job queue with per-track progress / library / settings.
"""

import copy
import json
import os
import queue
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

import deezload
from deezload import (
    AudioQuality,
    DeezerDownloader,
    extract_id_and_type,
    resolve_deezer_url,
    sanitise_filename,
)

DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", "/downloads")).resolve()
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config")).resolve()
SETTINGS_FILE = CONFIG_DIR / "settings.json"
DZ_API = "https://api.deezer.com"
KINDS = ("track", "album", "artist", "playlist")

DEFAULTS: Dict[str, Any] = {
    "arl": "",
    "quality": "FLAC",
    "min_quality": "",
    "concurrency": 2,
    "retries": 3,
    "lyrics": True,
}


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
_settings_lock = threading.Lock()


def load_settings() -> Dict[str, Any]:
    data = dict(DEFAULTS)
    with _settings_lock:
        if SETTINGS_FILE.exists():
            try:
                data.update(json.loads(SETTINGS_FILE.read_text()))
            except Exception:
                pass
    if not data.get("arl"):
        data["arl"] = os.environ.get("DEEZLOAD_ARL", "")
    return data


def save_settings(data: Dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with _settings_lock:
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)
        tmp.replace(SETTINGS_FILE)


class AuthError(Exception):
    pass


class JobCancelled(Exception):
    pass


# --------------------------------------------------------------------------- #
# Downloader manager (cached, authenticated DeezerDownloader instances)
# --------------------------------------------------------------------------- #
class Manager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cache: Dict[tuple, DeezerDownloader] = {}
        self.user: Optional[str] = None

    def get(self, quality: Optional[str] = None) -> DeezerDownloader:
        s = load_settings()
        if not s["arl"]:
            raise AuthError("No ARL token configured — add one in Settings.")
        q = quality or s["quality"]
        key = (s["arl"], q, s["min_quality"], int(s["retries"]), bool(s["lyrics"]))
        with self.lock:
            dl = self.cache.get(key)
            if dl:
                return dl
            dl = DeezerDownloader(
                s["arl"],
                AudioQuality(q),
                concurrency=1,
                min_quality=AudioQuality(s["min_quality"]) if s["min_quality"] else None,
                max_retries=int(s["retries"]),
                fetch_lyrics=bool(s["lyrics"]),
            )
            if not dl.authenticate():
                raise AuthError("Deezer authentication failed — the ARL token may be expired.")
            try:
                self.user = str((dl.client.current_user or {}).get("name") or "")
            except Exception:
                self.user = None
            if len(self.cache) >= 4:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = dl
            return dl

    def reset(self) -> None:
        with self.lock:
            self.cache.clear()
            self.user = None


mgr = Manager()


# --------------------------------------------------------------------------- #
# Deezer public API helpers
# --------------------------------------------------------------------------- #
def dz(path: str, **params: Any) -> Dict[str, Any]:
    url = path if path.startswith("http") else f"{DZ_API}/{path.lstrip('/')}"
    r = requests.get(url, params=params or None, timeout=(10, 20))
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        raise ValueError(str(data["error"].get("message") or data["error"]))
    return data


def dz_paged(path: str, limit: int = 100, max_items: int = 5000) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    url: Optional[str] = f"{DZ_API}/{path.lstrip('/')}?limit={limit}"
    while url and len(items) < max_items:
        data = dz(url)
        items.extend(data.get("data", []))
        url = data.get("next")
    return items


def fmt_duration(sec: Any) -> str:
    try:
        sec = int(sec)
    except Exception:
        return ""
    return f"{sec // 60}:{sec % 60:02d}"


def normalise(o: Dict[str, Any], kind: str) -> Dict[str, Any]:
    if kind == "track":
        album = o.get("album") or {}
        return {
            "id": str(o.get("id")),
            "type": kind,
            "title": o.get("title") or "Unknown",
            "subtitle": " · ".join(x for x in [(o.get("artist") or {}).get("name"), album.get("title")] if x),
            "cover": album.get("cover_medium") or album.get("cover"),
            "meta": " ".join(x for x in [fmt_duration(o.get("duration")), "· explicit" if o.get("explicit_lyrics") else ""] if x),
        }
    if kind == "album":
        n = o.get("nb_tracks")
        return {
            "id": str(o.get("id")),
            "type": kind,
            "title": o.get("title") or "Unknown",
            "subtitle": (o.get("artist") or {}).get("name") or "",
            "cover": o.get("cover_medium") or o.get("cover"),
            "meta": f"{n} tracks" if n else "",
        }
    if kind == "artist":
        fans, albums = o.get("nb_fan"), o.get("nb_album")
        return {
            "id": str(o.get("id")),
            "type": kind,
            "title": o.get("name") or "Unknown",
            "subtitle": f"{fans:,} fans" if isinstance(fans, int) else "",
            "cover": o.get("picture_medium") or o.get("picture"),
            "meta": f"{albums} albums" if albums else "",
        }
    n = o.get("nb_tracks")
    owner = (o.get("user") or o.get("creator") or {}).get("name") or ""
    return {
        "id": str(o.get("id")),
        "type": "playlist",
        "title": o.get("title") or "Unknown",
        "subtitle": f"by {owner}" if owner else "",
        "cover": o.get("picture_medium") or o.get("picture"),
        "meta": f"{n} tracks" if n else "",
    }


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #
JOBS: Dict[str, Dict[str, Any]] = {}
ORDER: List[str] = []
CANCEL: Dict[str, threading.Event] = {}
JLOCK = threading.RLock()
JQ: "queue.Queue[str]" = queue.Queue()


def now() -> float:
    return time.time()


def new_track_state(t: Dict[str, Any], album: str = "") -> Dict[str, Any]:
    return {
        "id": str(t.get("id")),
        "title": t.get("title") or str(t.get("id")),
        "artist": (t.get("artist") or {}).get("name") or "",
        "album": album,
        "status": "queued",
        "pct": 0.0,
        "format": None,
        "fallback": False,
        "error": None,
    }


def album_tracks(dl: DeezerDownloader, album_id: str) -> List[Dict[str, Any]]:
    try:
        resp = dl.client.api.get_album_tracks(album_id)
        data = (resp or {}).get("data", []) if isinstance(resp, dict) else []
        if data:
            return data
    except Exception:
        pass
    return dz_paged(f"album/{album_id}/tracks")


def album_group(dl: DeezerDownloader, album: Dict[str, Any], root: Path,
                artist_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return one group (or one per disc) of work items for an album."""
    album_id = str(album["id"])
    meta = album if album.get("cover_xl") and album.get("artist") else dz(f"album/{album_id}")
    title = meta.get("title") or "Unknown Album"
    artist = artist_name or (meta.get("artist") or {}).get("name") or "Unknown Artist"
    album_dir = root / f"{sanitise_filename(artist)} - {sanitise_filename(title)}"
    cover = meta.get("cover_xl") or meta.get("cover_big") or meta.get("cover_medium")

    tracks = album_tracks(dl, album_id)
    nums = [t.get("track_position", i + 1) for i, t in enumerate(tracks)]
    discs = [t.get("disk_number", 1) or 1 for t in tracks]
    multi = (max(discs) if discs else 1) > 1

    groups: Dict[int, Dict[str, Any]] = {}
    for t, n, d in zip(tracks, nums, discs):
        key = d if multi else 1
        g = groups.setdefault(key, {
            "dir": album_dir / f"Disc {d}" if multi else album_dir,
            "cover_dir": album_dir,
            "cover_url": cover,
            "items": [],
        })
        g["items"].append({"track": t, "num": n, "disc": d, "album": title})
    return [groups[k] for k in sorted(groups)]


def build_groups(dl: DeezerDownloader, job: Dict[str, Any]) -> List[Dict[str, Any]]:
    kind, cid = job["type"], job["content_id"]
    if kind == "track":
        t = dz(f"track/{cid}")
        with JLOCK:
            job["title"] = t.get("title") or job["title"]
            job["subtitle"] = (t.get("artist") or {}).get("name") or job["subtitle"]
            job["cover"] = (t.get("album") or {}).get("cover_medium") or job["cover"]
        return [{"dir": DOWNLOAD_DIR, "cover_dir": None, "cover_url": None,
                 "items": [{"track": t, "num": None, "disc": None, "album": (t.get("album") or {}).get("title", "")}]}]

    if kind == "playlist":
        meta = dz(f"playlist/{cid}")
        title = meta.get("title") or f"Playlist {cid}"
        with JLOCK:
            job["title"] = title
            job["cover"] = meta.get("picture_medium") or job["cover"]
        tracks = dz_paged(f"playlist/{cid}/tracks")
        return [{"dir": DOWNLOAD_DIR / f"Playlist - {sanitise_filename(title)}", "cover_dir": None, "cover_url": None,
                 "items": [{"track": t, "num": None, "disc": None, "album": ""} for t in tracks]}]

    if kind == "album":
        meta = dz(f"album/{cid}")
        with JLOCK:
            job["title"] = meta.get("title") or job["title"]
            job["subtitle"] = (meta.get("artist") or {}).get("name") or job["subtitle"]
            job["cover"] = meta.get("cover_medium") or job["cover"]
        return album_group(dl, meta, DOWNLOAD_DIR)

    # artist
    meta = dz(f"artist/{cid}")
    artist = meta.get("name") or f"Artist {cid}"
    with JLOCK:
        job["title"] = artist
        job["cover"] = meta.get("picture_medium") or job["cover"]
    albums = dz_paged(f"artist/{cid}/albums")
    groups: List[Dict[str, Any]] = []
    for a in albums:
        if JOBS_CANCEL_REQUESTED(job):
            raise JobCancelled()
        try:
            groups.extend(album_group(dl, a, DOWNLOAD_DIR, artist_name=artist))
        except Exception as e:  # one bad album shouldn't kill the discography
            deezload.log(f"Skipping album {a.get('id')}: {e}", level="warn")
    return groups


def JOBS_CANCEL_REQUESTED(job: Dict[str, Any]) -> bool:
    ev = CANCEL.get(job["id"])
    return bool(ev and ev.is_set())


def run_job(job: Dict[str, Any]) -> None:
    jid = job["id"]
    ev = CANCEL[jid]
    with JLOCK:
        job.update(status="running", started=now())

    dl = mgr.get(job.get("quality"))
    groups = build_groups(dl, job)

    # Flatten into track states + work items
    work: List[Dict[str, Any]] = []
    states: List[Dict[str, Any]] = []
    for g in groups:
        for it in g["items"]:
            st = new_track_state(it["track"], it.get("album", ""))
            states.append(st)
            work.append({"state": st, "group": g, **it})
    with JLOCK:
        job["tracks"] = states
    if not work:
        raise RuntimeError("Nothing to download (no tracks found).")

    requested = AudioQuality(job.get("quality") or load_settings()["quality"])
    conc = max(1, min(8, int(load_settings()["concurrency"])))

    covers_done = set()

    def ensure_cover(g: Dict[str, Any]) -> None:
        cdir, url = g.get("cover_dir"), g.get("cover_url")
        if not cdir or not url or str(cdir) in covers_done:
            return
        covers_done.add(str(cdir))
        try:
            cdir.mkdir(parents=True, exist_ok=True)
            cp = cdir / "Cover.jpg"
            if not cp.exists():
                data = dl.download_cover_art(url)
                if data:
                    cp.write_bytes(data)
        except Exception as e:
            deezload.log(f"Cover.jpg failed: {e}", level="debug")

    def do(w: Dict[str, Any]) -> None:
        st = w["state"]
        if ev.is_set():
            with JLOCK:
                st["status"] = "cancelled"
            return
        with JLOCK:
            st["status"] = "downloading"
        ensure_cover(w["group"])
        last = {"p": -1.0}

        def cb(pct: float) -> None:
            if ev.is_set():
                raise JobCancelled()
            if pct - last["p"] >= 1 or pct >= 100:
                last["p"] = pct
                with JLOCK:
                    st["pct"] = round(pct, 1)

        try:
            path = dl.download_track(
                st["id"], str(w["group"]["dir"]),
                track_num=w.get("num"), disc_num=w.get("disc"),
                progress_cb=cb,
            )
        except Exception as e:
            path, st["error"] = None, str(e)

        with JLOCK:
            if ev.is_set() and not path:
                st["status"] = "cancelled"
            elif path:
                ext = Path(path).suffix.lower()
                st.update(status="done", pct=100.0, format="FLAC" if ext == ".flac" else "MP3")
                # Only detectable via file type: FLAC requested but an MP3 came back
                st["fallback"] = requested == AudioQuality.FLAC and ext != ".flac"
            else:
                st["status"] = "failed"
                st["error"] = st["error"] or "Download failed (see server logs)"

    with ThreadPoolExecutor(max_workers=conc) as ex:
        list(ex.map(do, work))

    with JLOCK:
        done = sum(1 for s in states if s["status"] == "done")
        failed = sum(1 for s in states if s["status"] == "failed")
        if ev.is_set():
            job["status"] = "cancelled"
        elif failed == 0:
            job["status"] = "done"
        elif done == 0:
            job["status"] = "failed"
        else:
            job["status"] = "partial"
        job["finished"] = now()


def worker() -> None:
    while True:
        jid = JQ.get()
        job = JOBS.get(jid)
        if not job or job["status"] != "queued":
            continue
        try:
            run_job(job)
        except JobCancelled:
            with JLOCK:
                job.update(status="cancelled", finished=now())
        except AuthError as e:
            with JLOCK:
                job.update(status="failed", error=str(e), finished=now())
        except Exception as e:
            deezload.log(f"Job {jid} crashed: {e}", level="error")
            with JLOCK:
                job.update(status="failed", error=str(e), finished=now())


@asynccontextmanager
async def lifespan(_: FastAPI):
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=worker, daemon=True, name="job-worker").start()
    yield


app = FastAPI(title="Deezload Web", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class SettingsUpdate(BaseModel):
    arl: Optional[str] = None
    quality: Optional[str] = None
    min_quality: Optional[str] = None
    concurrency: Optional[int] = None
    retries: Optional[int] = None
    lyrics: Optional[bool] = None


class ResolveBody(BaseModel):
    url: str


class JobBody(BaseModel):
    type: str
    id: str
    quality: Optional[str] = None


# --------------------------------------------------------------------------- #
# Routes — status / settings
# --------------------------------------------------------------------------- #
def public_settings() -> Dict[str, Any]:
    s = load_settings()
    arl = s.pop("arl", "")
    s["arl_set"] = bool(arl)
    s["arl_hint"] = f"••••{arl[-4:]}" if len(arl) >= 8 else ""
    env_arl = os.environ.get("DEEZLOAD_ARL", "")
    s["arl_from_env"] = bool(env_arl) and arl == env_arl
    return s


@app.get("/api/health")
def health() -> Dict[str, bool]:
    return {"ok": True}


@app.get("/api/status")
def status() -> Dict[str, Any]:
    s = load_settings()
    out: Dict[str, Any] = {"configured": bool(s["arl"]), "authenticated": False, "user": None, "error": None}
    if not s["arl"]:
        return out
    try:
        mgr.get()
        out.update(authenticated=True, user=mgr.user)
    except AuthError as e:
        out["error"] = str(e)
    except Exception as e:
        out["error"] = f"Could not reach Deezer: {e}"
    return out


@app.get("/api/settings")
def get_settings() -> Dict[str, Any]:
    return public_settings()


@app.put("/api/settings")
def put_settings(body: SettingsUpdate) -> Dict[str, Any]:
    s = load_settings()
    if body.quality is not None:
        if body.quality not in [q.value for q in AudioQuality]:
            raise HTTPException(400, "Invalid quality")
        s["quality"] = body.quality
    if body.min_quality is not None:
        if body.min_quality and body.min_quality not in [q.value for q in AudioQuality]:
            raise HTTPException(400, "Invalid minimum quality")
        s["min_quality"] = body.min_quality
    if body.concurrency is not None:
        s["concurrency"] = max(1, min(8, body.concurrency))
    if body.retries is not None:
        s["retries"] = max(1, min(10, body.retries))
    if body.lyrics is not None:
        s["lyrics"] = body.lyrics
    if body.arl is not None and body.arl.strip():
        s["arl"] = body.arl.strip()
    save_settings(s)
    mgr.reset()
    if body.arl is not None and body.arl.strip():
        try:
            mgr.get()
        except AuthError as e:
            raise HTTPException(400, f"Settings saved, but: {e}")
    return public_settings()


# --------------------------------------------------------------------------- #
# Routes — search / resolve
# --------------------------------------------------------------------------- #
@app.get("/api/search")
def search(q: str = Query(..., min_length=1), type: str = "track", limit: int = 24) -> List[Dict[str, Any]]:
    if type not in KINDS:
        raise HTTPException(400, "Invalid type")
    try:
        data = dz(f"search/{type}", q=q, limit=max(1, min(50, limit)))
    except Exception as e:
        raise HTTPException(502, f"Deezer search failed: {e}")
    return [normalise(o, type) for o in data.get("data", [])]


@app.post("/api/resolve")
def resolve(body: ResolveBody) -> Dict[str, Any]:
    url = resolve_deezer_url(body.url.strip())
    cid, kind = extract_id_and_type(url)
    if not cid or not kind:
        raise HTTPException(400, "Could not recognise that as a Deezer track, album, playlist or artist link.")
    try:
        return normalise(dz(f"{kind}/{cid}"), kind)
    except Exception as e:
        raise HTTPException(404, f"Not found on Deezer: {e}")


# --------------------------------------------------------------------------- #
# Routes — jobs
# --------------------------------------------------------------------------- #
@app.post("/api/jobs")
def create_job(body: JobBody) -> Dict[str, Any]:
    if body.type not in KINDS:
        raise HTTPException(400, "Invalid type")
    if body.quality and body.quality not in [q.value for q in AudioQuality]:
        raise HTTPException(400, "Invalid quality")
    s = load_settings()
    if not s["arl"]:
        raise HTTPException(400, "No ARL token configured — add one in Settings.")

    # Light metadata lookup so the queue shows something meaningful immediately
    title, subtitle, cover = f"{body.type} {body.id}", "", None
    try:
        n = normalise(dz(f"{body.type}/{body.id}"), body.type)
        title, subtitle, cover = n["title"], n["subtitle"], n["cover"]
    except Exception:
        pass

    jid = uuid.uuid4().hex[:10]
    job = {
        "id": jid, "type": body.type, "content_id": body.id,
        "title": title, "subtitle": subtitle, "cover": cover,
        "quality": body.quality or s["quality"],
        "status": "queued", "error": None, "tracks": [],
        "created": now(), "started": None, "finished": None,
    }
    with JLOCK:
        JOBS[jid] = job
        ORDER.append(jid)
        CANCEL[jid] = threading.Event()
    JQ.put(jid)
    return copy.deepcopy(job)


@app.get("/api/jobs")
def list_jobs() -> List[Dict[str, Any]]:
    with JLOCK:
        return [copy.deepcopy(JOBS[j]) for j in reversed(ORDER) if j in JOBS]


@app.delete("/api/jobs/{jid}")
def cancel_job(jid: str) -> Dict[str, bool]:
    with JLOCK:
        job = JOBS.get(jid)
        if not job:
            raise HTTPException(404, "No such job")
        if job["status"] == "queued":
            job.update(status="cancelled", finished=now())
        elif job["status"] == "running":
            CANCEL[jid].set()
    return {"ok": True}


@app.post("/api/jobs/clear")
def clear_jobs() -> Dict[str, int]:
    removed = 0
    with JLOCK:
        for jid in list(ORDER):
            if JOBS[jid]["status"] not in ("queued", "running"):
                ORDER.remove(jid)
                JOBS.pop(jid, None)
                CANCEL.pop(jid, None)
                removed += 1
    return {"removed": removed}


# --------------------------------------------------------------------------- #
# Routes — library
# --------------------------------------------------------------------------- #
def safe_path(rel: str) -> Path:
    p = (DOWNLOAD_DIR / rel.lstrip("/")).resolve()
    if p != DOWNLOAD_DIR and not p.is_relative_to(DOWNLOAD_DIR):
        raise HTTPException(400, "Invalid path")
    return p


@app.get("/api/library")
def library(path: str = "") -> Dict[str, Any]:
    d = safe_path(path)
    if not d.exists():
        return {"path": path, "items": []}
    if not d.is_dir():
        raise HTTPException(400, "Not a directory")
    items = []
    for c in sorted(d.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        if c.name.startswith(".") or c.name.endswith(".part"):
            continue
        st = c.stat()
        items.append({
            "name": c.name,
            "path": c.relative_to(DOWNLOAD_DIR).as_posix(),
            "type": "dir" if c.is_dir() else "file",
            "size": 0 if c.is_dir() else st.st_size,
            "mtime": st.st_mtime,
            "ext": c.suffix.lower().lstrip("."),
        })
    return {"path": d.relative_to(DOWNLOAD_DIR).as_posix() if d != DOWNLOAD_DIR else "", "items": items}


@app.get("/api/library/file")
def library_file(path: str, inline: bool = False) -> FileResponse:
    f = safe_path(path)
    if not f.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(f, filename=f.name, content_disposition_type="inline" if inline else "attachment")


@app.get("/api/library/zip")
def library_zip(path: str, bg: BackgroundTasks) -> FileResponse:
    d = safe_path(path)
    if d == DOWNLOAD_DIR or not d.is_dir():
        raise HTTPException(400, "Choose a folder inside the library")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as z:
        for f in sorted(d.rglob("*")):
            if f.is_file() and not f.name.endswith(".part"):
                z.write(f, f.relative_to(d.parent).as_posix())
    bg.add_task(os.unlink, tmp.name)
    return FileResponse(tmp.name, filename=f"{d.name}.zip", media_type="application/zip")


@app.delete("/api/library")
def library_delete(path: str) -> Dict[str, bool]:
    import shutil
    p = safe_path(path)
    if p == DOWNLOAD_DIR:
        raise HTTPException(400, "Refusing to delete the library root")
    if not p.exists():
        raise HTTPException(404, "Not found")
    shutil.rmtree(p) if p.is_dir() else p.unlink()
    return {"ok": True}
