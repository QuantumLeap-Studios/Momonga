use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrinterPreset {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub model: String,
    pub firmware: String,
    pub bed_width: f64,
    pub bed_depth: f64,
    pub build_height: f64,
    pub nozzle_diameter: f64,
    pub filament_diameter: f64,
    pub max_hotend_temp: f64,
    pub max_bed_temp: f64,
    pub connection: String,
    pub serial_port: String,
    pub baud_rate: u32,
    pub url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub camera_url: String,
}

pub struct PresetStore {
    path: PathBuf,
    presets: Mutex<Vec<PrinterPreset>>,
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

fn defaults() -> Vec<PrinterPreset> {
    vec![
    ]
}

fn validate(p: &mut PrinterPreset) -> Result<(), String> {
    p.name = p.name.trim().to_string();
    p.model = p.model.trim().to_string();
    p.serial_port = p.serial_port.trim().to_string();
    p.url = p.url.trim().to_string();
    p.api_key = p.api_key.trim().to_string();
    p.camera_url = p.camera_url.trim().to_string();
    if !p.camera_url.is_empty() {
        crate::net::check_camera_url(&p.camera_url)?;
    }
    if p.name.is_empty() {
        return Err("Name is required".into());
    }
    if !["Klipper", "Marlin", "RepRap"].contains(&p.firmware.as_str()) {
        return Err("Unknown firmware".into());
    }
    if !["usb", "octoprint", "moonraker"].contains(&p.connection.as_str()) {
        return Err("Unknown connection type".into());
    }
    let in_range = |v: f64, lo: f64, hi: f64| v.is_finite() && v >= lo && v <= hi;
    if !in_range(p.bed_width, 10.0, 2000.0)
        || !in_range(p.bed_depth, 10.0, 2000.0)
        || !in_range(p.build_height, 10.0, 2000.0)
    {
        return Err("Build volume must be between 10 and 2000 mm".into());
    }
    if !in_range(p.nozzle_diameter, 0.1, 2.0) {
        return Err("Nozzle diameter must be between 0.1 and 2.0 mm".into());
    }
    if !in_range(p.filament_diameter, 1.0, 3.5) {
        return Err("Filament diameter must be between 1.0 and 3.5 mm".into());
    }
    if !in_range(p.max_hotend_temp, 100.0, 600.0) || !in_range(p.max_bed_temp, 0.0, 200.0) {
        return Err("Temperature limit is out of range".into());
    }
    if !(1200..=2_000_000).contains(&p.baud_rate) {
        return Err("Baud rate is out of range".into());
    }
    if p.connection != "usb" {
        crate::net::target(&p.connection, &p.url, &p.api_key)?;
    }
    Ok(())
}

impl PresetStore {
    pub fn get(&self, id: &str) -> Option<PrinterPreset> {
        self.presets.lock().unwrap().iter().find(|p| p.id == id).cloned()
    }

    pub fn load(path: PathBuf) -> Self {
        let presets = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
                let _ = fs::rename(&path, path.with_extension("json.bak"));
                Vec::new()
            }),
            Err(_) => defaults(),
        };
        let store = Self {
            path,
            presets: Mutex::new(presets),
        };
        if !store.path.exists() {
            let _ = store.persist(&store.presets.lock().unwrap());
        }
        store
    }

    fn persist(&self, presets: &[PrinterPreset]) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(presets).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn list_printers(store: State<PresetStore>) -> Vec<PrinterPreset> {
    store.presets.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_printer(
    app: AppHandle,
    store: State<PresetStore>,
    mut preset: PrinterPreset,
) -> Result<PrinterPreset, String> {
    validate(&mut preset)?;
    let mut presets = store.presets.lock().unwrap();
    match presets.iter_mut().find(|p| p.id == preset.id) {
        Some(existing) if !preset.id.is_empty() => *existing = preset.clone(),
        _ => {
            preset.id = new_id();
            presets.push(preset.clone());
        }
    }
    store.persist(&presets)?;
    drop(presets);
    let _ = app.emit("presets-changed", ());
    Ok(preset)
}

#[tauri::command]
pub fn delete_printer(app: AppHandle, store: State<PresetStore>, id: String) -> Result<(), String> {
    let mut presets = store.presets.lock().unwrap();
    presets.retain(|p| p.id != id);
    store.persist(&presets)?;
    drop(presets);
    let _ = app.emit("presets-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn open_preset_window(
    app: AppHandle,
    id: Option<String>,
    connection: Option<String>,
    port: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    let safe = |s: &str| {
        !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c))
    };
    if let Some(id) = &id {
        if !safe(id) {
            return Err("Invalid preset id".into());
        }
    }
    let label = format!("preset-{}", id.as_deref().unwrap_or("new"));
    if let Some(window) = app.get_webview_window(&label) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut url = String::from("index.html?window=preset");
    if let Some(id) = &id {
        url.push_str(&format!("&id={id}"));
    }
    if let Some(c) = connection.as_deref().filter(|c| ["usb", "octoprint", "moonraker"].contains(c)) {
        url.push_str(&format!("&connection={c}"));
    }
    if let Some(p) = port.as_deref().filter(|p| safe(p)) {
        url.push_str(&format!("&port={p}"));
    }
    let title = if id.is_some() { "Edit printer preset" } else { "New printer preset" };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1100.0, 720.0)
        .min_inner_size(860.0, 560.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}