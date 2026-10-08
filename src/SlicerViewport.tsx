import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { bounds, worldTris, type Axis, type Model } from "./slicer/mesh";

interface Props {
  bed: { width: number; depth: number; height: number };
  models: Model[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  cut: { axis: Axis; offset: number } | null;
}

interface Entry {
  ref: Model;
  mesh: THREE.Mesh;
  outside: boolean;
}

interface Api {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  entries: Map<string, Entry>;
  bedGroup: THREE.Group;
  cutMesh: THREE.Mesh;
}

const toThree = (w: number, d: number, p: Float32Array) => {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] - w / 2;
    out[i + 1] = p[i + 2];
    out[i + 2] = -(p[i + 1] - d / 2);
  }
  return out;
};

const disposeMesh = (m: THREE.Mesh) => {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
};

export function SlicerViewport({ bed, models, selectedId, onSelect, onMove, cut }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const cb = useRef({ onSelect, onMove });
  cb.current = { onSelect, onMove };

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x1b1b1b);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(150, 300, 200);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const bedGroup = new THREE.Group();
    scene.add(bedGroup);
    const cutMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xf0a030, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    cutMesh.visible = false;
    scene.add(cutMesh);
    const entries = new Map<string, Entry>();
    api.current = { scene, camera, controls, entries, bedGroup, cutMesh };

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drag: { id: string; mesh: THREE.Mesh; start: THREE.Vector3; moved: boolean } | null = null;
    const ndc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.intersectObjects([...entries.values()].map((x) => x.mesh))[0];
      if (!hit) {
        cb.current.onSelect(null);
        return;
      }
      const id = [...entries].find(([, v]) => v.mesh === hit.object)![0];
      cb.current.onSelect(id);
      e.stopImmediatePropagation();
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, p)) {
        drag = { id, mesh: hit.object as THREE.Mesh, start: p, moved: false };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMovePtr = (e: PointerEvent) => {
      if (!drag) return;
      ray.setFromCamera(ndc(e), camera);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, p)) return;
      drag.mesh.position.set(p.x - drag.start.x, 0, p.z - drag.start.z);
      drag.moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      controls.enabled = true;
      renderer.domElement.releasePointerCapture(e.pointerId);
      if (d.moved) {
        const ent = entries.get(d.id);
        if (ent) cb.current.onMove(d.id, ent.ref.x + d.mesh.position.x, ent.ref.y - d.mesh.position.z);
        d.mesh.position.set(0, 0, 0);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown, true);
    renderer.domElement.addEventListener("pointermove", onMovePtr);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown, true);
      renderer.domElement.removeEventListener("pointermove", onMovePtr);
      renderer.domElement.removeEventListener("pointerup", onUp);
      for (const e of entries.values()) disposeMesh(e.mesh);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const { width: w, depth: d, height: h } = bed;
    for (const c of [...a.bedGroup.children]) {
      a.bedGroup.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.8 }));
    plate.position.y = -1;
    const pts: number[] = [];
    for (let x = 0; x <= w; x += 10) pts.push(x - w / 2, 0.05, -d / 2, x - w / 2, 0.05, d / 2);
    for (let y = 0; y <= d; y += 10) pts.push(-w / 2, 0.05, y - d / 2, w / 2, 0.05, y - d / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5a6064 }));
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: 0x00a68c }));
    box.position.y = h / 2;
    a.bedGroup.add(plate, grid, box);
    for (const e of a.entries.values()) {
      a.scene.remove(e.mesh);
      disposeMesh(e.mesh);
    }
    a.entries.clear();
    const r = Math.max(w, d);
    a.camera.position.set(r * 0.6, r * 0.9, r * 1.1);
    a.controls.target.set(0, 0, 0);
    a.controls.update();
  }, [bed.width, bed.depth, bed.height]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const { width: w, depth: d } = bed;
    const ids = new Set(models.map((m) => m.id));
    for (const [id, e] of a.entries) {
      if (!ids.has(id)) {
        a.scene.remove(e.mesh);
        disposeMesh(e.mesh);
        a.entries.delete(id);
      }
    }
    for (const m of models) {
      const old = a.entries.get(m.id);
      if (old && old.ref === m) continue;
      const world = worldTris(m);
      const b = bounds(world);
      const outside = b.min[0] < -0.01 || b.min[1] < -0.01 || b.max[0] > w + 0.01 || b.max[1] > d + 0.01 || b.max[2] > bed.height;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(toThree(w, d, world), 3));
      geom.computeVertexNormals();
      let mesh: THREE.Mesh;
      if (old) {
        mesh = old.mesh;
        mesh.geometry.dispose();
        mesh.geometry = geom;
      } else {
        mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xc9d1d3, roughness: 0.55, side: THREE.DoubleSide }));
        a.scene.add(mesh);
      }
      a.entries.set(m.id, { ref: m, mesh, outside });
    }
  }, [models, bed.width, bed.depth, bed.height]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    for (const [id, e] of a.entries) {
      (e.mesh.material as THREE.MeshStandardMaterial).color.set(e.outside ? 0xe0554f : id === selectedId ? 0x2fd0b4 : 0xc9d1d3);
    }
  }, [models, selectedId, bed.width, bed.depth]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const m = a.cutMesh;
    m.visible = !!cut;
    if (!cut) return;
    const { width: w, depth: d, height: h } = bed;
    m.rotation.set(0, 0, 0);
    if (cut.axis === "z") {
      m.rotation.x = -Math.PI / 2;
      m.scale.set(w, d, 1);
      m.position.set(0, cut.offset, 0);
    } else if (cut.axis === "x") {
      m.rotation.y = Math.PI / 2;
      m.scale.set(d, h, 1);
      m.position.set(cut.offset - w / 2, h / 2, 0);
    } else {
      m.scale.set(w, h, 1);
      m.position.set(0, h / 2, -(cut.offset - d / 2));
    }
  }, [cut, bed.width, bed.depth, bed.height]);

  return <div className="toolpath-view" ref={host} />;
}
