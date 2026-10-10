import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import momongaLogo from "./assets/momonga-logo-notext.png";
import { PresetFields } from "./preset-editor";
import { ConnectionsPage, NetworkSetupPage } from "./connections";
import { PrinterDetailPage } from "./printer-detail";
import {
  ActivePrint,
  baseName,
  fmtWhen,
  isActiveState,
  useFleet,
  useRecentJobs,
  type FleetEntry,
  type RecentJob,
} from "./live";
import { SlicePage } from "./slice-page";
import { loadModel, extOf, fileName, MODEL_EXTS, GCODE_EXTS } from "./modelIO";
import type { Model } from "./slicer/mesh";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FilamentPage, FilesPage, GcodePage, type EditorDoc } from "./pages";
import { loadTheme, saveTheme, type ThemePref } from "./Theme";
import {
  connectionLabel,
  deletePrinter,
  openPresetWindow,
  savePrinter,
  usePrinters,
  type PrinterPreset,
} from "./printers";

type IconName =
  | "home"
  | "cube"
  | "code"
  | "printer"
  | "layers"
  | "settings"
  | "plus"
  | "play"
  | "pause"
  | "stop"
  | "more"
  | "upload"
  | "usb"
  | "wifi"
  | "chevron"
  | "clock"
  | "temp"
  | "speed"
  | "check"
  | "spool"
  | "link";

const icons: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9M9 20v-6h6v6" />
    </>
  ),
  cube: (
    <>
      <path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" />
      <path d="m4.5 6.8 7.5 4.3 7.5-4.3M12 20v-9" />
    </>
  ),
  code: (
    <>
      <path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v7H7z" />
      <path d="M17 11h.01" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3M7 8l5-5 5 5" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  usb: (
    <>
      <path d="M12 3v12M9 6l3-3 3 3M8 11H5v4M5 15l-2-2M5 15l-2 2M12 15l4 4M16 19h3v-3" />
    </>
  ),
  wifi: (
    <>
      <path d="M4 9a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 17a3 3 0 0 1 4 0" />
      <circle cx="12" cy="20" r=".7" fill="currentColor" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  temp: (
    <>
      <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z" />
      <path d="M12 9v8" />
    </>
  ),
  speed: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4M7 17h10" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  spool: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

export function Button({
  children,
  variant = "default",
  onClick,
  title,
  disabled,
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "danger" | "icon";
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`button button-${variant}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const primaryNavItems: { label: string; icon: IconName }[] = [
  { label: "Overview", icon: "home" },
];
const productionNavItems: { label: string; icon: IconName }[] = [
  { label: "Slice", icon: "cube" },
  { label: "G-code editor", icon: "code" },
  { label: "Files", icon: "layers" },
];
const devicesNavItems: { label: string; icon: IconName }[] = [
  { label: "Printers", icon: "printer" },
  { label: "Filament", icon: "spool" },
];

function Sidebar({
  active,
  onSelect,
  printerCount,
}: {
  active: string;
  onSelect: (label: string) => void;
  printerCount: number;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-image">
          <img src={momongaLogo} alt="" />
        </div>
        <div>
          <div className="brand-name">MOMONGA</div>
        </div>
      </div>

      <nav className="nav">
        {primaryNavItems.map((item) => (
          <button
            key={item.label}
            className={`nav-item ${active === item.label ? "active" : ""}`}
            onClick={() => onSelect(item.label)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.label === "Printers" && (
              <span className="nav-count">{printerCount}</span>
            )}
          </button>
        ))}
        <div className="nav-group">
          <div className="nav-label">Production</div>
          <div className="nav-children">
            {productionNavItems.map((item) => (
              <button
                key={item.label}
                className={`nav-item nav-child ${active === item.label ? "active" : ""}`}
                onClick={() => onSelect(item.label)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {/* {item.label === "Printers" && <span className="nav-count">{printerCount}</span>} */}
              </button>
            ))}
          </div>
        </div>
        <div className="nav-group">
          <div className="nav-label">Devices</div>
          <div className="nav-children">
            {devicesNavItems.map((item) => (
              <button
                key={item.label}
                className={`nav-item nav-child ${active === item.label ? "active" : ""}`}
                onClick={() => onSelect(item.label)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.label === "Printers" && (
                  <span className="nav-count">{printerCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => onSelect("Settings")}>
          <Icon name="settings" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function PrinterCard({
  printer,
  entry,
  color,
  onOpen,
}: {
  printer: PrinterPreset;
  entry?: FleetEntry;
  color: "cyan" | "orange";
  onOpen: () => void;
}) {
  const st = entry?.status;
  const state = st ? st.state.toUpperCase() : entry?.error ? "OFFLINE" : "...";
  const printing = isActiveState(st);
  const online = !!st?.online;
  return (
    <div className="printer-card">
      <div className={`printer-visual ${color}`}>
        <div className="printer-frame">
          <span className="gantry" />
          <span className="print-head" />
          <span className="bed" />
        </div>
      </div>
      <div className="printer-info">
        <div className="printer-title">
          <strong>{printer.name}</strong>
          <span className={`state ${printing ? "printing" : ""}`}>{state}</span>
        </div>
        <div className="printer-meta">
          <Icon
            name={printer.connection === "usb" ? "usb" : "wifi"}
            size={14}
          />{" "}
          {connectionLabel(printer)}
          {st?.hotend
            ? ` · ${st.hotend.actual.toFixed(0)}\u00b0 / ${st.bed ? st.bed.actual.toFixed(0) : "-"}\u00b0`
            : ""}
        </div>
        <div className="printer-footer">
          <span>
            <span className={online ? "online-dot" : "offline-dot"} />{" "}
            {online ? "Online" : "Offline"}
          </span>
          <button aria-label={`Open ${printer.name}`} onClick={onOpen}>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentJobs({
  jobs,
  onNavigate,
}: {
  jobs: RecentJob[];
  onNavigate: (page: string) => void;
}) {
  return (
    <section className="panel recent">
      <div className="section-title">
        <div>
          <span>Recent jobs</span>
        </div>
        <button className="text-button" onClick={() => onNavigate("Files")}>
          View all <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="job-list">
        {jobs.length === 0 && (
          <p className="empty-note">
            No prints yet on your OctoPrint or Moonraker printers.
          </p>
        )}
        {jobs.map((job, index) => {
          const failed = job.lastSuccess === false;
          return (
            <button
              className="job-row"
              key={job.printerId + job.path}
              onClick={() => onNavigate("Files")}
            >
              <span className={`file-thumb thumb-${(index % 3) + 1}`}>
                <Icon name="cube" size={18} />
              </span>
              <span className="file-main">
                <strong>{baseName(job.path)}</strong>
                <small>{job.printerName}</small>
              </span>
              <span className="file-time">{fmtWhen(job.lastPrint ?? 0)}</span>
              <span className={`job-status ${failed ? "stopped" : ""}`}>
                {!failed && <Icon name="check" size={12} />}{" "}
                {failed ? "Stopped" : "Done"}
              </span>
              <Icon name="chevron" size={15} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuickSlice({ onNavigate }: { onNavigate: (page: string) => void }) {
  return (
    <section className="panel quick-slice">
      <div className="section-title">
        <div>
          <span>Quick slice</span>
        </div>
        <Button variant="icon">
          <Icon name="settings" size={16} />
        </Button>
      </div>
      <button className="drop-zone" onClick={() => onNavigate("Slice")}>
        <span className="drop-icon">
          <Icon name="upload" size={20} />
        </span>
        <strong>Drag & Drop a model anywhere or select a file</strong>
      </button>

      <Button variant="primary" onClick={() => onNavigate("Slice")}>
        <Icon name="cube" size={16} /> Open slicer
      </Button>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="module-header">
      <div>
        <div className="module-title">{title}</div>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function PrintersPage({
  printers,
  onNavigate,
  onSelect,
}: {
  printers: PrinterPreset[];
  onNavigate: (page: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="module-page">
      <PageHeader
        title="Printers"
        description="Printer presets saved in Momonga."
        action={
          <Button variant="primary" onClick={() => openPresetWindow()}>
            <Icon name="plus" size={16} /> New preset
          </Button>
        }
      />
      <div className="connection-banner">
        <Icon name="link" />
        <div>
          <strong>Connect another printer</strong>
          <span>Use USB, OctoPrint, or Moonraker for Klipper.</span>
        </div>
        <Button onClick={() => onNavigate("Connections")}>
          Choose connection
        </Button>
      </div>
      {printers.length === 0 && (
        <p className="empty-note">
          No printer presets yet. Create one with New preset.
        </p>
      )}
      <div className="machine-grid">
        {printers.map((p, i) => (
          <button
            className="panel machine-card"
            key={p.id}
            onClick={() => {
              onSelect(p.id);
              onNavigate("Printer detail");
            }}
          >
            <div
              className={`machine-illustration ${i % 2 ? "orange" : "cyan"}`}
            >
              <div className="printer-frame">
                <span className="gantry" />
                <span className="print-head" />
                <span className="bed" />
              </div>
            </div>
            <div className="machine-content">
              <div>
                <strong>{p.name}</strong>
                <span className="status-dot" />
              </div>
              <p>
                {p.firmware} · {connectionLabel(p)}
              </p>
              <div className="machine-state">
                <span>
                  {p.bedWidth} × {p.bedDepth} × {p.buildHeight} mm ·{" "}
                  {p.nozzleDiameter} nozzle
                </span>
                <Icon name="chevron" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NoPrinter({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  return (
    <div className="module-page">
      <PageHeader
        title="No printer selected"
        description="Pick a printer preset first."
        action={
          <Button onClick={() => onNavigate("Printers")}>Go to Printers</Button>
        }
      />
    </div>
  );
}

function PrinterSettingsPage({
  printer,
  onNavigate,
  onDeleted,
}: {
  printer?: PrinterPreset;
  onNavigate: (page: string) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<PrinterPreset | undefined>(printer);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setDraft(printer);
  }, [printer]);
  if (!printer || !draft) return <NoPrinter onNavigate={onNavigate} />;

  const save = async () => {
    setError("");
    try {
      await savePrinter(draft);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async () => {
    await deletePrinter(printer.id);
    onDeleted();
  };

  return (
    <div className="module-page settings-page">
      <PageHeader
        title={`${printer.name} settings`}
        description="Machine, connection, and limits."
        action={
          <>
            <Button onClick={() => openPresetWindow(printer.id)}>
              Open preset editor
            </Button>
            <Button variant="primary" onClick={save}>
              Save changes
            </Button>
          </>
        }
      />
      {error && <p className="preset-error">{error}</p>}
      {saved && !error && <p className="empty-note">Saved.</p>}
      <PresetFields
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          setSaved(false);
        }}
      />
      <section className="panel form-section danger-section">
        <div className="form-heading">
          <strong>Remove printer</strong>
          <span>Deletes this preset. This cannot be undone.</span>
        </div>
        {confirming ? (
          <div className="form-actions">
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>
              Confirm remove
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Remove {printer.name}
          </Button>
        )}
      </section>
    </div>
  );
}
function SettingsPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  return (
    <div className="module-page settings-page">
      <PageHeader title="Settings" description="Momonga preferences" />
      <section className="panel form-section">
        <div className="form-heading">
          <strong>General</strong>
          <span></span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Theme</span>
            <select
              value={theme}
              onChange={(e) => {
                const t = e.target.value as ThemePref;
                setTheme(t);
                saveTheme(t);
              }}
            >
              <option value="dark">Dark</option>
              <option value="system">System</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("Overview");
  const [doc, setDoc] = useState<EditorDoc | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [dropping, setDropping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { printers } = usePrinters();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = printers.find((p) => p.id === selectedId) ?? printers[0];
  const dropRef = useRef<(paths: string[]) => void>(() => {});
  dropRef.current = async (paths) => {
    for (const path of paths) {
      const ext = extOf(path);
      try {
        if (MODEL_EXTS.includes(ext)) {
          const m = await loadModel(path);
          m.x = (selected?.bedWidth ?? 220) / 2;
          m.y = (selected?.bedDepth ?? 220) / 2;
          setModels((ms) => [...ms, m]);
          setActive("Slice");
        } else if (GCODE_EXTS.includes(ext)) {
          const text = await invoke<string>("read_gcode_file", { path });
          setDoc({ name: fileName(path), text, path });
          setActive("G-code editor");
        } else setToast(`Unsupported file: ${fileName(path)}`);
      } catch (e) {
        setToast(String(e));
      }
    }
  };
  if (import.meta.env.DEV)
    (
      window as unknown as { __momongaDrop?: (p: string[]) => void }
    ).__momongaDrop = (p) => dropRef.current(p);
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const t = e.payload.type;
        if (t === "enter" || t === "over") setDropping(true);
        else if (t === "leave") setDropping(false);
        else if (t === "drop") {
          setDropping(false);
          dropRef.current(e.payload.paths);
        }
      })
      .then((u) => (dead ? u() : (off = u)))
      .catch((err) => setToast(`File drop is unavailable: ${String(err)}`));
    return () => {
      dead = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const { fleet, history } = useFleet(printers);
  const recent = useRecentJobs(printers);
  const featured =
    printers.find((p) => isActiveState(fleet[p.id]?.status)) ?? selected;
  const today = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const sidebarActive = active.startsWith("Printer") ? "Printers" : active;
  {
    /* TODO: Find a better way of doing this... */
  }
  const section = [
    "Slice",
    "Printers",
    "Printer detail",
    "Printer settings",
    "Files",
    "Filament",
    "G-code editor",
  ].includes(active)
    ? "Production"
    : active === "Overview"
      ? ""
      : "Workspace";

  const renderPage = () => {
    switch (active) {
      case "Slice":
        return (
          <SlicePage
            models={models}
            setModels={setModels}
            printers={printers}
            printerId={selected?.id}
            onPrinter={setSelectedId}
            onOpenInEditor={(d) => {
              setDoc(d);
              setActive("G-code editor");
            }}
            onError={setToast}
          />
        );
      case "G-code editor":
        return (
          <GcodePage
            doc={doc}
            onDoc={setDoc}
            printers={printers}
            selectedId={selected?.id}
          />
        );
      case "Printers":
        return (
          <PrintersPage
            printers={printers}
            onNavigate={setActive}
            onSelect={setSelectedId}
          />
        );
      case "Printer detail":
        return <PrinterDetailPage printer={selected} onNavigate={setActive} />;
      case "Printer settings":
        return (
          <PrinterSettingsPage
            printer={selected}
            onNavigate={setActive}
            onDeleted={() => {
              setSelectedId(null);
              setActive("Printers");
            }}
          />
        );
      case "Files":
        return (
          <FilesPage
            printers={printers}
            selectedId={selected?.id}
            onOpenInEditor={(d) => {
              setDoc(d);
              setActive("G-code editor");
            }}
          />
        );
      case "Filament":
        return <FilamentPage />;
      case "Connections":
        return <ConnectionsPage onNavigate={setActive} />;
      case "OctoPrint setup":
        return <NetworkSetupPage kind="octoprint" onNavigate={setActive} />;
      case "Moonraker setup":
        return <NetworkSetupPage kind="moonraker" onNavigate={setActive} />;
      case "Settings":
        return <SettingsPage onNavigate={setActive} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        active={sidebarActive}
        onSelect={setActive}
        printerCount={printers.length}
      />
      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="page-title">
              {section && (
                <>
                  <span>{section}</span>
                  <Icon name="chevron" size={13} />
                </>
              )}
              {(active === "Printer detail" || active === "Printer settings") &&
              selected
                ? selected.name
                : active}
            </div>
            {active === "Overview" && (
              <div className="page-subtitle">{today}</div>
            )}
          </div>
          <div className="top-actions">
            <div className="connection-pill">
              <span /> {printers.length}{" "}
              {printers.length === 1 ? "printer" : "printers"} connected
            </div>
            <Button variant="primary" onClick={() => setActive("Connections")}>
              <Icon name="usb" size={16} /> Connect
            </Button>
          </div>
        </header>

        {active === "Overview" ? (
          <div className="dashboard">
            <div className="main-column">
              {featured ? (
                <ActivePrint
                  printer={featured}
                  entry={fleet[featured.id]}
                  samples={history[featured.id] ?? []}
                />
              ) : (
                <section className="panel active-print">
                  <p className="empty-note">
                    Add a printer preset to see live status here.
                  </p>
                </section>
              )}
              <RecentJobs jobs={recent} onNavigate={setActive} />
            </div>
            <div className="side-column">
              <section>
                <div className="section-heading">
                  <div>
                    <span>Printers</span>
                  </div>
                  <Button
                    variant="icon"
                    title="New printer preset"
                    onClick={() => openPresetWindow()}
                  >
                    <Icon name="plus" size={16} />
                  </Button>
                </div>
                <div className="printer-list">
                  {printers.map((p, i) => (
                    <PrinterCard
                      key={p.id}
                      printer={p}
                      entry={fleet[p.id]}
                      color={i % 2 ? "orange" : "cyan"}
                      onOpen={() => {
                        setSelectedId(p.id);
                        setActive("Printer detail");
                      }}
                    />
                  ))}
                </div>
              </section>
              <QuickSlice onNavigate={setActive} />
            </div>
          </div>
        ) : (
          renderPage()
        )}
      </main>
      {dropping && (
        <div className="drop-overlay">
          <div>Drop STL / OBJ to slice, or G-code to edit</div>
        </div>
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
