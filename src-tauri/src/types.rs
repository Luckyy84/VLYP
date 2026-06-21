use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    pub kind: CaptureSourceKind,
    pub name: String,
    pub process_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub refresh_rate: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureSourceKind {
    Monitor,
    Window,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayConfig {
    pub source_id: String,
    pub buffer_seconds: u64,
    pub segment_seconds: u64,
    pub bitrate: u32,
    pub frame_rate: Option<u32>,
    pub capture_cursor: bool,
}

impl ReplayConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(30..=300).contains(&self.buffer_seconds) {
            return Err("Replay duration must be between 30 and 300 seconds".into());
        }
        if !(2..=15).contains(&self.segment_seconds) {
            return Err("Segment duration must be between 2 and 15 seconds".into());
        }
        if !(1_000_000..=200_000_000).contains(&self.bitrate) {
            return Err("Bitrate must be between 1 and 200 Mbps".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCapability {
    pub id: String,
    pub name: String,
    pub codec: String,
    pub hardware_preferred: bool,
    pub available: bool,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTelemetry {
    pub state: RecorderState,
    pub source_name: Option<String>,
    pub encoder_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub bitrate: u32,
    pub frames_encoded: u64,
    pub dropped_frames: u64,
    pub buffered_seconds: f64,
    pub segment_count: usize,
    pub buffer_bytes: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecorderState {
    #[default]
    Idle,
    Starting,
    Recording,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRecord {
    pub id: String,
    pub path: PathBuf,
    pub created_at: String,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReplayRequest {
    pub duration_seconds: u64,
}
