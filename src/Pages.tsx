import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button, Icon, PageHeader } from "./App";
import { fmtDuration, parseGcode, validateGcode, type GcodeWarning } from "./gcode";
import { baseName, fmtWhen, useRemoteGcode } from "./Live";
import { ToolpathViewer } from "./ToolpathViewer";
import { PathTools } from "./PathTools";
import { movePath } from "./gcodeEdit";
import { tempDir, join } from "@tauri-apps/api/path";
import {
  fetchRemoteGcode,
  listRemoteFiles,
  readGcodeFile,
  startRemotePrint,
  uploadGcode,
  writeGcodeFile,
  type PrinterPreset,
  type RemoteFile,
} from "./printers";
import { invoke } from "@tauri-apps/api/core";

export interface EditorDoc {
  name: string;
  text: string;
  path?: string;
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const GCODE_FILTER = [{ name: "G-code", extensions: ["gcode", "gco", "g"] }];

function PrinterPicker({ printers, value, onChange }: { printers: PrinterPreset[]; value?: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

export function FilesPage({
  printers,
  selectedId,
  onOpenInEditor,
}: {
  printers: PrinterPreset[];
  selectedId?: string;
  onOpenInEditor: (doc: EditorDoc) => void;
}) {
  const networked = printers.filter((p) => p.connection !== "usb");
  const [printerId, setPrinterId] = useState(selectedId);
  const printer = networked.find((p) => p.id === printerId) ?? networked[0];
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [layer, setLayer] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!printer) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    listRemoteFiles(printer.id)
      .then((f) => !cancelled && setFiles(f.sort((a, b) => b.modified - a.modified)))
      .catch((e) => !cancelled && (setError(String(e)), setFiles([])))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [printer?.id, nonce]);

  const { gcode, loading: parsing, error: previewError } = useRemoteGcode(printer?.id, picked, !!picked);
  useEffect(() => {
    if (gcode) setLayer(gcode.layers.length - 1);
  }, [gcode]);
  useEffect(() => {
    setPicked(null);
    setConfirm(false);
  }, [printer?.id]);

  const shown = useMemo(() => files.filter((f) => f.path.toLowerCase().includes(search.toLowerCase())), [files, search]);

  if (!printer) {
    return (
      <div className="module-page">
        <PageHeader title="Files" description="G-code stored on your OctoPrint or Moonraker printers." />
        <p className="empty-note">Add an OctoPrint or Moonraker printer to browse its files. USB printers have no file storage.</p>
      </div>
    );
  }

  const importFile = async () => {
    setNotice("");
    const path = await open({ multiple: false, filters: GCODE_FILTER });
    if (typeof path !== "string") return;
    try {
      setNotice(await uploadGcode(printer.id, path, false));
      setNonce((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  };
  const print = async (f: RemoteFile) => {
    setNotice("");
    setError("");
    try {
      await startRemotePrint(printer.id, f.path);
      setNotice(`Started ${baseName(f.path)}`);
    } catch (e) {
      setError(String(e));
    }
    setConfirm(false);
  };
  const edit = async (f: RemoteFile) => {
    try {
      onOpenInEditor({ name: baseName(f.path), text: await fetchRemoteGcode(printer.id, f.path) });
    } catch (e) {
      setError(String(e));
    }
  };
  const sel = files.find((f) => f.path === picked);

  return (
    <div className="module-page">
      <PageHeader
        title="Files"
        description={`G-code stored on ${printer.name}.`}
        action={<Button variant="primary" onClick={importFile}><Icon name="upload" size={15} /> Upload</Button>}
      />
      {error && <p className="preset-error">{error}</p>}
      {notice && !error && <p className="empty-note">{notice}</p>}
      <div className="files-layout">
        <section className="panel file-browser">
          <div className="file-toolbar">
            <div className="breadcrumbs"><PrinterPicker printers={networked} value={printer.id} onChange={setPrinterId} /></div>
            <input placeholder="Search files…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
          </div>
          <div className="data-table">
            <div className="table-head"><span>Name</span><span>Size</span><span>Modified</span><span>Last print</span><span /></div>
            {loading && <p className="empty-note">Loading…</p>}
            {!loading && shown.length === 0 && !error && <p className="empty-note">No g-code files.</p>}
            {shown.map((f) => (
              <button className={`table-row ${picked === f.path ? "selected" : ""}`} key={f.path} onClick={() => { setPicked(f.path); setConfirm(false); }}>
                <span><span className="file-type-icon"><Icon name="code" size={15} /></span><strong>{f.path}</strong></span>
                <span>{fmtSize(f.size)}</span>
                <span>{f.modified ? fmtWhen(f.modified) : "—"}</span>
                <span>{f.lastPrint ? `${f.lastSuccess === false ? "Failed" : "Done"} · ${fmtWhen(f.lastPrint)}` : "Never"}</span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </section>
        <aside className="panel file-preview">
          {sel ? (
            <>
              <div className="stage-toolbar"><span>{baseName(sel.path)}</span><span className="mono-label">{gcode ? `${gcode.layers.length} layers` : ""}</span></div>
              <div className="model-preview">
                {gcode?.layers.length ? <ToolpathViewer gcode={gcode} layer={layer} bedWidth={printer.bedWidth} bedDepth={printer.bedDepth} /> : <div className="preview-empty">{parsing ? "Loading toolpath…" : previewError || "No toolpath in this file."}</div>}
              </div>
              {gcode?.layers.length ? <div className="layer-control"><span>{gcode.layers.length}</span><input type="range" min={0} max={gcode.layers.length - 1} value={layer} onChange={(e) => setLayer(+e.target.value)} /><span>1</span></div> : null}
              {gcode && <div className="gcode-stats"><div><span>Est. time</span><strong>{fmtDuration(gcode.seconds)}</strong></div><div><span>Height</span><strong>{gcode.bounds.maxZ.toFixed(1)} mm</strong></div></div>}
              <div className="preview-actions">
                <Button onClick={() => edit(sel)}><Icon name="code" size={15} /> Edit</Button>
                {confirm ? (
                  <><Button variant="primary" onClick={() => print(sel)}>Confirm print</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></>
                ) : (
                  <Button variant="primary" onClick={() => setConfirm(true)}><Icon name="play" size={15} /> Print</Button>
                )}
              </div>
            </>
          ) : (
            <p className="empty-note">Select a file to preview its toolpath.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export function GcodePage({
  doc,
  onDoc,
  printers,
  selectedId,
}: {
  doc: EditorDoc | null;
  onDoc: (d: EditorDoc | null) => void;
  printers: PrinterPreset[];
  selectedId?: string;
}) {
  const printer = printers.find((p) => p.id === selectedId) ?? printers[0];
  const [text, setText] = useState(doc?.text ?? "");
  const [dirty, setDirty] = useState(false);
  const [parsedText, setParsedText] = useState(text);
  const [layer, setLayer] = useState(0);
  const [warnings, setWarnings] = useState<GcodeWarning[] | null>(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [selPath, setSelPath] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSelPath(null);
    setText(doc?.text ?? "");
    setParsedText(doc?.text ?? "");
    setDirty(false);
    setWarnings(null);
  }, [doc]);
  useEffect(() => {
    const t = setTimeout(() => setParsedText(text), 600);
    return () => clearTimeout(t);
  }, [text]);

  const parsed = useMemo(() => (parsedText ? parseGcode(parsedText) : null), [parsedText]);
  useEffect(() => {
    if (parsed) setLayer(Math.max(0, parsed.layers.length - 1));
  }, [parsed]);

  const run = async (fn: () => Promise<string | void>) => {
    setErr("");
    setMsg("");
    try {
      setMsg((await fn()) ?? "");
    } catch (e) {
      setErr(String(e));
    }
  };

  const openLocal = () =>
    run(async () => {
      const path = await open({ multiple: false, filters: GCODE_FILTER });
      if (typeof path !== "string") return;
      onDoc({ name: baseName(path.replace(/\\/g, "/")), text: await readGcodeFile(path), path });
    });
  const saveDoc = () =>
    run(async () => {
      let path = doc?.path;
      if (!path) {
        const chosen = await save({ defaultPath: doc?.name ?? "untitled.gcode", filters: GCODE_FILTER });
        if (!chosen) return;
        path = chosen;
      }
      await writeGcodeFile(path, text);
      onDoc({ name: baseName(path.replace(/\\/g, "/")), text, path });
      return `Saved ${path}`;
    });
  const validate = () => {
    const w = validateGcode(text, printer?.maxHotendTemp ?? 300, printer?.maxBedTemp ?? 120, printer?.buildHeight ?? 1000);
    setWarnings(w);
    setMsg(w.length ? "" : "No problems found.");
  };
  const upload = () =>
  run(async () => {
    if (!printer || printer.connection === "usb") throw new Error("Select an OctoPrint or Moonraker printer first");
    const tmpPath = await join(await tempDir(), doc?.name ?? "untitled.gcode");
    try {
      await writeGcodeFile(tmpPath, text);
      return await uploadGcode(printer.id, tmpPath, false);
    } finally {
      await invoke("remove_temp_gcode", { path: tmpPath }).catch(() => {});
    }
  });

  const edit = (next: string, note: string) => {
    setText(next);
    setParsedText(next);
    setDirty(true);
    setMsg(note);
  };
  const showLines = (first: number, last: number) => {
    const el = area.current;
    if (!el) return;
    const ls = text.split("\n");
    let a = 0;
    for (let i = 0; i < first; i++) a += ls[i].length + 1;
    let b = a;
    for (let i = first; i <= last; i++) b += ls[i].length + 1;
    el.focus({ preventScroll: true });
    el.setSelectionRange(a, Math.max(a, b - 1));
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, first * lh - el.clientHeight / 3);
  };
  const selectPath = (i: number | null) => {
    setSelPath(i);
    if (i !== null && parsed?.paths[i]) setLayer(parsed.paths[i].layer);
  };

  const lines = text ? text.split("\n").length : 0;
  const onCursor = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart);
    const ln = before.split("\n").length;
    setCursor({ ln, col: before.length - before.lastIndexOf("\n") });
  };

  return (
    <div className="module-page">
      <PageHeader
        title="G-code editor"
        description="Inspect and edit printer instructions."
        action={
          <>
            <Button onClick={openLocal}>Open</Button>
            <Button onClick={validate}>Validate</Button>
            <Button onClick={saveDoc}>Save</Button>
            <Button variant="primary" onClick={upload}><Icon name="upload" size={15} /> Upload</Button>
          </>
        }
      />
      {err && <p className="preset-error">{err}</p>}
      {msg && !err && <p className="empty-note">{msg}</p>}
      <div className="editor-layout">
        <section className="panel code-panel">
          <div className="editor-tabs"><span className="active">{doc?.name ?? "untitled.gcode"}{dirty ? " •" : ""}</span></div>
          <textarea
            ref={area}
            className="code-area"
            spellCheck={false}
            value={text}
            placeholder="Open a file, or open one from the Files page…"
            onChange={(e) => { setText(e.target.value); setDirty(true); onCursor(e.target); }}
            onKeyUp={(e) => onCursor(e.currentTarget)}
            onClick={(e) => onCursor(e.currentTarget)}
          />
          <div className="editor-status"><span>Ln {cursor.ln.toLocaleString()} · Col {cursor.col}</span><span>{lines.toLocaleString()} lines · UTF-8</span></div>
        </section>
        <aside className="panel gcode-preview">
          <div className="stage-toolbar"><span>Toolpath preview</span><span className="mono-label">{parsed?.layers.length ? `LAYER ${layer + 1} / ${parsed.layers.length}` : ""}</span></div>
          <div className="model-preview">
            {parsed?.layers.length ? <ToolpathViewer gcode={parsed} layer={layer} bedWidth={printer?.bedWidth} bedDepth={printer?.bedDepth}
              selectedPath={selPath} onPick={selectPath}
              onDrag={(dx, dy) => {
                const p = selPath !== null ? parsed.paths[selPath] : undefined;
                const out = p ? movePath(text, p, dx, dy, 0) : null;
                if (out !== null) edit(out, `Moved path by ${dx.toFixed(2)}, ${dy.toFixed(2)} mm`);
                else setErr("This path uses relative moves (G91) and can't be moved.");
              }} /> : <div className="preview-empty">No extrusion moves to show.</div>}
          </div>
          {parsed?.layers.length ? <div className="layer-control"><span>{parsed.layers.length}</span><input type="range" min={0} max={parsed.layers.length - 1} value={layer} onChange={(e) => setLayer(+e.target.value)} /><span>1</span></div> : null}
          <div className="gcode-stats">
            <div><span>Moves</span><strong>{parsed ? parsed.moves.toLocaleString() : "—"}</strong></div>
            <div><span>Est. time</span><strong>{parsed ? fmtDuration(parsed.seconds) : "—"}</strong></div>
            <div><span>Warnings</span><strong className={warnings?.length ? "warn-text" : "ok-text"}>{warnings ? (warnings.length || "None") : "—"}</strong></div>
          </div>
          {parsed && <PathTools text={text} parsed={parsed} layer={layer} selected={selPath} onSelect={selectPath} onEdit={edit} onShowLines={showLines} />}
          {warnings && warnings.length > 0 && (
            <ul className="warning-list">{warnings.slice(0, 50).map((w, i) => <li key={i}>Line {w.line}: {w.message}</li>)}</ul>
          )}
        </aside>
      </div>
    </div>
  );
}

interface Spool {
  id: string;
  brand: string;
  material: string;
  color: string;
  hex: string;
  total: number;
  remaining: number;
}

const SPOOL_KEY = "momonga.spools";
const loadSpools = (): Spool[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SPOOL_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function FilamentPage() {
  const [spools, setSpools] = useState<Spool[]>(loadSpools);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ brand: "", material: "PLA", color: "", hex: "#222222", total: 1000 });
  const [error, setError] = useState("");

  useEffect(() => localStorage.setItem(SPOOL_KEY, JSON.stringify(spools)), [spools]);

  const add = () => {
    if (!draft.brand.trim()) return setError("Brand is required");
    if (!(draft.total > 0 && draft.total <= 10000)) return setError("Weight must be between 1 and 10000 g");
    setSpools([...spools, { ...draft, brand: draft.brand.trim(), color: draft.color.trim(), id: crypto.randomUUID(), remaining: draft.total }]);
    setAdding(false);
    setError("");
  };
  const update = (id: string, patch: Partial<Spool>) => setSpools(spools.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const totalG = spools.reduce((n, s) => n + s.remaining, 0);
  const low = spools.filter((s) => s.remaining < 250).length;
  const materials = new Set(spools.map((s) => s.material)).size;

  return (
    <div className="module-page">
      <PageHeader title="Filament" description="Spool inventory, saved on this computer." action={<Button variant="primary" onClick={() => setAdding(!adding)}><Icon name="plus" size={15} /> Add spool</Button>} />
      {adding && (
        <section className="panel form-section">
          <div className="form-grid">
            <label className="field"><span>Brand</span><input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></label>
            <label className="field"><span>Material</span><select value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })}>{["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "Other"].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="field"><span>Color name</span><input value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
            <label className="field"><span>Color</span><input type="color" value={draft.hex} onChange={(e) => setDraft({ ...draft, hex: e.target.value })} /></label>
            <label className="field"><span>Spool weight (g)</span><input type="number" value={draft.total} onChange={(e) => setDraft({ ...draft, total: +e.target.value })} /></label>
          </div>
          {error && <p className="preset-error">{error}</p>}
          <div className="form-actions"><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={add}>Add spool</Button></div>
        </section>
      )}
      <div className="filament-summary">
        <div className="panel"><span>Total spools</span><strong>{spools.length}</strong><small>{spools.filter((s) => s.remaining < s.total).length} started</small></div>
        <div className="panel"><span>Material on hand</span><strong>{(totalG / 1000).toFixed(1)} kg</strong><small>Across {materials} materials</small></div>
        <div className="panel"><span>Low stock</span><strong>{low}</strong><small>Below 250 g</small></div>
      </div>
      {spools.length === 0 && <p className="empty-note">No spools yet. Add one to start tracking filament.</p>}
      <div className="spool-grid">
        {spools.map((s) => {
          const pct = Math.max(0, Math.min(100, Math.round((s.remaining / s.total) * 100)));
          return (
            <div className="panel spool-card" key={s.id}>
              <div className="spool-visual" style={{ background: s.hex }}><div className="spool-hole" /></div>
              <div className="spool-info">
                <div><strong>{s.brand}</strong><span>{s.material}</span></div>
                <p>{s.color || "—"}</p>
                <div className="spool-track"><span style={{ width: `${pct}%` }} /></div>
                <div className="spool-weight"><span>{s.remaining} g remaining</span><span>{pct}%</span></div>
                <div className="spool-edit">
                  <input type="number" min={0} max={s.total} value={s.remaining} onChange={(e) => update(s.id, { remaining: Math.max(0, Math.min(s.total, +e.target.value || 0)) })} />
                  <Button onClick={() => setSpools(spools.filter((x) => x.id !== s.id))}>Remove</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
