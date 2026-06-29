mod commands;
mod storage;
mod updates;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let storage = storage::initialize(app.handle()).map_err(std::io::Error::other)?;
            app.manage(storage);
            app.manage(updates::PendingUpdate::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app_state,
            commands::save_active_game,
            commands::clear_active_game,
            commands::record_completed_game,
            commands::load_settings,
            commands::save_settings,
            commands::load_stats,
            commands::reset_local_data,
            updates::check_for_updates,
            updates::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Spider");
}
