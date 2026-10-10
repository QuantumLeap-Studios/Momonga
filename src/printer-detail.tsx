import { CameraView } from "./camera-view";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Icon, NoPrinter, PageHeader } from "./app";
import { MoonrakerWarning } from "./moonraker-warning";
import {
  connectionLabel,
  sendGcode,
  uploadGcode,
  usbConnect,
  usbDisconnect,
  usePrinterStatus,
  type PrinterPreset,
  type Temp,
} from "./printers";

const STEPS = [0.1, 1, 10, 50];
const MATERIALS = [
  { label: "PLA", hotend: 200, bed: 60 },
  { label: "PETG", hotend: 235, bed: 80 },
  { label: "ABS", hotend: 250, bed: 100 },
  { label: "Cooldown", hotend: 0, bed: 0 },
];

const fmtTemp = (t: Temp | null | undefined) =>
  t ? `${t.actual.toFixed(1)} / ${t.target.toFixed(0)}°C` : "—";
const fmtDuration = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export function PrinterDetailPage({
  printer,
  onNavigate,
}: {
  printer?: PrinterPreset;
  onNavigate: (page: string) => void;
}) {
  if (!printer) return <NoPrinter onNavigate={onNavigate} />;
  return (
    <PrinterDetail key={printer.id} printer={printer} onNavigate={onNavigate} />
  );
}

function PrinterDetail({
  printer,
  onNavigate,
}: {
  printer: PrinterPreset;
  onNavigate: (page: string) => void;
}) {
  const { status, error, refresh } = usePrinterStatus(printer.id);
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState(10);
  const [command, setCommand] = useState("");
  const [hotendTarget, setHotendTarget] = useState("200");
  const [bedTarget, setBedTarget] = useState("60");
  const [file, setFile] = useState("");
  const [startPrint, setStartPrint] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);

  const isUsb = printer.connection === "usb";
  const online = !!status?.online;
  const busy = /^(printing|paus)/i.test(status?.state ?? "");
  const canControl = online && !busy;

  const addLog = (line: string) => setLog((l) => [...l.slice(-299), line]);

  useEffect(() => {
    const unlisten = listen<{
      id: string;
      dir: "rx" | "tx" | "sys";
      text: string;
    }>("serial-line", (e) => {
      if (e.payload.id !== printer.id) return;
      const prefix = { rx: "", tx: "> ", sys: "// " }[e.payload.dir];
      addLog(prefix + e.payload.text);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [printer.id]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [log]);

  const run = async (lines: string[]) => {
    try {
      await sendGcode(printer.id, lines);
      if (!isUsb) lines.forEach((l) => addLog("> " + l));
    } catch (e) {
      addLog("// " + String(e));
    }
  };

  const jog = (axis: "X" | "Y" | "Z", dir: 1 | -1) =>
    run([
      "G91",
      `G1 ${axis}${dir * step} F${axis === "Z" ? 600 : 3000}`,
      "G90",
    ]);

  const toggleUsb = async () => {
    setConnecting(true);
    try {
      if (online) await usbDisconnect(printer.id);
      else await usbConnect(printer.id);
    } catch (e) {
      addLog("// " + String(e));
    }
    setConnecting(false);
    refresh();
  };

  const chooseFile = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "G-code", extensions: ["gcode", "gco", "g"] }],
    });
    if (typeof picked === "string") {
      setFile(picked);
      setUploadMsg(null);
    }
  };

  const upload = async () => {
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await uploadGcode(printer.id, file, startPrint);
      setUploadMsg({ ok: true, text });
      refresh();
    } catch (e) {
      setUploadMsg({ ok: false, text: String(e) });
    }
    setUploading(false);
  };

  const submitCommand = () => {
    const line = command.trim();
    if (!line) return;
    setCommand("");
    run([line]);
  };

  return (
    <div className="module-page">
      <PageHeader
        title={printer.name}
        description={`${printer.firmware} · ${connectionLabel(printer)}`}
        action={
          <Button onClick={() => onNavigate("Printer settings")}>
            <Icon name="settings" size={15} /> Printer settings
          </Button>
        }
      />
      {printer.connection === "moonraker" && <MoonrakerWarning />}

      <div className="printer-detail-grid">
        <section className="panel control-panel">
          <div className="section-title">
            <div>
              <span>Status</span>
            </div>
            {isUsb && (
              <Button
                onClick={toggleUsb}
                variant={online ? "default" : "primary"}
              >
                {connecting ? "…" : online ? "Disconnect" : "Connect"}
              </Button>
            )}
          </div>
          <div className="status-grid">
            <span>State</span>
            <b className={online ? "ok-text" : ""}>
              {error ? "Unreachable" : (status?.state ?? "Checking…")}
            </b>
            <span>Hotend</span>
            <b>{fmtTemp(status?.hotend)}</b>
            <span>Bed</span>
            <b>{fmtTemp(status?.bed)}</b>
            {status?.file && (
              <>
                <span>File</span>
                <b>{status.file}</b>
              </>
            )}
            {status?.progress != null && (
              <>
                <span>Progress</span>
                <b>{status.progress.toFixed(1)}%</b>
              </>
            )}
            {status?.timeLeftSecs != null && (
              <>
                <span>Time left</span>
                <b>{fmtDuration(status.timeLeftSecs)}</b>
              </>
            )}
          </div>
          {status?.progress != null && busy && (
            <div className="progress-track">
              <span style={{ width: `${status.progress}%` }} />
            </div>
          )}
          {error && <p className="preset-error">{error}</p>}
          {!error && isUsb && !online && (
            <p className="empty-note">
              Not connected. Port {printer.serialPort || "(not set)"} at{" "}
              {printer.baudRate} baud.
            </p>
          )}
        </section>

        <section className="panel control-panel camera-panel">
          <div className="section-title">
            <div>
              <span>Camera</span>
            </div>
          </div>
          <CameraView printerId={printer.id} cameraUrl={printer.cameraUrl} />
        </section>

        <section className="panel control-panel">
          <div className="section-title">
            <div>
              <span>Movement</span>
            </div>
            <div className="step-picker">
              {STEPS.map((s) => (
                <button
                  key={s}
                  className={s === step ? "selected" : ""}
                  onClick={() => setStep(s)}
                >
                  {s}
                </button>
              ))}
              <span className="mono-label">MM</span>
            </div>
          </div>
          <fieldset className="controls" disabled={!canControl}>
            <div className="jog-control">
              <button onClick={() => jog("Y", 1)}>Y+</button>
              <button onClick={() => jog("X", -1)}>X−</button>
              <button className="home-button" onClick={() => run(["G28"])}>
                Home
              </button>
              <button onClick={() => jog("X", 1)}>X+</button>
              <button onClick={() => jog("Y", -1)}>Y−</button>
            </div>
            <div className="z-row">
              <button onClick={() => jog("Z", 1)}>Z+</button>
              <button onClick={() => jog("Z", -1)}>Z−</button>
            </div>
          </fieldset>
          {!canControl && (
            <p className="empty-note">
              {busy
                ? "Controls are locked while printing."
                : "Connect to the printer to use controls."}
            </p>
          )}
        </section>

        <section className="panel control-panel">
          <div className="section-title">
            <div>
              <span>Temperature</span>
            </div>
          </div>
          <fieldset className="controls" disabled={!canControl}>
            <div className="temp-set">
              <label>
                Hotend (max {printer.maxHotendTemp}°C)
                <input
                  type="number"
                  value={hotendTarget}
                  onChange={(e) => setHotendTarget(e.target.value)}
                />
              </label>
              <Button
                onClick={() => run([`M104 S${Number(hotendTarget) || 0}`])}
              >
                Set
              </Button>
              <label>
                Bed (max {printer.maxBedTemp}°C)
                <input
                  type="number"
                  value={bedTarget}
                  onChange={(e) => setBedTarget(e.target.value)}
                />
              </label>
              <Button onClick={() => run([`M140 S${Number(bedTarget) || 0}`])}>
                Set
              </Button>
            </div>
            <div className="preset-row">
              {MATERIALS.map((m) => (
                <button
                  key={m.label}
                  onClick={() => run([`M104 S${m.hotend}`, `M140 S${m.bed}`])}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="panel control-panel">
          <div className="section-title">
            <div>
              <span>Upload G-code</span>
            </div>
          </div>
          {isUsb ? (
            <p className="empty-note">
              Uploading and printing over USB isn't supported yet. Use the
              console to send commands.
            </p>
          ) : (
            <div className="upload-box">
              <div className="file-pick">
                <Button onClick={chooseFile}>
                  <Icon name="upload" size={15} /> Choose file…
                </Button>
                <span title={file}>
                  {file ? file.split(/[\\/]/).pop() : "No file selected"}
                </span>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={startPrint}
                  onChange={(e) => setStartPrint(e.target.checked)}
                />
                <span>Start printing after upload</span>
              </label>
              <Button variant="primary" onClick={upload}>
                {uploading
                  ? "Uploading…"
                  : startPrint
                    ? "Upload and print"
                    : "Upload"}
              </Button>
              {uploadMsg && (
                <p className={uploadMsg.ok ? "ok-text" : "preset-error"}>
                  {uploadMsg.text}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="panel control-panel console-panel">
          <div className="section-title">
            <div>
              <span>Console</span>
            </div>
            <button className="text-button" onClick={() => setLog([])}>
              Clear
            </button>
          </div>
          <div className="console" ref={consoleRef}>
            {log.length === 0 ? (
              <span>No output yet</span>
            ) : (
              log.map((l, i) => <span key={i}>{l}</span>)
            )}
          </div>
          <form
            className="command-box"
            onSubmit={(e) => {
              e.preventDefault();
              submitCommand();
            }}
          >
            <input
              placeholder="Enter G-code command…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={!online}
            />
            <Button onClick={submitCommand}>Send</Button>
          </form>
        </section>
      </div>
    </div>
  );
}
