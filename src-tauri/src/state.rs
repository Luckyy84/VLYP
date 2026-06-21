use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;

use crate::capture::CaptureRuntime;
use crate::storage::ClipStore;

pub struct AppState {
    pub capture: Mutex<CaptureRuntime>,
    pub store: ClipStore,
    pub buffer_directory: PathBuf,
    pub clips_directory: PathBuf,
}

impl AppState {
    pub fn new(app_data: PathBuf, video_directory: PathBuf) -> Result<Self, String> {
        let buffer_directory = app_data.join("replay-buffer");
        let clips_directory = video_directory.join("VLYP");
        fs::create_dir_all(&buffer_directory).map_err(|error| error.to_string())?;
        fs::create_dir_all(&clips_directory).map_err(|error| error.to_string())?;
        fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;
        Ok(Self {
            capture: Mutex::new(CaptureRuntime::new(buffer_directory.clone())?),
            store: ClipStore::open(&app_data.join("vlyp.sqlite3"))?,
            buffer_directory,
            clips_directory,
        })
    }
}
