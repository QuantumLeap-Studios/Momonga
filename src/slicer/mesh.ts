import * as THREE from "three";
import ClipperLib from "clipper-lib";

export type Tris = Float32Array;

export interface Model {
  id: string;
  name: string;
  tris: Tris;
  x: number;
  y: number;
  rot: [number, number, number];
  scale: [number, number, number];
}

export function parseStl(buf: ArrayBuffer): Tris {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++)
          out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(buf);
  const out: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (out.length < 9 || out.length % 9 !== 0)
    throw new Error("Not a valid STL file");
  return new Float32Array(out);
}

export function parseObj(buf: ArrayBuffer): Tris {
  const v: number[] = [];
  const out: number[] = [];
  for (const raw of new TextDecoder().decode(buf).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/).slice(1, 4).map(Number);
      v.push(p[0], p[1], p[2]);
    } else if (line.startsWith("f ")) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((t) => {
          const i = parseInt(t.split("/")[0], 10);
          return i < 0 ? v.length / 3 + i : i - 1;
        });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const i of [idx[0], idx[k], idx[k + 1]]) {
          if (!(i >= 0 && i * 3 + 2 < v.length))
            throw new Error("OBJ face references a missing vertex");
          out.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        }
      }
    }
  }
  if (!out.length) throw new Error("No faces found in OBJ file");
  return new Float32Array(out);
}

export function bounds(t: Tris) {
  const b = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (t[i + k] < b.min[k]) b.min[k] = t[i + k];
      if (t[i + k] > b.max[k]) b.max[k] = t[i + k];
    }
  }
  return b;
}

function normalise(t: Tris): Tris {
  const b = bounds(t);
  const cx = (b.min[0] + b.max[0]) / 2,
    cy = (b.min[1] + b.max[1]) / 2,
    z = b.min[2];
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    out[i] = t[i] - cx;
    out[i + 1] = t[i + 1] - cy;
    out[i + 2] = t[i + 2] - z;
  }
  return out;
}

export function newModel(name: string, tris: Tris): Model {
  return {
    id: crypto.randomUUID(),
    name,
    tris: normalise(tris),
    x: 0,
    y: 0,
    rot: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

export function worldTris(m: Model): Tris {
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rad(m.rot[0]), rad(m.rot[1]), rad(m.rot[2]), "XYZ"),
    ),
    new THREE.Vector3(...m.scale),
  );
  const e = mat.elements;
  const out = new Float32Array(m.tris.length);
  for (let i = 0; i < out.length; i += 3) {
    const x = m.tris[i],
      y = m.tris[i + 1],
      z = m.tris[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z;
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z;
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z;
  }
  const b = bounds(out);
  const ox = m.x - (b.min[0] + b.max[0]) / 2,
    oy = m.y - (b.min[1] + b.max[1]) / 2,
    oz = -b.min[2];
  for (let i = 0; i < out.length; i += 3) {
    out[i] += ox;
    out[i + 1] += oy;
    out[i + 2] += oz;
  }
  return out;
}

export function mergeTris(list: Tris[]): Tris {
  const out = new Float32Array(list.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of list) {
    out.set(t, o);
    o += t.length;
  }
  return out;
}

export type Axis = "x" | "y" | "z";
const AX = { x: 0, y: 1, z: 2 };
const SCALE = 10000;

export function cutMesh(
  t: Tris,
  axis: Axis,
  offset: number,
): { above: Tris; below: Tris } {
  const a = AX[axis];
  const above: number[] = [];
  const below: number[] = [];
  const cutSegs: number[][] = [];

  for (let i = 0; i < t.length; i += 9) {
    const v: number[][] = [0, 1, 2].map((k) => [
      t[i + k * 3],
      t[i + k * 3 + 1],
      t[i + k * 3 + 2],
    ]);
    const d = v.map((p) => p[a] - offset);
    if (d.every((x) => x >= 0)) {
      above.push(...v[0], ...v[1], ...v[2]);
      continue;
    }
    if (d.every((x) => x < 0)) {
      below.push(...v[0], ...v[1], ...v[2]);
      continue;
    }

    const hi: number[][] = [],
      lo: number[][] = [],
      edge: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const p = v[k],
        q = v[(k + 1) % 3],
        dp = d[k],
        dq = d[(k + 1) % 3];
      (dp >= 0 ? hi : lo).push(p);
      if (dp >= 0 !== dq >= 0) {
        const f = dp / (dp - dq);
        const x = [
          p[0] + (q[0] - p[0]) * f,
          p[1] + (q[1] - p[1]) * f,
          p[2] + (q[2] - p[2]) * f,
        ];
        x[a] = offset;
        hi.push(x);
        lo.push(x);
        edge.push(x);
      }
    }
    const fan = (poly: number[][], out: number[]) => {
      for (let k = 1; k + 1 < poly.length; k++)
        out.push(...poly[0], ...poly[k], ...poly[k + 1]);
    };
    fan(hi, above);
    fan(lo, below);
    if (edge.length === 2) cutSegs.push([...edge[0], ...edge[1]]);
  }

  const cap = capTriangles(cutSegs, axis, offset);
  const flip = (c: number[]) => {
    const f: number[] = [];
    for (let i = 0; i < c.length; i += 9)
      f.push(
        ...c.slice(i, i + 3),
        ...c.slice(i + 6, i + 9),
        ...c.slice(i + 3, i + 6),
      );
    return f;
  };
  return {
    above: new Float32Array([...above, ...cap]),
    below: new Float32Array([...below, ...flip(cap)]),
  };
}

function capTriangles(segs: number[][], axis: Axis, offset: number): number[] {
  const a = AX[axis];
  const [u, w] = [0, 1, 2].filter((k) => k !== a);
  const key = (p: number[]) =>
    `${Math.round(p[u] * 1000)},${Math.round(p[w] * 1000)}`;
  const adj = new Map<string, { p: number[]; n: string[] }>();
  const touch = (p: number[]) => {
    const k = key(p);
    if (!adj.has(k)) adj.set(k, { p, n: [] });
    return adj.get(k)!;
  };
  for (const s of segs) {
    const p = [s[0], s[1], s[2]],
      q = [s[3], s[4], s[5]];
    if (key(p) === key(q)) continue;
    touch(p).n.push(key(q));
    touch(q).n.push(key(p));
  }
  const edgeKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const used = new Set<string>();
  const loops: number[][][] = [];
  for (const [k0, node0] of adj) {
    for (const first of node0.n) {
      if (used.has(edgeKey(k0, first))) continue;
      const loop = [node0.p];
      let prev = k0,
        cur = first;
      used.add(edgeKey(k0, first));
      while (cur !== k0) {
        const node = adj.get(cur)!;
        loop.push(node.p);
        const next =
          node.n.find((n) => !used.has(edgeKey(cur, n)) && n !== prev) ??
          node.n.find((n) => !used.has(edgeKey(cur, n)));
        if (!next) break;
        used.add(edgeKey(cur, next));
        prev = cur;
        cur = next;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  if (!loops.length) return [];

  const clip = new ClipperLib.Clipper();
  for (const l of loops)
    clip.AddPath(
      l.map((p) => ({
        X: Math.round(p[u] * SCALE),
        Y: Math.round(p[w] * SCALE),
      })),
      ClipperLib.PolyType.ptSubject,
      true,
    );
  const tree = new ClipperLib.PolyTree();
  clip.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd,
  );

  const out: number[] = [];
  const toV = (p: { X: number; Y: number }) =>
    new THREE.Vector2(p.X / SCALE, p.Y / SCALE);
  const visit = (node: any) => {
    if (!node.IsHole() && node.Contour().length >= 3) {
      const contour = node.Contour().map(toV);
      const holes = node
        .Childs()
        .filter((c: any) => c.IsHole())
        .map((h: any) => h.Contour().map(toV));
      const verts = [...contour, ...holes.flat()];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(
        contour,
        holes,
      )) {
        for (const idx of [i, j, k]) {
          const pt = verts[idx];
          const p = [0, 0, 0];
          p[u] = pt.x;
          p[w] = pt.y;
          p[a] = offset;
          out.push(...p);
        }
      }
    }
    node.Childs().forEach(visit);
  };
  visit(tree);
  return out;
}
