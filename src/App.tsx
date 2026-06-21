import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type RecorderState = "idle" | "starting" | "recording" | "stopping" | "failed";

interface CaptureSource {
  id: string;
  kind: "monitor" | "window";
  name: string;
  processName?: string;
  width: number;
  height: number;
  refreshRate?: number;
}

interface CaptureTelemetry {
  state: RecorderState;
  sourceName?: string;
  encoderName?: string;
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  framesEncoded: number;
  droppedFrames: number;
  bufferedSeconds: number;
  segmentCount: number;
  bufferBytes: number;
  lastError?: string;
}

interface ClipRecord {
  id: string;
  path: string;
  createdAt: string;
  durationSeconds: number;
  width: number;
  height: number;
  favorite: boolean;
}

const idleTelemetry: CaptureTelemetry = {
  state: "idle",
  width: 0,
  height: 0,
  frameRate: 0,
  bitrate: 0,
  framesEncoded: 0,
  droppedFrames: 0,
  bufferedSeconds: 0,
  segmentCount: 0,
  bufferBytes: 0,
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getClipName(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.mp4$/i, "") || "Untitled clip";
}

function formatRelativeDate(value: string) {
  const created = new Date(value);
  const diffMinutes = Math.max(0, Math.round((Date.now() - created.getTime()) / 60_000));

  if (Number.isNaN(created.getTime())) return "Unknown date";
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function App() {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [telemetry, setTelemetry] = useState(idleTelemetry);
  const [sourceId, setSourceId] = useState("");
  const [bufferSeconds, setBufferSeconds] = useState(60);
  const [bitrateMbps, setBitrateMbps] = useState(20);
  const [captureCursor, setCaptureCursor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const active = telemetry.state === "recording" || telemetry.state === "starting";
  const latestClip = clips[0];
  const selectedSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);

  const refreshStatus = useCallback(async () => {
    try {
      setTelemetry(await invoke<CaptureTelemetry>("get_capture_status"));
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  const refreshClips = useCallback(async () => {
    try {
      setClips(await invoke<ClipRecord[]>("list_clips"));
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  const saveReplay = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);

    try {
      const clip = await invoke<ClipRecord>("save_replay", { request: { durationSeconds: bufferSeconds } });
      setNotice(`Saved ${formatDuration(clip.durationSeconds)} locally.`);
      await refreshClips();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [bufferSeconds, refreshClips]);

  const toggleReplay = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);

    try {
      if (active) {
        await invoke("stop_replay");
        setNotice("Replay stopped.");
      } else {
        await invoke("start_replay", {
          config: {
            sourceId,
            bufferSeconds,
            segmentSeconds: 5,
            bitrate: bitrateMbps * 1_000_000,
            frameRate: selectedSource?.refreshRate ?? 60,
            captureCursor,
          },
        });
        setNotice(`Replay armed for last ${bufferSeconds}s.`);
      }

      await refreshStatus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [active, bitrateMbps, bufferSeconds, captureCursor, refreshStatus, selectedSource?.refreshRate, sourceId]);

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setNotice("Clip path copied.");
    } catch (reason) {
      setError(`Could not copy path: ${String(reason)}`);
    }
  }

  useEffect(() => {
    invoke<CaptureSource[]>("list_capture_sources")
      .then((nextSources) => {
        setSources(nextSources);
        setSourceId(nextSources.find((source) => source.kind === "monitor")?.id ?? nextSources[0]?.id ?? "");
      })
      .catch((reason) => setError(String(reason)));

    void refreshClips();
    void refreshStatus();

    const timer = window.setInterval(refreshStatus, 1000);
    const unlistenSave = listen("vlyp://save-replay", saveReplay);
    const unlistenToggle = listen("vlyp://toggle-replay", toggleReplay);

    return () => {
      window.clearInterval(timer);
      void unlistenSave.then((dispose) => dispose());
      void unlistenToggle.then((dispose) => dispose());
    };
  }, [refreshClips, refreshStatus, saveReplay, toggleReplay]);

  return (
    <main className="app">
      <section className="card">
        <header className="topbar">
          <div>
            <div className="logo-row">
              <img src="/vlyp-icon.png" alt="" />
              <span>VLYP</span>
            </div>
            <p>Local replay recorder</p>
          </div>

          <div className={`status ${telemetry.state}`}>
            <i />
            <span>{active ? "Replay Armed" : telemetry.state}</span>
          </div>
        </header>

        <section className="hero">
          <p className="eyebrow">ONE PAGE V1</p>
          <h1>Save the moment. Keep it local.</h1>
          <p className="subtitle">Pick a source, arm replay, then save the last few seconds with one click or Ctrl + Shift + F10.</p>
        </section>

        <section className="controls">
          <label>
            Source
            <select value={sourceId} disabled={active} onChange={(event) => setSourceId(event.target.value)}>
              {sources.length === 0 ? (
                <option value="">No source found</option>
              ) : sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.kind === "monitor" ? "Display" : source.processName ?? "Window"} · {source.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Replay Length
            <select value={bufferSeconds} disabled={active} onChange={(event) => setBufferSeconds(Number(event.target.value))}>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>

          <label>
            Quality
            <select value={bitrateMbps} disabled={active} onChange={(event) => setBitrateMbps(Number(event.target.value))}>
              <option value={10}>Small · 10 Mbps</option>
              <option value={20}>Balanced · 20 Mbps</option>
              <option value={35}>High · 35 Mbps</option>
              <option value={60}>Max · 60 Mbps</option>
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={captureCursor} disabled={active} onChange={(event) => setCaptureCursor(event.target.checked)} />
            Capture cursor
          </label>
        </section>

        <section className="actions">
          <button className={active ? "danger" : "primary"} disabled={busy || !sourceId} onClick={toggleReplay} type="button">
            {active ? "Stop Replay" : "Start Replay"}
          </button>
          <button disabled={busy || !active || telemetry.segmentCount === 0} onClick={saveReplay} type="button">
            Save Last {bufferSeconds}s
          </button>
          <div className="hotkey">CTRL + SHIFT + F10</div>
        </section>

        {(error || telemetry.lastError || notice) && (
          <div className={error || telemetry.lastError ? "message error" : "message"}>
            <span>{error ?? telemetry.lastError ?? notice}</span>
            <button onClick={() => { setError(undefined); setNotice(undefined); }} type="button">Dismiss</button>
          </div>
        )}

        <footer className="bottom">
          <div>
            <span>Buffer</span>
            <strong>{telemetry.bufferedSeconds.toFixed(1)}s</strong>
          </div>
          <div>
            <span>FPS</span>
            <strong>{telemetry.frameRate.toFixed(1)}</strong>
          </div>
          <div>
            <span>Size</span>
            <strong>{formatBytes(telemetry.bufferBytes)}</strong>
          </div>
          <div className="latest">
            <span>Latest Clip</span>
            {latestClip ? (
              <button onClick={() => void copyPath(latestClip.path)} type="button">
                {getClipName(latestClip.path)} · {formatRelativeDate(latestClip.createdAt)}
              </button>
            ) : (
              <strong>No clips yet</strong>
            )}
          </div>
        </footer>
      </section>
    </main>
  );
}

export default App;
