export interface GPath {
  layer: number;
  seg0: number;
  seg1: number;
  lineFirst: number;
  lineLast: number;
  start: [number, number, number];
  end: [number, number, number];
  eStart: number;
  eEnd: number;
  absE: boolean;
  movable: boolean;
}

export interface ParsedGcode {
  paths: GPath[];
  layers: number[][];
  layerZ: number[];
  layerStart: number[];
  totalChars: number;
  moves: number;
  seconds: number;
  truncated: boolean;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxZ: number;
  };
}

export interface GcodeWarning {
  line: number;
  message: string;
}

const MAX_SEGMENTS = 700_000;

const num = (w: string) => {
  const v = parseFloat(w.slice(1));
  return Number.isFinite(v) ? v : NaN;
};

export function parseGcode(text: string): ParsedGcode {
  const out: ParsedGcode = {
    paths: [],
    layers: [],
    layerZ: [],
    layerStart: [],
    totalChars: text.length,
    moves: 0,
    seconds: 0,
    truncated: false,
    bounds: {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      maxZ: 0,
    },
  };
  let x = 0,
    y = 0,
    z = 0,
    e = 0,
    f = 3000;
  let absXYZ = true,
    absE = true;
  let layer: number[] | null = null;
  let layerZ = NaN;
  let segments = 0;
  let pos = 0;
  let lineNo = -1;
  let open: GPath | null = null;

  while (pos < text.length) {
    lineNo++;
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    const start = pos;
    pos = end + 1;
    const semi = text.indexOf(";", start);
    const code = (
      semi >= 0 && semi < end ? text.slice(start, semi) : text.slice(start, end)
    ).trim();
    if (!code) continue;
    const words = code.toUpperCase().split(/\s+/);
    const cmd = words[0];

    if (cmd === "G90") absXYZ = true;
    else if (cmd === "G91") absXYZ = false;
    else if (cmd === "M82") absE = true;
    else if (cmd === "M83") absE = false;
    else if (cmd === "G92") {
      open = null;
      for (const w of words.slice(1)) if (w[0] === "E") e = num(w) || 0;
    } else if (cmd === "G0" || cmd === "G1" || cmd === "G00" || cmd === "G01") {
      let nx = x,
        ny = y,
        nz = z,
        de = 0;
      for (const w of words.slice(1)) {
        const v = num(w);
        if (Number.isNaN(v)) continue;
        switch (w[0]) {
          case "X":
            nx = absXYZ ? v : x + v;
            break;
          case "Y":
            ny = absXYZ ? v : y + v;
            break;
          case "Z":
            nz = absXYZ ? v : z + v;
            break;
          case "E":
            de = absE ? v - e : v;
            e = absE ? v : e + v;
            break;
          case "F":
            if (v > 0) f = v;
            break;
        }
      }
      const dist = Math.hypot(nx - x, ny - y, nz - z);
      out.moves++;
      out.seconds += dist / (f / 60) || 0;
      const extruding = de > 0 && (nx !== x || ny !== y);
      if (!extruding) open = null;
      if (extruding) {
        if (layer === null || Math.abs(nz - layerZ) > 0.001) {
          layer = [];
          layerZ = nz;
          out.layers.push(layer);
          out.layerZ.push(nz);
          out.layerStart.push(start);
        }
        if (segments < MAX_SEGMENTS) {
          const newLayer = layer.length === 0;
          if (!open || newLayer) {
            open = {
              layer: out.layers.length - 1,
              seg0: segments,
              seg1: segments,
              lineFirst: lineNo,
              lineLast: lineNo,
              start: [x, y, z],
              end: [nx, ny, nz],
              eStart: e - de,
              eEnd: e,
              absE,
              movable: absXYZ,
            };
            out.paths.push(open);
          }
          layer.push(x, y, z, nx, ny, nz);
          segments++;
          open.seg1 = segments;
          open.lineLast = lineNo;
          open.end = [nx, ny, nz];
          open.eEnd = e;
        } else {
          out.truncated = true;
        }
        const b = out.bounds;
        b.minX = Math.min(b.minX, x, nx);
        b.maxX = Math.max(b.maxX, x, nx);
        b.minY = Math.min(b.minY, y, ny);
        b.maxY = Math.max(b.maxY, y, ny);
        b.maxZ = Math.max(b.maxZ, nz);
      }
      x = nx;
      y = ny;
      z = nz;
    }
  }
  return out;
}

export function layerAtFraction(g: ParsedGcode, fraction: number): number {
  if (!g.layers.length) return -1;
  const target = fraction * g.totalChars;
  let lo = 0,
    hi = g.layerStart.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.layerStart[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function validateGcode(
  text: string,
  maxHotend: number,
  maxBed: number,
  buildHeight: number,
): GcodeWarning[] {
  const warnings: GcodeWarning[] = [];
  const add = (line: number, message: string) => {
    if (warnings.length < 200) warnings.push({ line, message });
  };
  let absXYZ = true;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].split(";")[0].trim().toUpperCase();
    if (!code) continue;
    const words = code.split(/\s+/);
    const cmd = words[0];
    if (cmd === "G90") absXYZ = true;
    if (cmd === "G91") absXYZ = false;
    if (cmd === "M112") add(i + 1, "M112 is an emergency stop");
    const limit =
      cmd === "M104" || cmd === "M109"
        ? maxHotend
        : cmd === "M140" || cmd === "M190"
          ? maxBed
          : null;
    if (limit !== null) {
      for (const w of words.slice(1)) {
        if (w[0] === "S" || w[0] === "R") {
          const v = num(w);
          if (Number.isNaN(v)) add(i + 1, `Invalid temperature in ${cmd}`);
          else if (v > limit)
            add(
              i + 1,
              `${cmd} ${w} exceeds this printer's limit of ${limit}°C`,
            );
        }
      }
    }
    if ((cmd === "G0" || cmd === "G1") && absXYZ) {
      for (const w of words.slice(1)) {
        if (w[0] === "Z" && num(w) > buildHeight)
          add(
            i + 1,
            `Z${num(w)} is above the build height of ${buildHeight} mm`,
          );
      }
    }
  }
  return warnings;
}

export const fmtDuration = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
