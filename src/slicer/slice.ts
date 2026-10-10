import ClipperLib from "clipper-lib";
import type { SliceSettings } from "./settings";
import type { Tris } from "./mesh";

const S = 1000;
type Pt = { X: number; Y: number };
type Path = Pt[];
type Paths = Path[];

export interface SliceResult {
  gcode: string;
  layers: number;
  seconds: number;
  filamentMm: number;
  filamentGrams: number;
  warnings: string[];
}

export interface Bed {
  width: number;
  depth: number;
  height: number;
}

const CL = ClipperLib;

function offset(paths: Paths, delta: number, miter = false): Paths {
  if (!paths.length) return [];
  const co = new CL.ClipperOffset(2, S * 0.01);
  co.AddPaths(
    paths,
    miter ? CL.JoinType.jtMiter : CL.JoinType.jtRound,
    CL.EndType.etClosedPolygon,
  );
  const out: Paths = [];
  co.Execute(out, delta * S);
  return out;
}

function boolOp(
  type: number,
  a: Paths,
  b: Paths,
  fill = CL.PolyFillType.pftNonZero,
): Paths {
  if (!a.length) return type === CL.ClipType.ctUnion ? b.slice() : [];
  const c = new CL.Clipper();
  c.AddPaths(a, CL.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, CL.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return out;
}
const union = (a: Paths, b: Paths) => boolOp(CL.ClipType.ctUnion, a, b);
const diff = (a: Paths, b: Paths) => boolOp(CL.ClipType.ctDifference, a, b);
const inter = (a: Paths, b: Paths) => boolOp(CL.ClipType.ctIntersection, a, b);

const mm = (v: number) => v / S;

function clipLines(lines: Paths, region: Paths): Paths {
  if (!lines.length || !region.length) return [];
  const c = new CL.Clipper();
  c.AddPaths(lines, CL.PolyType.ptSubject, false);
  c.AddPaths(region, CL.PolyType.ptClip, true);
  const tree = new CL.PolyTree();
  c.Execute(
    CL.ClipType.ctIntersection,
    tree,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  );
  return CL.Clipper.OpenPathsFromPolyTree(tree);
}

const KEY_OFF = 2097152;
const keyOf = (x: number, y: number) => (x + KEY_OFF) * 8388608 + (y + KEY_OFF);

function chain(segs: number[]): Paths {
  const adj = new Map<number, { p: Pt; n: number[] }>();
  const node = (x: number, y: number) => {
    const k = keyOf(x, y);
    let v = adj.get(k);
    if (!v) adj.set(k, (v = { p: { X: x, Y: y }, n: [] }));
    return { k, v };
  };
  for (let i = 0; i < segs.length; i += 4) {
    const a = node(segs[i], segs[i + 1]);
    const b = node(segs[i + 2], segs[i + 3]);
    if (a.k === b.k) continue;
    a.v.n.push(b.k);
    b.v.n.push(a.k);
  }
  const used = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const out: Paths = [];
  for (const [k0, n0] of adj) {
    for (const first of n0.n) {
      if (used.has(ek(k0, first))) continue;
      used.add(ek(k0, first));
      const loop: Path = [n0.p];
      let prev = k0,
        cur = first;
      while (cur !== k0) {
        const nd = adj.get(cur)!;
        loop.push(nd.p);
        const next =
          nd.n.find((n) => !used.has(ek(cur, n)) && n !== prev) ??
          nd.n.find((n) => !used.has(ek(cur, n)));
        if (next === undefined) break;
        used.add(ek(cur, next));
        prev = cur;
        cur = next;
      }
      if (loop.length >= 3) out.push(loop);
    }
  }
  return out;
}

function sliceLayers(t: Tris, planes: number[]): Paths[] {
  const n = planes.length;
  const buckets: number[][] = Array.from({ length: n }, () => []);
  const first = planes[0];
  const step = n > 1 ? planes[1] - planes[0] : 1;
  for (let i = 0; i < t.length; i += 9) {
    const zmin = Math.min(t[i + 2], t[i + 5], t[i + 8]);
    const zmax = Math.max(t[i + 2], t[i + 5], t[i + 8]);
    let l = Math.max(0, Math.floor((zmin - first) / step) - 1);
    while (l > 0 && planes[l - 1] >= zmin) l--;
    while (l < n && planes[l] < zmin) l++;
    for (; l < n && planes[l] <= zmax; l++) buckets[l].push(i);
  }
  return buckets.map((tris, li) => {
    const z = planes[li];
    const segs: number[] = [];
    for (const i of tris) {
      const pts: number[] = [];
      for (let k = 0; k < 3; k++) {
        const ax = t[i + k * 3],
          ay = t[i + k * 3 + 1],
          az = t[i + k * 3 + 2];
        const j = (k + 1) % 3;
        const bx = t[i + j * 3],
          by = t[i + j * 3 + 1],
          bz = t[i + j * 3 + 2];
        if (az >= z !== bz >= z) {
          const f = (z - az) / (bz - az);
          pts.push(
            Math.round((ax + (bx - ax) * f) * S),
            Math.round((ay + (by - ay) * f) * S),
          );
        }
      }
      if (pts.length === 4) segs.push(...pts);
    }
    const loops = chain(segs);
    if (!loops.length) return [];
    const c = new CL.Clipper();
    c.AddPaths(loops, CL.PolyType.ptSubject, true);
    const out: Paths = [];
    c.Execute(
      CL.ClipType.ctUnion,
      out,
      CL.PolyFillType.pftEvenOdd,
      CL.PolyFillType.pftEvenOdd,
    );
    return out;
  });
}

function scanLines(region: Paths, angleDeg: number, spacing: number): Paths {
  if (!region.length) return [];
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a),
    dy = Math.sin(a);
  const nx = -dy,
    ny = dx;
  let pmin = Infinity,
    pmax = -Infinity,
    dmin = Infinity,
    dmax = -Infinity;
  for (const path of region) {
    for (const p of path) {
      const pn = p.X * nx + p.Y * ny,
        pd = p.X * dx + p.Y * dy;
      if (pn < pmin) pmin = pn;
      if (pn > pmax) pmax = pn;
      if (pd < dmin) dmin = pd;
      if (pd > dmax) dmax = pd;
    }
  }
  const lines: Paths = [];
  for (let t = Math.ceil(pmin / spacing) * spacing; t <= pmax; t += spacing) {
    lines.push([
      {
        X: Math.round(nx * t + dx * (dmin - 10)),
        Y: Math.round(ny * t + dy * (dmin - 10)),
      },
      {
        X: Math.round(nx * t + dx * (dmax + 10)),
        Y: Math.round(ny * t + dy * (dmax + 10)),
      },
    ]);
  }
  return clipLines(lines, region);
}

function orderLines(lines: Paths, from: Pt): Paths {
  const rest = lines.slice();
  const out: Paths = [];
  let cur = from;
  const d2 = (a: Pt, b: Pt) => (a.X - b.X) ** 2 + (a.Y - b.Y) ** 2;
  while (rest.length) {
    let best = 0,
      rev = false,
      bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const l = rest[i];
      const d0 = d2(cur, l[0]),
        d1 = d2(cur, l[l.length - 1]);
      if (d0 < bd) {
        bd = d0;
        best = i;
        rev = false;
      }
      if (d1 < bd) {
        bd = d1;
        best = i;
        rev = true;
      }
    }
    const l = rest.splice(best, 1)[0];
    if (rev) l.reverse();
    out.push(l);
    cur = l[l.length - 1];
  }
  return out;
}

type Fill = { lines: Paths; loops: Paths };

function sparseFill(
  region: Paths,
  pattern: SliceSettings["infillPattern"],
  density: number,
  w: number,
  layer: number,
): Fill {
  const wi = w * S;
  if (!region.length || density <= 0) return { lines: [], loops: [] };
  const base = (wi * 100) / density;
  switch (pattern) {
    case "lines":
      return {
        lines: scanLines(region, layer % 2 ? 135 : 45, base),
        loops: [],
      };
    case "grid":
      return {
        lines: [
          ...scanLines(region, 45, base * 2),
          ...scanLines(region, 135, base * 2),
        ],
        loops: [],
      };
    case "triangles":
      return {
        lines: [0, 60, 120].flatMap((a) => scanLines(region, a, base * 3)),
        loops: [],
      };
    case "concentric": {
      const loops: Paths = [];
      let cur = offset(region, -wi / 2);
      for (let g = 0; g < 400 && cur.length; g++) {
        loops.push(...cur);
        cur = offset(cur, -base);
      }
      return { lines: [], loops };
    }
  }
}

const solidFill = (region: Paths, w: number, layer: number): Fill => ({
  lines: scanLines(region, layer % 2 ? 135 : 45, w * S * 0.98),
  loops: [],
});

class Writer {
  out: string[] = [];
  x = 0;
  y = 0;
  z = 0;
  retracted = false;
  seconds = 0;
  filament = 0;
  feed = -1;
  constructor(private s: SliceSettings) {}

  snapshot() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      retracted: this.retracted,
      seconds: this.seconds,
      filament: this.filament,
      feed: this.feed,
      n: this.out.length,
    };
  }
  restore(sn: ReturnType<Writer["snapshot"]>) {
    Object.assign(this, {
      x: sn.x,
      y: sn.y,
      z: sn.z,
      retracted: sn.retracted,
      seconds: sn.seconds,
      filament: sn.filament,
      feed: sn.feed,
    });
    this.out.length = sn.n;
  }
  line(l: string) {
    this.out.push(l);
  }

  private f(v: number) {
    return v.toFixed(3).replace(/\.?0+$/, "");
  }
  private fp(speed: number) {
    const f = Math.round(speed * 60);
    if (f === this.feed) return "";
    this.feed = f;
    return ` F${f}`;
  }

  retract() {
    if (this.retracted || this.s.retractLength <= 0) return;
    this.line(
      `G1 E${this.f(-this.s.retractLength)}${this.fp(this.s.retractSpeed)}`,
    );
    this.retracted = true;
    this.seconds += this.s.retractLength / this.s.retractSpeed;
  }
  unretract() {
    if (!this.retracted) return;
    this.line(
      `G1 E${this.f(this.s.retractLength)}${this.fp(this.s.retractSpeed)}`,
    );
    this.retracted = false;
    this.seconds += this.s.retractLength / this.s.retractSpeed;
  }

  travel(p: Pt, z: number) {
    const x = mm(p.X),
      y = mm(p.Y);
    const dist = Math.hypot(x - this.x, y - this.y);
    if (dist < 0.01 && z === this.z) return;
    const far = dist >= this.s.retractMinTravel;
    if (far) {
      this.retract();
      if (this.s.zHop > 0)
        this.line(
          `G1 Z${this.f(z + this.s.zHop)}${this.fp(this.s.travelSpeed)}`,
        );
    }
    this.line(
      `G0 X${this.f(x)} Y${this.f(y)}${far && this.s.zHop > 0 ? "" : ` Z${this.f(z)}`}${this.fp(this.s.travelSpeed)}`,
    );
    if (far && this.s.zHop > 0)
      this.line(`G1 Z${this.f(z)}${this.fp(this.s.travelSpeed)}`);
    this.seconds += dist / this.s.travelSpeed;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  extrude(p: Pt, speed: number, h: number) {
    this.unretract();
    const x = mm(p.X),
      y = mm(p.Y);
    const len = Math.hypot(x - this.x, y - this.y);
    if (len < 1e-4) return;
    const w = this.s.lineWidth;
    const sectional = (w - h * (1 - Math.PI / 4)) * h;
    const filArea = Math.PI * (this.s.filamentDiameter / 2) ** 2;
    const e = (len * sectional * (this.s.flow / 100)) / filArea;
    this.line(`G1 X${this.f(x)} Y${this.f(y)} E${this.f(e)}${this.fp(speed)}`);
    this.seconds += len / speed;
    this.filament += e;
    this.x = x;
    this.y = y;
  }
}

type Op = { pts: Path; closed: boolean; speed: number };

function nearestStart(
  loop: Path,
  from: Pt,
  seam: SliceSettings["seam"],
  layer: number,
): Path {
  let idx = 0;
  if (seam === "nearest") {
    let bd = Infinity;
    loop.forEach((p, i) => {
      const d = (p.X - from.X) ** 2 + (p.Y - from.Y) ** 2;
      if (d < bd) {
        bd = d;
        idx = i;
      }
    });
  } else if (seam === "rear") {
    loop.forEach((p, i) => {
      if (p.Y > loop[idx].Y || (p.Y === loop[idx].Y && p.X < loop[idx].X))
        idx = i;
    });
  } else {
    idx = (layer * 2654435761) % loop.length;
  }
  return [...loop.slice(idx), ...loop.slice(0, idx)];
}

function orderLoops(
  loops: Paths,
  from: Pt,
  seam: SliceSettings["seam"],
  layer: number,
): Paths {
  const rest = loops.filter((l) => l.length >= 3);
  const out: Paths = [];
  let cur = from;
  while (rest.length) {
    let best = 0,
      bd = Infinity,
      bs: Path = rest[0];
    for (let i = 0; i < rest.length; i++) {
      const s = nearestStart(rest[i], cur, seam, layer);
      const d = (s[0].X - cur.X) ** 2 + (s[0].Y - cur.Y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
        bs = s;
      }
    }
    rest.splice(best, 1);
    out.push(bs);
    cur = bs[0];
  }
  return out;
}

export function sliceMesh(
  tris: Tris,
  s: SliceSettings,
  bed: Bed,
  progress: (f: number, msg: string) => void,
): SliceResult {
  const warnings: string[] = [];
  let zmax = 0;
  for (let i = 2; i < tris.length; i += 3) zmax = Math.max(zmax, tris[i]);
  if (zmax <= 0.01) throw new Error("The model has no height");
  if (zmax > bed.height)
    warnings.push(
      `The model is ${zmax.toFixed(1)} mm tall but the printer's build height is ${bed.height} mm.`,
    );

  const h = s.layerHeight,
    h0 = s.firstLayerHeight,
    w = s.lineWidth;
  const n = Math.max(1, Math.round((zmax - h0) / h) + 1);
  const zTop = Array.from({ length: n }, (_, i) => h0 + i * h);
  const planes = zTop.map((z, i) => z - (i === 0 ? h0 : h) / 2);
  if (n > 5000) throw new Error("Too many layers; increase the layer height");

  progress(0.02, "Slicing mesh");
  let regions = sliceLayers(tris, planes);
  if (!regions.some((r) => r.length))
    throw new Error(
      "The model produced no printable cross-sections. Is the mesh closed?",
    );

  if (s.enlargeSmall) {
    const m = s.minFeature;
    regions = regions.map((r) => {
      if (!r.length) return r;
      const opened = offset(offset(r, -m / 2, true), m / 2, true);
      const thin = diff(r, opened).filter(
        (p) => Math.abs(CL.Clipper.Area(p)) / (S * S) > m * m,
      );
      return thin.length ? union(r, offset(thin, m / 2, true)) : r;
    });
  }

  progress(0.2, "Planning walls");
  const wallsByLayer: Paths[][] = [];
  const inner: Paths[] = [];
  for (let i = 0; i < n; i++) {
    const r = regions[i];
    const walls: Paths[] = [];
    for (let k = 0; k < s.wallCount; k++) {
      const wk = offset(r, -(k + 0.5) * w);
      if (!wk.length) break;
      walls.push(wk);
    }
    wallsByLayer.push(walls);
    inner.push(
      walls.length === s.wallCount
        ? offset(r, -(s.wallCount * w - (w * s.infillOverlap) / 100))
        : [],
    );
  }

  progress(0.3, "Planning support");
  const support: Paths[] = Array.from({ length: n }, () => []);
  if (s.support !== "none") {
    const overhang: Paths[] = regions.map((r, i) => {
      if (i === 0) return [];
      const reach = Math.tan(((90 - s.supportAngle) * Math.PI) / 180) * h;
      return diff(r, offset(regions[i - 1], Math.max(reach, 0.01)));
    });
    const below: Paths[] = [];
    let acc: Paths = [];
    for (let i = 0; i < n; i++) {
      below.push(acc);
      acc = union(acc, regions[i]);
    }
    let carry: Paths = [];
    for (let i = n - 1; i >= 0; i--) {
      if (i + 2 < n) carry = union(carry, overhang[i + 2]);
      let si = carry.length
        ? diff(carry, offset(regions[i], s.supportXYDistance))
        : [];
      if (s.support === "buildplate" && si.length)
        si = diff(si, offset(below[i], s.supportXYDistance));
      si = si.filter((p) => Math.abs(CL.Clipper.Area(p)) / (S * S) > w * w * 4);
      support[i] = si;
      carry = si;
    }
  }

  const g = new Writer(s);
  const bedW = bed.width,
    bedD = bed.depth;
  const fill = (t: string) =>
    t
      .replace(/\{bedWidth\}/g, String(bedW))
      .replace(/\{bedDepth\}/g, String(bedD))
      .replace(/\{bedDepthMinus5\}/g, String(bedD - 5));
  g.line("; Generated by Momonga");
  g.line(
    `; layer height ${h} mm, ${n} layers, wall count ${s.wallCount}, infill ${s.infillDensity}% ${s.infillPattern}`,
  );
  g.line("G90 ; absolute positioning");
  g.line("M83 ; relative extrusion");
  g.line(`M140 S${s.bedTemp}`);
  g.line(`M104 S${s.firstLayerHotendTemp}`);
  g.line(`M190 S${s.bedTemp}`);
  g.line(`M109 S${s.firstLayerHotendTemp}`);
  fill(s.startGcode)
    .split("\n")
    .forEach((l) => g.line(l));
  if (s.pressureAdvance > 0)
    g.line(
      s.flavor === "klipper"
        ? `SET_PRESSURE_ADVANCE ADVANCE=${s.pressureAdvance}`
        : `M900 K${s.pressureAdvance}`,
    );
  g.retracted = false;
  g.x = g.y = 0;

  let lastFan = -1;
  for (let i = 0; i < n; i++) {
    progress(0.35 + 0.6 * (i / n), `Layer ${i + 1} of ${n}`);
    const z = zTop[i];
    const lh = i === 0 ? h0 : h;
    const first = i === 0;
    const sp = (v: number) => (first ? Math.min(v, s.firstLayerSpeed) : v);

    const ops: Op[] = [];
    const loopOps = (loops: Paths, speed: number, from: Pt, seam = s.seam) => {
      let cur = from;
      for (const l of orderLoops(loops, cur, seam, i)) {
        ops.push({ pts: l, closed: true, speed: sp(speed) });
        cur = l[0];
      }
      return cur;
    };
    const lineOps = (lines: Paths, speed: number, from: Pt) => {
      for (const l of orderLines(
        lines.filter((x) => x.length >= 2),
        from,
      ))
        ops.push({ pts: l, closed: false, speed: sp(speed) });
    };

    let cur: Pt = { X: g.x * S, Y: g.y * S };

    if (first && s.adhesion !== "none") {
      const base = union(regions[0], support[0]);
      if (s.adhesion === "skirt") {
        const loops: Paths = [];
        for (let k = 0; k < s.skirtLoops; k++)
          loops.push(
            ...offset(base, s.skirtDistance + (k + 0.5) * w).filter((p) =>
              CL.Clipper.Orientation(p),
            ),
          );
        cur = loopOps(loops, s.firstLayerSpeed, cur, "nearest");
      } else {
        const count = Math.max(1, Math.round(s.brimWidth / w));
        const loops: Paths = [];
        for (let k = count - 1; k >= 0; k--)
          loops.push(
            ...offset(base, (k + 0.5) * w).filter((p) =>
              CL.Clipper.Orientation(p),
            ),
          );
        cur = loopOps(loops, s.firstLayerSpeed, cur, "nearest");
      }
    }

    if (support[i].length) {
      cur = loopOps(offset(support[i], -w / 2), s.supportSpeed, cur, "nearest");
      const sf = sparseFill(
        offset(support[i], -w),
        "lines",
        s.supportDensity,
        w,
        i,
      );
      lineOps(sf.lines, s.supportSpeed, cur);
      cur = ops.length
        ? ops[ops.length - 1].pts[ops[ops.length - 1].pts.length - 1]
        : cur;
    }

    const walls = wallsByLayer[i];
    const order = s.outerWallFirst
      ? walls.map((_, k) => k)
      : walls.map((_, k) => walls.length - 1 - k);
    for (const k of order) {
      cur = loopOps(
        walls[k],
        k === 0 ? s.outerWallSpeed : s.innerWallSpeed,
        cur,
      );
    }

    const I = inner[i];
    if (I.length) {
      let covered = I;
      for (let j = 1; j <= s.topLayers; j++)
        covered = i + j < n ? inter(covered, inner[i + j]) : [];
      let coveredB = I;
      for (let j = 1; j <= s.bottomLayers; j++)
        coveredB = i - j >= 0 ? inter(coveredB, inner[i - j]) : [];
      let solid: Paths;
      if (s.topLayers === 0 && s.bottomLayers === 0) solid = [];
      else {
        const top = s.topLayers > 0 ? diff(I, covered) : [];
        const bot = s.bottomLayers > 0 ? diff(I, coveredB) : [];
        solid = union(top, bot);
      }
      solid = solid.filter(
        (p) => Math.abs(CL.Clipper.Area(p)) / (S * S) > w * w,
      );
      const sparse = solid.length ? diff(I, solid) : I;
      if (solid.length) {
        const sf = solidFill(solid, w, i);
        lineOps(sf.lines, s.solidInfillSpeed, cur);
        cur = ops.length
          ? ops[ops.length - 1].pts[ops[ops.length - 1].pts.length - 1]
          : cur;
      }
      if (!first) {
        const sf = sparseFill(sparse, s.infillPattern, s.infillDensity, w, i);
        if (sf.loops.length)
          cur = loopOps(sf.loops, s.infillSpeed, cur, "nearest");
        lineOps(sf.lines, s.infillSpeed, cur);
      } else {
        const sf = solidFill(sparse, w, i);
        lineOps(sf.lines, s.firstLayerSpeed, cur);
      }
    }

    const emit = (factor: number) => {
      for (const op of ops) {
        g.travel(op.pts[0], z);
        const sp2 = op.speed * factor;
        for (let k = 1; k < op.pts.length; k++) g.extrude(op.pts[k], sp2, lh);
        if (op.closed) g.extrude(op.pts[0], sp2, lh);
      }
    };

    g.line(`;LAYER:${i}`);
    g.line(`;Z:${z.toFixed(3)}`);
    const fan =
      i + 1 >= s.fanFirstLayer ? Math.round((s.fanSpeed / 100) * 255) : 0;
    if (fan !== lastFan) {
      g.line(fan ? `M106 S${fan}` : "M107");
      lastFan = fan;
    }
    if (i === 1 && s.hotendTemp !== s.firstLayerHotendTemp)
      g.line(`M104 S${s.hotendTemp}`);
    if (ops.length) {
      const sn = g.snapshot();
      const t0 = g.seconds;
      emit(1);
      const took = g.seconds - t0;
      if (!first && s.minLayerTime > 0 && took < s.minLayerTime && took > 0) {
        const factor = Math.max(0.25, took / s.minLayerTime);
        g.restore(sn);
        g.line(
          `; slowed to ${(factor * 100).toFixed(0)}% for minimum layer time`,
        );
        g.feed = -1;
        emit(factor);
      }
    }
  }

  g.retract();
  g.line("M107 ; fan off");
  g.line("M104 S0 ; hotend off");
  g.line("M140 S0 ; bed off");
  g.line("M83");
  fill(s.endGcode)
    .split("\n")
    .forEach((l) => g.line(l));
  g.line(`; filament used: ${g.filament.toFixed(1)} mm`);

  const grams =
    Math.PI *
    (s.filamentDiameter / 20) ** 2 *
    (g.filament / 10) *
    s.filamentDensity;
  progress(1, "Done");
  return {
    gcode: g.out.join("\n") + "\n",
    layers: n,
    seconds: g.seconds,
    filamentMm: g.filament,
    filamentGrams: grams,
    warnings,
  };
}
