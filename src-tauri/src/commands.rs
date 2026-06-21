use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::audio::{self, AudioTrackDescriptor};
use crate::capture;
use crate::encoder;
use crate::replay::remux_segments;
use crate::state::AppState;
use crate::types::{
    CaptureSource, CaptureTelemetry, ClipRecord, EncoderCapability, ReplayConfig, SaveReplayRequest,
};

#[tauri::command]
pub fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    capture::enumerate_sources()
}

#[tauri::command]
pub fn list_encoder_capabilities() -> Vec<EncoderCapability> {
    encoder::enumerate_encoders()
}

#[tauri::command]
pub fn list_audio_tracks() -> Vec<AudioTrackDescriptor> {
    audio::planned_tracks()
}

#[tauri::command]
pub fn get_capture_status(state: State<'_, AppState>) -> CaptureTelemetry {
    let capture = state.capture.lock();
    capture.refresh_buffer_stats();
    capture.telemetry.lock().clone()
}

#[tauri::command]
pub fn start_replay(config: ReplayConfig, state: State<'_, AppState>) -> Result<(), String> {
    state
        .capture
        .lock()
        .start(config, state.buffer_directory.clone())
}

#[tauri::command]
pub fn stop_replay(state: State<'_, AppState>) -> Result<(), String> {
    state.capture.lock().stop()
}

#[tauri::command]
pub fn save_replay(
    request: SaveReplayRequest,
    state: State<'_, AppState>,
) -> Result<ClipRecord, String> {
    if !(30..=300).contains(&request.duration_seconds) {
        return Err("Replay duration must be between 30 and 300 seconds".into());
    }
    let (segments, telemetry) = {
        let capture = state.capture.lock();
        let segments = capture.ring.lock().snapshot(request.duration_seconds);
        let telemetry = capture.telemetry.lock().clone();
        (segments, telemetry)
    };
    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now();
    let file_name = format!("VLYP-{}.mp4", timestamp.format("%Y%m%d-%H%M%S"));
    let path = state.clips_directory.join(file_name);
    let duration_seconds = remux_segments(&segments, &path)?;
    let clip = ClipRecord {
        id,
        path,
        created_at: timestamp.to_rfc3339(),
        duration_seconds,
        width: telemetry.width,
        height: telemetry.height,
        favorite: false,
    };
    state.store.insert(&clip)?;
    Ok(clip)
}

#[tauri::command]
pub fn list_clips(state: State<'_, AppState>) -> Result<Vec<ClipRecord>, String> {
    state.store.list()
}
