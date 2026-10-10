import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GPath, ParsedGcode } from "./gcode";

interface Props {
  gcode: ParsedGcode | null;
  layer: number;
  bedWidth?: number;
  bedDepth?: number;
  selectedPath?: number | null;
  onPick?: (index: number | null) => void;
  onDrag?: (dx: number, dy: number) => void;
}

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Group;
  paths?: THREE.LineSegments;
  current?: THREE.LineSegments;
  layerEnd: number[];
  layerStart: number[];
  selGroup: THREE.Group;
  raf: number;
}

const disposeGroup = (g: THREE.Group) => {
  for (const c of [...g.children]) {
    g.remove(c);
    const l = c as THREE.LineSegments;
    l.geometry?.dispose();
    (l.material as THREE.Material | undefined)?.dispose();
  }
};

export function ToolpathViewer({
  gcode,
  layer,
  bedWidth = 220,
  bedDepth = 220,
  selectedPath = null,
  onPick,
  onDrag,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const s = useRef<Scene | null>(null);
  const cb = useRef({ onPick, onDrag, gcode, selectedPath });
  cb.current = { onPick, onDrag, gcode, selectedPath };

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x1b1b1b);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const model = new THREE.Group();
    scene.add(model);
    const selGroup = new THREE.Group();
    scene.add(selGroup);
    const state: Scene = {
      renderer,
      scene,
      camera,
      controls,
      model,
      selGroup,
      layerEnd: [],
      layerStart: [],
      raf: 0,
    };
    s.current = state;

    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 0.6 };
    const ndc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
    };
    const pick = (e: PointerEvent): number | null => {
      const g = cb.current.gcode;
      if (!state.paths || !g?.paths.length) return null;
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.intersectObject(state.paths)[0];
      if (!hit || hit.index === undefined) return null;
      const seg = Math.floor(hit.index / 2);
      let lo = 0,
        hi = g.paths.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (g.paths[mid].seg0 <= seg) lo = mid;
        else hi = mid - 1;
      }
      return seg < g.paths[lo].seg1 ? lo : null;
    };
    let down: {
      x: number;
      y: number;
      drag: boolean;
      plane: THREE.Plane;
      origin: THREE.Vector3;
    } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const sel = cb.current.selectedPath;
      const g = cb.current.gcode;
      const hit = pick(e);
      const origin = new THREE.Vector3();
      if (sel !== null && hit === sel && g?.paths[sel]?.movable) {
        const plane = new THREE.Plane(
          new THREE.Vector3(0, 1, 0),
          -g.paths[sel].start[2],
        );
        ray.setFromCamera(ndc(e), camera);
        if (ray.ray.intersectPlane(plane, origin)) {
          down = { x: e.clientX, y: e.clientY, drag: true, plane, origin };
          controls.enabled = false;
          e.stopImmediatePropagation();
          renderer.domElement.setPointerCapture(e.pointerId);
          return;
        }
      }
      down = {
        x: e.clientX,
        y: e.clientY,
        drag: false,
        plane: new THREE.Plane(),
        origin,
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!down?.drag) return;
      ray.setFromCamera(ndc(e), camera);
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(down.plane, p))
        selGroup.position.set(p.x - down.origin.x, 0, p.z - down.origin.z);
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d) return;
      if (d.drag) {
        controls.enabled = true;
        renderer.domElement.releasePointerCapture(e.pointerId);
        const dx = selGroup.position.x,
          dy = -selGroup.position.z;
        selGroup.position.set(0, 0, 0);
        if (Math.hypot(dx, dy) > 0.05) cb.current.onDrag?.(dx, dy);
      } else if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) {
        cb.current.onPick?.(pick(e));
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown, true);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(state.raf);
      renderer.domElement.removeEventListener("pointerdown", onDown, true);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      ro.disconnect();
      disposeGroup(selGroup);
      disposeGroup(model);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      s.current = null;
    };
  }, []);

  useEffect(() => {
    const st = s.current;
    if (!st) return;
    disposeGroup(st.model);
    st.paths = st.current = undefined;
    st.layerEnd = [];
    st.layerStart = [];

    const grid: number[] = [];
    for (let x = 0; x <= bedWidth; x += 10)
      grid.push(
        x - bedWidth / 2,
        0,
        -bedDepth / 2,
        x - bedWidth / 2,
        0,
        bedDepth / 2,
      );
    for (let y = 0; y <= bedDepth; y += 10)
      grid.push(
        -bedWidth / 2,
        0,
        y - bedDepth / 2,
        bedWidth / 2,
        0,
        y - bedDepth / 2,
      );
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    st.model.add(
      new THREE.LineSegments(
        gg,
        new THREE.LineBasicMaterial({ color: 0x3a3a3a }),
      ),
    );

    let top = 50;
    if (gcode && gcode.layers.length) {
      const total = gcode.layers.reduce((n, l) => n + l.length, 0);
      const pos = new Float32Array(total);
      const col = new Float32Array(total);
      const maxZ = Math.max(gcode.bounds.maxZ, 0.1);
      const c = new THREE.Color();
      let o = 0;
      gcode.layers.forEach((l) => {
        st.layerStart.push(o / 3);
        for (let i = 0; i < l.length; i += 3) {
          pos[o] = l[i] - bedWidth / 2;
          pos[o + 1] = l[i + 2];
          pos[o + 2] = -(l[i + 1] - bedDepth / 2);
          c.setHSL(0.5 - 0.5 * (l[i + 2] / maxZ), 0.7, 0.45);
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
          o += 3;
        }
        st.layerEnd.push(o / 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      st.paths = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ vertexColors: true }),
      );
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute("position", geo.getAttribute("position"));
      st.current = new THREE.LineSegments(
        geo2,
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      st.model.add(st.paths, st.current);
      top = maxZ;
    }
    const dist = Math.max(bedWidth, bedDepth, top) * 1.5;
    st.camera.position.set(dist * 0.6, dist * 0.7, dist * 0.9);
    st.controls.target.set(0, top / 3, 0);
    st.controls.update();
  }, [gcode, bedWidth, bedDepth]);

  useEffect(() => {
    const st = s.current;
    if (!st?.paths || !st.current || !st.layerEnd.length) return;
    const i = Math.min(Math.max(layer, 0), st.layerEnd.length - 1);
    st.paths.geometry.setDrawRange(0, st.layerEnd[i]);
    st.current.geometry.setDrawRange(
      st.layerStart[i],
      st.layerEnd[i] - st.layerStart[i],
    );
  }, [layer, gcode]);

  useEffect(() => {
    const st = s.current;
    if (!st) return;
    disposeGroup(st.selGroup);
    st.selGroup.position.set(0, 0, 0);
    const p: GPath | undefined =
      selectedPath === null ? undefined : gcode?.paths[selectedPath];
    const src = st.paths?.geometry.getAttribute("position");
    if (!p || !src) return;
    const arr = (src.array as Float32Array).slice(p.seg0 * 6, p.seg1 * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const line = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }),
    );
    line.renderOrder = 10;
    st.selGroup.add(line);
  }, [selectedPath, gcode]);

  return <div className="toolpath-view" ref={host} />;
}
