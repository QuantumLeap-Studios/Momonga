import { useCallback, useEffect, useRef, useState } from "react";
import { cameraStreamUrl } from "./printers";

const isSnapshot = (url: string) => /snapshot/i.test(url);

// --- Blank-frame detection settings ---
const SAMPLE_SIZE = 32;        // frame is downscaled to SAMPLE_SIZE x SAMPLE_SIZE before analysis
const MIN_COLORS = 4;          // fewer distinct colors than this => treat the frame as blank
const CHECK_MS = 2000;         // how often to inspect the current frame
const BLANK_STRIKES = 2;       // consecutive blank checks before reconnecting
const LOAD_TIMEOUT_MS = 10000; // no image at all after this long => reconnect
const MAX_AUTO_RETRIES = 5;    // give up auto-reconnecting after this many tries in a row

let sampler: HTMLCanvasElement | null = null;

/**
 * true  = frame is empty / (nearly) a single color
 * false = frame looks like a real picture
 * null  = can't tell (canvas is tainted by a cross-origin image without CORS headers)
 */
function isBlankFrame(el: HTMLImageElement): boolean | null {
  if (!el.naturalWidth || !el.naturalHeight) return true;
  try {
    sampler ??= document.createElement("canvas");
    sampler.width = SAMPLE_SIZE;
    sampler.height = SAMPLE_SIZE;
    const ctx = sampler.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const d = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    // Quantize each channel to 3 bits so sensor noise doesn't count as extra colors.
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      seen.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5));
    }
    return seen.size < MIN_COLORS;
  } catch {
    return null; // SecurityError: tainted canvas
  }
}

export function CameraView({ printerId, cameraUrl }: { printerId: string; cameraUrl?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const blankStrikes = useRef(0);
  const autoRetries = useRef(0);

  const connect = useCallback(() => {
    setUrl("");
    setError("");
    setLoaded(false);
    setTick((t) => t + 1);
  }, []);

  // Manual retry: start the automatic-retry budget over.
  const retry = useCallback(() => {
    autoRetries.current = 0;
    blankStrikes.current = 0;
    connect();
  }, [connect]);

  // Automatic reconnect (blank frame / no image), limited so we don't loop forever.
  const autoReconnect = useCallback(
    (reason: string) => {
      blankStrikes.current = 0;
      if (autoRetries.current >= MAX_AUTO_RETRIES) {
        setError(reason);
        return;
      }
      autoRetries.current += 1;
      connect();
    },
    [connect]
  );

  // New printer => fresh counters.
  useEffect(() => {
    autoRetries.current = 0;
    blankStrikes.current = 0;
  }, [printerId]);

  useEffect(() => {
    let live = true;
    setUrl("");
    setError("");
    setLoaded(false);
    cameraStreamUrl(printerId)
      .then((u) => live && setUrl(u))
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [printerId, cameraUrl, tick]);

  const snap = !!url && isSnapshot(url);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!snap || error) return;
    const t = window.setInterval(() => setFrame((f) => f + 1), 1000);
    return () => window.clearInterval(t);
  }, [snap, error]);

  useEffect(() => {
    const el = img.current;
    return () => { if (el) el.src = ""; };
  }, [url]);

  // Nothing arrived at all within the timeout => reconnect.
  useEffect(() => {
    if (!url || loaded || error) return;
    const t = window.setTimeout(
      () => autoReconnect("The camera didn't send an image."),
      LOAD_TIMEOUT_MS
    );
    return () => window.clearTimeout(t);
  }, [url, loaded, error, autoReconnect]);

  // Image arrived but is blank / only a few colors => reconnect.
  useEffect(() => {
    if (!loaded || error) return;
    const t = window.setInterval(() => {
      const el = img.current;
      if (!el) return;
      const blank = isBlankFrame(el);
      if (blank === null) return; // can't inspect this stream; leave it alone
      if (!blank) {
        blankStrikes.current = 0;
        autoRetries.current = 0;
        return;
      }
      blankStrikes.current += 1;
      if (blankStrikes.current >= BLANK_STRIKES) {
        autoReconnect("The camera is only returning a blank image.");
      }
    }, CHECK_MS);
    return () => window.clearInterval(t);
  }, [loaded, error, autoReconnect]);

  const src = snap ? `${url}${url.includes("?") ? "&" : "?"}_=${frame}` : url;

  return (
    <div className="camera-view">
      {url && !error && (
        <img
          ref={img}
          src={src}
          alt="Printer camera"
          className={loaded ? "ready" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setError("Could not load the camera stream. Check the camera URL and that the camera is on.")}
        />
      )}
      {!error && !loaded && <div className="camera-note">{url ? "Connecting to camera…" : "Looking for camera…"}</div>}
      {error && (
        <div className="camera-note">
          <p>{error}</p>
          <button className="button" onClick={retry}>Retry</button>
        </div>
      )}
    </div>
  );
}