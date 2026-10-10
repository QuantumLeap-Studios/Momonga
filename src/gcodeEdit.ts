import type { GPath } from "./gcode";

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const isMoveCode = (code: string) => /^G0?[01](\s|$)/i.test(code.trim());
const codeOf = (line: string) => {
  const i = line.indexOf(";");
  return i >= 0 ? line.slice(0, i) : line;
};
const hasWord = (code: string, axis: string) =>
  new RegExp(`(^|\\s)${axis}-?[\\d.]`, "i").test(code);

function shiftWords(
  line: string,
  d: { X: number; Y: number; Z: number },
): string {
  const semi = line.indexOf(";");
  const code = semi >= 0 ? line.slice(0, semi) : line;
  const rest = semi >= 0 ? line.slice(semi) : "";
  const out = code.replace(
    /(^|\s)([XYZxyz])(-?\d*\.?\d+)/g,
    (m, sp: string, axis: string, val: string) => {
      const delta = d[axis.toUpperCase() as "X" | "Y" | "Z"];
      return delta ? `${sp}${axis}${fmt(parseFloat(val) + delta)}` : m;
    },
  );
  return out + rest;
}

function nextMove(lines: string[], from: number): number {
  for (let i = from + 1; i < lines.length; i++)
    if (isMoveCode(codeOf(lines[i]))) return i;
  return -1;
}

const eolOf = (text: string) => (text.includes("\r\n") ? "\r" : "");
const withEol = (s: string, eol: string) => s.split("\n").map((l) => l + eol);

function restoreMove(
  lines: string[],
  after: number,
  at: [number, number, number],
  z: boolean,
): string | null {
  const n = nextMove(lines, after);
  if (n < 0) return null;
  const code = codeOf(lines[n]);
  const words: string[] = [];
  const needXY = !(hasWord(code, "X") && hasWord(code, "Y"));
  if (needXY) words.push(`X${fmt(at[0])}`, `Y${fmt(at[1])}`);
  if (z && !hasWord(code, "Z")) words.push(`Z${fmt(at[2])}`);
  return words.length ? `G0 ${words.join(" ")}` : null;
}

export function movePath(
  text: string,
  p: GPath,
  dx: number,
  dy: number,
  dz: number,
): string | null {
  if (!p.movable) return null;
  if (!dx && !dy && !dz) return text;
  const eol = eolOf(text);
  const lines = text.split("\n");
  const d = { X: dx, Y: dy, Z: dz };
  for (let i = p.lineFirst; i <= p.lineLast; i++) {
    if (isMoveCode(codeOf(lines[i]))) lines[i] = shiftWords(lines[i], d);
  }
  const back = restoreMove(lines, p.lineLast, p.end, dz !== 0);
  if (back) lines.splice(p.lineLast + 1, 0, back + eol);
  const to = `G0 X${fmt(p.start[0] + dx)} Y${fmt(p.start[1] + dy)}${dz ? ` Z${fmt(p.start[2] + dz)}` : ""} ; moved path`;
  lines.splice(p.lineFirst, 0, to + eol);
  return lines.join("\n");
}

export function deletePath(text: string, p: GPath): string | null {
  if (!p.movable) return null;
  const eol = eolOf(text);
  const lines = text.split("\n");
  const fix: string[] = [];
  const back = restoreMove(lines, p.lineLast, p.end, true);
  if (back) fix.push(back + eol);
  if (p.absE) fix.push(`G92 E${fmt(p.eEnd)}${eol}`);
  const kept: string[] = [];
  for (let i = p.lineFirst; i <= p.lineLast; i++)
    if (!isMoveCode(codeOf(lines[i]))) kept.push(lines[i]);
  lines.splice(p.lineFirst, p.lineLast - p.lineFirst + 1, ...kept, ...fix);
  return lines.join("\n");
}

export interface SnippetContext {
  x: number;
  y: number;
  z: number;
  layer: number;
  e: number;
  absE: boolean;
}

export function expandSnippet(template: string, c: SnippetContext): string {
  return template
    .replace(/\{restoreE\}/g, c.absE ? `M82\nG92 E${fmt(c.e)}` : "")
    .replace(
      /\{([xyz])([+-]\d+(?:\.\d+)?)\}/g,
      (_m, a: "x" | "y" | "z", d: string) => fmt(c[a] + parseFloat(d)),
    )
    .replace(/\{x\}/g, fmt(c.x))
    .replace(/\{y\}/g, fmt(c.y))
    .replace(/\{z\}/g, fmt(c.z))
    .replace(/\{layer\}/g, String(c.layer))
    .replace(/\{e\}/g, fmt(c.e))
    .split("\n")
    .filter((l) => l.trim() !== "")
    .join("\n");
}

export function insertLines(
  text: string,
  line: number,
  snippet: string,
  after: boolean,
): string {
  const eol = eolOf(text);
  const lines = text.split("\n");
  lines.splice(after ? line + 1 : line, 0, ...withEol(snippet, eol));
  return lines.join("\n");
}

export interface Snippet {
  id: string;
  name: string;
  description: string;
  template: string;
  builtin?: boolean;
}

export const BUILTIN_SNIPPETS: Snippet[] = [
  {
    id: "pause-m0",
    name: "Pause (M0)",
    description:
      "Stop and wait for the user to resume (Marlin, RepRapFirmware).",
    template: "M0 Paused by Momonga",
    builtin: true,
  },
  {
    id: "pause-klipper",
    name: "Pause (Klipper)",
    description: "Calls the PAUSE macro; resume from the web UI.",
    template: "PAUSE",
    builtin: true,
  },
  {
    id: "m600",
    name: "Filament change (M600)",
    description:
      "For firmware with M600 support: parks, unloads and waits for new filament.",
    template: "M600",
    builtin: true,
  },
  {
    id: "manual-swap",
    name: "Filament change pause (no M600 / single filament)",
    description:
      "Retracts, lifts, parks, beeps and waits so you can swap filament by hand, then purges and returns.",
    template: [
      "; --- manual filament change at layer {layer} ---",
      "M83",
      "G1 E-3 F2400 ; retract",
      "G1 Z{z+10} F1200 ; lift",
      "G1 X5 Y5 F6000 ; park",
      "M300 S880 P400 ; beep",
      "M0 Change filament, then resume",
      "G1 E45 F300 ; purge new filament",
      "G1 E-3 F2400",
      "G1 X{x} Y{y} F6000 ; return",
      "G1 Z{z} F1200",
      "G1 E3 F2400",
      "{restoreE}",
      "; --- end filament change ---",
    ].join("\n"),
    builtin: true,
  },
  {
    id: "hotend",
    name: "Set hotend temperature",
    description: "Edit the value before inserting.",
    template: "M104 S200",
    builtin: true,
  },
  {
    id: "bed",
    name: "Set bed temperature",
    description: "Edit the value before inserting.",
    template: "M140 S60",
    builtin: true,
  },
  {
    id: "fan-on",
    name: "Fan 100%",
    description: "",
    template: "M106 S255",
    builtin: true,
  },
  {
    id: "fan-off",
    name: "Fan off",
    description: "",
    template: "M107",
    builtin: true,
  },
  {
    id: "beep",
    name: "Beep",
    description: "",
    template: "M300 S1000 P300",
    builtin: true,
  },
  {
    id: "message",
    name: "Display message",
    description: "",
    template: "M117 Layer {layer}",
    builtin: true,
  },
  {
    id: "park",
    name: "Park and return",
    description: "Moves aside, then back to where the path was.",
    template:
      "G1 Z{z+5} F1200\nG1 X5 Y5 F6000\nG1 X{x} Y{y} F6000\nG1 Z{z} F1200",
    builtin: true,
  },
];
