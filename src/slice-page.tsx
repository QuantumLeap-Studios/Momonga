import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Icon, PageHeader } from "./app";
import { SlicerViewport } from "./slicer-viewport";
import { loadModel, MODEL_EXTS } from "./modelIO";
import {
  bounds,
  cutMesh,
  mergeTris,
  newModel,
  worldTris,
  type Axis,
  type Model,
} from "./slicer/mesh";
import {
  DEFAULT_SETTINGS,
  MATERIALS,
  PROFILES,
  SETTING_GROUPS,
  validateSettings,
  type SliceSettings,
} from "./slicer/settings";
import type { SliceMessage, SliceRequest } from "./slicer/worker";
import type { SliceResult } from "./slicer/slice";
import { fmtDuration } from "./gcode";
import type { PrinterPreset } from "./printers";
import type { EditorDoc } from "./pages";

const STORE = "momonga.slicer.settings";
const DEFAULT_BED = { width: 220, depth: 220, height: 250 };

const loadSettings = (): SliceSettings => {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem(STORE) ?? "{}"),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

function SettingsModal({
  value,
  onChange,
  onClose,
}: {
  value: SliceSettings;
  onChange: (s: SliceSettings) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState(0);
  const set = (k: keyof SliceSettings, v: unknown) =>
    onChange({ ...value, [k]: v });
  const err = validateSettings(value);
  const g = SETTING_GROUPS[group];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal slicer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Slicer settings</strong>
          <Button variant="icon" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="modal-body">
          <nav className="modal-nav">
            {SETTING_GROUPS.map((x, i) => (
              <button
                key={x.title}
                className={i === group ? "selected" : ""}
                onClick={() => setGroup(i)}
              >
                {x.title}
              </button>
            ))}
          </nav>
          <div className="modal-fields">
            {g.fields.map((f) => (
              <label className="field" key={f.key} title={f.help}>
                <span>
                  {f.label}
                  {f.type === "number" && f.unit ? ` (${f.unit})` : ""}
                </span>
                {f.type === "number" && (
                  <input
                    type="number"
                    value={
                      Number.isFinite(value[f.key] as number)
                        ? (value[f.key] as number)
                        : ""
                    }
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    onChange={(e) =>
                      set(
                        f.key,
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                )}
                {f.type === "select" && (
                  <select
                    value={String(value[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
                {f.type === "check" && (
                  <input
                    type="checkbox"
                    checked={!!value[f.key]}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                )}
                {f.type === "text" && (
                  <textarea
                    rows={6}
                    value={String(value[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                    spellCheck={false}
                  />
                )}
                {f.help && <small>{f.help}</small>}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <span className="error-text">{err}</span>
          <Button onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function Num({
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
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : ""}
        onChange={(e) =>
          e.target.value !== "" && onChange(Number(e.target.value))
        }
      />
    </label>
  );
}

export function SlicePage({
  models,
  setModels,
  printers,
  printerId,
  onPrinter,
  onOpenInEditor,
  onError,
}: {
  models: Model[];
  setModels: (f: (m: Model[]) => Model[]) => void;
  printers: PrinterPreset[];
  printerId?: string;
  onPrinter: (id: string) => void;
  onOpenInEditor: (d: EditorDoc) => void;
  onError: (msg: string) => void;
}) {
  const printer = printers.find((p) => p.id === printerId) ?? printers[0];
  const bed = useMemo(
    () =>
      printer
        ? {
            width: printer.bedWidth,
            depth: printer.bedDepth,
            height: printer.buildHeight,
          }
        : DEFAULT_BED,
    [printer?.bedWidth, printer?.bedDepth, printer?.buildHeight],
  );
  const [settings, setSettings] = useState(loadSettings);
  const [profile, setProfile] = useState("0.20 mm Standard");
  const [material, setMaterial] = useState("PLA");
  const [showSettings, setShowSettings] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [cutOn, setCutOn] = useState(false);
  const [axis, setAxis] = useState<Axis>("z");
  const [offset, setOffset] = useState(10);
  const [progress, setProgress] = useState<{ f: number; msg: string } | null>(
    null,
  );
  const [result, setResult] = useState<SliceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const sel = models.find((m) => m.id === selId) ?? null;

  useEffect(
    () => localStorage.setItem(STORE, JSON.stringify(settings)),
    [settings],
  );
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (printer)
      setSettings((s) => ({
        ...s,
        flavor: printer.firmware === "Klipper" ? "klipper" : "marlin",
      }));
  }, [printer?.id, printer?.firmware]);

  const patch = (id: string, p: Partial<Model>) => {
    setModels((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
    setResult(null);
  };

  const importModels = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "3D models", extensions: MODEL_EXTS }],
    });
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) {
      try {
        const m = await loadModel(p);
        m.x = bed.width / 2;
        m.y = bed.depth / 2;
        setModels((ms) => [...ms, m]);
        setSelId(m.id);
      } catch (e) {
        onError(String(e));
      }
    }
    setResult(null);
  };

  const arrange = () => {
    const items = models.map((m) => ({ m, b: bounds(worldTris(m)) }));
    const gap = 5;
    let x = gap,
      y = gap,
      rowH = 0;
    const out = new Map<string, [number, number]>();
    for (const { m, b } of items) {
      const w = b.max[0] - b.min[0],
        d = b.max[1] - b.min[1];
      if (x + w > bed.width && x > gap) {
        x = gap;
        y += rowH + gap;
        rowH = 0;
      }
      out.set(m.id, [x + w / 2, y + d / 2]);
      x += w + gap;
      rowH = Math.max(rowH, d);
    }
    setModels((ms) =>
      ms.map((m) =>
        out.has(m.id)
          ? { ...m, x: out.get(m.id)![0], y: out.get(m.id)![1] }
          : m,
      ),
    );
    setResult(null);
  };

  const selBounds = sel ? bounds(worldTris(sel)) : null;
  const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const range = selBounds
    ? [selBounds.min[axisIdx], selBounds.max[axisIdx]]
    : [0, 100];
  useEffect(() => {
    if (selBounds) setOffset(Math.round(((range[0] + range[1]) / 2) * 10) / 10);
  }, [selId, axis, cutOn]);

  const applyCut = () => {
    if (!sel) return;
    const { above, below } = cutMesh(worldTris(sel), axis, offset);
    const halves: Model[] = [];
    const gap = axis === "z" ? 0 : 3;
    for (const [tris, dir] of [
      [below, -1],
      [above, 1],
    ] as const) {
      if (!tris.length) continue;
      const b = bounds(tris);
      const m = newModel(`${sel.name}-${axis}${dir < 0 ? "lo" : "hi"}`, tris);
      m.x = (b.min[0] + b.max[0]) / 2 + (axis === "x" ? dir * gap : 0);
      m.y = (b.min[1] + b.max[1]) / 2 + (axis === "y" ? dir * gap : 0);
      halves.push(m);
    }
    if (halves.length < 2) {
      onError("The cut plane does not pass through the model.");
      return;
    }
    setModels((ms) => ms.flatMap((m) => (m.id === sel.id ? halves : [m])));
    setSelId(halves[0].id);
    setCutOn(false);
    setResult(null);
  };

  const slice = () => {
    setError(null);
    setResult(null);
    const bad = validateSettings(settings);
    if (bad) {
      setError(bad);
      return;
    }
    if (!models.length) {
      setError("Import a model first.");
      return;
    }
    const w = new Worker(new URL("./slicer/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    setProgress({ f: 0, msg: "Starting" });
    w.onmessage = (e: MessageEvent<SliceMessage>) => {
      const m = e.data;
      if (m.type === "progress") setProgress({ f: m.fraction, msg: m.message });
      else {
        setProgress(null);
        w.terminate();
        worker.current = null;
        if (m.type === "done") setResult(m.result);
        else setError(m.message);
      }
    };
    w.onerror = (e) => {
      setProgress(null);
      setError(e.message || "Slicer crashed");
      worker.current = null;
    };
    const req: SliceRequest = {
      tris: mergeTris(models.map(worldTris)),
      settings,
      bed,
    };
    w.postMessage(req);
  };
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  };

  const send = () => {
    if (!result) return;
    const base = (models[0]?.name ?? "model").replace(/\s+/g, "_");
    onOpenInEditor({ name: `${base}.gcode`, text: result.gcode });
  };

  return (
    <div className="module-page">
      <PageHeader
        title="Slice"
        description="Turn a model into g-code"
        action={
          <Button variant="primary" onClick={importModels}>
            <Icon name="upload" size={16} /> Import model
          </Button>
        }
      />
      <div className="slicer-layout">
        <section className="panel slicer-stage">
          <div className="stage-toolbar">
            <span>
              {models.length
                ? `${models.length} model${models.length > 1 ? "s" : ""}`
                : "Waiting for a model... Cmon, import something!"}
            </span>
            <div>
              <Button onClick={arrange} disabled={models.length < 2}>
                Arrange
              </Button>
            </div>
          </div>
          <div className="slicer-canvas">
            <SlicerViewport
              bed={bed}
              models={models}
              selectedId={selId}
              onSelect={setSelId}
              onMove={(id, x, y) => patch(id, { x, y })}
              cut={cutOn && sel ? { axis, offset } : null}
            />
            {sel && cutOn && (
              <div className="transform-bar cut-bar">
                <strong>Cut plane</strong>
                <select
                  value={axis}
                  onChange={(e) => setAxis(e.target.value as Axis)}
                >
                  <option value="z">Horizontal (Z)</option>
                  <option value="x">Vertical (X)</option>
                  <option value="y">Vertical (Y)</option>
                </select>
                <input
                  type="range"
                  min={range[0]}
                  max={range[1]}
                  step={0.1}
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                />
                <Num
                  label={`${axis.toUpperCase()} mm`}
                  value={offset}
                  step={0.5}
                  onChange={setOffset}
                />
                <Button variant="primary" onClick={applyCut}>
                  Apply cut
                </Button>
              </div>
            )}
          </div>
          {!sel && (
            <div className="transform-bar">
              <span className="dim" style={{ marginLeft: 0 }}>
                Click a model to select it, drag it to move it.
              </span>
            </div>
          )}
          {sel && (
            <div className="transform-bar">
              <strong>{sel.name}</strong>
              <Num
                label="X"
                value={sel.x}
                onChange={(v) => patch(sel.id, { x: v })}
              />
              <Num
                label="Y"
                value={sel.y}
                onChange={(v) => patch(sel.id, { y: v })}
              />
              <Num
                label="Rot X°"
                value={sel.rot[0]}
                step={15}
                onChange={(v) =>
                  patch(sel.id, { rot: [v, sel.rot[1], sel.rot[2]] })
                }
              />
              <Num
                label="Rot Y°"
                value={sel.rot[1]}
                step={15}
                onChange={(v) =>
                  patch(sel.id, { rot: [sel.rot[0], v, sel.rot[2]] })
                }
              />
              <Num
                label="Rot Z°"
                value={sel.rot[2]}
                step={15}
                onChange={(v) =>
                  patch(sel.id, { rot: [sel.rot[0], sel.rot[1], v] })
                }
              />
              <Num
                label="Scale %"
                value={sel.scale[0] * 100}
                step={5}
                onChange={(v) =>
                  v > 0 && patch(sel.id, { scale: [v / 100, v / 100, v / 100] })
                }
              />
              {selBounds && (
                <span className="dim">
                  {(selBounds.max[0] - selBounds.min[0]).toFixed(1)} ×{" "}
                  {(selBounds.max[1] - selBounds.min[1]).toFixed(1)} ×{" "}
                  {(selBounds.max[2] - selBounds.min[2]).toFixed(1)} mm
                </span>
              )}
              <Button onClick={() => setCutOn((v) => !v)}>
                {cutOn ? "Close cut" : "Cut…"}
              </Button>
              <Button
                onClick={() => {
                  setModels((ms) => ms.filter((m) => m.id !== sel.id));
                  setSelId(null);
                  setResult(null);
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </section>
        <aside className="panel slicer-settings">
          <div className="settings-block">
            <strong>Print setup</strong>
            <label className="field">
              <span>Printer</span>
              <select
                value={printer?.id ?? ""}
                onChange={(e) => onPrinter(e.target.value)}
              >
                {!printers.length && (
                  <option value="">Default 220 × 220 bed</option>
                )}
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Quality</span>
              <select
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  setSettings((s) => ({ ...s, ...PROFILES[e.target.value] }));
                }}
              >
                {Object.keys(PROFILES).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Material</span>
              <select
                value={material}
                onChange={(e) => {
                  setMaterial(e.target.value);
                  setSettings((s) => ({ ...s, ...MATERIALS[e.target.value] }));
                }}
              >
                {Object.keys(MATERIALS).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="settings-block setting-rows">
            <label>
              <span>Infill %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.infillDensity}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    infillDensity: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Supports</span>
              <select
                value={settings.support}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    support: e.target.value as SliceSettings["support"],
                  })
                }
              >
                <option value="none">Off</option>
                <option value="buildplate">Build plate only</option>
                <option value="everywhere">Everywhere</option>
              </select>
            </label>
            <label>
              <span>Adhesion</span>
              <select
                value={settings.adhesion}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    adhesion: e.target.value as SliceSettings["adhesion"],
                  })
                }
              >
                <option value="none">None</option>
                <option value="skirt">Skirt</option>
                <option value="brim">Brim</option>
              </select>
            </label>
          </div>
          <Button onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={16} /> All slicer settings…
          </Button>
          {progress && (
            <div className="slice-progress">
              <div className="bar">
                <span style={{ width: `${Math.round(progress.f * 100)}%` }} />
              </div>
              <small>
                {progress.msg} · {Math.round(progress.f * 100)}%
              </small>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          {result && (
            <>
              <div className="slice-estimate">
                <div>
                  <span>Estimated time</span>
                  <strong>{fmtDuration(result.seconds)}</strong>
                </div>
                <div>
                  <span>Filament</span>
                  <strong>{result.filamentGrams.toFixed(1)} g</strong>
                </div>
                <div>
                  <span>Layers</span>
                  <strong>{result.layers}</strong>
                </div>
              </div>
              {result.warnings.map((w) => (
                <p className="warn-text" key={w}>
                  {w}
                </p>
              ))}
            </>
          )}
          {progress ? (
            <Button onClick={cancel}>Cancel</Button>
          ) : result ? (
            <Button variant="primary" onClick={send}>
              <Icon name="code" size={16} /> Open in G-code editor
            </Button>
          ) : (
            <Button variant="primary" onClick={slice} disabled={!models.length}>
              <Icon name="cube" size={16} /> Slice model
            </Button>
          )}
          {result && !progress && <Button onClick={slice}>Re-slice</Button>}
        </aside>
      </div>
      {showSettings && (
        <SettingsModal
          value={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
