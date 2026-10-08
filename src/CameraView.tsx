import { useCallback, useEffect, useRef, useState } from "react";
import { cameraStreamUrl } from "./printers";

const isSnapshot = (url: string) => /snapshot/i.test(url);

export function CameraView({ printerId, cameraUrl }: { printerId: string; cameraUrl?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  const connect = useCallback(() => {
    setUrl("");
    setError("");
    setLoaded(false);
    setTick((t) => t + 1);
  }, []);

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
      {!error && !loaded && <div className="camera-note">{url ? "Connecting to camera?" : "Looking for camera?"}</div>}
      {error && (
        <div className="camera-note">
          <p>{error}</p>
          <button className="button" onClick={connect}>Retry</button>
        </div>
      )}
    </div>
  );
}
