import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BedVisualizer, { type VisualizerMode } from "./bed-visualizer";
import { MoonrakerWarning } from "./moonraker-warning";
import {
  listPrinters,
  listSerialPorts,
  newPreset,
  savePrinter,
  testConnection,
  type ConnectionType,
  type Firmware,
  type PrinterPreset,
} from "./printers";

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

export function PresetFields({
  draft,
  onChange,
}: {
  draft: PrinterPreset;
  onChange: (next: PrinterPreset) => void;
}) {
  const set = <K extends keyof PrinterPreset>(
    key: K,
    value: PrinterPreset[K],
  ) => onChange({ ...draft, [key]: value });
  const [ports, setPorts] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (draft.connection === "usb") listSerialPorts().then(setPorts);
  }, [draft.connection]);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult({
        ok: true,
        text: await testConnection(draft.connection, draft.url, draft.apiKey),
      });
    } catch (err) {
      setResult({ ok: false, text: String(err) });
    }
    setTesting(false);
  };
  return (
    <>
      <section className="panel form-section">
        <div className="form-heading">
          <strong>Machine</strong>
          <span>Basic printer information and build volume.</span>
        </div>
        <div className="form-grid">
          <TextField
            label="Display name"
            value={draft.name}
            onChange={(v) => set("name", v)}
            placeholder="My printer"
          />
          <TextField
            label="Model"
            value={draft.model}
            onChange={(v) => set("model", v)}
          />
          <NumberField
            label="Width / X (mm)"
            value={draft.bedWidth}
            onChange={(v) => set("bedWidth", v)}
          />
          <NumberField
            label="Depth / Y (mm)"
            value={draft.bedDepth}
            onChange={(v) => set("bedDepth", v)}
          />
          <NumberField
            label="Height / Z (mm)"
            value={draft.buildHeight}
            onChange={(v) => set("buildHeight", v)}
          />
          <label className="field">
            <span>Firmware</span>
            <select
              value={draft.firmware}
              onChange={(e) => set("firmware", e.target.value as Firmware)}
            >
              <option>Klipper</option>
              <option>Marlin</option>
              <option>RepRap</option>
            </select>
          </label>
        </div>
      </section>
      <section className="panel form-section">
        <div className="form-heading">
          <strong>Extruder & limits</strong>
          <span>Nozzle, filament and temperature limits.</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Nozzle diameter (mm)"
            value={draft.nozzleDiameter}
            step={0.05}
            onChange={(v) => set("nozzleDiameter", v)}
          />
          <NumberField
            label="Filament diameter (mm)"
            value={draft.filamentDiameter}
            step={0.05}
            onChange={(v) => set("filamentDiameter", v)}
          />
          <NumberField
            label="Max hotend (°C)"
            value={draft.maxHotendTemp}
            onChange={(v) => set("maxHotendTemp", v)}
          />
          <NumberField
            label="Max bed (°C)"
            value={draft.maxBedTemp}
            onChange={(v) => set("maxBedTemp", v)}
          />
        </div>
      </section>
      <section className="panel form-section">
        <div className="form-heading">
          <strong>Connection</strong>
          <span>How Momonga will communicate with this printer.</span>
        </div>
        {draft.connection === "moonraker" && <MoonrakerWarning />}
        <div className="form-grid">
          <label className="field">
            <span>Connection type</span>
            <select
              value={draft.connection}
              onChange={(e) =>
                set("connection", e.target.value as ConnectionType)
              }
            >
              <option value="usb">USB serial</option>
              <option value="octoprint">OctoPrint</option>
              <option value="moonraker">Moonraker</option>
            </select>
          </label>
          {draft.connection === "usb" ? (
            <>
              <label className="field">
                <span>Serial port</span>
                <input
                  list="serial-ports"
                  value={draft.serialPort}
                  placeholder="COM3"
                  onChange={(e) => set("serialPort", e.target.value)}
                />
                <datalist id="serial-ports">
                  {ports.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <NumberField
                label="Baud rate"
                value={draft.baudRate}
                onChange={(v) => set("baudRate", v)}
              />
            </>
          ) : (
            <>
              <TextField
                label="Server URL"
                value={draft.url}
                onChange={(v) => set("url", v)}
                placeholder="http://printer.local"
              />
              <label className="field">
                <span>
                  API key{draft.connection === "moonraker" ? " (optional)" : ""}
                </span>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                />
              </label>
              <div className="field-wide test-row">
                <button
                  className="button"
                  type="button"
                  disabled={testing}
                  onClick={test}
                >
                  {testing ? "Testing…" : "Test connection"}
                </button>
                {result && (
                  <span className={result.ok ? "ok-text" : "preset-error"}>
                    {result.text}
                  </span>
                )}
              </div>
            </>
          )}
          <TextField
            label="Camera URL (optional)"
            value={draft.cameraUrl ?? ""}
            onChange={(v) => set("cameraUrl", v)}
            placeholder={
              draft.connection === "usb"
                ? "http://camera.local/stream"
                : "Leave empty to use the OctoPrint/Moonraker camera"
            }
          />
        </div>
      </section>
    </>
  );
}

export function PresetWindow() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const [draft, setDraft] = useState<PrinterPreset | null>(() => {
    if (id) return null;
    const conn = params.get("connection");
    return {
      ...newPreset(),
      connection: conn === "octoprint" || conn === "moonraker" ? conn : "usb",
      serialPort: params.get("port") ?? "",
    };
  });
  const [mode, setMode] = useState<VisualizerMode>("bed");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    listPrinters().then((all) => {
      const found = all.find((p) => p.id === id);
      if (found) setDraft(found);
      else setError("Preset not found");
    });
  }, [id]);

  const close = () => getCurrentWindow().close();

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await savePrinter(draft);
      await close();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  if (!draft)
    return (
      <div className="preset-window">
        <p className="preset-error">{error || "Loading…"}</p>
      </div>
    );

  return (
    <div className="preset-window">
      <div className="preset-form">
        <div className="module-title">
          {id ? "Edit printer preset" : "New printer preset"}
        </div>
        <PresetFields draft={draft} onChange={setDraft} />
      </div>
      <div className="preset-side">
        <section className="panel visualizer-panel">
          <div className="stage-toolbar">
            <div className="stage-tools">
              <button
                className={mode === "bed" ? "selected" : ""}
                onClick={() => setMode("bed")}
              >
                Build volume
              </button>
              <button
                className={mode === "nozzle" ? "selected" : ""}
                onClick={() => setMode("nozzle")}
              >
                Nozzle
              </button>
            </div>
            <span className="mono-label">
              {mode === "bed"
                ? `${draft.bedWidth} × ${draft.bedDepth} × ${draft.buildHeight} mm`
                : `Ø ${draft.nozzleDiameter} mm · filament ${draft.filamentDiameter} mm`}
            </span>
          </div>
          <BedVisualizer
            mode={mode}
            bedWidth={draft.bedWidth}
            bedDepth={draft.bedDepth}
            buildHeight={draft.buildHeight}
            nozzleDiameter={draft.nozzleDiameter}
            filamentDiameter={draft.filamentDiameter}
          />
          <div className="visualizer-hint">
            {mode === "bed"
              ? "Drag to orbit, scroll to zoom. Origin is the front-left corner."
              : "Nozzle shown at magnified scale next to a printed line."}
          </div>
        </section>
        {error && <p className="preset-error">{error}</p>}
        <div className="form-actions">
          <button className="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button button-primary"
            onClick={save}
            disabled={saving}
          >
            {id ? "Save changes" : "Create preset"}
          </button>
        </div>
      </div>
    </div>
  );
}
