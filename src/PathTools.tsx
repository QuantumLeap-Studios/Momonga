import { useEffect, useMemo, useState } from "react";
import { Button } from "./App";
import type { GPath, ParsedGcode } from "./gcode";
import { BUILTIN_SNIPPETS, deletePath, expandSnippet, insertLines, movePath, type Snippet } from "./gcodeEdit";

const KEY = "momonga.snippets";
const loadCustom = (): Snippet[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function PathTools({
  text, parsed, layer, selected, onSelect, onEdit, onShowLines,
}: {
  text: string;
  parsed: ParsedGcode;
  layer: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onEdit: (text: string, note: string) => void;
  onShowLines: (first: number, last: number) => void;
}) {
  const path: GPath | null = selected === null ? null : parsed.paths[selected] ?? null;
  const [pos, setPos] = useState<[string, string, string]>(["", "", ""]);
  const [step, setStep] = useState(1);
  const [custom, setCustom] = useState<Snippet[]>(loadCustom);
  const [snipId, setSnipId] = useState(BUILTIN_SNIPPETS[0].id);
  const all = useMemo(() => [...BUILTIN_SNIPPETS, ...custom], [custom]);
  const [template, setTemplate] = useState(BUILTIN_SNIPPETS[0].template);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (path) setPos([String(r3(path.start[0])), String(r3(path.start[1])), String(r3(path.start[2]))]);
  }, [path?.start[0], path?.start[1], path?.start[2], selected]);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(custom)), [custom]);
  useEffect(() => setErr(""), [selected]);

  const layerPaths = useMemo(() => parsed.paths.filter((p) => p.layer === layer), [parsed, layer]);
  const snip = all.find((s) => s.id === snipId);

  const apply = (dx: number, dy: number, dz: number) => {
    if (!path) return;
    const out = movePath(text, path, dx, dy, dz);
    if (out === null) setErr("This path uses relative moves (G91) and can't be moved.");
    else if (out !== text) { setErr(""); onEdit(out, "Moved path"); }
  };
  const applyAbsolute = () => {
    if (!path) return;
    const v = pos.map(Number);
    if (v.some((n) => !Number.isFinite(n))) { setErr("Enter numbers for X, Y and Z."); return; }
    apply(v[0] - path.start[0], v[1] - path.start[1], v[2] - path.start[2]);
  };

  const insert = (where: "before" | "after") => {
    const anchor = path ?? (where === "before" ? layerPaths[0] : layerPaths[layerPaths.length - 1]);
    if (!anchor) { setErr("Select a path or a layer with extrusion first."); return; }
    const at = where === "before" ? anchor.start : anchor.end;
    const snippet = expandSnippet(template, { x: at[0], y: at[1], z: at[2], layer: anchor.layer + 1, e: where === "before" ? anchor.eStart : anchor.eEnd, absE: anchor.absE });
    const line = where === "before" ? anchor.lineFirst : anchor.lineLast;
    setErr("");
    onEdit(insertLines(text, line, snippet, where === "after"), `Inserted ${snip?.name ?? "snippet"} ${where} ${path ? "path" : "layer"}`);
  };

  const remove = () => {
    if (!path) return;
    const out = deletePath(text, path);
    if (out === null) { setErr("This path uses relative moves (G91) and can't be deleted."); return; }
    onSelect(null);
    onEdit(out, "Deleted path");
  };

  const saveCustom = () => {
    const n = name.trim();
    if (!n) { setErr("Name the preset first."); return; }
    const s: Snippet = { id: crypto.randomUUID(), name: n, description: "Custom preset", template };
    setCustom([...custom, s]);
    setSnipId(s.id);
    setName("");
    setErr("");
  };

  const nudge = (axis: 0 | 1 | 2, sign: number) => apply(axis === 0 ? sign * step : 0, axis === 1 ? sign * step : 0, axis === 2 ? sign * step : 0);

  return (
    <div className="path-tools">
      <div className="path-head">
        <strong>{path ? `Path ${selected! + 1} of ${parsed.paths.length} · layer ${path.layer + 1}` : "No path selected"}</strong>
        <span>
          <Button variant="icon" title="Previous path" onClick={() => onSelect(selected === null ? parsed.paths.length - 1 : Math.max(0, selected - 1))}>‹</Button>
          <Button variant="icon" title="Next path" onClick={() => onSelect(selected === null ? 0 : Math.min(parsed.paths.length - 1, selected + 1))}>›</Button>
        </span>
      </div>
      {!path && <small>Click a toolpath in the preview to select it. Drag the highlighted path to move it.</small>}
      {path && (
        <>
          <div className="xyz-row">
            {(["X", "Y", "Z"] as const).map((a, i) => (
              <label key={a} className="num-field"><span>{a}</span>
                <input type="number" step="0.1" value={pos[i]} onChange={(e) => setPos(pos.map((v, j) => (j === i ? e.target.value : v)) as [string, string, string])}
                  onKeyDown={(e) => e.key === "Enter" && applyAbsolute()} />
              </label>
            ))}
            <Button variant="primary" onClick={applyAbsolute}>Move</Button>
          </div>
          <div className="nudge-row">
            <span>Nudge</span>
            <select value={step} onChange={(e) => setStep(Number(e.target.value))}>{[0.1, 0.5, 1, 5, 10].map((v) => <option key={v} value={v}>{v} mm</option>)}</select>
            {(["X", "Y", "Z"] as const).map((a, i) => (
              <span className="nudge" key={a}>
                <button onClick={() => nudge(i as 0 | 1 | 2, -1)}>−{a}</button><button onClick={() => nudge(i as 0 | 1 | 2, 1)}>+{a}</button>
              </span>
            ))}
          </div>
          <div className="path-actions">
            <Button onClick={() => onShowLines(path.lineFirst, path.lineLast)}>Show lines {path.lineFirst + 1}–{path.lineLast + 1}</Button>
            <Button variant="danger" onClick={remove}>Delete path</Button>
          </div>
          {!path.movable && <small className="warn-text">Relative moves (G91): editing disabled for this path.</small>}
        </>
      )}
      <div className="snippet-box">
        <strong>Insert g-code</strong>
        <select value={snipId} onChange={(e) => { setSnipId(e.target.value); const s = all.find((x) => x.id === e.target.value); if (s) setTemplate(s.template); }}>
          <optgroup label="Built-in">{BUILTIN_SNIPPETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          {custom.length > 0 && <optgroup label="Custom">{custom.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
        </select>
        {snip?.description && <small>{snip.description}</small>}
        <textarea className="snippet-text" rows={5} spellCheck={false} value={template} onChange={(e) => setTemplate(e.target.value)} />
        <small>Placeholders: {"{x} {y} {z} {layer} {e} {restoreE}"} — position of the path start (before) or end (after).</small>
        <div className="path-actions">
          <Button onClick={() => insert("before")}>{path ? "Insert before path" : "Insert at layer start"}</Button>
          <Button onClick={() => insert("after")}>{path ? "Insert after path" : "Insert at layer end"}</Button>
        </div>
        <div className="path-actions">
          <input placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={saveCustom}>Save preset</Button>
          {snip && !snip.builtin && <Button variant="danger" onClick={() => { setCustom(custom.filter((s) => s.id !== snip.id)); setSnipId(BUILTIN_SNIPPETS[0].id); setTemplate(BUILTIN_SNIPPETS[0].template); }}>Delete preset</Button>}
        </div>
      </div>
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}
