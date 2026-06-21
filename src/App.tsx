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

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getClipName(path: string) {
  return path.split(/[\\/]/).pop() || "Untitled clip";
}

function stateToStatus(state: RecorderState) {
  if (state === "recording" || state === "starting") return "recording";
  if (state === "failed") return "failed";
  return "ready";
}

function statusLabel(state: RecorderState) {
  if (state === "recording" || state === "starting") return "Recording";
  if (state === "stopping") return "Stopping";
  if (state === "failed") return "Failed";
  return "Ready";
}

function Hotkey({ keys }: { keys: string[] }) {
  return (
    <div className="hotkey">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`}>{key}</span>
      ))}
    </div>
  );
}

function StatusPill({ state }: { state: RecorderState }) {
  return (
    <div className={`status-pill ${stateToStatus(state)}`}>
      <span />
      <b>{statusLabel(state)}</b>
    </div>
  );
}

function AppHeader({ state }: { state: RecorderState }) {
  return (
    <header className="app-header">
      <div className="brand-wordmark">VLYP</div>
      <div className="header-right">
        <StatusPill state={state} />
        <button className="icon-button" type="button" aria-label="Settings">⚙</button>
      </div>
    </header>
  );
}

function PrimaryActions({
  active,
  busy,
  canSave,
  toggleRecording,
  saveReplay,
}: {
  active: boolean;
  busy: boolean;
  canSave: boolean;
  toggleRecording: () => void;
  saveReplay: () => void;
}) {
  return (
    <section className="primary-actions">
      <div className="action-group">
        <button
          type="button"
          onClick={toggleRecording}
          disabled={busy}
          className={active ? "main-action recording" : "main-action"}
        >
          <span />
          {active ? "Stop Recording" : "Start Recording"}
        </button>
        <div className="action-meta">
          <span>Start / Stop</span>
          <Hotkey keys={["Ctrl", "Shift", "F9"]} />
        </div>
      </div>

      <div className="action-group replay-group">
        <button
          type="button"
          onClick={saveReplay}
          disabled={busy || !canSave}
          className="secondary-action"
        >
          Save Last Replay
        </button>
        <div className="action-meta">
          <span>Save Replay</span>
          <Hotkey keys={["Ctrl", "Shift", "F10"]} />
        </div>
      </div>
    </section>
  );
}

function RecentClips({ clips, copyPath }: { clips: ClipRecord[]; copyPath: (path: string) => void }) {
  const recentClips = clips.slice(0, 3);

  return (
    <section className="recent-clips">
      <div className="section-heading">
        <h2>Recent Clips</h2>
        <span>{clips.length} local</span>
      </div>

      <ul>
        {recentClips.length === 0 ? (
          <li className="empty-row">Your saved replays will appear here.</li>
        ) : (
          recentClips.map((clip, index) => (
            <li key={clip.id}>
              <div className={`clip-thumb clip-thumb-${index + 1}`}>
                <span>{formatDuration(clip.durationSeconds)}</span>
              </div>
              <div className="clip-copy">
                <strong>{getClipName(clip.path)}</strong>
                <p>{formatDuration(clip.durationSeconds)} · {clip.width}×{clip.height}</p>
              </div>
              <div className="clip-actions">
                <button type="button" disabled>✂ Trim</button>
                <button type="button" onClick={() => copyPath(clip.path)}>▱ Folder</button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function App() {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [telemetry, setTelemetry] = useState(idleTelemetry);
  const [sourceId, setSourceId] = useState("");
  const [bufferSeconds] = useState(60);
  const [bitrateMbps] = useState(20);
  const [captureCursor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const active = telemetry.state === "recording" || telemetry.state === "starting";
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
      setNotice(`Saved ${getClipName(clip.path)}`);
      await refreshClips();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [bufferSeconds, refreshClips]);

  const toggleRecording = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);

    try {
      if (active) {
        await invoke("stop_replay");
        setNotice("Recording stopped");
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
        setNotice("Recording started");
      }

      await refreshStatus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [active, bitrateMbps, bufferSeconds, captureCursor, refreshStatus, selectedSource?.refreshRate, sourceId]);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setNotice("Clip path copied");
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

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
    const unlistenToggle = listen("vlyp://toggle-replay", toggleRecording);

    return () => {
      window.clearInterval(timer);
      void unlistenSave.then((dispose) => dispose());
      void unlistenToggle.then((dispose) => dispose());
    };
  }, [refreshClips, refreshStatus, saveReplay, toggleRecording]);

  return (
    <div className="page-shell">
      <div className="app-frame">
        <AppHeader state={telemetry.state} />

        <main className="home-content">
          <PrimaryActions
            active={active}
            busy={busy || !sourceId}
            canSave={active && telemetry.segmentCount > 0}
            toggleRecording={toggleRecording}
            saveReplay={saveReplay}
          />

          {(error || telemetry.lastError || notice) && (
            <div className={error || telemetry.lastError ? "message error" : "message"}>
              <span>{error ?? telemetry.lastError ?? notice}</span>
              <button type="button" onClick={() => { setError(undefined); setNotice(undefined); }}>Dismiss</button>
            </div>
          )}

          <div className="divider" />
          <RecentClips clips={clips} copyPath={copyPath} />
        </main>
      </div>
    </div>
  );
}

export default App;
