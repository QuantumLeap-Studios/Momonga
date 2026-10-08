import { useEffect, useState } from "react";
import { Button, Icon, PageHeader } from "./App";
import { MoonrakerWarning } from "./MoonrakerWarning";
import { listSerialPorts, newPreset, openPresetWindow, savePrinter, testConnection, type ConnectionType } from "./printers";

export function ConnectionsPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [ports, setPorts] = useState<string[]>([]);
  const refresh = () => listSerialPorts().then(setPorts);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="module-page">
      <PageHeader title="Add printer" description="Choose how Momonga should connect." />
      <div className="connection-options">
        <button className="panel connection-option" onClick={() => openPresetWindow(undefined, { connection: "usb" })}>
          <span className="option-icon"><Icon name="usb" /></span>
          <div><strong>USB serial</strong><p>Connect a printer directly to this computer.</p><span>Marlin · Klipper · RepRap</span></div>
          <Icon name="chevron" />
        </button>
        <button className="panel connection-option" onClick={() => onNavigate("OctoPrint setup")}>
          <span className="option-icon"><Icon name="wifi" /></span>
          <div><strong>OctoPrint</strong><p>Connect over the local network with an API key.</p><span>OctoPrint 1.8 or newer</span></div>
          <Icon name="chevron" />
        </button>
        <button className="panel connection-option" onClick={() => onNavigate("Moonraker setup")}>
          <span className="option-icon"><Icon name="link" /></span>
          <div><strong>Moonraker</strong><p>Connect directly to a Klipper instance.</p><span className="untested-tag">Untested</span></div>
          <Icon name="chevron" />
        </button>
      </div>
      <section className="panel discovery-panel">
        <div className="section-title"><div><strong>USB devices</strong><span>Serial ports detected on this computer.</span></div><Button onClick={refresh}>Rescan</Button></div>
        {ports.length === 0 && <p className="empty-note">No serial ports found.</p>}
        {ports.map((port) => (
          <div className="detected-device" key={port}>
            <Icon name="usb" />
            <div><strong>{port}</strong></div>
            <Button onClick={() => openPresetWindow(undefined, { connection: "usb", port })}>Add printer</Button>
          </div>
        ))}
      </section>
    </div>
  );
}

export function NetworkSetupPage({ kind, onNavigate }: { kind: Exclude<ConnectionType, "usb">; onNavigate: (page: string) => void }) {
  const isOcto = kind === "octoprint";
  const label = isOcto ? "OctoPrint" : "Moonraker";
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(""); setUrl(""); setApiKey(""); setResult(null); setError("");
  }, [kind]);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await testConnection(kind, url, apiKey) });
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    }
    setTesting(false);
  };

  const add = async () => {
    setError("");
    try {
      await savePrinter({
        ...newPreset(),
        name,
        firmware: isOcto ? "Marlin" : "Klipper",
        connection: kind,
        url,
        apiKey,
      });
      onNavigate("Printers");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="module-page narrow-module">
      <PageHeader title={`Connect ${label}`} description={`Add ${isOcto ? "an OctoPrint server" : "a Moonraker instance"} on your network.`} />
      {!isOcto && <MoonrakerWarning />}
      <section className="panel octoprint-form">
        <div className="octo-heading">
          <span className="option-icon"><Icon name={isOcto ? "wifi" : "link"} /></span>
          <div>
            <strong>Server details</strong>
            <p>{isOcto ? "Find the API key in OctoPrint under Settings → Application Keys." : "An API key is only needed if Moonraker requires authentication."}</p>
          </div>
        </div>
        <label className="field"><span>Display name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My printer" /></label>
        <label className="field"><span>Server address</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={isOcto ? "http://octopi.local" : "http://printer.local:7125"} /></label>
        <label className="field"><span>API key{isOcto ? "" : " (optional)"}</span><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isOcto ? "Paste your application key" : ""} /></label>
        {result && (
          <div className={result.ok ? "test-success" : "test-failure"}>
            <Icon name="check" size={15} />
            <div><strong>{result.ok ? "Connection successful" : "Connection failed"}</strong><span>{result.text}</span></div>
          </div>
        )}
        {error && <p className="preset-error">{error}</p>}
        <p className="empty-note">HTTPS servers with self-signed certificates are not supported; use http:// on a trusted local network.</p>
        <div className="form-actions">
          <Button onClick={() => onNavigate("Connections")}>Back</Button>
          <Button onClick={test}>{testing ? "Testing…" : "Test connection"}</Button>
          <Button variant="primary" onClick={add}>Add printer</Button>
        </div>
      </section>
    </div>
  );
}
