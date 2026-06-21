mod audio;
mod capture;
mod commands;
mod encoder;
mod replay;
mod state;
mod storage;
mod types;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

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

            let show_item = MenuItem::with_id(app, "show", "Show VLYP", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide VLYP", true, None::<&str>)?;
            let toggle_replay_item =
                MenuItem::with_id(app, "toggle_replay", "Start / Stop Replay", true, None::<&str>)?;
            let save_replay_item =
                MenuItem::with_id(app, "save_replay", "Save Last Replay", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit VLYP", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &hide_item,
                    &toggle_replay_item,
                    &save_replay_item,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("VLYP")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "toggle_replay" => {
                        show_main_window(app);
                        let _ = app.emit("vlyp://toggle-replay", ());
                    }
                    "save_replay" => {
                        let _ = app.emit("vlyp://save-replay", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
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
