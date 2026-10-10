use crate::net::{self, PrinterStatus};
use crate::presets::{PresetStore, PrinterPreset};
use crate::usb::UsbManager;
use tauri::{AppHandle, State};

fn preset(store: &PresetStore, id: &str) -> Result<PrinterPreset, String> {
    store.get(id).ok_or_else(|| "Printer not found".to_string())
}

fn check_gcode(line: &str, p: &PrinterPreset) -> Result<String, String> {
    let line = line.trim();
    if line.is_empty() {
        return Err("Empty command".into());
    }
    if line.len() > 200 || line.contains(['\n', '\r', '\0']) {
        return Err("Command is too long or contains line breaks".into());
    }
    let code = line.split(';').next().unwrap_or("").to_ascii_uppercase();
    let mut words = code.split_whitespace();
    let limit = match words.next() {
        Some("M104") | Some("M109") => Some(p.max_hotend_temp),
        Some("M140") | Some("M190") => Some(p.max_bed_temp),
        _ => None,
    };
    if let Some(limit) = limit {
        for w in words {
            if let Some(v) = w.strip_prefix('S') {
                let v: f64 = v.parse().map_err(|_| "Invalid temperature".to_string())?;
                if !(0.0..=limit).contains(&v) {
                    return Err(format!("Temperature {v} is outside this printer's limit of {limit}°C"));
                }
            }
        }
    }
    Ok(line.to_string())
}

#[tauri::command]
pub async fn test_connection(kind: String, url: String, api_key: String) -> Result<String, String> {
    net::test(&net::target(&kind, &url, &api_key)?).await
}

#[tauri::command]
pub async fn printer_status(
    store: State<'_, PresetStore>,
    usb: State<'_, UsbManager>,
    id: String,
) -> Result<PrinterStatus, String> {
    let p = preset(&store, &id)?;
    if p.connection == "usb" {
        return Ok(usb.status(&id));
    }
    net::status(&net::target_of(&p)?).await
}

#[tauri::command]
pub async fn send_gcode(
    app: AppHandle,
    store: State<'_, PresetStore>,
    usb: State<'_, UsbManager>,
    id: String,
    lines: Vec<String>,
) -> Result<(), String> {
    let p = preset(&store, &id)?;
    if lines.is_empty() || lines.len() > 10 {
        return Err("Send between 1 and 10 commands at a time".into());
    }
    let lines = lines.iter().map(|l| check_gcode(l, &p)).collect::<Result<Vec<_>, _>>()?;
    if p.connection == "usb" {
        return usb.send(&app, &id, &lines);
    }
    net::send_gcode(&net::target_of(&p)?, &lines).await
}

#[tauri::command]
pub async fn upload_gcode(
    store: State<'_, PresetStore>,
    id: String,
    path: String,
    start_print: bool,
) -> Result<String, String> {
    let p = preset(&store, &id)?;
    if p.connection == "usb" {
        return Err("Uploading and printing over USB is not supported yet".into());
    }
    net::upload(&net::target_of(&p)?, &path, start_print).await
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn usb_connect(
    app: AppHandle,
    store: State<'_, PresetStore>,
    usb: State<'_, UsbManager>,
    id: String,
) -> Result<(), String> {
    let p = preset(&store, &id)?;
    if p.connection != "usb" {
        return Err("This printer does not use USB".into());
    }
    usb.connect(&app, &id, &p.serial_port, p.baud_rate)
}

#[tauri::command]
pub async fn usb_disconnect(app: AppHandle, usb: State<'_, UsbManager>, id: String) -> Result<(), String> {
    usb.disconnect(&app, &id);
    Ok(())
}

fn network(store: &PresetStore, id: &str) -> Result<net::Target, String> {
    let p = preset(store, id)?;
    if p.connection == "usb" {
        return Err("This feature needs an OctoPrint or Moonraker printer".into());
    }
    net::target_of(&p)
}

#[tauri::command]
pub async fn list_remote_files(store: State<'_, PresetStore>, id: String) -> Result<Vec<net::RemoteFile>, String> {
    net::list_files(&network(&store, &id)?).await
}

#[tauri::command]
pub async fn fetch_remote_gcode(store: State<'_, PresetStore>, id: String, path: String) -> Result<String, String> {
    net::download(&network(&store, &id)?, &path).await
}

#[tauri::command]
pub async fn job_command(store: State<'_, PresetStore>, id: String, action: String) -> Result<(), String> {
    net::job_command(&network(&store, &id)?, &action).await
}

#[tauri::command]
pub async fn start_remote_print(store: State<'_, PresetStore>, id: String, path: String) -> Result<(), String> {
    net::start_print(&network(&store, &id)?, &path).await
}

const MAX_TEXT_BYTES: u64 = 60 * 1024 * 1024;

fn gcode_path(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["gcode", "gco", "g", "nc"].contains(&ext.as_str()) {
        return Err("Only .gcode, .gco and .g files can be opened or saved".into());
    }
    Ok(p)
}

#[tauri::command]
pub async fn read_gcode_file(path: String) -> Result<String, String> {
    let p = gcode_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&p).map_err(|e| format!("Cannot read file: {e}"))?;
        if !meta.is_file() || meta.len() > MAX_TEXT_BYTES {
            return Err("Not a file, or larger than 60 MB".to_string());
        }
        let bytes = std::fs::read(&p).map_err(|e| format!("Cannot read file: {e}"))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_gcode_file(path: String, text: String) -> Result<(), String> {
    let p = gcode_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(p, text).map_err(|e| format!("Cannot save file: {e}")))
        .await
        .map_err(|e| e.to_string())?
}

const MAX_MODEL_BYTES: u64 = 300 * 1024 * 1024;

#[tauri::command]
pub async fn read_model_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = std::path::PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["stl", "obj"].contains(&ext.as_str()) {
        return Err("Only .stl and .obj models can be imported".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&p).map_err(|e| format!("Cannot read file: {e}"))?;
        if !meta.is_file() || meta.len() > MAX_MODEL_BYTES {
            return Err("Not a file, or larger than 300 MB".to_string());
        }
        std::fs::read(&p).map_err(|e| format!("Cannot read file: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset() -> PrinterPreset {
        serde_json::from_str(r#"{"name":"t","model":"","firmware":"Marlin","bedWidth":200,"bedDepth":200,"buildHeight":200,"nozzleDiameter":0.4,"filamentDiameter":1.75,"maxHotendTemp":260,"maxBedTemp":100,"connection":"usb","serialPort":"","baudRate":115200,"url":""}"#).unwrap()
    }

    #[test]
    fn enforces_temperature_limits() {
        let p = preset();
        assert!(check_gcode("M104 S200", &p).is_ok());
        assert!(check_gcode("m104 s261", &p).is_err());
        assert!(check_gcode("M140 S101", &p).is_err());
        assert!(check_gcode("G1 X10 ; M104 S999", &p).is_ok());
    }

    #[test]
    fn rejects_bad_lines() {
        let p = preset();
        assert!(check_gcode("", &p).is_err());
        assert!(check_gcode("G28\nM104 S999", &p).is_err());
    }
}
#[tauri::command]
fn remove_temp_gcode(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);

    if !p.starts_with(std::env::temp_dir()) {
        return Err("Refusing to delete a file outside the temp directory".into());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn camera_stream_url(store: State<'_, PresetStore>, id: String) -> Result<String, String> {
    let p = preset(&store, &id)?;
    if !p.camera_url.is_empty() {
        net::check_camera_url(&p.camera_url)?;
        return Ok(p.camera_url);
    }
    if p.connection == "usb" {
        return Err("No camera set. Add a camera URL in the printer settings".into());
    }
    net::camera_url(&net::target_of(&p)?).await
}
