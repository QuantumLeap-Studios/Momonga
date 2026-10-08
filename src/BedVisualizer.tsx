import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type VisualizerMode = "bed" | "nozzle";

interface Props {
  mode: VisualizerMode;
  bedWidth: number;
  bedDepth: number;
  buildHeight: number;
  nozzleDiameter: number;
  filamentDiameter: number;
}

interface Dims {
  w: number;
  d: number;
  h: number;
}

function clear(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }
}

function line(points: number[], color: number, opacity = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

function buildBed(group: THREE.Group, { w, d, h }: Dims) {
  clear(group);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(w, 2, d),
    new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.8 }),
  );
  plate.position.y = -1;
  group.add(plate);

  const minor: number[] = [];
  const major: number[] = [];
  for (let x = 0; x <= w + 1e-6; x += 10) {
    (Math.round(x) % 50 === 0 ? major : minor).push(x - w / 2, 0.05, -d / 2, x - w / 2, 0.05, d / 2);
  }
  for (let z = 0; z <= d + 1e-6; z += 10) {
    (Math.round(z) % 50 === 0 ? major : minor).push(-w / 2, 0.05, z - d / 2, w / 2, 0.05, z - d / 2);
  }
  group.add(line(minor, 0x5a6064, 0.6), line(major, 0x8a9296));

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0x00a68c }),
  );
  box.position.y = h / 2;
  group.add(box);

  const axisLen = Math.max(10, Math.min(w, d, h) * 0.25);
  const o = [-w / 2, 0.1, d / 2];
  group.add(
    line([...o, o[0] + axisLen, o[1], o[2]], 0xe04b4b),
    line([...o, o[0], o[1], o[2] - axisLen], 0x4bc84b),
    line([...o, o[0], o[1] + axisLen, o[2]], 0x4b8be0),
  );

  const s = Math.min(w, d) * 0.06;
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(s, s * 0.15, s * 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.4 }),
  );
  head.rotation.x = Math.PI;
  head.position.y = s * 1.1;
  group.add(head);
}

function buildNozzle(group: THREE.Group, nozzle: number, filament: number) {
  clear(group);
  const layer = nozzle * 0.5;
  const tipRadius = nozzle / 2 + 0.5;
  const coneH = 4;
  const hexH = 3;

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(24, 1, 24),
    new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.8 }),
  );
  plate.position.y = -0.5;
  group.add(plate);

  const bead = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 20, 24).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf0a030, roughness: 0.6 }),
  );
  bead.scale.set(1, layer / 2, nozzle * 0.55);
  bead.position.y = layer / 2;
  group.add(bead);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xc9a24a,
    metalness: 0.8,
    roughness: 0.35,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(3, tipRadius, coneH, 40), bodyMat);
  cone.position.y = layer + coneH / 2;
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, hexH, 6), bodyMat);
  hex.position.y = layer + coneH + hexH / 2;
  group.add(cone, hex);

  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(nozzle / 2, nozzle / 2, coneH, 24),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  bore.position.y = layer + coneH / 2;
  group.add(bore);

  const filamentH = coneH + hexH + 3;
  const filamentMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(filament / 2, filament / 2, filamentH, 24),
    new THREE.MeshStandardMaterial({ color: 0xf0a030 }),
  );
  filamentMesh.position.y = layer + coneH + filamentH / 2;
  group.add(filamentMesh);
}

export default function BedVisualizer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    bed: THREE.Group;
    nozzle: THREE.Group;
  } | null>(null);
  const dims = useRef<Dims>({ w: props.bedWidth, d: props.bedDepth, h: props.buildHeight });
  dims.current = { w: props.bedWidth, d: props.bedDepth, h: props.buildHeight };

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x2a2a2a);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);

    const bed = new THREE.Group();
    const nozzle = new THREE.Group();
    scene.add(bed, nozzle);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 + 0.3;
    three.current = { camera, controls, bed, nozzle };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      clear(bed);
      clear(nozzle);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  useEffect(() => {
    if (three.current) buildBed(three.current.bed, { w: props.bedWidth, d: props.bedDepth, h: props.buildHeight });
  }, [props.bedWidth, props.bedDepth, props.buildHeight]);

  useEffect(() => {
    if (three.current) buildNozzle(three.current.nozzle, props.nozzleDiameter, props.filamentDiameter);
  }, [props.nozzleDiameter, props.filamentDiameter]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.bed.visible = props.mode === "bed";
    t.nozzle.visible = props.mode === "nozzle";
    if (props.mode === "bed") {
      const { w, d, h } = dims.current;
      const r = Math.max(w, d, h);
      t.controls.target.set(0, h * 0.3, 0);
      t.camera.position.set(r * 1.3, r * 1.2, r * 1.9);
    } else {
      t.controls.target.set(0, 3, 0);
      t.camera.position.set(9, 8, 12);
    }
    t.controls.update();
  }, [props.mode]);

  return <div ref={host} className="visualizer-canvas" />;
}

