export interface SliceSettings {
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  wallCount: number;
  outerWallFirst: boolean;
  seam: "nearest" | "rear" | "random";
  topLayers: number;
  bottomLayers: number;
  infillDensity: number;
  infillPattern: "lines" | "grid" | "triangles" | "concentric";
  infillOverlap: number;
  support: "none" | "buildplate" | "everywhere";
  supportAngle: number;
  supportDensity: number;
  supportXYDistance: number;
  adhesion: "none" | "skirt" | "brim";
  skirtLoops: number;
  skirtDistance: number;
  brimWidth: number;
  firstLayerSpeed: number;
  outerWallSpeed: number;
  innerWallSpeed: number;
  infillSpeed: number;
  solidInfillSpeed: number;
  supportSpeed: number;
  travelSpeed: number;
  hotendTemp: number;
  firstLayerHotendTemp: number;
  bedTemp: number;
  fanSpeed: number;
  fanFirstLayer: number;
  minLayerTime: number;
  retractLength: number;
  retractSpeed: number;
  retractMinTravel: number;
  zHop: number;
  filamentDiameter: number;
  filamentDensity: number;
  flow: number;
  pressureAdvance: number;
  flavor: "marlin" | "klipper";
  startGcode: string;
  endGcode: string;
  enlargeSmall: boolean;
  minFeature: number;
}

export const DEFAULT_SETTINGS: SliceSettings = {
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  lineWidth: 0.45,
  wallCount: 2,
  outerWallFirst: false,
  seam: "nearest",
  topLayers: 4,
  bottomLayers: 4,
  infillDensity: 15,
  infillPattern: "grid",
  infillOverlap: 10,
  support: "none",
  supportAngle: 50,
  supportDensity: 15,
  supportXYDistance: 0.7,
  adhesion: "skirt",
  skirtLoops: 2,
  skirtDistance: 5,
  brimWidth: 5,
  firstLayerSpeed: 20,
  outerWallSpeed: 40,
  innerWallSpeed: 60,
  infillSpeed: 80,
  solidInfillSpeed: 60,
  supportSpeed: 60,
  travelSpeed: 150,
  hotendTemp: 205,
  firstLayerHotendTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  fanFirstLayer: 3,
  minLayerTime: 6,
  retractLength: 0.8,
  retractSpeed: 35,
  retractMinTravel: 1.5,
  zHop: 0.2,
  filamentDiameter: 1.75,
  filamentDensity: 1.24,
  flow: 100,
  pressureAdvance: 0,
  flavor: "marlin",
  startGcode: "G28 ; home\nG92 E0\nG1 Z0.3 F1200\nG1 X5 Y5 F3000\nG1 X5 Y{bedDepthMinus5} E10 F600 ; purge line\nG92 E0",
  endGcode: "G91\nG1 Z10 F1200\nG90\nG1 X0 Y{bedDepth} F3000 ; present print\nM84 ; motors off",
  enlargeSmall: true,
  minFeature: 0.4,
};

export type Field =
  | { key: keyof SliceSettings; label: string; type: "number"; unit?: string; min?: number; max?: number; step?: number; help?: string }
  | { key: keyof SliceSettings; label: string; type: "select"; options: [string, string][]; help?: string }
  | { key: keyof SliceSettings; label: string; type: "check"; help?: string }
  | { key: keyof SliceSettings; label: string; type: "text"; help?: string };

export const SETTING_GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Quality",
    fields: [
      { key: "layerHeight", label: "Layer height", type: "number", unit: "mm", min: 0.04, max: 1, step: 0.02 },
      { key: "firstLayerHeight", label: "First layer height", type: "number", unit: "mm", min: 0.05, max: 1, step: 0.02 },
      { key: "lineWidth", label: "Line width", type: "number", unit: "mm", min: 0.1, max: 2, step: 0.05 },
    ],
  },
  {
    title: "Walls",
    fields: [
      { key: "wallCount", label: "Wall count", type: "number", min: 1, max: 20, step: 1 },
      { key: "outerWallFirst", label: "Print outer wall first", type: "check" },
      { key: "seam", label: "Seam position", type: "select", options: [["nearest", "Nearest"], ["rear", "Rear"], ["random", "Random"]] },
      { key: "enlargeSmall", label: "Enlarge features too small to print", type: "check", help: "Widens thin features to at least the minimum feature size so they still get a wall." },
      { key: "minFeature", label: "Minimum feature size", type: "number", unit: "mm", min: 0.1, max: 2, step: 0.05 },
    ],
  },
  {
    title: "Top & bottom",
    fields: [
      { key: "topLayers", label: "Top layers", type: "number", min: 0, max: 30, step: 1 },
      { key: "bottomLayers", label: "Bottom layers", type: "number", min: 0, max: 30, step: 1 },
    ],
  },
  {
    title: "Infill",
    fields: [
      { key: "infillDensity", label: "Density", type: "number", unit: "%", min: 0, max: 100, step: 5 },
      { key: "infillPattern", label: "Pattern", type: "select", options: [["lines", "Lines"], ["grid", "Grid"], ["triangles", "Triangles"], ["concentric", "Concentric"]] },
      { key: "infillOverlap", label: "Overlap with walls", type: "number", unit: "%", min: 0, max: 50, step: 5 },
    ],
  },
  {
    title: "Support",
    fields: [
      { key: "support", label: "Support", type: "select", options: [["none", "None"], ["buildplate", "Build plate only"], ["everywhere", "Everywhere"]] },
      { key: "supportAngle", label: "Overhang angle", type: "number", unit: "°", min: 10, max: 89, step: 5 },
      { key: "supportDensity", label: "Density", type: "number", unit: "%", min: 5, max: 80, step: 5 },
      { key: "supportXYDistance", label: "Distance from model", type: "number", unit: "mm", min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    title: "Adhesion",
    fields: [
      { key: "adhesion", label: "Type", type: "select", options: [["none", "None"], ["skirt", "Skirt"], ["brim", "Brim"]] },
      { key: "skirtLoops", label: "Skirt loops", type: "number", min: 1, max: 20, step: 1 },
      { key: "skirtDistance", label: "Skirt distance", type: "number", unit: "mm", min: 0, max: 30, step: 1 },
      { key: "brimWidth", label: "Brim width", type: "number", unit: "mm", min: 1, max: 30, step: 1 },
    ],
  },
  {
    title: "Speed",
    fields: [
      { key: "firstLayerSpeed", label: "First layer", type: "number", unit: "mm/s", min: 1, max: 300 },
      { key: "outerWallSpeed", label: "Outer wall", type: "number", unit: "mm/s", min: 1, max: 500 },
      { key: "innerWallSpeed", label: "Inner wall", type: "number", unit: "mm/s", min: 1, max: 500 },
      { key: "infillSpeed", label: "Infill", type: "number", unit: "mm/s", min: 1, max: 500 },
      { key: "solidInfillSpeed", label: "Solid infill", type: "number", unit: "mm/s", min: 1, max: 500 },
      { key: "supportSpeed", label: "Support", type: "number", unit: "mm/s", min: 1, max: 500 },
      { key: "travelSpeed", label: "Travel", type: "number", unit: "mm/s", min: 10, max: 1000 },
    ],
  },
  {
    title: "Temperature",
    fields: [
      { key: "hotendTemp", label: "Hotend", type: "number", unit: "°C", min: 0, max: 450 },
      { key: "firstLayerHotendTemp", label: "Hotend, first layer", type: "number", unit: "°C", min: 0, max: 450 },
      { key: "bedTemp", label: "Bed", type: "number", unit: "°C", min: 0, max: 150 },
    ],
  },
  {
    title: "Cooling",
    fields: [
      { key: "fanSpeed", label: "Fan speed", type: "number", unit: "%", min: 0, max: 100, step: 5 },
      { key: "fanFirstLayer", label: "Fan starts at layer", type: "number", min: 1, max: 50, step: 1 },
      { key: "minLayerTime", label: "Minimum layer time", type: "number", unit: "s", min: 0, max: 60, help: "Slows down small layers so they can cool." },
    ],
  },
  {
    title: "Retraction",
    fields: [
      { key: "retractLength", label: "Length", type: "number", unit: "mm", min: 0, max: 15, step: 0.1 },
      { key: "retractSpeed", label: "Speed", type: "number", unit: "mm/s", min: 1, max: 200 },
      { key: "retractMinTravel", label: "Minimum travel", type: "number", unit: "mm", min: 0, max: 50, step: 0.5 },
      { key: "zHop", label: "Z hop", type: "number", unit: "mm", min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    title: "Material",
    fields: [
      { key: "filamentDiameter", label: "Filament diameter", type: "number", unit: "mm", min: 1, max: 3, step: 0.05 },
      { key: "filamentDensity", label: "Density", type: "number", unit: "g/cm³", min: 0.5, max: 5, step: 0.01 },
      { key: "flow", label: "Flow", type: "number", unit: "%", min: 50, max: 150, step: 1 },
    ],
  },
  {
    title: "Machine",
    fields: [
      { key: "flavor", label: "G-code flavor", type: "select", options: [["marlin", "Marlin"], ["klipper", "Klipper"]] },
      { key: "pressureAdvance", label: "Pressure / linear advance", type: "number", min: 0, max: 2, step: 0.01, help: "0 leaves it untouched." },
      { key: "startGcode", label: "Start G-code", type: "text", help: "Variables: {bedWidth} {bedDepth} {bedDepthMinus5}" },
      { key: "endGcode", label: "End G-code", type: "text" },
    ],
  },
];

export const PROFILES: Record<string, Partial<SliceSettings>> = {
  "0.20 mm Standard": {},
  "0.12 mm Fine": { layerHeight: 0.12, firstLayerHeight: 0.2, outerWallSpeed: 30, innerWallSpeed: 45, infillSpeed: 60, topLayers: 6, bottomLayers: 5 },
  "0.28 mm Draft": { layerHeight: 0.28, firstLayerHeight: 0.28, lineWidth: 0.5, outerWallSpeed: 50, innerWallSpeed: 70, infillSpeed: 100, topLayers: 3, bottomLayers: 3, infillDensity: 10 },
};

export const MATERIALS: Record<string, Partial<SliceSettings>> = {
  PLA: { hotendTemp: 205, firstLayerHotendTemp: 210, bedTemp: 60, fanSpeed: 100, filamentDensity: 1.24, retractLength: 0.8 },
  PETG: { hotendTemp: 235, firstLayerHotendTemp: 240, bedTemp: 80, fanSpeed: 40, filamentDensity: 1.27, retractLength: 1.0 },
  ABS: { hotendTemp: 250, firstLayerHotendTemp: 255, bedTemp: 100, fanSpeed: 0, filamentDensity: 1.04, retractLength: 0.8 },
  TPU: { hotendTemp: 225, firstLayerHotendTemp: 225, bedTemp: 50, fanSpeed: 50, filamentDensity: 1.21, retractLength: 0.5, infillSpeed: 25, outerWallSpeed: 20, innerWallSpeed: 25, solidInfillSpeed: 25 },
};

export function validateSettings(s: SliceSettings): string | null {
  for (const g of SETTING_GROUPS) {
    for (const f of g.fields) {
      if (f.type !== "number") continue;
      const v = s[f.key] as number;
      if (!Number.isFinite(v)) return `${f.label} must be a number`;
      if (f.min !== undefined && v < f.min) return `${f.label} must be at least ${f.min}`;
      if (f.max !== undefined && v > f.max) return `${f.label} must be at most ${f.max}`;
    }
  }
  if (s.lineWidth < s.layerHeight) return "Line width must be at least the layer height";
  return null;
}
