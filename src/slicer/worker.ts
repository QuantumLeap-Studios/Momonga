import { sliceMesh, type Bed, type SliceResult } from "./slice";
import type { SliceSettings } from "./settings";

export interface SliceRequest {
  tris: Float32Array;
  settings: SliceSettings;
  bed: Bed;
}

export type SliceMessage =
  | { type: "progress"; fraction: number; message: string }
  | { type: "done"; result: SliceResult }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<SliceRequest>) => {
  const post = (m: SliceMessage) => (self as unknown as Worker).postMessage(m);
  try {
    const { tris, settings, bed } = e.data;
    const result = sliceMesh(tris, settings, bed, (fraction, message) =>
      post({ type: "progress", fraction, message }),
    );
    post({ type: "done", result });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
