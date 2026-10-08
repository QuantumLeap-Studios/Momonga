#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod net;
mod presets;
mod usb;

use presets::PresetStore;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(PresetStore::load(dir.join("printers.json")));
            app.manage(usb::UsbManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            presets::list_printers,
            presets::save_printer,
            presets::delete_printer,
            presets::open_preset_window,
            commands::test_connection,
            commands::printer_status,
            commands::send_gcode,
            commands::upload_gcode,
            commands::list_remote_files,
            commands::fetch_remote_gcode,
            commands::job_command,
            commands::start_remote_print,
            commands::read_gcode_file,
            commands::write_gcode_file,
            commands::read_model_file,
            commands::list_serial_ports,
            commands::usb_connect,
            commands::usb_disconnect,
            commands::camera_stream_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Momonga");
}
