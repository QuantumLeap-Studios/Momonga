import { CameraView } from "./CameraView";
import { useEffect, useMemo, useState } from "react";
import { Button, Icon } from "./App";
import { fmtDuration, layerAtFraction, parseGcode, type ParsedGcode } from "./gcode";
import { ToolpathViewer } from "./ToolpathViewer";
import {
  fetchRemoteGcode,
  jobCommand,
  listRemoteFiles,
  printerStatus,
  type PrinterPreset,
  type PrinterStatus,
  type RemoteFile,
} from "./printers";

export interface Sample {
  hot: number | null;
  hotTarget: number;
  bed: number | null;
  bedTarget: number;
}

export interface FleetEntry {
  status: PrinterStatus | null;
  error: string;
}

const HISTORY = 120;
const POLL_MS = 3000;

export function useFleet(printers: PrinterPreset[]) {
  const [fleet, setFleet] = useState<Record<string, FleetEntry>>({});
  const [history, setHistory] = useState<Record<string, Sample[]>>({});
  const key = printers.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const ids = key ? key.split(",") : [];
    const tick = async () => {
      const results = await Promise.all(
        ids.map(async (id): Promise<[string, FleetEntry]> => {
          try {
            return [id, { status: await printerStatus(id), error: "" }];
          } catch (e) {
            return [id, { status: null, error: String(e) }];
          }
        }),
      );
      if (cancelled) return;
      setFleet(Object.fromEntries(results));
      setHistory((prev) => {
        const next = { ...prev };
        for (const [id, entry] of results) {
          const s = entry.status;
          if (!s?.online) continue;
          const sample: Sample = {
            hot: s.hotend?.actual ?? null,
            hotTarget: s.hotend?.target ?? 0,
            bed: s.bed?.actual ?? null,
            bedTarget: s.bed?.target ?? 0,
          };
          next[id] = [...(next[id] ?? []), sample].slice(-HISTORY);
        }
        return next;
      });
      timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  return { fleet, history };
}

export const isActiveState = (s?: PrinterStatus | null) => !!s && /^(printing|paus)/i.test(s.state);

const gcodeCache = new Map<string, ParsedGcode>();

export function useRemoteGcode(printerId: string | undefined, path: string | null | undefined, enabled: boolean) {
  const [gcode, setGcode] = useState<ParsedGcode | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError("");
    if (!enabled || !printerId || !path) {
      setGcode(null);
      return;
    }
    const k = `${printerId}:${path}`;
    const cached = gcodeCache.get(k);
    if (cached) {
      setGcode(cached);
      return;
    }
    let cancelled = false;
    setGcode(null);
    setLoading(true);
    fetchRemoteGcode(printerId, path)
      .then((text) => new Promise<ParsedGcode>((res) => setTimeout(() => res(parseGcode(text)), 0)))
      .then((g) => {
        if (cancelled) return;
        if (gcodeCache.size > 3) gcodeCache.delete(gcodeCache.keys().next().value!);
        gcodeCache.set(k, g);
        setGcode(g);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [printerId, path, enabled]);

  return { gcode, error, loading };
}

export interface RecentJob extends RemoteFile {
  printerId: string;
  printerName: string;
}

export function useRecentJobs(printers: PrinterPreset[]) {
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const net = printers.filter((p) => p.connection !== "usb");
  const key = net.map((p) => p.id).join(",");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      const all = await Promise.all(
        net.map((p) =>
          listRemoteFiles(p.id)
            .then((files) => files.map((f): RecentJob => ({ ...f, printerId: p.id, printerName: p.name })))
            .catch(() => [] as RecentJob[]),
        ),
      );
      if (cancelled) return;
      setJobs(
        all
          .flat()
          .filter((j) => j.lastPrint)
          .sort((a, b) => (b.lastPrint ?? 0) - (a.lastPrint ?? 0))
          .slice(0, 6),
      );
      timer = window.setTimeout(load, 30000);
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  return jobs;
}

export function fmtWhen(unix: number) {
  const d = new Date(unix * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const baseName = (p: string) => p.split("/").pop() ?? p;

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="metric-icon"><Icon name="temp" size={16} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

function TemperatureChart({ samples }: { samples: Sample[] }) {
  const W = 520, H = 116;
  const { hot, bed, fill, max } = useMemo(() => {
    const vals = samples.flatMap((s) => [s.hot ?? 0, s.hotTarget, s.bed ?? 0, s.bedTarget]);
    const max = Math.max(50, Math.ceil((Math.max(0, ...vals) * 1.1) / 10) * 10);
    const x = (i: number) => (samples.length < 2 ? 0 : (i / (samples.length - 1)) * W);
    const y = (v: number) => H - 4 - (v / max) * (H - 8);
    const path = (pick: (s: Sample) => number | null) =>
      samples
        .map((s, i) => ({ i, v: pick(s) }))
        .filter((p): p is { i: number; v: number } => p.v !== null)
        .map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`)
        .join(" ");
    const hot = path((s) => s.hot);
    return { hot, bed: path((s) => s.bed), fill: hot ? `${hot} V${H} H0Z` : "", max };
  }, [samples]);

  return (
    <div className="chart" aria-label="Temperature chart">
      <div className="chart-labels"><span>{max}°</span><span>{Math.round(max / 2)}°</span><span>0°</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path className="chart-grid" d={`M0 4H${W}M0 ${H / 2}H${W}M0 ${H - 4}H${W}`} />
        {fill && samples.length > 1 && <path className="chart-fill" d={fill} />}
        {hot && <path className="chart-hot" d={hot} />}
        {bed && <path className="chart-bed" d={bed} />}
      </svg>
      {samples.length < 2 && <div className="chart-empty">Collecting data…</div>}
    </div>
  );
}

export function ActivePrint({ printer, entry, samples }: { printer: PrinterPreset; entry?: FleetEntry; samples: Sample[] }) {
  const status = entry?.status ?? null;
  const active = isActiveState(status);
  const paused = !!status && /^paus/i.test(status.state);
  const file = status?.file ?? null;
  const net = printer.connection !== "usb";
  const { gcode, error: gcodeError, loading } = useRemoteGcode(printer.id, file, net && active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const fraction =
    status?.filePos != null && status.fileSize ? status.filePos / status.fileSize : (status?.progress ?? 0) / 100;
  const layer = gcode ? Math.max(0, layerAtFraction(gcode, fraction)) : 0;
  const progress = status?.progress ?? 0;

  const act = async (action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    setErr("");
    try {
      await jobCommand(printer.id, action);
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
    setConfirmStop(false);
  };

  return (
    <section className="panel active-print">
      <div className="panel-header">
        <div>
          <div className="job-title">{active && file ? baseName(file) : "No active print"}</div>
          <div className="job-context">
            <span className={`live-dot ${paused || !active ? "paused" : ""}`} />
            {printer.name}
            <span className="job-state"> · {status ? status.state : entry?.error ? "Unreachable" : "Connecting…"}</span>
          </div>
        </div>
        {active && net && (
          <div className="print-actions">
            <Button variant="icon" title={paused ? "Resume print" : "Pause print"} onClick={() => !busy && act(paused ? "resume" : "pause")}>
              <Icon name={paused ? "play" : "pause"} />
            </Button>
            {confirmStop ? (
              <>
                <Button variant="danger" onClick={() => !busy && act("cancel")}>Confirm stop</Button>
                <Button onClick={() => setConfirmStop(false)}>Keep printing</Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmStop(true)}><Icon name="stop" size={15} /> Stop</Button>
            )}
          </div>
        )}
      </div>
      {(err || (entry?.error && !status)) && <p className="preset-error">{err || entry?.error}</p>}
         <div className="preview-tabs">
                           </div>
                           <CameraView printerId={printer.id} cameraUrl={printer.cameraUrl} />
        
      <div className="print-grid">
      <div className="model-preview">
{gcode && gcode.layers.length ? (
  <>
    <ToolpathViewer 
      gcode={gcode} 
      layer={layer} 
      bedWidth={printer.bedWidth} 
      bedDepth={printer.bedDepth} 
    />
    <div className="layer-badge">
      LAYER {layer + 1} / {gcode.layers.length}
    </div>
  </>
) : (
  <div className="preview-empty">
    {!active 
      ? "Start a print to see its toolpath here." 
      : !net 
        ? "Toolpath preview needs OctoPrint or Moonraker." 
        : loading 
          ? "Loading toolpath…" 
          : gcodeError || "No toolpath available."
    }
  </div>
)}

        </div>
        <div className="print-data">
          <div className="progress-heading">
            <div><span>Progress</span><strong>{active ? `${progress.toFixed(0)}%` : "—"}</strong></div>
            <div className="eta"><Icon name="clock" size={15} /><span>{active && status?.timeLeftSecs != null ? `${fmtDuration(status.timeLeftSecs)} remaining` : "—"}</span></div>
          </div>
          <div className="progress-track"><span style={{ width: `${active ? progress : 0}%` }} /></div>
          <div className="metrics">
            <Metric label="Nozzle" value={status?.hotend ? `${status.hotend.actual.toFixed(0)}°` : "—"} sub={status?.hotend ? `/ ${status.hotend.target.toFixed(0)}°C` : undefined} />
            <Metric label="Bed" value={status?.bed ? `${status.bed.actual.toFixed(0)}°` : "—"} sub={status?.bed ? `/ ${status.bed.target.toFixed(0)}°C` : undefined} />
            <Metric label="Layer" value={gcode ? `${layer + 1}` : "—"} sub={gcode ? `/ ${gcode.layers.length}` : undefined} />
          </div>
          <div className="chart-header">
            <span>Thermal telemetry</span>
            <div><span className="legend hot" /> Nozzle <span className="legend bed" /> Bed</div>
          </div>
          <TemperatureChart samples={samples} />
        </div>
      </div>
    </section>
  );
}
