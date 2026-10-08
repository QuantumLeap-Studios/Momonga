import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Firmware = "Klipper" | "Marlin" | "RepRap";
export type ConnectionType = "usb" | "octoprint" | "moonraker";

export interface PrinterPreset {
  id: string;
  name: string;
  model: string;
  firmware: Firmware;
  bedWidth: number;
  bedDepth: number;
  buildHeight: number;
  nozzleDiameter: number;
  filamentDiameter: number;
  maxHotendTemp: number;
  maxBedTemp: number;
  connection: ConnectionType;
  serialPort: string;
  baudRate: number;
  url: string;
  apiKey: string;
  cameraUrl: string;
}

export const newPreset = (): PrinterPreset => ({
  id: "",
  name: "",
  model: "",
  firmware: "Marlin",
  bedWidth: 220,
  bedDepth: 220,
  buildHeight: 250,
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  maxHotendTemp: 260,
  maxBedTemp: 100,
  connection: "usb",
  serialPort: "",
  baudRate: 115200,
  url: "",
  apiKey: "",
  cameraUrl: "",
});

export const connectionLabel = (p: PrinterPreset) =>
  ({ usb: "USB", octoprint: "OctoPrint", moonraker: "Moonraker" })[p.connection];

export const cameraStreamUrl = (id: string) => invoke<string>("camera_stream_url", { id });
export const listPrinters = () => invoke<PrinterPreset[]>("list_printers");
export const savePrinter = (preset: PrinterPreset) => invoke<PrinterPreset>("save_printer", { preset });
export const deletePrinter = (id: string) => invoke<void>("delete_printer", { id });
export const openPresetWindow = (id?: string, opts?: { connection?: ConnectionType; port?: string }) =>
  invoke<void>("open_preset_window", { id: id ?? null, connection: opts?.connection ?? null, port: opts?.port ?? null });

export interface Temp {
  actual: number;
  target: number;
}

export interface PrinterStatus {
  online: boolean;
  state: string;
  hotend: Temp | null;
  bed: Temp | null;
  progress: number | null;
  file: string | null;
  timeLeftSecs: number | null;
  filePos: number | null;
  fileSize: number | null;
}

export interface RemoteFile {
  path: string;
  size: number;
  modified: number;
  lastPrint: number | null;
  lastSuccess: boolean | null;
}

export const testConnection = (kind: ConnectionType, url: string, apiKey: string) =>
  invoke<string>("test_connection", { kind, url, apiKey });
export const printerStatus = (id: string) => invoke<PrinterStatus>("printer_status", { id });
export const sendGcode = (id: string, lines: string[]) => invoke<void>("send_gcode", { id, lines });
export const uploadGcode = (id: string, path: string, startPrint: boolean) =>
  invoke<string>("upload_gcode", { id, path, startPrint });
export const listRemoteFiles = (id: string) => invoke<RemoteFile[]>("list_remote_files", { id });
export const fetchRemoteGcode = (id: string, path: string) => invoke<string>("fetch_remote_gcode", { id, path });
export const jobCommand = (id: string, action: "pause" | "resume" | "cancel") => invoke<void>("job_command", { id, action });
export const startRemotePrint = (id: string, path: string) => invoke<void>("start_remote_print", { id, path });
export const readGcodeFile = (path: string) => invoke<string>("read_gcode_file", { path });
export const writeGcodeFile = (path: string, text: string) => invoke<void>("write_gcode_file", { path, text });
export const listSerialPorts = () => invoke<string[]>("list_serial_ports");
export const usbConnect = (id: string) => invoke<void>("usb_connect", { id });
export const usbDisconnect = (id: string) => invoke<void>("usb_disconnect", { id });

export function usePrinterStatus(id: string | undefined, intervalMs = 2000) {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const s = await printerStatus(id);
        if (!cancelled) {
          setStatus(s);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus(null);
          setError(String(e));
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, intervalMs);
    };
    setStatus(null);
    setError("");
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, intervalMs, nonce]);

  return { status, error, refresh: () => setNonce((n) => n + 1) };
}

export function usePrinters() {
  const [printers, setPrinters] = useState<PrinterPreset[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setPrinters(await listPrinters());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen("presets-changed", refresh);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  return { printers, loaded, refresh };
}
