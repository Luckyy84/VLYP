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

interface EncoderCapability {
  id: string;
  name: string;
  codec: string;
  hardwarePreferred: boolean;
  available: boolean;
  note: string;
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

const navItems = ["Home", "Clips", "Replay", "Trim", "Compress"];

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getClipName(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.mp4$/i, "") || "Untitled clip";
}

function formatRelativeDate(value: string) {
  const created = new Date(value);
  const diffMs = Date.now() - created.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (Number.isNaN(created.getTime())) return "Unknown date";
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function App() {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [encoders, setEncoders] = useState<EncoderCapability[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [telemetry, setTelemetry] = useState(idleTelemetry);
  const [sourceId, setSourceId] = useState("");
  const [bufferSeconds, setBufferSeconds] = useState(60);
  const [bitrateMbps, setBitrateMbps] = useState(20);
  const [captureCursor, setCaptureCursor] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const refreshStatus = useCallback(async () => {
    try {
      setTelemetry(await invoke<CaptureTelemetry>("get_capture_status"));
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  const refreshClips = useCallback(async () => {
    setClips(await invoke<ClipRecord[]>("list_clips"));
  }, []);

  const saveReplay = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);

    try {
      const clip = await invoke<ClipRecord>("save_replay", { request: { durationSeconds: bufferSeconds } });
      setNotice(`Saved ${formatDuration(clip.durationSeconds)} replay locally.`);
      await refreshClips();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [bufferSeconds, refreshClips]);

  useEffect(() => {
    Promise.all([
      invoke<CaptureSource[]>("list_capture_sources"),
      invoke<EncoderCapability[]>("list_encoder_capabilities"),
      refreshClips(),
    ])
      .then(([nextSources, nextEncoders]) => {
        setSources(nextSources);
        setEncoders(nextEncoders);
        setSourceId(nextSources.find((source) => source.kind === "monitor")?.id ?? nextSources[0]?.id ?? "");
      })
      .catch((reason) => setError(String(reason)));

    void refreshStatus();

    const timer = window.setInterval(refreshStatus, 1000);
    const unlisten = listen("vlyp://save-replay", saveReplay);

    return () => {
      window.clearInterval(timer);
      void unlisten.then((dispose) => dispose());
    };
  }, [refreshClips, refreshStatus, saveReplay]);

  const active = telemetry.state === "recording" || telemetry.state === "starting";
  const selectedSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);

  const filteredClips = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return clips;
    return clips.filter((clip) => getClipName(clip.path).toLowerCase().includes(query));
  }, [clips, searchTerm]);

  const availableEncoders = useMemo(() => encoders.filter((encoder) => encoder.available), [encoders]);

  const totalClipTime = useMemo(
    () => clips.reduce((total, clip) => total + clip.durationSeconds, 0),
    [clips],
  );

  async function toggleReplay() {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);

    try {
      if (active) {
        await invoke("stop_replay");
        setNotice("Replay buffer stopped.");
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
        setNotice(`Replay buffer armed for last ${bufferSeconds}s.`);
      }

      await refreshStatus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setNotice("Clip path copied.");
    } catch (reason) {
      setError(`Could not copy path: ${String(reason)}`);
    }
  }

  return (
    <main className="vlyp-shell">
      <aside className="rail" aria-label="VLYP navigation">
        <div className="rail-logo"><img src="/vlyp-icon.png" alt="" /></div>
        <nav>
          {navItems.map((item) => (
            <button className={item === "Clips" ? "active" : ""} key={item} title={item} type="button">
              <span>{item.slice(0, 1)}</span>
            </button>
          ))}
        </nav>
        <div className="rail-meter" title="Replay buffer size">
          <i style={{ height: `${Math.min(100, telemetry.bufferedSeconds)}%` }} />
          <span>{formatBytes(telemetry.bufferBytes)}</span>
        </div>
        <button className="rail-ghost" title="Settings" type="button">⚙</button>
      </aside>

      <section className="workspace">
        <header className="command-bar">
          <div className="brand-block">
            <div className="brand-title">VLYP</div>
            <div className="brand-subtitle">Local clip library</div>
          </div>

          <div className="hotkey-strip" aria-label="Hotkeys">
            <div>
              <strong>Now Clipping</strong>
              <span><kbd>CTRL</kbd><kbd>SHIFT</kbd><kbd>F10</kbd> Save last {bufferSeconds}s</span>
            </div>
            <div>
              <strong>Screen Recording</strong>
              <span><kbd>V1</kbd><kbd>LOCAL</kbd> Replay buffer</span>
            </div>
          </div>

          <div className={`record-state ${telemetry.state}`}>
            <i />
            <span>{telemetry.state}</span>
          </div>
        </header>

        <div className="tool-row">
          <button type="button" disabled>Import</button>
          <button className={active ? "danger" : "primary"} disabled={busy || !sourceId} onClick={toggleReplay} type="button">
            {active ? "Stop Replay" : "Start Replay"}
          </button>
          <button disabled={busy || !active || telemetry.segmentCount === 0} onClick={saveReplay} type="button">
            Save Last {bufferSeconds}s
          </button>
          <button type="button" disabled>Open Clips Folder</button>
          <div className="spacer" />
          <span className="clip-count">{filteredClips.length} Clips</span>
          <input
            aria-label="Search clips"
            className="search"
            placeholder="Search local clips"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        {(error || telemetry.lastError || notice) && (
          <div className={error || telemetry.lastError ? "message error" : "message"}>
            <strong>{error || telemetry.lastError ? "Capture issue" : "VLYP"}</strong>
            <span>{error ?? telemetry.lastError ?? notice}</span>
            <button onClick={() => { setError(undefined); setNotice(undefined); }} type="button">Dismiss</button>
          </div>
        )}

        <section className="library-layout">
          <div className="library-main">
            <article className="spotlight-card">
              <div className="spotlight-copy">
                <p className="eyebrow">LOCAL FIRST</p>
                <h1>Clip fast. Trim later. Keep it offline.</h1>
                <p>V1 keeps the Medal-style library flow, but replaces social upload actions with local save, copy path, trim, and compression affordances.</p>
              </div>
              <div className="spotlight-actions">
                <button className="primary" disabled={busy || !sourceId || active} onClick={toggleReplay} type="button">Arm Replay</button>
                <button disabled={busy || !active || telemetry.segmentCount === 0} onClick={saveReplay} type="button">Save Moment</button>
              </div>
            </article>

            <div className="section-title">
              <div>
                <p className="eyebrow">RECENT CAPTURES</p>
                <h2>On this device</h2>
              </div>
              <span>{formatDuration(totalClipTime)} total</span>
            </div>

            {filteredClips.length === 0 ? (
              <div className="empty-library">
                <strong>No matching clips yet.</strong>
                <span>Start the replay buffer, hit the save hotkey, and your local captures will appear here.</span>
              </div>
            ) : (
              <div className="clip-grid">
                {filteredClips.slice(0, 12).map((clip, index) => (
                  <article className="clip-card" key={clip.id}>
                    <div className={`thumb thumb-${index % 5}`}>
                      <div className="thumb-grid" />
                      <span className="duration">{formatDuration(clip.durationSeconds)}</span>
                      {clip.favorite && <span className="favorite">★</span>}
                    </div>
                    <div className="clip-info">
                      <strong>{getClipName(clip.path)}</strong>
                      <p>● On Device · {clip.width}×{clip.height} · {formatRelativeDate(clip.createdAt)}</p>
                    </div>
                    <div className="clip-actions">
                      <button onClick={() => void copyPath(clip.path)} type="button">Copy Path</button>
                      <button type="button" disabled>Trim</button>
                      <button type="button" disabled>Compress</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <aside className="control-dock">
            <article className="panel capture-panel">
              <header>
                <div>
                  <p className="eyebrow">CAPTURE</p>
                  <h2>Replay setup</h2>
                </div>
                <span className={active ? "pill live" : "pill"}>{active ? "Live" : "Ready"}</span>
              </header>

              <label>Capture source
                <select value={sourceId} disabled={active} onChange={(event) => setSourceId(event.target.value)}>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.kind === "monitor" ? "Display" : source.processName ?? "Window"} · {source.name} · {source.width}×{source.height}
                    </option>
                  ))}
                </select>
              </label>

              <div className="control-grid">
                <label>Replay length
                  <select value={bufferSeconds} disabled={active} onChange={(event) => setBufferSeconds(Number(event.target.value))}>
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={120}>2 minutes</option>
                    <option value={300}>5 minutes</option>
                  </select>
                </label>
                <label>Bitrate
                  <select value={bitrateMbps} disabled={active} onChange={(event) => setBitrateMbps(Number(event.target.value))}>
                    <option value={10}>Small · 10 Mbps</option>
                    <option value={20}>Balanced · 20 Mbps</option>
                    <option value={35}>High · 35 Mbps</option>
                    <option value={60}>Max · 60 Mbps</option>
                  </select>
                </label>
              </div>

              <label className="check"><input type="checkbox" checked={captureCursor} disabled={active} onChange={(event) => setCaptureCursor(event.target.checked)} /> Capture cursor</label>
            </article>

            <article className="panel stats-panel">
              <header>
                <div>
                  <p className="eyebrow">STATUS</p>
                  <h2>Pipeline</h2>
                </div>
              </header>
              <div className="stat-list">
                <div><span>Source</span><strong>{telemetry.width ? `${telemetry.width}×${telemetry.height}` : "Ready"}</strong><small>{telemetry.sourceName ?? selectedSource?.name ?? "No source selected"}</small></div>
                <div><span>Encoder</span><strong>{telemetry.encoderName ?? availableEncoders[0]?.name ?? "Detecting"}</strong><small>{availableEncoders.length} available path{availableEncoders.length === 1 ? "" : "s"}</small></div>
                <div><span>Rate</span><strong>{telemetry.frameRate.toFixed(1)} FPS</strong><small>{telemetry.framesEncoded.toLocaleString()} frames encoded</small></div>
                <div><span>Buffer</span><strong>{telemetry.bufferedSeconds.toFixed(1)}s</strong><small>{telemetry.segmentCount} segments · {formatBytes(telemetry.bufferBytes)}</small></div>
                <div><span>Drops</span><strong>{telemetry.droppedFrames}</strong><small>Capture pipeline reported</small></div>
              </div>
            </article>

            <article className="panel encoders-panel">
              <header>
                <div>
                  <p className="eyebrow">ENCODING</p>
                  <h2>Available paths</h2>
                </div>
              </header>
              {encoders.map((encoder) => (
                <div className="encoder" key={encoder.id}>
                  <i className={encoder.available ? "ok" : ""} />
                  <div>
                    <strong>{encoder.name}</strong>
                    <p>{encoder.note}</p>
                  </div>
                  <span>{encoder.hardwarePreferred ? "GPU" : "CPU"}</span>
                </div>
              ))}
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}

export default App;
