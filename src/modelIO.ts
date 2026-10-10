import { invoke } from "@tauri-apps/api/core";
import { newModel, parseObj, parseStl, type Model } from "./slicer/mesh";

export const MODEL_EXTS = ["stl", "obj"];
export const GCODE_EXTS = ["gcode", "gco", "g"];

export const extOf = (path: string) =>
  (path.split(".").pop() ?? "").toLowerCase();
export const fileName = (path: string) =>
  path.replace(/\\/g, "/").split("/").pop() ?? path;

export async function loadModel(path: string): Promise<Model> {
  const ext = extOf(path);
  const buf = await invoke<ArrayBuffer>("read_model_file", { path });
  const tris = ext === "obj" ? parseObj(buf) : parseStl(buf);
  return newModel(fileName(path).replace(/\.[^.]+$/, ""), tris);
}
