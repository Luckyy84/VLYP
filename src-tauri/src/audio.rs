use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioTrackKind {
    DesktopMaster,
    Game,
    PinnedApplication,
    Microphone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackDescriptor {
    pub id: String,
    pub name: String,
    pub kind: AudioTrackKind,
    pub enabled: bool,
}

pub fn planned_tracks() -> Vec<AudioTrackDescriptor> {
    vec![
        AudioTrackDescriptor {
            id: "desktop".into(),
            name: "Desktop master".into(),
            kind: AudioTrackKind::DesktopMaster,
            enabled: true,
        },
        AudioTrackDescriptor {
            id: "game".into(),
            name: "Active game".into(),
            kind: AudioTrackKind::Game,
            enabled: true,
        },
        AudioTrackDescriptor {
            id: "pinned".into(),
            name: "Pinned applications".into(),
            kind: AudioTrackKind::PinnedApplication,
            enabled: true,
        },
        AudioTrackDescriptor {
            id: "microphone".into(),
            name: "Default microphone".into(),
            kind: AudioTrackKind::Microphone,
            enabled: true,
        },
    ]
}

#[allow(dead_code)]
pub trait AudioCaptureBackend: Send {
    fn tracks(&self) -> &[AudioTrackDescriptor];
    fn start(&mut self) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
}
