use crate::presets::PrinterPreset;
use reqwest::{multipart, redirect, Client, Method, RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::Path, sync::OnceLock, time::Duration};

const MAX_UPLOAD_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Temp {
    pub actual: f64,
    pub target: f64,
}

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    pub online: bool,
    pub state: String,
    pub hotend: Option<Temp>,
    pub bed: Option<Temp>,
    pub progress: Option<f64>,
    pub file: Option<String>,
    pub time_left_secs: Option<u64>,
    pub file_pos: Option<u64>,
    pub file_size: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub last_print: Option<u64>,
    pub last_success: Option<bool>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    OctoPrint,
    Moonraker,
}

pub struct Target {
    pub kind: Kind,
    base: String,
    key: String,
}

pub fn target(kind: &str, url: &str, api_key: &str) -> Result<Target, String> {
    let kind = match kind {
        "octoprint" => Kind::OctoPrint,
        "moonraker" => Kind::Moonraker,
        _ => return Err("This printer does not use a network connection".into()),
    };
    let url = url.trim();
    if url.is_empty() {
        return Err("Server URL is required".into());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "Server URL is not valid (example: http://octopi.local)".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Server URL must start with http:// or https://".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Server URL must not contain credentials, a query or a fragment".into());
    }
    let key = api_key.trim();
    if key.len() > 256 || !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err("API key contains invalid characters".into());
    }
    if kind == Kind::OctoPrint && key.is_empty() {
        return Err("An API key is required for OctoPrint".into());
    }
    Ok(Target {
        kind,
        base: parsed.as_str().trim_end_matches('/').to_string(),
        key: key.to_string(),
    })
}

pub fn target_of(p: &PrinterPreset) -> Result<Target, String> {
    target(&p.connection, &p.url, &p.api_key)
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .redirect(redirect::Policy::none())
            .build()
            .expect("failed to build HTTP client")
    })
}

fn request(t: &Target, method: Method, path: &str) -> RequestBuilder {
    let mut r = client().request(method, format!("{}{}", t.base, path));
    if !t.key.is_empty() {
        r = r.header("X-Api-Key", &t.key);
    }
    r
}

fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The server did not respond in time".into()
    } else if e.is_connect() {
        "Could not connect to the server. Check the address and that it is running".into()
    } else if e.is_redirect() {
        "The server redirected the request (try the exact http:// or https:// address)".into()
    } else {
        format!("Request failed: {e}")
    }
}

fn check(resp: Response) -> Result<Response, String> {
    match resp.status() {
        s if s.is_success() => Ok(resp),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err("Authentication failed. Check the API key".into()),
        StatusCode::NOT_FOUND => Err("Endpoint not found. Check the URL and server type".into()),
        StatusCode::CONFLICT => Err("The printer is not in a state that allows this (is it connected and idle?)".into()),
        s if s.is_redirection() => Err("The server redirected the request (try the exact http:// or https:// address)".into()),
        s => Err(format!("Server returned {s}")),
    }
}

async fn send(r: RequestBuilder) -> Result<Response, String> {
    check(r.send().await.map_err(describe)?)
}

async fn get_json(t: &Target, path: &str) -> Result<Value, String> {
    send(request(t, Method::GET, path))
        .await?
        .json()
        .await
        .map_err(|_| "Unexpected response. Is this the right kind of server?".to_string())
}

fn temp(v: &Value) -> Option<Temp> {
    Some(Temp {
        actual: v["actual"].as_f64().or_else(|| v["temperature"].as_f64())?,
        target: v["target"].as_f64().unwrap_or(0.0),
    })
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

pub async fn test(t: &Target) -> Result<String, String> {
    match t.kind {
        Kind::OctoPrint => {
            let v = get_json(t, "/api/version").await?;
            let server = v["server"].as_str().ok_or("Unexpected response. Is this OctoPrint?")?;
            let state = get_json(t, "/api/connection")
                .await
                .ok()
                .and_then(|c| c["current"]["state"].as_str().map(str::to_string))
                .unwrap_or_else(|| "unknown".into());
            Ok(format!("OctoPrint {server} · printer state: {state}"))
        }
        Kind::Moonraker => {
            let v = get_json(t, "/server/info").await?;
            let r = &v["result"];
            let version = r["moonraker_version"].as_str().ok_or("Unexpected response. Is this Moonraker?")?;
            let klippy = r["klippy_state"].as_str().unwrap_or("unknown");
            Ok(format!(
                "Moonraker {version} · Klipper {klippy} · Moonraker support is untested"
            ))
        }
    }
}

pub async fn status(t: &Target) -> Result<PrinterStatus, String> {
    match t.kind {
        Kind::OctoPrint => octo_status(t).await,
        Kind::Moonraker => moon_status(t).await,
    }
}

async fn octo_status(t: &Target) -> Result<PrinterStatus, String> {
    let conn = get_json(t, "/api/connection").await?;
    let state = conn["current"]["state"].as_str().unwrap_or("Unknown").to_string();
    let closed = ["Closed", "Offline", "Unknown"].iter().any(|s| state.starts_with(s));
    let mut s = PrinterStatus { online: !closed, state, ..Default::default() };
    if closed {
        return Ok(s);
    }

    let resp = request(t, Method::GET, "/api/printer").send().await.map_err(describe)?;
    if resp.status() != StatusCode::CONFLICT {
        let v: Value = check(resp)?.json().await.map_err(|_| "Unexpected response from OctoPrint".to_string())?;
        s.hotend = temp(&v["temperature"]["tool0"]);
        s.bed = temp(&v["temperature"]["bed"]);
    }

    if let Ok(job) = get_json(t, "/api/job").await {
        s.progress = job["progress"]["completion"].as_f64();
        s.time_left_secs = job["progress"]["printTimeLeft"].as_u64();
        s.file = job["job"]["file"]["name"].as_str().map(str::to_string);
        s.file_pos = job["progress"]["filepos"].as_u64();
        s.file_size = job["job"]["file"]["size"].as_u64();
    }
    Ok(s)
}

async fn moon_status(t: &Target) -> Result<PrinterStatus, String> {
    let info = get_json(t, "/server/info").await?;
    let klippy = info["result"]["klippy_state"].as_str().unwrap_or("unknown");
    if klippy != "ready" {
        return Ok(PrinterStatus { online: false, state: format!("Klipper {klippy}"), ..Default::default() });
    }
    let q = get_json(t, "/printer/objects/query?extruder&heater_bed&print_stats&virtual_sdcard").await?;
    let st = &q["result"]["status"];
    let file = st["print_stats"]["filename"].as_str().filter(|f| !f.is_empty()).map(str::to_string);
    Ok(PrinterStatus {
        online: true,
        state: capitalize(st["print_stats"]["state"].as_str().unwrap_or("ready")),
        hotend: temp(&st["extruder"]),
        bed: temp(&st["heater_bed"]),
        progress: st["virtual_sdcard"]["progress"].as_f64().map(|p| p * 100.0),
        file,
        time_left_secs: None,
        file_pos: None,
        file_size: None,
    })
}

pub async fn send_gcode(t: &Target, lines: &[String]) -> Result<(), String> {
    let r = match t.kind {
        Kind::OctoPrint => request(t, Method::POST, "/api/printer/command").json(&json!({ "commands": lines })),
        Kind::Moonraker => request(t, Method::POST, "/printer/gcode/script").json(&json!({ "script": lines.join("\n") })),
    };
    send(r).await.map(|_| ())
}

pub async fn upload(t: &Target, path: &str, start: bool) -> Result<String, String> {
    let path = Path::new(path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["gcode", "gco", "g"].contains(&ext.as_str()) {
        return Err("Only .gcode, .gco and .g files can be uploaded".into());
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid file name")?
        .to_string();
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err("File is larger than 200 MB".into());
    }
    let owned = path.to_path_buf();
    let data = tauri::async_runtime::spawn_blocking(move || std::fs::read(owned))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Cannot read file: {e}"))?;

    let part = multipart::Part::bytes(data)
        .file_name(name.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let flag = start.to_string();
    let (endpoint, form) = match t.kind {
        Kind::OctoPrint => (
            "/api/files/local",
            multipart::Form::new().part("file", part).text("select", flag.clone()).text("print", flag),
        ),
        Kind::Moonraker => (
            "/server/files/upload",
            multipart::Form::new().part("file", part).text("root", "gcodes").text("print", flag),
        ),
    };
    send(request(t, Method::POST, endpoint).timeout(Duration::from_secs(300)).multipart(form)).await?;
    Ok(if start { format!("Uploaded {name} and started printing") } else { format!("Uploaded {name}") })
}

fn enc(path: &str) -> Result<String, String> {
    if path.is_empty() || path.len() > 300 || path.contains(['\\', '\0']) || path.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err("Invalid file path".into());
    }
    let mut u = reqwest::Url::parse("http://x/").unwrap();
    u.path_segments_mut().unwrap().extend(path.split('/'));
    Ok(u.path().to_string())
}

pub async fn list_files(t: &Target) -> Result<Vec<RemoteFile>, String> {
    let mut out = Vec::new();
    match t.kind {
        Kind::OctoPrint => {
            let v = get_json(t, "/api/files/local?recursive=true").await?;
            fn walk(items: &Value, out: &mut Vec<RemoteFile>) {
                for f in items.as_array().into_iter().flatten() {
                    if f["type"] == "folder" {
                        walk(&f["children"], out);
                    } else if f["type"] == "machinecode" {
                        let last = &f["prints"]["last"];
                        out.push(RemoteFile {
                            path: f["path"].as_str().or(f["name"].as_str()).unwrap_or("").to_string(),
                            size: f["size"].as_u64().unwrap_or(0),
                            modified: f["date"].as_u64().unwrap_or(0),
                            last_print: last["date"].as_f64().map(|d| d as u64),
                            last_success: last["success"].as_bool(),
                        });
                    }
                }
            }
            walk(&v["files"], &mut out);
        }
        Kind::Moonraker => {
            let v = get_json(t, "/server/files/list?root=gcodes").await?;
            for f in v["result"].as_array().into_iter().flatten() {
                out.push(RemoteFile {
                    path: f["path"].as_str().unwrap_or("").to_string(),
                    size: f["size"].as_u64().unwrap_or(0),
                    modified: f["modified"].as_f64().unwrap_or(0.0) as u64,
                    last_print: None,
                    last_success: None,
                });
            }
        }
    }
    out.retain(|f| !f.path.is_empty());
    Ok(out)
}

const MAX_DOWNLOAD_BYTES: usize = 60 * 1024 * 1024;

pub async fn download(t: &Target, path: &str) -> Result<String, String> {
    let p = match t.kind {
        Kind::OctoPrint => format!("/downloads/files/local{}", enc(path)?),
        Kind::Moonraker => format!("/server/files/gcodes{}", enc(path)?),
    };
    let mut resp = send(request(t, Method::GET, &p).timeout(Duration::from_secs(120))).await?;
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(describe)? {
        if buf.len() + chunk.len() > MAX_DOWNLOAD_BYTES {
            return Err("File is larger than 60 MB; it is too big to preview".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub async fn job_command(t: &Target, action: &str) -> Result<(), String> {
    let r = match (t.kind, action) {
        (Kind::OctoPrint, "pause") => request(t, Method::POST, "/api/job").json(&json!({"command":"pause","action":"pause"})),
        (Kind::OctoPrint, "resume") => request(t, Method::POST, "/api/job").json(&json!({"command":"pause","action":"resume"})),
        (Kind::OctoPrint, "cancel") => request(t, Method::POST, "/api/job").json(&json!({"command":"cancel"})),
        (Kind::Moonraker, "pause") => request(t, Method::POST, "/printer/print/pause"),
        (Kind::Moonraker, "resume") => request(t, Method::POST, "/printer/print/resume"),
        (Kind::Moonraker, "cancel") => request(t, Method::POST, "/printer/print/cancel"),
        _ => return Err("Unknown job action".into()),
    };
    send(r).await.map(|_| ())
}

pub async fn start_print(t: &Target, path: &str) -> Result<(), String> {
    let r = match t.kind {
        Kind::OctoPrint => request(t, Method::POST, &format!("/api/files/local{}", enc(path)?))
            .json(&json!({"command":"select","print":true})),
        Kind::Moonraker => request(t, Method::POST, "/printer/print/start").json(&json!({"filename": path})),
    };
    send(r).await.map(|_| ())
}

pub fn check_camera_url(url: &str) -> Result<(), String> {
    let u = reqwest::Url::parse(url).map_err(|_| "Camera URL is not valid (example: http://octopi.local/webcam/?action=stream)".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("Camera URL must start with http:// or https://".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Camera URL must not contain credentials".into());
    }
    Ok(())
}

fn resolve_camera(base: &str, raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("The server has no webcam configured".into());
    }
    let b = reqwest::Url::parse(&format!("{base}/")).map_err(|e| e.to_string())?;
    let full = b.join(raw).map_err(|_| "The server returned an invalid webcam address".to_string())?;
    check_camera_url(full.as_str())?;
    Ok(full.to_string())
}

pub async fn camera_url(t: &Target) -> Result<String, String> {
    match t.kind {
        Kind::OctoPrint => {
            let v = get_json(t, "/api/settings").await?;
            let raw = v["webcam"]["streamUrl"].as_str().unwrap_or("");
            resolve_camera(&t.base, raw).map_err(|e| format!("{e}. Set a camera URL in the printer settings"))
        }
        Kind::Moonraker => {
            let v = get_json(t, "/server/webcam/list").await?;
            let cam = v["result"]["webcams"]
                .as_array()
                .and_then(|a| a.iter().find(|c| c["enabled"].as_bool().unwrap_or(true)))
                .ok_or("The server has no webcam configured. Set a camera URL in the printer settings")?;
            let raw = cam["stream_url"].as_str().or_else(|| cam["snapshot_url"].as_str()).unwrap_or("");
            resolve_camera(&t.base, raw)
        }
    }
}
