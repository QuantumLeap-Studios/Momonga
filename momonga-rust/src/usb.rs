use crate::net::{PrinterStatus, Temp};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

type Writer = Arc<Mutex<Box<dyn serialport::SerialPort>>>;

#[derive(Default)]
struct Shared {
    alive: bool,
    hotend: Option<Temp>,
    bed: Option<Temp>,
}

struct Conn {
    writer: Writer,
    stop: Arc<AtomicBool>,
    shared: Arc<Mutex<Shared>>,
}

#[derive(Default)]
pub struct UsbManager {
    conns: Mutex<HashMap<String, Conn>>,
}

#[derive(Serialize, Clone)]
struct ConsoleLine {
    id: String,
    dir: &'static str,
    text: String,
}

fn emit(app: &AppHandle, id: &str, dir: &'static str, text: impl Into<String>) {
    let _ = app.emit("serial-line", ConsoleLine { id: id.to_string(), dir, text: text.into() });
}

fn number(s: &str) -> Option<(f64, &str)> {
    let end = s.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).unwrap_or(s.len());
    s[..end].parse().ok().map(|v| (v, &s[end..]))
}

fn pair(line: &str, key: &str) -> Option<Temp> {
    let i = line.find(key)?;
    if i > 0 && !line.as_bytes()[i - 1].is_ascii_whitespace() {
        return None;
    }
    let (actual, rest) = number(&line[i + key.len()..])?;
    let target = rest
        .trim_start()
        .strip_prefix('/')
        .and_then(|r| number(r.trim_start()))
        .map(|(v, _)| v)
        .unwrap_or(0.0);
    Some(Temp { actual, target })
}

fn is_temp_report(line: &str) -> bool {
    line.starts_with("T:") || line.starts_with("ok T:")
}

impl UsbManager {
    pub fn connect(&self, app: &AppHandle, id: &str, port: &str, baud: u32) -> Result<(), String> {
        if port.trim().is_empty() {
            return Err("No serial port configured for this printer".into());
        }
        let mut conns = self.conns.lock().unwrap();
        if let Some(c) = conns.get(id) {
            if c.shared.lock().unwrap().alive {
                return Err("Already connected".into());
            }
            c.stop.store(true, Ordering::SeqCst);
            conns.remove(id);
        }

        let sp = serialport::new(port, baud)
            .timeout(Duration::from_millis(200))
            .open()
            .map_err(|e| format!("Could not open {port}: {e}"))?;
        let mut reader = sp.try_clone().map_err(|e| e.to_string())?;
        let writer: Writer = Arc::new(Mutex::new(sp));
        let stop = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(Mutex::new(Shared { alive: true, ..Default::default() }));

        {
            let (app, id, stop, shared) = (app.clone(), id.to_string(), stop.clone(), shared.clone());
            thread::spawn(move || {
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 512];
                while !stop.load(Ordering::SeqCst) {
                    match reader.read(&mut chunk) {
                        Ok(0) => thread::sleep(Duration::from_millis(10)),
                        Ok(n) => {
                            buf.extend_from_slice(&chunk[..n]);
                            while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                                let raw: Vec<u8> = buf.drain(..=pos).collect();
                                let line = String::from_utf8_lossy(&raw).trim().to_string();
                                if line.is_empty() {
                                    continue;
                                }
                                let hotend = pair(&line, "T:");
                                let bed = pair(&line, "B:");
                                if hotend.is_some() || bed.is_some() {
                                    let mut s = shared.lock().unwrap();
                                    s.hotend = hotend.or(s.hotend.take());
                                    s.bed = bed.or(s.bed.take());
                                }
                                if !is_temp_report(&line) {
                                    emit(&app, &id, "rx", line);
                                }
                            }
                            if buf.len() > 8192 {
                                buf.clear();
                            }
                        }
                        Err(e) if e.kind() == ErrorKind::TimedOut => {}
                        Err(_) => {
                            if !stop.swap(true, Ordering::SeqCst) {
                                emit(&app, &id, "sys", "Connection lost");
                            }
                            break;
                        }
                    }
                }
                shared.lock().unwrap().alive = false;
            });
        }

        {
            let (writer, stop, shared) = (writer.clone(), stop.clone(), shared.clone());
            thread::spawn(move || {
                'outer: loop {
                    for _ in 0..20 {
                        thread::sleep(Duration::from_millis(100));
                        if stop.load(Ordering::SeqCst) {
                            break 'outer;
                        }
                    }
                    let mut w = writer.lock().unwrap();
                    if w.write_all(b"M105\n").and_then(|_| w.flush()).is_err() {
                        shared.lock().unwrap().alive = false;
                        stop.store(true, Ordering::SeqCst);
                        break;
                    }
                }
            });
        }

        conns.insert(id.to_string(), Conn { writer, stop, shared });
        drop(conns);
        emit(app, id, "sys", format!("Connected to {port} at {baud} baud"));
        Ok(())
    }

    pub fn disconnect(&self, app: &AppHandle, id: &str) {
        if let Some(c) = self.conns.lock().unwrap().remove(id) {
            c.stop.store(true, Ordering::SeqCst);
            c.shared.lock().unwrap().alive = false;
            emit(app, id, "sys", "Disconnected");
        }
    }

    pub fn send(&self, app: &AppHandle, id: &str, lines: &[String]) -> Result<(), String> {
        let conns = self.conns.lock().unwrap();
        let c = conns.get(id).filter(|c| c.shared.lock().unwrap().alive).ok_or("Not connected")?;
        let mut w = c.writer.lock().unwrap();
        for line in lines {
            w.write_all(format!("{line}\n").as_bytes())
                .and_then(|_| w.flush())
                .map_err(|e| format!("Write failed: {e}"))?;
            emit(app, id, "tx", line.clone());
        }
        Ok(())
    }

    pub fn status(&self, id: &str) -> PrinterStatus {
        let conns = self.conns.lock().unwrap();
        match conns.get(id) {
            Some(c) => {
                let s = c.shared.lock().unwrap();
                PrinterStatus {
                    online: s.alive,
                    state: if s.alive { "Connected" } else { "Disconnected" }.into(),
                    hotend: s.hotend.clone(),
                    bed: s.bed.clone(),
                    ..Default::default()
                }
            }
            None => PrinterStatus { state: "Disconnected".into(), ..Default::default() },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marlin_and_klipper_temperature_reports() {
        let line = "ok T:21.34 /0.00 B:20.10 /60.00 @:0 B@:0";
        let t = pair(line, "T:").unwrap();
        assert_eq!((t.actual, t.target), (21.34, 0.0));
        let b = pair(line, "B:").unwrap();
        assert_eq!((b.actual, b.target), (20.1, 60.0));
        assert!(pair("echo: busy", "T:").is_none());
        assert!(pair("ok T:200.0", "B:").is_none());
        assert!(is_temp_report(line));
    }
}

