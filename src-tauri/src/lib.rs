mod audio;
mod capture;
mod commands;
mod encoder;
mod replay;
mod state;
mod storage;
mod types;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let video_directory = app.path().video_dir()?;
            app.manage(
                state::AppState::new(app_data, video_directory).map_err(std::io::Error::other)?,
            );

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["ctrl+shift+f10"])?
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed
                            && shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::F10)
                        {
                            let _ = app.emit("vlyp://save-replay", ());
                        }
                    })
                    .build(),
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_capture_sources,
            commands::list_encoder_capabilities,
            commands::list_audio_tracks,
            commands::get_capture_status,
            commands::start_replay,
            commands::stop_replay,
            commands::save_replay,
            commands::list_clips,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VLYP");
}
