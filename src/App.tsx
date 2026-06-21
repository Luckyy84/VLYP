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

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const [busy, setBusy] = useState(false);
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
    setError(undefined);
    try {
      await invoke<ClipRecord>("save_replay", { request: { durationSeconds: bufferSeconds } });
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

    const timer = window.setInterval(refreshStatus, 1000);
    const unlisten = listen("vlyp://save-replay", saveReplay);
    return () => {
      window.clearInterval(timer);
      void unlisten.then((dispose) => dispose());
    };
  }, [refreshClips, refreshStatus, saveReplay]);

  const active = telemetry.state === "recording" || telemetry.state === "starting";
  const selectedSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);

  async function toggleReplay() {
    setBusy(true);
    setError(undefined);
    try {
      if (active) {
        await invoke("stop_replay");
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
      }
      await refreshStatus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><img src="/vlyp-icon.png" alt="" /><span>VLYP</span><b>Capture Lab</b></div>
        <div className={`status ${telemetry.state}`}><i />{telemetry.state}</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">LOCAL REPLAY ENGINE</p>
          <h1>Keep the moment.<br /><span>Skip the overhead.</span></h1>
          <p className="lede">Native Windows capture with continuous Media Foundation encoding and a disk-backed replay buffer.</p>
        </div>
        <div className="controls">
          <label>Capture source
            <select value={sourceId} disabled={active} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.kind === "monitor" ? "Display" : source.processName ?? "Window"} · {source.name} · {source.width}×{source.height}</option>)}
            </select>
          </label>
          <div className="control-grid">
            <label>Replay length<select value={bufferSeconds} disabled={active} onChange={(event) => setBufferSeconds(Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option></select></label>
            <label>Bitrate<select value={bitrateMbps} disabled={active} onChange={(event) => setBitrateMbps(Number(event.target.value))}><option value={10}>10 Mbps</option><option value={20}>20 Mbps</option><option value={35}>35 Mbps</option><option value={60}>60 Mbps</option></select></label>
          </div>
          <label className="check"><input type="checkbox" checked={captureCursor} disabled={active} onChange={(event) => setCaptureCursor(event.target.checked)} /> Capture cursor</label>
          <div className="actions">
            <button className={active ? "stop" : "primary"} disabled={busy || !sourceId} onClick={toggleReplay}>{active ? "Stop replay" : "Start replay"}</button>
            <button disabled={busy || !active || telemetry.segmentCount === 0} onClick={saveReplay}>Save last {bufferSeconds}s</button>
          </div>
          <small>Global save hotkey: Ctrl + Shift + F10</small>
        </div>
      </section>

      {error && <div className="error"><strong>Capture error</strong><span>{error}</span><button onClick={() => setError(undefined)}>Dismiss</button></div>}

      <section className="metrics">
        <article><span>Source</span><strong>{telemetry.width ? `${telemetry.width}×${telemetry.height}` : "Ready"}</strong><small>{telemetry.sourceName ?? selectedSource?.name ?? "No source"}</small></article>
        <article><span>Delivered rate</span><strong>{telemetry.frameRate.toFixed(1)} FPS</strong><small>{telemetry.framesEncoded.toLocaleString()} frames encoded</small></article>
        <article><span>Replay buffer</span><strong>{telemetry.bufferedSeconds.toFixed(1)}s</strong><small>{telemetry.segmentCount} segments · {formatBytes(telemetry.bufferBytes)}</small></article>
        <article><span>Frame drops</span><strong>{telemetry.droppedFrames}</strong><small>Capture pipeline reported</small></article>
      </section>

      <section className="lower-grid">
        <article className="panel"><header><div><p className="eyebrow">ENCODING</p><h2>Available paths</h2></div></header>{encoders.map((encoder) => <div className="encoder" key={encoder.id}><i className={encoder.available ? "ok" : ""} /><div><strong>{encoder.name}</strong><p>{encoder.note}</p></div><span>{encoder.hardwarePreferred ? "GPU" : "CPU"}</span></div>)}</article>
        <article className="panel"><header><div><p className="eyebrow">LIBRARY</p><h2>Recent captures</h2></div><span>{clips.length}</span></header>{clips.length === 0 ? <div className="empty">Your saved replays will appear here.</div> : clips.slice(0, 5).map((clip) => <div className="clip" key={clip.id}><div className="clip-mark">V</div><div><strong>{new Date(clip.createdAt).toLocaleString()}</strong><p>{clip.durationSeconds.toFixed(1)}s · {clip.width}×{clip.height}</p></div></div>)}</article>
      </section>
    </main>
  );
}

export default App;
