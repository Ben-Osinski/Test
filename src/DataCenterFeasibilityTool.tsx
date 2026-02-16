import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Info, Map as MapIcon, RefreshCcw, PackageOpen, Focus } from "lucide-react";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip,
} from "recharts";

// Mapping libs (no API keys)
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import * as turf from "@turf/turf";

/**
 * Data Center Feasibility Tool (Restored baseline + improved Mapping)
 * - Inputs / Power & Mix / Results / Mapping / Assumptions
 * - Mapping is downstream (one-way feed). Mapping edits do NOT change Inputs/Results.
 * - Buildable acres is derived from Parcel acres × Buildable % (slider).
 */

// -----------------------
// Brand palette (1898 & Co.)
// -----------------------
const BRAND = {
  orange: "#FF6A39",
  yellowOrange: "#E09641",
  slate: "#707070",
  onyx: "#393A3C",
  smoke: "#B6B8BA",
  midnight: "#003B65",
  teal: "#72CAC3",
  purple: "#52266F",
};

const MAP_LEGEND_COLORS = {
  building: BRAND.midnight,
  mep: BRAND.orange,
  sub: BRAND.yellowOrange,
  roads: BRAND.purple,
  generation: BRAND.teal,
  open: BRAND.slate,
  parcelFill: "rgba(0,59,101,0.18)",
  parcelLine: BRAND.midnight,
};

const LAND_COLORS = [
  MAP_LEGEND_COLORS.building,
  MAP_LEGEND_COLORS.mep,
  MAP_LEGEND_COLORS.sub,
  MAP_LEGEND_COLORS.roads,
  MAP_LEGEND_COLORS.generation,
  MAP_LEGEND_COLORS.open,
];
const MIX_COLORS = [
  BRAND.orange,
  BRAND.midnight,
  BRAND.teal,
  BRAND.purple,
  BRAND.yellowOrange,
  BRAND.slate,
];

type DesignBundleId = "enterprise" | "hyperscale" | "ai_hpc";

const DESIGN_BUNDLES: Record<
  DesignBundleId,
  { label: string; ft2PerRack: number; kwPerRack: number; supportPct: number; note: string }
> = {
  enterprise: {
    label: "Enterprise",
    ft2PerRack: 60,
    kwPerRack: 8,
    supportPct: 55,
    note: "60 ft2/rack · 8 kW/rack · 55% support",
  },
  hyperscale: {
    label: "Hyperscale",
    ft2PerRack: 45,
    kwPerRack: 10,
    supportPct: 45,
    note: "45 ft2/rack · 10 kW/rack · 45% support",
  },
  ai_hpc: {
    label: "AI / HPC",
    ft2PerRack: 32,
    kwPerRack: 30,
    supportPct: 58,
    note: "32 ft2/rack · 30 kW/rack · 58% support",
  },
};

function detectDesignBundle(ft2PerRack: number, kwPerRack: number, supportPct: number): DesignBundleId | "custom" {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const entries = Object.entries(DESIGN_BUNDLES) as Array<[DesignBundleId, (typeof DESIGN_BUNDLES)[DesignBundleId]]>;
  for (const [id, v] of entries) {
    if (eq(ft2PerRack, v.ft2PerRack) && eq(kwPerRack, v.kwPerRack) && eq(supportPct, v.supportPct)) {
      return id;
    }
  }
  return "custom";
}

const GENERATION_MAP_COLORS = ["#72CAC3", "#5FBBB4", "#4DAEA8", "#3BA19B", "#8ED9D3", "#A7E2DE"];

function hashString(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function generationColorForTechId(techId: string) {
  return GENERATION_MAP_COLORS[hashString(techId) % GENERATION_MAP_COLORS.length];
}

// -----------------------
// Utilities
// -----------------------
const AC_TO_M2 = 4046.8564224;
const FT2_PER_AC = 43560;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function useLocalStorageState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() =>
    safeJsonParse<T>(typeof window === "undefined" ? null : window.localStorage.getItem(key), initial)
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [key, state]);

  return [state, setState] as const;
}

// -----------------------
// UI helpers
// -----------------------
function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "bad" | "warn" | "info";
}) {
  const cls =
    tone === "good"
      ? "bg-green-100 text-green-800"
      : tone === "bad"
      ? "bg-red-100 text-red-800"
      : tone === "warn"
      ? "bg-yellow-100 text-yellow-900"
      : "bg-blue-100 text-blue-800";
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className={`text-xs ${subtle ? "text-muted-foreground" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

/**
 * NumberField prevents the "one digit then blur" UX.
 * - Maintains local string buffer
 * - Commits parsed numeric value on blur or Enter
 */
function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  placeholder,
  className,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [buf, setBuf] = useState<string>(() => (Number.isFinite(value) ? String(value) : ""));

  useEffect(() => {
    const asStr = Number.isFinite(value) ? String(value) : "";
    if (asStr !== buf && document.activeElement?.getAttribute("data-numfield") !== "1") {
      setBuf(asStr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    const parsed = num(buf, value);
    let v = parsed;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onCommit(v);
    setBuf(String(v));
  };

  return (
    <Input
      data-numfield="1"
      type="number"
      value={buf}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      onChange={(e) => setBuf(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: any) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function RangeWithInput({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  accent,
  onChange,
  note,
  valueFormat,
  inputWidthClass,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  accent?: string;
  onChange: (v: number) => void;
  note?: string;
  valueFormat?: (v: number) => string;
  inputWidthClass?: string;
}) {
  const v = Number.isFinite(value) ? value : min;
  const display = valueFormat ? valueFormat(v) : String(v);

  // If valueFormat produces non-numeric (rare), fall back to raw value in input.
  const numericDisplay = Number.isFinite(Number(display)) ? Number(display) : v;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <Label className="text-sm">{label}</Label>
        <div className="flex items-center gap-2">
          <NumberField
            value={numericDisplay}
            onCommit={(nv) => onChange(clamp(nv, min, max))}
            min={min}
            max={max}
            step={step}
            className={inputWidthClass || "w-28"}
          />
          {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(clamp(num((e.target as any).value, v), min, max))}
        className="w-full"
        style={{ accentColor: accent || BRAND.orange }}
      />

      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

// -----------------------
// Reliability
// -----------------------

type ReliabilityLevel = "99.9" | "99.99" | "99.999";

function kFromReliability(r: ReliabilityLevel) {
  if (r === "99.999") return 3;
  if (r === "99.99") return 2;
  return 1;
}

// -----------------------
// Mapping helpers
// -----------------------

type GenerationShapeModel = "rect_by_tech" | "square";
type FootprintShapeSpec = { geometry: "square" | "rect"; aspectRatio: number };

function shapeSpecForFootprint(kind: string): FootprintShapeSpec {
  if (!String(kind || "").startsWith("gen:")) return { geometry: "square", aspectRatio: 1 };

  const category = String(kind || "").split(":")[1] || "";
  const byCategory: Record<string, number> = {
    RICE: 1.4,
    SCGT: 1.8,
    CCGT: 2.2,
    FuelCell: 1.3,
    Nuclear: 1.4,
    PV: 2.6,
    Wind: 4.0,
    BESS: 1.7,
    Grid: 1.8,
  };
  const aspectRatio = byCategory[category] || 1.6;
  return { geometry: "rect", aspectRatio };
}

function acresToSquarePolygon(center: [number, number], acres: number) {
  const a = Math.max(0.0001, acres);
  const areaM2 = a * AC_TO_M2;
  const side = Math.sqrt(areaM2); // meters
  const c = turf.point(center);
  const half = side / 2;

  const north = turf.destination(c, half / 1000, 0, { units: "kilometers" });
  const south = turf.destination(c, half / 1000, 180, { units: "kilometers" });
  const east = turf.destination(c, half / 1000, 90, { units: "kilometers" });
  const west = turf.destination(c, half / 1000, -90, { units: "kilometers" });

  const nLat = (north.geometry.coordinates as any)[1];
  const sLat = (south.geometry.coordinates as any)[1];
  const eLon = (east.geometry.coordinates as any)[0];
  const wLon = (west.geometry.coordinates as any)[0];

  return turf.polygon([
    [
      [wLon, sLat],
      [eLon, sLat],
      [eLon, nLat],
      [wLon, nLat],
      [wLon, sLat],
    ],
  ]);
}

function acresToRectPolygon(center: [number, number], acres: number, aspectRatio: number, rotationDeg = 0) {
  const a = Math.max(0.0001, acres);
  const areaM2 = a * AC_TO_M2;
  const ratio = Math.max(1, Number(aspectRatio) || 1);

  const longM = Math.sqrt(areaM2 * ratio);
  const shortM = areaM2 / longM;

  const rotate = ((Math.round(rotationDeg / 90) * 90) % 180 + 180) % 180;
  const eastWestM = rotate === 90 ? shortM : longM;
  const northSouthM = rotate === 90 ? longM : shortM;

  const halfXKm = eastWestM / 2000;
  const halfYKm = northSouthM / 2000;
  const c = turf.point(center);

  const moveBy = (dxKm: number, dyKm: number) => {
    const movedE = turf.destination(c, Math.abs(dxKm), dxKm >= 0 ? 90 : -90, { units: "kilometers" });
    const moved = turf.destination(movedE, Math.abs(dyKm), dyKm >= 0 ? 0 : 180, { units: "kilometers" });
    return moved.geometry.coordinates as [number, number];
  };

  const sw = moveBy(-halfXKm, -halfYKm);
  const se = moveBy(halfXKm, -halfYKm);
  const ne = moveBy(halfXKm, halfYKm);
  const nw = moveBy(-halfXKm, halfYKm);

  return turf.polygon([[sw, se, ne, nw, sw]]);
}

function makeFootprintPolygon(
  item: { kind: string; acres: number },
  center: [number, number],
  shapeModel: GenerationShapeModel,
  rotationDeg = 0
) {
  const spec = shapeSpecForFootprint(item.kind);
  if (shapeModel === "square" || spec.geometry === "square") {
    return acresToSquarePolygon(center, item.acres);
  }
  return acresToRectPolygon(center, item.acres, spec.aspectRatio, rotationDeg);
}

function polygonCentroidLngLat(poly: any): [number, number] {
  try {
    const c = turf.centerOfMass(poly);
    const [lng, lat] = c.geometry.coordinates as any;
    return [lng, lat];
  } catch {
    try {
      const c = turf.centroid(poly);
      const [lng, lat] = c.geometry.coordinates as any;
      return [lng, lat];
    } catch {
      return [0, 0];
    }
  }
}

function featureAcres(f: any): number {
  if (!f) return 0;

  const gt = f.geometry?.type;
  if (gt === "Polygon" || gt === "MultiPolygon") {
    try {
      const areaM2 = turf.area(f as any);
      const acres = areaM2 / AC_TO_M2;
      return Number.isFinite(acres) ? acres : 0;
    } catch {
      // fall through
    }
  }

  const fromProps = Number(f.properties?.acres);
  return Number.isFinite(fromProps) ? fromProps : 0;
}

type BasemapId = "LightGray" | "Aerial" | "OSM";

type BasemapDef = {
  id: BasemapId;
  label: string;
  tiles: string;
  attribution: string;
};

const BASEMAPS: BasemapDef[] = [
  {
    id: "LightGray",
    label: "Light gray",
    tiles: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
  },
  {
    id: "OSM",
    label: "OSM Standard",
    tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  {
    id: "Aerial",
    label: "Aerial",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
  },
];

function getBasemapDef(id: BasemapId) {
  return BASEMAPS.find((b) => b.id === id) || BASEMAPS[0];
}

function applyBasemap(map: maplibregl.Map, enabled: boolean, basemapId: BasemapId) {
  const srcId = "basemap-src";
  const lyrId = "basemap-lyr";

  // Remove existing layer/source safely
  if (map.getLayer(lyrId)) {
    try {
      map.removeLayer(lyrId);
    } catch {
      // ignore
    }
  }
  if (map.getSource(srcId)) {
    try {
      map.removeSource(srcId);
    } catch {
      // ignore
    }
  }

  if (!enabled) return;

  const bm = getBasemapDef(basemapId);
  map.addSource(
    srcId,
    {
      type: "raster",
      tiles: [bm.tiles],
      tileSize: 256,
      attribution: bm.attribution,
    } as any
  );

  // Insert basemap ABOVE the background, but BELOW draw layers/anything else.
  const layers = map.getStyle().layers || [];
  const insertBeforeId = layers.find((l) => l.type !== "background" && l.id !== lyrId)?.id;

  map.addLayer(
    {
      id: lyrId,
      type: "raster",
      source: srcId,
      paint: {
        "raster-opacity": 1,
      },
    } as any,
    insertBeforeId
  );
}

function makeLabelEl(text: string, color: string, isParcel?: boolean) {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1.1";
  el.style.padding = "4px 6px";
  el.style.borderRadius = "999px";
  el.style.border = `1px solid ${isParcel ? BRAND.midnight : "rgba(0,0,0,0.15)"}`;
  el.style.background = "rgba(255,255,255,0.92)";
  el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.12)";
  el.style.color = BRAND.onyx;
  el.style.whiteSpace = "nowrap";

  const dot = document.createElement("span");
  dot.className = "dc-label-dot";
  dot.style.display = "inline-block";
  dot.style.width = "10px";
  dot.style.height = "10px";
  dot.style.borderRadius = "999px";
  dot.style.marginRight = "6px";
  dot.style.verticalAlign = "middle";
  dot.style.background = color;
  dot.style.border = "1px solid rgba(0,0,0,0.15)";

  const t = document.createElement("span");
  t.className = "dc-label-text";
  t.textContent = text;
  t.style.verticalAlign = "middle";

  el.appendChild(dot);
  el.appendChild(t);
  return el;
}

// -----------------------
// Technology library
// -----------------------

type TechCategory =
  | "Grid"
  | "RICE"
  | "SCGT"
  | "CCGT"
  | "FuelCell"
  | "Nuclear"
  | "PV"
  | "Wind"
  | "BESS";

type FirmDispatchCategory = Exclude<TechCategory, "PV" | "Wind" | "BESS">;

type LibraryBasis = "conservative" | "typical" | "aggressive";

const TECH_CATEGORY_ORDER: TechCategory[] = [
  "Grid",
  "RICE",
  "SCGT",
  "CCGT",
  "FuelCell",
  "Nuclear",
  "PV",
  "Wind",
  "BESS",
];

const DISPATCH_FIRM_CATEGORIES: FirmDispatchCategory[] = ["Grid", "RICE", "SCGT", "CCGT", "FuelCell", "Nuclear"];

const DISPATCH_PROFILE_24H: { pv: number[]; wind: number[] } = {
  // Representative normalized day shape (screening only).
  pv: [0, 0, 0, 0, 0, 0.02, 0.08, 0.2, 0.4, 0.62, 0.8, 0.92, 1, 0.95, 0.82, 0.62, 0.38, 0.16, 0.05, 0.01, 0, 0, 0, 0],
  wind: [0.45, 0.42, 0.4, 0.38, 0.36, 0.34, 0.32, 0.3, 0.28, 0.26, 0.25, 0.24, 0.24, 0.26, 0.28, 0.31, 0.34, 0.38, 0.42, 0.46, 0.5, 0.52, 0.5, 0.47],
};

const DISPATCH_SERIES_COLORS = {
  pvMW: BRAND.yellowOrange,
  windMW: BRAND.teal,
  bessDischargeMW: BRAND.purple,
  requiredMW: BRAND.onyx,
  socMWh: BRAND.slate,
  excessMW: "#0EA5E9",
  unservedMW: "#B91C1C",
};

const DISPATCH_FIRM_CATEGORY_COLORS: Record<FirmDispatchCategory, string> = {
  Grid: BRAND.midnight,
  RICE: "#7C4A2E",
  SCGT: "#A35A2B",
  CCGT: "#2A6F9E",
  FuelCell: "#3F7A5B",
  Nuclear: "#5F4B8B",
};

const DISPATCH_FIRM_MIN_LOAD_PCT: Record<FirmDispatchCategory, number> = {
  Grid: 0,
  RICE: 0.25,
  SCGT: 0.35,
  CCGT: 0.5,
  FuelCell: 0.5,
  Nuclear: 0.9,
};

const LIBRARY_BASIS_LABELS: Record<LibraryBasis, string> = {
  conservative: "Conservative",
  typical: "Typical",
  aggressive: "Aggressive",
};

type Tech = {
  id: string;
  name: string;
  category: TechCategory;
  isFirm: boolean;
  unitMW: number;
  defaultAvailability: number;
  heatRateBtuPerKWh: number;
  waterGalPerMWh: number;
  landFixedAc: number;
  landAcPerMW: number;
  notes?: string;
};

const TECH_LIBRARY: Tech[] = [
  {
    id: "grid_50",
    name: "Grid (50 MW block)",
    category: "Grid",
    isFirm: true,
    unitMW: 50,
    defaultAvailability: 0.9995,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 0,
    notes: "Firm via utility interconnect; land accounted via Substation in land model.",
  },
  {
    id: "grid_100",
    name: "Grid (100 MW block)",
    category: "Grid",
    isFirm: true,
    unitMW: 100,
    defaultAvailability: 0.9995,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 0,
    notes: "Firm via utility interconnect; land accounted via Substation in land model.",
  },
  {
    id: "grid_250",
    name: "Grid (250 MW block)",
    category: "Grid",
    isFirm: true,
    unitMW: 250,
    defaultAvailability: 0.9995,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 0,
    notes: "Firm via utility interconnect; land accounted via Substation in land model.",
  },

  // RICE
  {
    id: "rice_ng_3",
    name: "Recip (NG) - RICE 3 MW engine",
    category: "RICE",
    isFirm: true,
    unitMW: 3,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 9300,
    waterGalPerMWh: 1,
    landFixedAc: 0.8,
    landAcPerMW: 0.08,
    notes: "Screening-level small NG reciprocating engine.",
  },
  {
    id: "rice_ng_5",
    name: "Recip (NG) - RICE 5 MW engine",
    category: "RICE",
    isFirm: true,
    unitMW: 5,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 9100,
    waterGalPerMWh: 1,
    landFixedAc: 1.2,
    landAcPerMW: 0.07,
    notes: "Screening-level medium NG reciprocating engine.",
  },
  {
    id: "rice_ng_10",
    name: "Recip (NG) - RICE 10 MW engine",
    category: "RICE",
    isFirm: true,
    unitMW: 10,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 8924,
    waterGalPerMWh: 1,
    landFixedAc: 2,
    landAcPerMW: 0.06,
    notes: "Screening-level modern NG reciprocating; land model includes scale economies.",
  },
  {
    id: "rice_ng_18",
    name: "Recip (NG) - RICE 18 MW engine",
    category: "RICE",
    isFirm: true,
    unitMW: 18,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 8800,
    waterGalPerMWh: 1,
    landFixedAc: 2.8,
    landAcPerMW: 0.05,
    notes: "Screening-level large-bore NG reciprocating engine.",
  },

  // SCGT
  {
    id: "scgt_industrial_15",
    name: "SCGT - Industrial (~15 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 15,
    defaultAvailability: 0.97,
    heatRateBtuPerKWh: 11000,
    waterGalPerMWh: 0,
    landFixedAc: 1.5,
    landAcPerMW: 0.03,
    notes: "Representative industrial CT; water not modeled (screening).",
  },
  {
    id: "scgt_lm2500_33",
    name: "SCGT - LM2500 (~33 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 33,
    defaultAvailability: 0.97,
    heatRateBtuPerKWh: 8669,
    waterGalPerMWh: 0,
    landFixedAc: 2,
    landAcPerMW: 0.02,
    notes: "Aero CT screening heat rate order-of-magnitude.",
  },
  {
    id: "scgt_lm6000_57",
    name: "SCGT - LM6000 (~57 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 57,
    defaultAvailability: 0.97,
    heatRateBtuPerKWh: 8328,
    waterGalPerMWh: 0,
    landFixedAc: 2,
    landAcPerMW: 0.02,
    notes: "Aero CT screening heat rate order-of-magnitude.",
  },
  {
    id: "scgt_frame_e_130",
    name: "SCGT - Frame E (~130 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 130,
    defaultAvailability: 0.96,
    heatRateBtuPerKWh: 9800,
    waterGalPerMWh: 0,
    landFixedAc: 3,
    landAcPerMW: 0.016,
    notes: "Frame E class placeholder.",
  },
  {
    id: "scgt_frame_f_250",
    name: "SCGT - Frame F (~250 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 250,
    defaultAvailability: 0.96,
    heatRateBtuPerKWh: 9700,
    waterGalPerMWh: 0,
    landFixedAc: 5,
    landAcPerMW: 0.012,
    notes: "Frame F class placeholder.",
  },
  {
    id: "scgt_frame_h_360",
    name: "SCGT - Frame H (~360 MW)",
    category: "SCGT",
    isFirm: true,
    unitMW: 360,
    defaultAvailability: 0.96,
    heatRateBtuPerKWh: 9300,
    waterGalPerMWh: 0,
    landFixedAc: 6,
    landAcPerMW: 0.011,
    notes: "Large frame simple-cycle placeholder.",
  },

  // CCGT
  {
    id: "ccgt_lm6000_2x1_152",
    name: "CCGT - LM6000 2x1 (~152 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 152,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6178,
    waterGalPerMWh: 198,
    landFixedAc: 5,
    landAcPerMW: 0.012,
    notes: "Screening heat rate; water assumes recirc cooling tower factor.",
  },
  {
    id: "ccgt_frame_f_1x1_420",
    name: "CCGT - Frame F 1x1 (~420 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 420,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6800,
    waterGalPerMWh: 198,
    landFixedAc: 8,
    landAcPerMW: 0.011,
    notes: "Placeholder; recirc cooling tower factor.",
  },
  {
    id: "ccgt_frame_f_2x1_700",
    name: "CCGT - Frame F 2x1 (~700 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 700,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6500,
    waterGalPerMWh: 198,
    landFixedAc: 10,
    landAcPerMW: 0.009,
    notes: "Placeholder; recirc tower water factor.",
  },
  {
    id: "ccgt_frame_f_2x1_700_dry",
    name: "CCGT - Frame F 2x1 (~700 MW, dry cooling)",
    category: "CCGT",
    isFirm: true,
    unitMW: 700,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6700,
    waterGalPerMWh: 45,
    landFixedAc: 12,
    landAcPerMW: 0.01,
    notes: "Placeholder; dry cooling reduces water intensity.",
  },
  {
    id: "ccgt_frame_h_1x1_650",
    name: "CCGT - Frame H 1x1 (~650 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 650,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6200,
    waterGalPerMWh: 198,
    landFixedAc: 12,
    landAcPerMW: 0.008,
    notes: "Placeholder; recirc tower water factor.",
  },
  {
    id: "ccgt_frame_h_2x1_1000",
    name: "CCGT - Frame H 2x1 (~1,000 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 1000,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6100,
    waterGalPerMWh: 198,
    landFixedAc: 14,
    landAcPerMW: 0.007,
    notes: "Placeholder; recirc tower water factor.",
  },
  {
    id: "ccgt_frame_j_1x1_700",
    name: "CCGT - Frame J 1x1 (~700 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 700,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6000,
    waterGalPerMWh: 198,
    landFixedAc: 12,
    landAcPerMW: 0.008,
    notes: "Placeholder; recirc tower water factor.",
  },
  {
    id: "ccgt_frame_j_2x1_1100",
    name: "CCGT - Frame J 2x1 (~1,100 MW)",
    category: "CCGT",
    isFirm: true,
    unitMW: 1100,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 5900,
    waterGalPerMWh: 198,
    landFixedAc: 15,
    landAcPerMW: 0.007,
    notes: "Placeholder; recirc tower water factor.",
  },

  // Fuel cells
  {
    id: "fuelcell_sofc_5",
    name: "Fuel Cells (SOFC) - 5 MW block",
    category: "FuelCell",
    isFirm: true,
    unitMW: 5,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6600,
    waterGalPerMWh: 0,
    landFixedAc: 0.6,
    landAcPerMW: 0.012,
    notes: "Screening-level SOFC; assumes negligible water.",
  },
  {
    id: "fuelcell_sofc_10",
    name: "Fuel Cells (SOFC) - 10 MW block",
    category: "FuelCell",
    isFirm: true,
    unitMW: 10,
    defaultAvailability: 0.95,
    heatRateBtuPerKWh: 6300,
    waterGalPerMWh: 0,
    landFixedAc: 1,
    landAcPerMW: 0.01,
    notes: "Screening-level; assumes negligible water.",
  },
  {
    id: "fuelcell_pem_5",
    name: "Fuel Cells (PEM) - 5 MW block",
    category: "FuelCell",
    isFirm: true,
    unitMW: 5,
    defaultAvailability: 0.96,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0.5,
    landAcPerMW: 0.01,
    notes: "PEM block; hydrogen supply/fuel use not modeled in this screening tool.",
  },

  // Nuclear
  {
    id: "nuclear_large_1100",
    name: "Nuclear - Large site (~1,100 MW)",
    category: "Nuclear",
    isFirm: true,
    unitMW: 1100,
    defaultAvailability: 0.92,
    heatRateBtuPerKWh: 10500,
    waterGalPerMWh: 672,
    landFixedAc: 700,
    landAcPerMW: 0.02,
    notes: "Screening: includes large buffer/exclusion; recirc cooling tower water factor.",
  },
  {
    id: "nuclear_smr_module_300",
    name: "Nuclear - SMR module (~300 MW)",
    category: "Nuclear",
    isFirm: true,
    unitMW: 300,
    defaultAvailability: 0.92,
    heatRateBtuPerKWh: 10500,
    waterGalPerMWh: 672,
    landFixedAc: 180,
    landAcPerMW: 0.04,
    notes: "Screening: multi-module SMR site envelope; recirc cooling tower water factor.",
  },
  {
    id: "nuclear_smr_module_77",
    name: "Nuclear - SMR module (~77 MW)",
    category: "Nuclear",
    isFirm: true,
    unitMW: 77,
    defaultAvailability: 0.92,
    heatRateBtuPerKWh: 10500,
    waterGalPerMWh: 672,
    landFixedAc: 80,
    landAcPerMW: 0.08,
    notes: "Screening: SMR site envelope; recirc cooling tower water factor.",
  },
  {
    id: "nuclear_micro_10",
    name: "Nuclear - Microreactor (~10 MW)",
    category: "Nuclear",
    isFirm: true,
    unitMW: 10,
    defaultAvailability: 0.92,
    heatRateBtuPerKWh: 10500,
    waterGalPerMWh: 0,
    landFixedAc: 3,
    landAcPerMW: 0.05,
    notes: "Screening: microreactor; water not modeled.",
  },

  // Non-firm
  {
    id: "pv_5",
    name: "PV (non-firm) - ~5 MW block",
    category: "PV",
    isFirm: false,
    unitMW: 5,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 7,
    notes: "Utility-scale PV land (screening).",
  },
  {
    id: "pv_25",
    name: "PV (non-firm) - ~25 MW block",
    category: "PV",
    isFirm: false,
    unitMW: 25,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 6.5,
    notes: "Utility-scale PV block with fixed+single-axis screening acreage.",
  },
  {
    id: "pv_100",
    name: "PV (non-firm) - ~100 MW block",
    category: "PV",
    isFirm: false,
    unitMW: 100,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 6.5,
    notes: "Large utility-scale PV block; screening acreage only.",
  },
  {
    id: "wind_5",
    name: "Wind (non-firm) - ~5 MW turbine",
    category: "Wind",
    isFirm: false,
    unitMW: 5,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 82,
    notes: "Wind land is total project area (capacity density).",
  },
  {
    id: "wind_8",
    name: "Wind (non-firm) - ~8 MW turbine",
    category: "Wind",
    isFirm: false,
    unitMW: 8,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0,
    landAcPerMW: 70,
    notes: "Onshore wind total project area by capacity density (screening).",
  },
  {
    id: "bess_20",
    name: "BESS (non-firm) - 20 MW block",
    category: "BESS",
    isFirm: false,
    unitMW: 20,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0.3,
    landAcPerMW: 0.17,
    notes: "Compact footprint; duration handled by ELCC duration setting.",
  },
  {
    id: "bess_50",
    name: "BESS (non-firm) - 50 MW block",
    category: "BESS",
    isFirm: false,
    unitMW: 50,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 0.5,
    landAcPerMW: 0.15,
    notes: "Compact footprint; accreditation depends on duration.",
  },
  {
    id: "bess_100",
    name: "BESS (non-firm) - 100 MW block",
    category: "BESS",
    isFirm: false,
    unitMW: 100,
    defaultAvailability: 0,
    heatRateBtuPerKWh: 0,
    waterGalPerMWh: 0,
    landFixedAc: 1,
    landAcPerMW: 0.14,
    notes: "Compact footprint; duration handled by ELCC duration setting.",
  },
];

function techById(id: string) {
  return TECH_LIBRARY.find((t) => t.id === id);
}

function techWithLibraryBasis(tech: Tech, basis: LibraryBasis | undefined): Tech {
  const b: LibraryBasis = basis || "typical";
  if (b === "typical") return tech;

  const cfg =
    b === "conservative"
      ? {
          firmAvailDelta: -0.02,
          gridAvailDelta: -0.0005,
          heatRateMult: 1.05,
          waterMult: 1.1,
          landFixedMult: 1.15,
          landPerMWMult: 1.15,
        }
      : {
          firmAvailDelta: 0.01,
          gridAvailDelta: 0.0002,
          heatRateMult: 0.96,
          waterMult: 0.9,
          landFixedMult: 0.9,
          landPerMWMult: 0.9,
        };

  const availDelta = tech.category === "Grid" ? cfg.gridAvailDelta : cfg.firmAvailDelta;
  const adjustedAvailability = tech.isFirm ? clamp(tech.defaultAvailability + availDelta, 0, 0.9999) : tech.defaultAvailability;

  return {
    ...tech,
    defaultAvailability: adjustedAvailability,
    heatRateBtuPerKWh: tech.heatRateBtuPerKWh > 0 ? tech.heatRateBtuPerKWh * cfg.heatRateMult : tech.heatRateBtuPerKWh,
    waterGalPerMWh: tech.waterGalPerMWh > 0 ? tech.waterGalPerMWh * cfg.waterMult : tech.waterGalPerMWh,
    landFixedAc: tech.landFixedAc > 0 ? tech.landFixedAc * cfg.landFixedMult : tech.landFixedAc,
    landAcPerMW: tech.landAcPerMW > 0 ? tech.landAcPerMW * cfg.landPerMWMult : tech.landAcPerMW,
  };
}

// -----------------------
// App state
// -----------------------

type InputsState = {
  modeUseTarget: boolean;
  targetITMW: number;

  parcelAc: number;
  buildablePct: number; // buildable acres derived from parcel
  siteCoveragePct: number;
  mepYardPct: number;
  roadsPct: number;
  substationAc: number;

  stories: number;
  ft2PerRack: number;
  kwPerRack: number;
  supportPct: number;

  cooling: "Air" | "Liquid";
  pue: number;
  wue: number;

  phases: number;
  phaseMode: "equal" | "manual";
  phaseIT: number[];
};

type PowerRow = {
  id: string;
  techId: string;
  units: number;
  unitMWOverride?: number;
  availabilityOverride?: number;
};

type PowerState = {
  reliability: ReliabilityLevel;
  sizeToFacility: boolean;
  libraryBasis: LibraryBasis;
  dispatchMinLoadEnabled?: boolean;

  elccEnabled: boolean;
  pvElccPct: number;
  windElccPct: number;
  bessElccPct: number;
  bessDurationHr: number;

  rows: PowerRow[];
};

type MappingState = {
  networkEnabled: boolean;
  basemap: BasemapId;
  generationShapeModel: GenerationShapeModel;
  center: { lat: number; lon: number };
  zoom: number;
  draw: any | null;
};

type AppState = {
  schemaVersion: number;
  tab: "inputs" | "power" | "results" | "mapping" | "assumptions";
  inputs: InputsState;
  power: PowerState;
  mapping: MappingState;
};

type DispatchHourRow = {
  hour: string;
  requiredMW: number;
  pvMW: number;
  windMW: number;
  bessChargeMW: number;
  bessDischargeMW: number;
  excessMW: number;
  unservedMW: number;
  curtailedMW: number;
  socMWh: number;
  servedMW: number;
  firmMW: number;
  [firmCategoryKey: string]: number | string;
};

type DispatchResult = {
  byHour: DispatchHourRow[];
  stackKeys: string[];
  totals: {
    servedMWh: number;
    unservedMWh: number;
    curtailedMWh: number;
    excessMWh: number;
    renewableServedMWh: number;
    firmServedMWh: number;
  };
};

function isFirmDispatchCategory(category: TechCategory): category is FirmDispatchCategory {
  return (DISPATCH_FIRM_CATEGORIES as string[]).includes(category);
}

function firmDispatchKey(category: FirmDispatchCategory) {
  return `firm_${category}`;
}

const APP_SCHEMA_VERSION = 19;

const DEFAULTS: AppState = {
  schemaVersion: APP_SCHEMA_VERSION,
  tab: "inputs",
  inputs: {
    modeUseTarget: true,
    targetITMW: 100,

    parcelAc: 500,
    buildablePct: 30,
    siteCoveragePct: 100,
    mepYardPct: 15,
    roadsPct: 10,
    substationAc: 2,

    stories: 1,
    ft2PerRack: 45,
    kwPerRack: 10,
    supportPct: 45,

    cooling: "Air",
    pue: 1.35,
    wue: 0.3,

    phases: 3,
    phaseMode: "equal",
    phaseIT: [33.33, 33.33, 33.34],
  },
  power: {
    reliability: "99.9",
    sizeToFacility: true,
    libraryBasis: "typical",
    dispatchMinLoadEnabled: true,

    elccEnabled: false,
    pvElccPct: 40,
    windElccPct: 20,
    bessElccPct: 100,
    bessDurationHr: 4,

    rows: [
      { id: "r1", techId: "grid_100", units: 1 },
      { id: "r2", techId: "scgt_lm6000_57", units: 3 },
      { id: "r3", techId: "pv_5", units: 0 },
      { id: "r4", techId: "wind_5", units: 0 },
      { id: "r5", techId: "bess_50", units: 0 },
    ],
  },
  mapping: {
    networkEnabled: false,
    basemap: "LightGray",
    generationShapeModel: "rect_by_tech",
    center: { lat: 39.7392, lon: -104.9903 },
    zoom: 13,
    draw: null,
  },
};

// -----------------------
// Core computations
// -----------------------

function getBuildableAc(inputs: InputsState) {
  const pct = clamp(inputs.buildablePct, 0, 100) / 100;
  return Math.max(0, inputs.parcelAc) * pct;
}

function computeEnvelopeFromLand(inputs: InputsState) {
  const buildableAc = getBuildableAc(inputs);
  const stories = Math.max(1, Math.round(inputs.stories || 1));

  const envelopeFootprintAc = buildableAc * (clamp(inputs.siteCoveragePct, 0, 100) / 100);
  const envelopeFootprintFt2 = envelopeFootprintAc * FT2_PER_AC;
  const envelopeTotalFloorFt2 = envelopeFootprintFt2 * stories;

  const supportFrac = clamp(inputs.supportPct, 0, 90) / 100;
  const envelopeWhiteSpaceFt2 = envelopeTotalFloorFt2 * (1 - supportFrac);

  const ft2PerRack = Math.max(1, inputs.ft2PerRack);
  const racks = envelopeWhiteSpaceFt2 / ft2PerRack;
  const kwPerRack = Math.max(0, inputs.kwPerRack);
  const itMW = (racks * kwPerRack) / 1000;

  return {
    buildableAc,
    stories,
    envelopeFootprintAc,
    envelopeFootprintFt2,
    envelopeTotalFloorFt2,
    envelopeWhiteSpaceFt2,
    racks,
    itMW,
  };
}

function computeRequiredBuildingFootprint(inputs: InputsState, itMW: number) {
  const kwPerRack = Math.max(0.0001, inputs.kwPerRack);
  const racksNeeded = (Math.max(0, itMW) * 1000) / kwPerRack;

  const ft2PerRack = Math.max(1, inputs.ft2PerRack);
  const whiteSpaceFt2 = racksNeeded * ft2PerRack;

  const supportFrac = clamp(inputs.supportPct, 0, 90) / 100;
  const totalFloorFt2 = supportFrac >= 0.999 ? whiteSpaceFt2 : whiteSpaceFt2 / (1 - supportFrac);

  const stories = Math.max(1, Math.round(inputs.stories || 1));
  const footprintFt2 = totalFloorFt2 / stories;
  const footprintAc = footprintFt2 / FT2_PER_AC;

  return {
    racksNeeded,
    whiteSpaceFt2,
    totalFloorFt2,
    footprintFt2,
    footprintAc,
    stories,
  };
}

function computeEffectiveIT(inputs: InputsState, maxIt: number) {
  const target = Math.max(0, inputs.targetITMW);
  if (!inputs.modeUseTarget) {
    return { itMW: maxIt, mode: "max" as const };
  }
  const it = Math.min(target, maxIt);
  const limited = target > maxIt + 1e-6;
  return { itMW: it, mode: limited ? ("land-limited" as const) : ("target" as const) };
}

function computeFacilityPower(itMW: number, pue: number) {
  const PUE = Math.max(1.0, pue);
  const facility = itMW * PUE;
  const itShare = 1 / PUE;
  return { facilityMW: facility, itShare };
}

function estimateSubstationAcres(facilityMW: number) {
  const mw = Math.max(0, facilityMW);
  if (mw <= 0) return 0;
  return 1.25 + 0.0075 * mw;
}

function computeLandAllocation(
  inputs: InputsState,
  buildingFootprintAc: number,
  genFootprintAc: number,
  facilityMW: number
) {
  const buildable = getBuildableAc(inputs);
  const building = Math.max(0, buildingFootprintAc);
  const mep = building * (clamp(inputs.mepYardPct, 0, 100) / 100);
  const sub = Math.max(0, Math.max(inputs.substationAc, estimateSubstationAcres(facilityMW)));
  const roadsBase = building + mep + sub;
  const roads = roadsBase * (clamp(inputs.roadsPct, 0, 100) / 100);

  const baseUsed = building + mep + roads + sub;
  const openRaw = Math.max(0, buildable - baseUsed);

  const gen = Math.max(0, genFootprintAc);
  const openAfter = Math.max(0, openRaw - gen);

  return {
    buildable,
    building,
    mep,
    roads,
    sub,
    gen,
    open: openAfter,
    openRaw,
    baseUsed,
  };
}

function computePowerMix(power: PowerState) {
  const rows = power.rows
    .map((r) => {
      const baseTech = techById(r.techId);
      if (!baseTech) return null;
      const t = techWithLibraryBasis(baseTech, power.libraryBasis);

      const unitMW = r.unitMWOverride != null ? Math.max(0, r.unitMWOverride) : t.unitMW;
      const avail = r.availabilityOverride != null ? clamp(r.availabilityOverride, 0, 1) : t.defaultAvailability;
      const units = Math.max(0, Math.round(r.units || 0));

      const installedMW = units * unitMW;
      const firmMWPerUnit = t.isFirm ? unitMW * avail : 0;
      const firmAvailable = t.isFirm ? installedMW * avail : 0;

      return {
        ...r,
        tech: t,
        units,
        unitMW,
        availability: avail,
        installedMW,
        firmMWPerUnit,
        firmAvailableMW: firmAvailable,
      };
    })
    .filter(Boolean) as any[];

  return rows;
}

function computeReliability(power: PowerState, requiredMW: number, computedRows: any[]) {
  const k = kFromReliability(power.reliability);

  const firmUnits: { name: string; mw: number; installedMW: number; techId: string }[] = [];
  for (const r of computedRows) {
    if (!r.tech.isFirm) continue;
    for (let i = 0; i < r.units; i++) {
      firmUnits.push({
        name: r.tech.name,
        mw: r.firmMWPerUnit,
        installedMW: r.unitMW,
        techId: r.tech.id,
      });
    }
  }

  firmUnits.sort((a, b) => b.mw - a.mw);
  const dropped = firmUnits.slice(0, k);
  const droppedMW = dropped.reduce((a, b) => a + b.mw, 0);

  const installedFirmTotal = computedRows
    .filter((r) => r.tech.isFirm)
    .reduce((a, b) => a + (b.installedMW || 0), 0);
  const availableFirmTotal = computedRows
    .filter((r) => r.tech.isFirm)
    .reduce((a, b) => a + (b.firmAvailableMW || 0), 0);
  const remainingFirm = Math.max(0, availableFirmTotal - droppedMW);

  const pvInstalled = computedRows
    .filter((r) => r.tech.category === "PV")
    .reduce((a, b) => a + (b.installedMW || 0), 0);
  const windInstalled = computedRows
    .filter((r) => r.tech.category === "Wind")
    .reduce((a, b) => a + (b.installedMW || 0), 0);
  const bessInstalled = computedRows
    .filter((r) => r.tech.category === "BESS")
    .reduce((a, b) => a + (b.installedMW || 0), 0);

  const bessDurationFactor = clamp(power.bessDurationHr / 4, 0, 1);

  const accredited = power.elccEnabled
    ? (pvInstalled * clamp(power.pvElccPct, 0, 100)) / 100 +
      (windInstalled * clamp(power.windElccPct, 0, 100)) / 100 +
      ((bessInstalled * clamp(power.bessElccPct, 0, 100)) / 100) * bessDurationFactor
    : 0;

  const meets = remainingFirm + accredited >= requiredMW - 1e-9 && requiredMW > 0;

  return {
    k,
    dropped,
    installedFirmTotal,
    availableFirmTotal,
    remainingFirm,
    accredited,
    meets,
  };
}

function computeGenerationFootprint(computedRows: any[]) {
  const byTech: {
    id: string;
    name: string;
    category: TechCategory;
    installedMW: number;
    acres: number;
    isFirm: boolean;
    color: string;
  }[] = [];

  for (const r of computedRows) {
    const t: Tech = r.tech;
    const installed = r.installedMW || 0;
    if (installed <= 0) continue;

    const acres = Math.max(0, t.landFixedAc + t.landAcPerMW * installed);
    const color = generationColorForTechId(t.id);
    byTech.push({
      id: t.id,
      name: t.name,
      category: t.category,
      installedMW: installed,
      acres,
      isFirm: t.isFirm,
      color,
    });
  }

  const total = byTech.reduce((a, b) => a + b.acres, 0);
  return { byTech, total };
}

function computeDispatchSummary(requiredMW: number, computedRows: any[]) {
  const req = Math.max(0, requiredMW);
  const firmRows = computedRows.filter((r: any) => r.tech?.isFirm && (r.firmAvailableMW || 0) > 0);
  const totalAvail = firmRows.reduce((a: number, b: any) => a + (b.firmAvailableMW || 0), 0);
  const dispatchedTotal = totalAvail > 0 ? Math.min(req, totalAvail) : 0;

  const byTech = firmRows
    .map((r: any) => {
      const share = totalAvail > 0 ? (r.firmAvailableMW || 0) / totalAvail : 0;
      const dispatchMW = dispatchedTotal * share;
      const heatRate = r.tech.heatRateBtuPerKWh || 0;
      const water = r.tech.waterGalPerMWh || 0;
      const mmbtuPerHr = heatRate > 0 ? (dispatchMW * heatRate) / 1000 : 0;
      const waterGalPerHr = dispatchMW * water;
      return {
        id: r.tech.id,
        name: r.tech.name,
        dispatchMW,
        mmbtuPerHr,
        waterGalPerHr,
      };
    })
    .filter((x: any) => x.dispatchMW > 1e-6 || x.mmbtuPerHr > 1e-6 || x.waterGalPerHr > 1e-6);

  const gasMMBtuPerHr = byTech.reduce((a: number, b: any) => a + (b.mmbtuPerHr || 0), 0);
  const waterGalPerHr = byTech.reduce((a: number, b: any) => a + (b.waterGalPerHr || 0), 0);

  return {
    req,
    totalAvail,
    dispatchedTotal,
    byTech,
    gasMMBtuPerHr,
    waterGalPerHr,
  };
}

function computeDispatch24h(requiredMW: number, computedRows: any[], bessDurationHr: number, dispatchMinLoadEnabled: boolean): DispatchResult {
  const req = Math.max(0, requiredMW);
  const pvInstalledMW = computedRows
    .filter((r: any) => r.tech?.category === "PV")
    .reduce((sum: number, r: any) => sum + (r.installedMW || 0), 0);
  const windInstalledMW = computedRows
    .filter((r: any) => r.tech?.category === "Wind")
    .reduce((sum: number, r: any) => sum + (r.installedMW || 0), 0);
  const bessInstalledMW = computedRows
    .filter((r: any) => r.tech?.category === "BESS")
    .reduce((sum: number, r: any) => sum + (r.installedMW || 0), 0);

  const chargeEff = 0.95;
  const dischargeEff = 0.95;
  const bessPowerCapMW = Math.max(0, bessInstalledMW);
  const bessEnergyCapMWh = bessPowerCapMW * Math.max(0, bessDurationHr);
  let socMWh = bessEnergyCapMWh * 0.5;

  const firmRows = computedRows
    .filter((r: any) => r.tech?.isFirm && (r.firmAvailableMW || 0) > 0)
    .map((r: any) => ({
      category: r.tech.category as TechCategory,
      name: String(r.tech.name || ""),
      availableMW: Math.max(0, r.firmAvailableMW || 0),
      heatRate: Math.max(0, r.tech.heatRateBtuPerKWh || 0),
      minLoadPct: DISPATCH_FIRM_MIN_LOAD_PCT[r.tech.category as FirmDispatchCategory] || 0,
    }))
    .filter((r: any) => isFirmDispatchCategory(r.category))
    .sort((a: any, b: any) => {
      if (a.heatRate !== b.heatRate) return a.heatRate - b.heatRate;
      return a.name.localeCompare(b.name);
    });

  const dispatchByFirmCategoryKey: Record<string, number> = {};
  const byHour: DispatchHourRow[] = [];

  let servedMWh = 0;
  let unservedMWh = 0;
  let curtailedMWh = 0;
  let excessMWh = 0;
  let renewableServedMWh = 0;
  let firmServedMWh = 0;

  for (let h = 0; h < 24; h++) {
    const hourLabel = `${String(h).padStart(2, "0")}:00`;
    const row: DispatchHourRow = {
      hour: hourLabel,
      requiredMW: req,
      pvMW: 0,
      windMW: 0,
      bessChargeMW: 0,
      bessDischargeMW: 0,
      excessMW: 0,
      unservedMW: 0,
      curtailedMW: 0,
      socMWh: socMWh,
      servedMW: 0,
      firmMW: 0,
    };

    for (const category of DISPATCH_FIRM_CATEGORIES) {
      row[firmDispatchKey(category)] = 0;
    }

    let remainingMW = req;
    const pvAvailMW = Math.max(0, pvInstalledMW * (DISPATCH_PROFILE_24H.pv[h] || 0));
    const windAvailMW = Math.max(0, windInstalledMW * (DISPATCH_PROFILE_24H.wind[h] || 0));

    row.pvMW = Math.min(remainingMW, pvAvailMW);
    remainingMW = Math.max(0, remainingMW - row.pvMW);

    row.windMW = Math.min(remainingMW, windAvailMW);
    remainingMW = Math.max(0, remainingMW - row.windMW);

    let renewableExcessMW = Math.max(0, pvAvailMW - row.pvMW) + Math.max(0, windAvailMW - row.windMW);

    if (bessPowerCapMW > 0 && bessEnergyCapMWh > 0 && renewableExcessMW > 0) {
      const chargePowerLimitMW = Math.min(bessPowerCapMW, renewableExcessMW);
      const availableRoomMWh = Math.max(0, bessEnergyCapMWh - socMWh);
      const roomLimitedChargeMW = availableRoomMWh / chargeEff;
      row.bessChargeMW = Math.min(chargePowerLimitMW, roomLimitedChargeMW);
      socMWh = Math.min(bessEnergyCapMWh, socMWh + row.bessChargeMW * chargeEff);
      renewableExcessMW = Math.max(0, renewableExcessMW - row.bessChargeMW);
    }

    if (bessPowerCapMW > 0 && socMWh > 0 && remainingMW > 0) {
      const socDeliverableMW = socMWh * dischargeEff;
      row.bessDischargeMW = Math.min(remainingMW, bessPowerCapMW, socDeliverableMW);
      const socWithdrawMWh = row.bessDischargeMW / dischargeEff;
      socMWh = Math.max(0, socMWh - socWithdrawMWh);
      remainingMW -= row.bessDischargeMW;
    }

    // Apply firm minimum-load floors before merit-order headroom dispatch.
    for (const fr of firmRows) {
      const minLoadMW = dispatchMinLoadEnabled ? Math.min(fr.availableMW, fr.availableMW * fr.minLoadPct) : 0;
      if (minLoadMW <= 1e-9) continue;
      const key = firmDispatchKey(fr.category);
      row[key] = Math.max(0, Number(row[key] || 0) + minLoadMW);
      dispatchByFirmCategoryKey[key] = Math.max(0, (dispatchByFirmCategoryKey[key] || 0) + minLoadMW);
      remainingMW -= minLoadMW;
    }

    for (const fr of firmRows) {
      if (remainingMW <= 1e-9) break;
      const key = firmDispatchKey(fr.category);
      const minLoadMW = dispatchMinLoadEnabled ? Math.min(fr.availableMW, fr.availableMW * fr.minLoadPct) : 0;
      const headroomMW = Math.max(0, fr.availableMW - minLoadMW);
      const dispatchMW = Math.min(remainingMW, headroomMW);
      if (dispatchMW <= 1e-9) continue;
      row[key] = Math.max(0, Number(row[key] || 0) + dispatchMW);
      dispatchByFirmCategoryKey[key] = Math.max(0, (dispatchByFirmCategoryKey[key] || 0) + dispatchMW);
      remainingMW -= dispatchMW;
    }

    row.unservedMW = Math.max(0, remainingMW);
    row.excessMW = Math.max(0, -remainingMW);
    row.curtailedMW = Math.max(0, renewableExcessMW);
    row.socMWh = socMWh;

    const firmMW = DISPATCH_FIRM_CATEGORIES.reduce(
      (sum, category) => sum + Math.max(0, Number(row[firmDispatchKey(category)] || 0)),
      0
    );
    row.firmMW = firmMW;
    row.servedMW = Math.max(0, req - row.unservedMW);

    const renewableServedMW = row.pvMW + row.windMW + row.bessDischargeMW;

    servedMWh += row.servedMW;
    unservedMWh += row.unservedMW;
    curtailedMWh += row.curtailedMW;
    excessMWh += row.excessMW;
    renewableServedMWh += renewableServedMW;
    firmServedMWh += firmMW;

    byHour.push(row);
  }

  const stackKeys = DISPATCH_FIRM_CATEGORIES.map((category) => firmDispatchKey(category)).filter(
    (key) => (dispatchByFirmCategoryKey[key] || 0) > 1e-6
  );

  return {
    byHour,
    stackKeys,
    totals: {
      servedMWh,
      unservedMWh,
      curtailedMWh,
      excessMWh,
      renewableServedMWh,
      firmServedMWh,
    },
  };
}

// -----------------------
// Dev self-tests (non-throwing)
// -----------------------
function runSelfTests() {
  try {
    const env = computeEnvelopeFromLand(DEFAULTS.inputs);
    console.assert(env.itMW > 0, "Self-test: envelope IT should be > 0");

    const eff = computeEffectiveIT(DEFAULTS.inputs, env.itMW);
    console.assert(eff.itMW <= env.itMW + 1e-6, "Self-test: effective IT capped to max");

    const fac = computeFacilityPower(eff.itMW, DEFAULTS.inputs.pue);
    console.assert(fac.facilityMW >= eff.itMW, "Self-test: facility MW >= IT MW when PUE>=1");

    const powerRows = computePowerMix(DEFAULTS.power);
    const dispatch = computeDispatch24h(
      fac.facilityMW,
      powerRows,
      DEFAULTS.power.bessDurationHr,
      DEFAULTS.power.dispatchMinLoadEnabled ?? true
    );
    const bessInstalledMW = powerRows
      .filter((r: any) => r.tech?.category === "BESS")
      .reduce((sum: number, r: any) => sum + (r.installedMW || 0), 0);
    const bessEnergyCapMWh = Math.max(0, bessInstalledMW * DEFAULTS.power.bessDurationHr);

    console.assert(dispatch.byHour.length === 24, "Self-test: dispatch should include 24 hourly points");

    for (const hr of dispatch.byHour) {
      const firmFromStacks = dispatch.stackKeys.reduce((sum, key) => sum + Math.max(0, Number(hr[key] || 0)), 0);
      const supply = Math.max(0, hr.pvMW + hr.windMW + hr.bessDischargeMW + firmFromStacks);
      const balanceError = Math.abs(supply + hr.unservedMW - hr.excessMW - hr.requiredMW);
      console.assert(balanceError <= 1e-6, "Self-test: dispatch hourly load balance");
      console.assert(hr.socMWh >= -1e-6 && hr.socMWh <= bessEnergyCapMWh + 1e-6, "Self-test: BESS SOC bounded");
      console.assert(
        hr.pvMW >= -1e-6 &&
          hr.windMW >= -1e-6 &&
          hr.bessChargeMW >= -1e-6 &&
          hr.bessDischargeMW >= -1e-6 &&
          hr.excessMW >= -1e-6 &&
          hr.unservedMW >= -1e-6 &&
          hr.curtailedMW >= -1e-6,
        "Self-test: dispatch components should be non-negative"
      );
      console.assert(!(hr.excessMW > 1e-6 && hr.unservedMW > 1e-6), "Self-test: excess and unserved should not co-occur");
    }
  } catch {
    // ignore
  }
}

// -----------------------
// MapboxDraw custom styles
// -----------------------
const DRAW_EXPR: any = {
  isParcel: [
    "any",
    ["boolean", ["get", "isParcel"], false],
    ["boolean", ["get", "user_isParcel"], false],
    ["==", ["get", "kind"], "parcel"],
    ["==", ["get", "user_kind"], "parcel"],
  ],
  color: ["coalesce", ["get", "user_color"], ["get", "color"], BRAND.orange],
  lineColor: [
    "coalesce",
    ["get", "user_lineColor"],
    ["get", "lineColor"],
    ["get", "user_color"],
    ["get", "color"],
    BRAND.orange,
  ],
};

const DRAW_STYLES: any[] = [
  {
    id: "dc-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    paint: {
      "fill-color": ["case", DRAW_EXPR.isParcel, MAP_LEGEND_COLORS.parcelLine, DRAW_EXPR.color],
      "fill-opacity": [
        "case",
        ["==", ["get", "active"], "true"],
        ["case", DRAW_EXPR.isParcel, 0.14, 0.45],
        ["case", DRAW_EXPR.isParcel, 0.08, 0.32],
      ],
    },
  },
  {
    id: "dc-draw-lines",
    type: "line",
    filter: [
      "all",
      ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]],
      ["!=", "mode", "static"],
    ],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": ["case", DRAW_EXPR.isParcel, MAP_LEGEND_COLORS.parcelLine, DRAW_EXPR.lineColor],
      "line-width": [
        "case",
        DRAW_EXPR.isParcel,
        ["case", ["==", ["get", "active"], "true"], 4, 4],
        ["case", ["==", ["get", "active"], "true"], 3, 2],
      ],
      "line-dasharray": [
        "case",
        DRAW_EXPR.isParcel,
        ["literal", [3, 2]],
        ["case", ["==", ["get", "active"], "true"], ["literal", [0.2, 2]], ["literal", [2, 0]]],
      ],
      "line-opacity": 0.95,
    },
  },
  {
    id: "dc-draw-point-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"], ["!=", "mode", "static"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#ffffff",
    },
  },
  {
    id: "dc-draw-point-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"], ["!=", "mode", "static"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": ["case", ["==", ["get", "active"], "true"], BRAND.onyx, DRAW_EXPR.lineColor],
    },
  },
  {
    id: "dc-draw-vertex-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#ffffff",
    },
  },
  {
    id: "dc-draw-vertex-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": BRAND.midnight,
    },
  },
  {
    id: "dc-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"]],
    paint: {
      "circle-radius": 4,
      "circle-color": "#ffffff",
      "circle-stroke-color": BRAND.orange,
      "circle-stroke-width": 1.5,
    },
  },
  {
    id: "dc-draw-polygon-fill-static",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]],
    paint: {
      "fill-color": "#404040",
      "fill-opacity": 0.08,
    },
  },
  {
    id: "dc-draw-line-static",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["==", "mode", "static"]],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#404040",
      "line-width": 2,
    },
  },
];

// -----------------------
// Main component
// -----------------------
export default function DataCenterFeasibilityTool() {
  const [app, setApp] = useLocalStorageState<AppState>("dc_feasibility_v18", DEFAULTS);
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  useEffect(() => {
    runSelfTests();
  }, []);

  useEffect(() => {
    const schema = Number((app as any).schemaVersion || 0);
    if (schema >= APP_SCHEMA_VERSION) return;
    setApp((prev) => ({
      ...prev,
      schemaVersion: APP_SCHEMA_VERSION,
      inputs: {
        ...prev.inputs,
        siteCoveragePct: 100,
      },
    }));
  }, [app.schemaVersion, setApp]);

  useEffect(() => {
    const model = app.mapping?.generationShapeModel as any;
    if (model === "rect_by_tech" || model === "square") return;
    setApp((prev) => ({
      ...prev,
      mapping: {
        ...prev.mapping,
        generationShapeModel: "rect_by_tech",
      },
    }));
  }, [app.mapping?.generationShapeModel, setApp]);

  const envelope = useMemo(() => computeEnvelopeFromLand(app.inputs), [app.inputs]);
  const effectiveIT = useMemo(() => computeEffectiveIT(app.inputs, envelope.itMW), [app.inputs, envelope.itMW]);
  const facility = useMemo(
    () => computeFacilityPower(effectiveIT.itMW, app.inputs.pue),
    [effectiveIT.itMW, app.inputs.pue]
  );

  const requiredMW = useMemo(
    () => (app.power.sizeToFacility ? facility.facilityMW : effectiveIT.itMW),
    [app.power.sizeToFacility, facility.facilityMW, effectiveIT.itMW]
  );

  const computedRows = useMemo(() => computePowerMix(app.power), [app.power]);
  const reliability = useMemo(
    () => computeReliability(app.power, requiredMW, computedRows),
    [app.power, requiredMW, computedRows]
  );
  const genFootprint = useMemo(() => computeGenerationFootprint(computedRows), [computedRows]);

  const requiredBldg = useMemo(
    () => computeRequiredBuildingFootprint(app.inputs, effectiveIT.itMW),
    [app.inputs, effectiveIT.itMW]
  );

  const requiredBuildingFootprintAc = useMemo(() => {
    const maxByCoverage = envelope.envelopeFootprintAc;
    return Math.min(requiredBldg.footprintAc, maxByCoverage);
  }, [requiredBldg.footprintAc, envelope.envelopeFootprintAc]);

  const land = useMemo(
    () => computeLandAllocation(app.inputs, requiredBuildingFootprintAc, genFootprint.total, facility.facilityMW),
    [app.inputs, requiredBuildingFootprintAc, genFootprint.total, facility.facilityMW]
  );

  const dispatchSummary = useMemo(
    () => computeDispatchSummary(requiredMW, computedRows),
    [requiredMW, computedRows]
  );
  const dispatchMinLoadEnabled = app.power.dispatchMinLoadEnabled ?? true;
  const dispatch24h = useMemo(
    () => computeDispatch24h(requiredMW, computedRows, app.power.bessDurationHr, dispatchMinLoadEnabled),
    [requiredMW, computedRows, app.power.bessDurationHr, dispatchMinLoadEnabled]
  );
  const dispatchFirmSeries = useMemo(
    () =>
      dispatch24h.stackKeys.map((key) => {
        const category = key.replace("firm_", "") as FirmDispatchCategory;
        return {
          key,
          label: `${category} (firm)`,
          color: DISPATCH_FIRM_CATEGORY_COLORS[category] || BRAND.slate,
        };
      }),
    [dispatch24h.stackKeys]
  );
  const dispatchChartHasData = useMemo(
    () =>
      dispatch24h.byHour.some(
        (h) =>
          h.requiredMW > 1e-6 ||
          h.pvMW > 1e-6 ||
          h.windMW > 1e-6 ||
          h.bessDischargeMW > 1e-6 ||
          h.excessMW > 1e-6 ||
          h.unservedMW > 1e-6 ||
          h.curtailedMW > 1e-6 ||
          dispatch24h.stackKeys.some((k) => Number(h[k] || 0) > 1e-6)
      ),
    [dispatch24h.byHour, dispatch24h.stackKeys]
  );

  const dcWater = useMemo(() => {
    const itMW = Math.max(0, effectiveIT.itMW);
    const wueLPerKWh = Math.max(0, app.inputs.wue);
    const lPerDay = itMW * 1000 * 24 * wueLPerKWh;
    const galPerDay = lPerDay * 0.264172;
    return { itMW, wueLPerKWh, galPerDay };
  }, [effectiveIT.itMW, app.inputs.wue]);

  const phasing = useMemo(() => {
    const phases = Math.max(1, Math.round(app.inputs.phases || 1));
    if (
      app.inputs.phaseMode === "manual" &&
      Array.isArray(app.inputs.phaseIT) &&
      app.inputs.phaseIT.length === phases
    ) {
      return app.inputs.phaseIT.map((v, i) => ({ name: `P${i + 1}`, itMW: Math.max(0, Number(v) || 0) }));
    }
    const each = phases > 0 ? effectiveIT.itMW / phases : effectiveIT.itMW;
    return Array.from({ length: phases }).map((_, i) => ({ name: `P${i + 1}`, itMW: each }));
  }, [app.inputs.phases, app.inputs.phaseMode, app.inputs.phaseIT, effectiveIT.itMW]);

  const mixPie = useMemo(() => {
    const all = computedRows.filter((r) => r.installedMW > 0);
    return all.map((r) => ({ name: r.tech.name, installed: r.installedMW, firm: r.tech.isFirm }));
  }, [computedRows]);

  const installedVsAvailable = useMemo(() => {
    return computedRows
      .filter((r) => r.installedMW > 0)
      .map((r) => ({
        tech: r.tech.name,
        installed: r.installedMW,
        dispatched: r.tech.isFirm ? r.firmAvailableMW : 0,
      }));
  }, [computedRows]);

  const techOptionsByCategory = useMemo(() => {
    const grouped = {} as Record<TechCategory, Tech[]>;
    for (const cat of TECH_CATEGORY_ORDER) grouped[cat] = [];
    for (const t of TECH_LIBRARY) grouped[t.category].push(t);
    return grouped;
  }, []);

  const techLibraryForDisplay = useMemo(
    () => TECH_LIBRARY.map((t) => techWithLibraryBasis(t, app.power.libraryBasis || "typical")),
    [app.power.libraryBasis]
  );

  const landPie = useMemo(() => {
    return [
      { name: "Building", value: land.building, color: MAP_LEGEND_COLORS.building },
      { name: "MEP Yard", value: land.mep, color: MAP_LEGEND_COLORS.mep },
      { name: "Substation", value: land.sub, color: MAP_LEGEND_COLORS.sub },
      { name: "Roads/Parking", value: land.roads, color: MAP_LEGEND_COLORS.roads },
      { name: "Generation (power)", value: land.gen, color: MAP_LEGEND_COLORS.generation },
      { name: "Open/Other", value: land.open, color: MAP_LEGEND_COLORS.open },
    ].filter((d) => d.value > 1e-6);
  }, [land]);

  const resetAll = () => setApp(DEFAULTS);
  const setTab = (tab: AppState["tab"]) => setApp((prev) => ({ ...prev, tab }));

  const setInputs = (patch: Partial<InputsState>) =>
    setApp((prev) => ({ ...prev, inputs: { ...prev.inputs, ...patch } }));

  const setPower = (patch: Partial<PowerState>) =>
    setApp((prev) => ({ ...prev, power: { ...prev.power, ...patch } }));

  const updatePowerRow = (id: string, patch: Partial<PowerRow>) => {
    setApp((prev) => ({
      ...prev,
      power: {
        ...prev.power,
        rows: prev.power.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
    }));
  };

  const addPowerRow = () => {
    const id = `r${Math.floor(Math.random() * 1e9)}`;
    setApp((prev) => ({
      ...prev,
      power: {
        ...prev.power,
        rows: [...prev.power.rows, { id, techId: "rice_ng_10", units: 0 }],
      },
    }));
  };

  const removeLastPowerRow = () => {
    setApp((prev) => ({
      ...prev,
      power: {
        ...prev.power,
        rows: prev.power.rows.length > 1 ? prev.power.rows.slice(0, -1) : prev.power.rows,
      },
    }));
  };

  // Cooling defaults for WUE only
  useEffect(() => {
    if (app.inputs.cooling === "Air") {
      if (Math.abs(app.inputs.wue - 0.15) < 1e-9) setInputs({ wue: 0.3 });
    } else {
      if (Math.abs(app.inputs.wue - 0.3) < 1e-9) setInputs({ wue: 0.15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.inputs.cooling]);

  // ----------------------------
  // Mapping implementation
  // ----------------------------
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<any | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // HTML label markers by feature id
  const labelMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const syncingDrawPropsRef = useRef(false);
  const enforcingParcelAreaRef = useRef(false);

  const syncDerivedFeatureProps = () => {
    const draw = drawRef.current;
    if (!draw) return;
    if (syncingDrawPropsRef.current) return;

    const fc = draw.getAll();
    syncingDrawPropsRef.current = true;

    try {
      for (const f of fc.features || []) {
        if (!f?.id) continue;

        const props = f.properties || {};
        const isParcel = !!props.isParcel || props.kind === "parcel";

        if (!props.name) {
          draw.setFeatureProperty(f.id, "name", isParcel ? "Parcel (buildable)" : "Polygon");
        }
        if (!props.kind) {
          draw.setFeatureProperty(f.id, "kind", isParcel ? "parcel" : "footprint");
        }

        // Default colors so style expressions don't fall back uniformly
        if (isParcel) {
          draw.setFeatureProperty(f.id, "isParcel", true);
          if (!props.color) draw.setFeatureProperty(f.id, "color", MAP_LEGEND_COLORS.parcelFill);
          if (!props.lineColor) draw.setFeatureProperty(f.id, "lineColor", MAP_LEGEND_COLORS.parcelLine);
          const targetAc = Number(props.targetAcres);
          if (!Number.isFinite(targetAc) || targetAc <= 0) {
            const acres = featureAcres(f);
            const fallback = Math.max(0.01, acres || getBuildableAc(app.inputs) || 1);
            draw.setFeatureProperty(f.id, "targetAcres", fallback);
          }
        } else {
          if (!props.color) draw.setFeatureProperty(f.id, "color", BRAND.orange);
          if (!props.lineColor) draw.setFeatureProperty(f.id, "lineColor", props.color || BRAND.orange);
        }

        const gt = f.geometry?.type;
        if (gt === "Polygon" || gt === "MultiPolygon") {
          const acres = featureAcres(f);
          const cur = Number(props.acres);
          if (!Number.isFinite(cur) || Math.abs(cur - acres) > 0.01) {
            draw.setFeatureProperty(f.id, "acres", acres);
          }
        }
      }
    } catch {
      // ignore
    } finally {
      syncingDrawPropsRef.current = false;
    }
  };

  type LegendItem = {
    id: string;
    name: string;
    acres: number;
    color: string;
    kind: string;
    isParcel: boolean;
  };
  type LayoutItem = {
    key: string;
    name: string;
    acres: number;
    color: string;
    kind: string;
  };
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);
  const [packReport, setPackReport] = useState<{ notFit: LegendItem[]; placed: number } | null>(null);

  const makeLayoutItemKey = (kind: string, name: string) => `${kind}::${name}`;
  const currentGenerationShapeModel = (): GenerationShapeModel => app.mapping.generationShapeModel || "rect_by_tech";

  const buildLayoutItemsFromResults = () => {
    const rows: LayoutItem[] = [];

    const push = (name: string, acres: number, color: string, kind: string) => {
      if (acres <= 0.01) return;
      rows.push({
        key: makeLayoutItemKey(kind, name),
        name,
        acres,
        color,
        kind,
      });
    };

    push("Building", land.building, MAP_LEGEND_COLORS.building, "building");
    push("MEP Yard", land.mep, MAP_LEGEND_COLORS.mep, "mep");
    push("Roads/Parking", land.roads, MAP_LEGEND_COLORS.roads, "roads");
    push("Substation", land.sub, MAP_LEGEND_COLORS.sub, "sub");

    for (const t of genFootprint.byTech) {
      const kind = `gen:${t.category}:${t.id}`;
      push(t.name, t.acres, t.color, kind);
    }

    return rows;
  };

  const persistDrawToState = () => {
    const draw = drawRef.current;
    if (!draw) return;
    const all = draw.getAll();
    setApp((prev) => ({
      ...prev,
      mapping: {
        ...prev.mapping,
        draw: all,
      },
    }));
  };

  const applyDrawSync = ({ persist = true, refresh = true }: { persist?: boolean; refresh?: boolean } = {}) => {
    syncDerivedFeatureProps();
    if (persist) persistDrawToState();
    if (refresh) refreshLegendAndLabels();
  };

  const maybeEnforceParcelAreaLock = (updateEvent?: any) => {
    const draw = drawRef.current;
    if (!draw || enforcingParcelAreaRef.current) return false;

    const action = String(updateEvent?.action || "");
    if (action === "move") return false;

    const updatedIds = new Set<string>(
      Array.isArray(updateEvent?.features) ? updateEvent.features.map((f: any) => String(f?.id || "")) : []
    );

    const fc = draw.getAll();
    if (!fc?.features?.length) return false;

    let changed = false;
    const nextFeatures = (fc.features || []).map((f: any) => {
      if (!f?.id) return f;

      const props = f.properties || {};
      const isParcel = !!props.isParcel || props.kind === "parcel";
      if (!isParcel) return f;
      if (updatedIds.size && !updatedIds.has(String(f.id))) return f;

      const currentAc = featureAcres(f);
      const targetRaw = Number(props.targetAcres);
      const targetAcres =
        Number.isFinite(targetRaw) && targetRaw > 0
          ? targetRaw
          : Math.max(0.01, currentAc || getBuildableAc(app.inputs) || 1);

      let next = f;
      const absDeltaAc = Math.abs(currentAc - targetAcres);
      const relDelta = targetAcres > 0 ? absDeltaAc / targetAcres : absDeltaAc;
      const exceedsTolerance = absDeltaAc > 0.05 && relDelta > 0.01;

      if (Number.isFinite(currentAc) && currentAc > 0 && exceedsTolerance) {
        const scale = Math.sqrt(targetAcres / currentAc);
        if (Number.isFinite(scale) && scale > 0) {
          try {
            const scaled = turf.transformScale(f as any, scale, { origin: "centroid", mutate: false }) as any;
            if (scaled?.geometry) {
              next = {
                ...scaled,
                id: f.id,
                properties: {
                  ...(f.properties || {}),
                },
              };
              changed = true;
            }
          } catch {
            // ignore
          }
        }
      }

      const nextProps = next.properties || {};
      if (!Number.isFinite(Number(nextProps.targetAcres)) || Number(nextProps.targetAcres) <= 0) {
        changed = true;
      }

      return {
        ...next,
        properties: {
          ...nextProps,
          isParcel: true,
          kind: "parcel",
          targetAcres,
        },
      };
    });

    if (!changed) return false;

    enforcingParcelAreaRef.current = true;
    try {
      draw.set({
        type: "FeatureCollection",
        features: nextFeatures,
      } as any);
      return true;
    } catch {
      return false;
    } finally {
      enforcingParcelAreaRef.current = false;
    }
  };

  const refreshLegendAndLabels = () => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;

    const fc = draw.getAll();
    const items: LegendItem[] = [];

    // remove stale markers
    const nextIds = new Set<string>();

    for (const f of fc.features || []) {
      if (!f || !f.id) continue;
      const id = String(f.id);
      nextIds.add(id);

      const props = f.properties || {};
      const isParcel = !!props.isParcel || props.kind === "parcel";
      const name = props.name || (isParcel ? "Parcel" : "Polygon");

      // Always compute acres from geometry when possible
      const acres = featureAcres(f);

      const color = props.color || (isParcel ? MAP_LEGEND_COLORS.parcelFill : BRAND.orange);
      const kind = props.kind || (isParcel ? "parcel" : "footprint");

      items.push({ id, name, acres, color, kind, isParcel });

      // labels for polygons only
      const gt = f.geometry?.type;
      if (gt !== "Polygon" && gt !== "MultiPolygon") continue;

      const [lng, lat] = polygonCentroidLngLat(f);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const labelText = acres > 0.01 ? `${name} • ${fmt(acres, 1)} ac` : String(name);

      const existing = labelMarkersRef.current.get(id);
      if (!existing) {
        const el = makeLabelEl(labelText, color, isParcel);
        const m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
        labelMarkersRef.current.set(id, m);
      } else {
        try {
          existing.setLngLat([lng, lat]);

          const el = existing.getElement() as HTMLElement;

          // Update text + dot color in-place (no marker recreate)
          const txt = el.querySelector(".dc-label-text") as HTMLElement | null;
          if (txt) txt.textContent = labelText;

          const dot = el.querySelector(".dc-label-dot") as HTMLElement | null;
          if (dot) dot.style.background = color;

          // Update parcel border styling if needed
          el.style.border = `1px solid ${isParcel ? MAP_LEGEND_COLORS.parcelLine : "rgba(0,0,0,0.15)"}`;
        } catch {
          // ignore
        }
      }
    }

    // clean up any markers not in draw anymore
    for (const [id, m] of labelMarkersRef.current.entries()) {
      if (!nextIds.has(id)) {
        try {
          m.remove();
        } catch {
          // ignore
        }
        labelMarkersRef.current.delete(id);
      }
    }

    // stable ordering: parcel first, then footprints by kind/name
    items.sort((a, b) => {
      if (a.isParcel && !b.isParcel) return -1;
      if (!a.isParcel && b.isParcel) return 1;
      return a.name.localeCompare(b.name);
    });

    setLegendItems(items);
  };

  const editSelectedPolygon = () => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      const selected = draw.getSelected()?.features || [];
      let target = selected.find((f: any) => {
        const gt = f?.geometry?.type;
        return !!f?.id && (gt === "Polygon" || gt === "MultiPolygon");
      });

      if (!target) {
        const all = draw.getAll()?.features || [];
        target = all.find((f: any) => {
          const gt = f?.geometry?.type;
          return !!f?.id && (gt === "Polygon" || gt === "MultiPolygon");
        });
        if (target?.id) {
          draw.changeMode("simple_select", { featureIds: [target.id] });
        }
      }

      if (!target?.id) return;
      draw.changeMode("direct_select", { featureId: target.id });
      refreshLegendAndLabels();
    } catch {
      // ignore
    }
  };

  const ensureMap = () => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#f3f4f6" },
          },
        ],
      } as any,
      center: [app.mapping.center.lon, app.mapping.center.lat],
      zoom: app.mapping.zoom,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const draw = new MapboxDraw({
      userProperties: true,
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: "simple_select",
      styles: DRAW_STYLES,
    });

    map.addControl(draw as any, "top-left");

    map.on("load", () => {
      try {
        applyBasemap(map, app.mapping.networkEnabled, app.mapping.basemap);
      } catch {
        // ignore
      }

      if (app.mapping.draw?.features?.length) {
        try {
          draw.set(app.mapping.draw);
        } catch {
          // ignore
        }
      }

      setMapReady(true);
      setTimeout(() => {
        try {
          syncDerivedFeatureProps();
        } catch {
          // ignore
        }
        refreshLegendAndLabels();
      }, 50);
    });

    map.on("moveend", () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setApp((prev) => ({
        ...prev,
        mapping: {
          ...prev.mapping,
          center: { lat: c.lat, lon: c.lng },
          zoom: z,
        },
      }));
    });

    const onDrawCreate = () => {
      if (enforcingParcelAreaRef.current) return;
      applyDrawSync({ persist: true, refresh: true });
    };

    const onDrawUpdate = (e: any) => {
      if (enforcingParcelAreaRef.current) return;
      const action = String(e?.action || "");
      const adjusted = action === "move" ? false : maybeEnforceParcelAreaLock(e);
      if (adjusted) {
        applyDrawSync({ persist: true, refresh: true });
        return;
      }
      applyDrawSync({ persist: true, refresh: true });
    };

    const onDrawDelete = () => {
      if (enforcingParcelAreaRef.current) return;
      applyDrawSync({ persist: true, refresh: true });
    };

    const onDrawSelectionChange = () => {
      refreshLegendAndLabels();
    };

    map.on("draw.create", onDrawCreate);
    map.on("draw.update", onDrawUpdate);
    map.on("draw.delete", onDrawDelete);
    map.on("draw.selectionchange", onDrawSelectionChange);

    mapRef.current = map;
    drawRef.current = draw;
  };

  useEffect(() => {
    if (app.tab !== "mapping") return;

    let raf = 0;
    let attempts = 0;
    const maxAttempts = 30;

    const tryInit = () => {
      attempts += 1;

      if (!mapRef.current) {
        ensureMap();
      }

      const map = mapRef.current;
      const el = mapContainerRef.current;
      if (map && el) {
        try {
          map.resize();
        } catch {
          // ignore
        }
        return;
      }

      if (attempts < maxAttempts) {
        raf = window.requestAnimationFrame(tryInit);
      }
    };

    raf = window.requestAnimationFrame(tryInit);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.tab, showDisclaimer]);

  useEffect(() => {
    if (app.tab !== "mapping") return;

    const map = mapRef.current;
    const el = mapContainerRef.current;
    if (!map || !el) return;

    // Initial resize after the tab becomes visible
    setTimeout(() => {
      try {
        map.resize();
      } catch {
        // ignore
      }
    }, 0);

    // Keep resizing if the container changes size (sidebars, responsive layout, etc.)
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        // ignore
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [app.tab, showDisclaimer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      applyBasemap(map, app.mapping.networkEnabled, app.mapping.basemap);
      // keep labels above basemap changes
      setTimeout(() => refreshLegendAndLabels(), 50);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.mapping.networkEnabled, app.mapping.basemap, mapReady]);

  useEffect(() => {
    return () => {
      try {
        for (const m of labelMarkersRef.current.values()) m.remove();
        labelMarkersRef.current.clear();
      } catch {
        // ignore
      }

      try {
        mapRef.current?.remove();
      } catch {
        // ignore
      }

      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  const zoomToFeatureId = (id: string) => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    const fc = draw.getAll();
    const f = (fc.features || []).find((x: any) => String(x.id) === String(id));
    if (!f) return;
    try {
      const bbox = turf.bbox(f as any);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 50, duration: 650 }
      );
    } catch {
      // ignore
    }
  };

  const zoomToLayout = () => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    const fc = draw.getAll();
    if (!fc?.features?.length) return;
    try {
      const bbox = turf.bbox(fc as any);
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 50, duration: 650 }
      );
    } catch {
      // ignore
    }
  };

  const clearLayout = () => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      const ids = draw.getAll().features.map((f: any) => f.id);
      ids.forEach((id: any) => draw.delete(id));
      setPackReport(null);
      applyDrawSync({ persist: true, refresh: true });
    } catch {
      // ignore
    }
  };

  const ensureParcelFeature = (center: [number, number]) => {
    const draw = drawRef.current;
    if (!draw) return null;

    const current = draw.getAll();
    const existing = (current.features || []).find((f: any) => f.properties?.isParcel || f.properties?.kind === "parcel");
    if (existing) return existing;

    const buildableAc = Math.max(1, getBuildableAc(app.inputs));
    const poly = acresToSquarePolygon(center, buildableAc);
    (poly as any).properties = {
      kind: "parcel",
      isParcel: true,
      name: "Parcel (buildable)",
      acres: buildableAc,
      targetAcres: buildableAc,
      color: MAP_LEGEND_COLORS.parcelFill,
      lineColor: MAP_LEGEND_COLORS.parcelLine,
    };
    const id = draw.add(poly as any);
    const fc = draw.getAll();
    return (fc.features || []).find((f: any) => String(f.id) === String(id)) || null;
  };

  const setSelectedAsParcel = () => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      const sel = draw.getSelected();
      if (!sel?.features?.length) return;
      const f = sel.features[0];
      if (!f?.id) return;

      // clear parcel flag on others
      const all = draw.getAll();
      for (const g of all.features || []) {
        if (!g?.id) continue;
        if (String(g.id) === String(f.id)) continue;
        if (g.properties?.isParcel || g.properties?.kind === "parcel") {
          draw.setFeatureProperty(g.id, "isParcel", false);
          draw.setFeatureProperty(g.id, "kind", "footprint");
        }
      }

      // set this as parcel
      draw.setFeatureProperty(f.id, "isParcel", true);
      draw.setFeatureProperty(f.id, "kind", "parcel");
      draw.setFeatureProperty(f.id, "name", "Parcel (buildable)");
      draw.setFeatureProperty(f.id, "color", MAP_LEGEND_COLORS.parcelFill);
      draw.setFeatureProperty(f.id, "lineColor", MAP_LEGEND_COLORS.parcelLine);

      // acres from geometry
      const acres = featureAcres(f);
      draw.setFeatureProperty(f.id, "acres", acres);
      draw.setFeatureProperty(f.id, "targetAcres", Math.max(0.01, getBuildableAc(app.inputs) || 1));
      maybeEnforceParcelAreaLock();
      applyDrawSync({ persist: true, refresh: true });
    } catch {
      // ignore
    }
  };

  const generateLayoutFromResults = () => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;

    const center: [number, number] = [app.mapping.center.lon, app.mapping.center.lat];
    const shapeModel = currentGenerationShapeModel();

    // ensure parcel exists
    ensureParcelFeature(center);

    // Clear previous generated footprints (keep parcel)
    const all = draw.getAll();
    for (const f of all.features || []) {
      if (f.properties?.kind === "footprint") {
        draw.delete(f.id);
      }
    }

    const footprints = buildLayoutItemsFromResults();

    // simple spread (not packed): arrange in a grid around center
    const base = turf.point(center);
    const spacingKm = 0.35;
    let idx = 0;

    for (const fp of footprints) {
      const row = Math.floor(idx / 3);
      const col = idx % 3;
      const dx = (col - 1) * spacingKm;
      const dy = (row - 1) * spacingKm;

      const movedE = turf.destination(base, Math.abs(dx), dx >= 0 ? 90 : -90, { units: "kilometers" });
      const moved = turf.destination(movedE, Math.abs(dy), dy >= 0 ? 0 : 180, { units: "kilometers" });

      const poly = makeFootprintPolygon(
        { kind: fp.kind, acres: fp.acres },
        moved.geometry.coordinates as [number, number],
        shapeModel
      );
      (poly as any).properties = {
        kind: "footprint",
        subkind: fp.kind,
        name: fp.name,
        acres: fp.acres,
        color: fp.color,
        lineColor: fp.color,
      };
      draw.add(poly as any);
      idx++;
    }

    setPackReport(null);
    applyDrawSync({ persist: true, refresh: true });
    zoomToLayout();
  };

  // Greedy autopack: place footprints inside parcel
  const autoPackIntoParcel = () => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    const shapeModel = currentGenerationShapeModel();

    const fc = draw.getAll();
    const parcel = (fc.features || []).find((f: any) => f.properties?.isParcel || f.properties?.kind === "parcel");
    if (!parcel) {
      // create parcel from buildable and retry
      ensureParcelFeature([app.mapping.center.lon, app.mapping.center.lat]);
    }

    const fc2 = draw.getAll();
    const parcel2 = (fc2.features || []).find((f: any) => f.properties?.isParcel || f.properties?.kind === "parcel");
    if (!parcel2) return;

    const existingFootprintsByKey = new Map<string, any>();
    for (const f of fc2.features || []) {
      if (f.properties?.kind !== "footprint") continue;
      const props = f.properties || {};
      const subkind = String(props.subkind || "footprint");
      const name = String(props.name || "Polygon");
      const key = makeLayoutItemKey(subkind, name);
      existingFootprintsByKey.set(key, f);
    }

    // remove existing footprints
    for (const f of fc2.features || []) {
      if (f.properties?.kind === "footprint") draw.delete(f.id);
    }

    const parcelPoly = parcel2;
    const parcelCenter = polygonCentroidLngLat(parcelPoly);

    // Build footprints list (largest first).
    // Merge current result-driven footprints with anything currently on map so tech footprints are not dropped.
    const rawByKey = new Map<string, LayoutItem>();
    for (const item of buildLayoutItemsFromResults()) {
      rawByKey.set(item.key, item);
    }
    for (const [key, f] of existingFootprintsByKey.entries()) {
      if (rawByKey.has(key)) continue;
      const props = f.properties || {};
      const acres = featureAcres(f) || Number(props.acres) || 0;
      if (acres <= 0.01) continue;
      rawByKey.set(key, {
        key,
        name: String(props.name || "Polygon"),
        acres,
        color: String(props.color || BRAND.orange),
        kind: String(props.subkind || "footprint"),
      });
    }
    const raw = Array.from(rawByKey.values());

    raw.sort((a, b) => b.acres - a.acres);

    const placedPolys: any[] = [];
    const placedCollisionPolys: any[] = [];
    const notFit: LayoutItem[] = [];

    const parcelBbox = turf.bbox(parcelPoly as any);
    // distance scale from bbox size
    const diagKm = turf.distance(
      turf.point([parcelBbox[0], parcelBbox[1]]),
      turf.point([parcelBbox[2], parcelBbox[3]]),
      { units: "kilometers" }
    );

    for (const item of raw) {
      const spec = shapeSpecForFootprint(item.kind);
      const aspectRatio = shapeModel === "rect_by_tech" && spec.geometry === "rect" ? Math.max(1, spec.aspectRatio) : 1;
      const longM = Math.sqrt(item.acres * AC_TO_M2 * aspectRatio);
      const longKm = longM / 1000;
      const stepKm = clamp(longKm * 0.3, 0.02, 0.12);
      const maxRings = Math.max(20, Math.ceil(diagKm / stepKm));
      const orientations = shapeModel === "rect_by_tech" && spec.geometry === "rect" ? [0, 90] : [0];

      let placed = false;
      const base = turf.point(parcelCenter);

      // generate spiral candidates
      const candidates: Array<[number, number]> = [];
      candidates.push([0, 0]);
      for (let r = 1; r <= maxRings && candidates.length < 12000; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            candidates.push([dx * stepKm, dy * stepKm]);
          }
        }
      }

      for (const [dx, dy] of candidates) {
        const movedE = turf.destination(base, Math.abs(dx), dx >= 0 ? 90 : -90, { units: "kilometers" });
        const moved = turf.destination(movedE, Math.abs(dy), dy >= 0 ? 0 : 180, { units: "kilometers" });
        const center = moved.geometry.coordinates as any;

        for (const rotationDeg of orientations) {
          const poly = makeFootprintPolygon({ kind: item.kind, acres: item.acres }, center, shapeModel, rotationDeg);
          const collisionPoly = turf.transformScale(poly as any, 0.985, {
            origin: "centroid",
            mutate: false,
          }) as any;

          // inside parcel?
          let inside = false;
          try {
            inside = turf.booleanWithin(poly as any, parcelPoly as any);
          } catch {
            inside = false;
          }
          if (!inside) continue;

          // no overlaps with placed polygons
          let overlaps = false;
          for (const p of placedCollisionPolys) {
            try {
              const disjoint = turf.booleanDisjoint(collisionPoly as any, p as any);
              if (!disjoint) {
                overlaps = true;
                break;
              }
            } catch {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          (poly as any).properties = {
            kind: "footprint",
            subkind: item.kind,
            name: item.name,
            acres: item.acres,
            color: item.color,
            lineColor: item.color,
          };
          draw.add(poly as any);
          placedPolys.push(poly as any);
          placedCollisionPolys.push(collisionPoly as any);
          placed = true;
          break;
        }
        if (placed) {
          break;
        }
      }

      if (!placed) {
        notFit.push(item);
      }
    }

    // Keep previous geometries for items that still do not fit after packing.
    for (const item of notFit) {
      const existing = existingFootprintsByKey.get(item.key);
      if (!existing) continue;
      const restored = {
        ...existing,
        properties: {
          ...(existing.properties || {}),
          kind: "footprint",
          subkind: item.kind,
          name: item.name,
          acres: item.acres,
          color: item.color,
          lineColor: item.color,
        },
      };
      draw.add(restored as any);
    }

    applyDrawSync({ persist: true, refresh: true });

    setPackReport({
      notFit: notFit.map((x) => ({
        id: "",
        name: x.name,
        acres: x.acres,
        color: x.color,
        kind: x.kind,
        isParcel: false,
      })),
      placed: placedPolys.length,
    });
  };

  const createParcelFromBuildable = () => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;

    // delete existing parcel
    const fc = draw.getAll();
    for (const f of fc.features || []) {
      if (f.properties?.isParcel || f.properties?.kind === "parcel") {
        draw.delete(f.id);
      }
    }

    ensureParcelFeature([app.mapping.center.lon, app.mapping.center.lat]);
    applyDrawSync({ persist: true, refresh: true });
    zoomToLayout();
  };

  const searchLocation = async (q: string) => {
    if (!app.mapping.networkEnabled) return;
    const map = mapRef.current;
    if (!map) return;

    const query = (q || "").trim();
    if (!query) return;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) return;
      const top = json[0];
      const lat = Number(top.lat);
      const lon = Number(top.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      setApp((prev) => ({
        ...prev,
        mapping: {
          ...prev.mapping,
          center: { lat, lon },
          zoom: Math.max(prev.mapping.zoom, 13),
        },
      }));
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13), essential: true });
    } catch {
      // ignore
    }
  };

  // ----------------------------
  // Render
  // ----------------------------

  const installedAll = computedRows.reduce((a: number, b: any) => a + (b.installedMW || 0), 0);
  const buildableAc = getBuildableAc(app.inputs);
  const activeLibraryBasis: LibraryBasis = app.power.libraryBasis || "typical";
  const activeDesignBundle = detectDesignBundle(app.inputs.ft2PerRack, app.inputs.kwPerRack, app.inputs.supportPct);

  return (
    <div className="min-h-screen w-full bg-white text-slate-900">
      {showDisclaimer && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4">
          <Card className="w-full max-w-2xl border-slate-300 shadow-xl">
            <CardHeader>
              <CardTitle>Screening Tool Disclaimer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p>
                This application is intended for conceptual screening only. It is not a substitute for detailed engineering, owner
                requirements, site due diligence, permitting analysis, utility studies, or safety reviews.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Outputs are based on simplified assumptions and user-provided inputs.</li>
                <li>Results are directional and should not be used as final design criteria.</li>
                <li>Land use, footprint, and generation metrics may differ from project-specific engineering outcomes.</li>
                <li>Users are responsible for validating all conclusions with qualified professionals.</li>
              </ul>
              <div className="pt-2">
                <Button onClick={() => setShowDisclaimer(false)} className="bg-black text-white hover:bg-slate-800">
                  I understand
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight">Data Center Feasibility Tool</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Sizing + power mix + mapping workspace (mapping is downstream; no feedback into inputs).
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetAll} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Reset to defaults
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <Tabs value={app.tab} onValueChange={(v: any) => setTab(v)}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="power">Power &amp; Mix</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="mapping">Mapping</TabsTrigger>
              <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
            </TabsList>

            {/* Inputs (NO MAP HERE) */}
            <TabsContent value="inputs" className="mt-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Mode + IT Target */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-5 w-5" />
                      IT Target &amp; Mode
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Use Target IT (cap to land)</div>
                        <div className="text-xs text-muted-foreground">Off = show site max from land envelope.</div>
                      </div>
                      <Switch
                        checked={app.inputs.modeUseTarget}
                        onCheckedChange={(c) => setInputs({ modeUseTarget: !!c })}
                      />
                    </div>

                    <RangeWithInput
                      label="Target IT"
                      value={app.inputs.targetITMW}
                      min={0}
                      max={5000}
                      step={10}
                      suffix="MW"
                      accent={BRAND.orange}
                      onChange={(v) => setInputs({ targetITMW: Math.max(0, v) })}
                      note="Effective IT is capped to site max from land when Target mode is enabled."
                    />

                    <div className="rounded-lg border p-3">
                      <div className="text-sm font-medium">Cooling</div>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label>Approach</Label>
                          <Select value={app.inputs.cooling} onValueChange={(v: any) => setInputs({ cooling: v })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Air">Air</SelectItem>
                              <SelectItem value="Liquid">Liquid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <RangeWithInput
                          label="PUE"
                          value={app.inputs.pue}
                          min={1.0}
                          max={2.0}
                          step={0.01}
                          accent={BRAND.midnight}
                          onChange={(v) => setInputs({ pue: Math.max(1.0, v) })}
                          valueFormat={(v) => v.toFixed(2)}
                        />
                      </div>

                      <div className="mt-3">
                        <RangeWithInput
                          label="WUE"
                          value={app.inputs.wue}
                          min={0}
                          max={2}
                          step={0.01}
                          suffix="L/kWh"
                          accent={BRAND.teal}
                          onChange={(v) => setInputs({ wue: Math.max(0, v) })}
                          valueFormat={(v) => v.toFixed(2)}
                          note="Cooling toggles suggest defaults (Air≈0.30, Liquid≈0.15) but you can override."
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Parcel & Land */}
                <Card>
                  <CardHeader>
                    <CardTitle>Parcel &amp; Land</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Parcel (ac)</Label>
                        <NumberField
                          value={app.inputs.parcelAc}
                          onCommit={(v) => setInputs({ parcelAc: Math.max(0, v) })}
                          min={0}
                          step={1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Buildable (ac)</Label>
                        <div className="rounded-md border px-3 py-2 text-sm">{fmt(buildableAc, 2)} ac</div>
                      </div>
                    </div>

                    <RangeWithInput
                      label="Buildable % of parcel"
                      value={app.inputs.buildablePct}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      accent={BRAND.midnight}
                      onChange={(v) => setInputs({ buildablePct: clamp(v, 0, 100) })}
                      note="Controls total developable land used across land allocation outputs."
                    />

                    <details className="rounded-md border px-3 py-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        Advanced: Site coverage ({fmt(app.inputs.siteCoveragePct, 0)}%)
                      </summary>
                      <div className="mt-3">
                        <RangeWithInput
                          label="Site coverage"
                          value={app.inputs.siteCoveragePct}
                          min={0}
                          max={100}
                          step={1}
                          suffix="%"
                          accent={BRAND.orange}
                          onChange={(v) => setInputs({ siteCoveragePct: clamp(v, 0, 100) })}
                          note="Controls maximum building footprint envelope only (Buildable ac × Site coverage %)."
                        />
                      </div>
                    </details>

                    <div className="grid grid-cols-2 gap-3">
                      <RangeWithInput
                        label="MEP yard (% of building)"
                        value={app.inputs.mepYardPct}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        accent={BRAND.yellowOrange}
                        onChange={(v) => setInputs({ mepYardPct: clamp(v, 0, 100) })}
                      />
                      <RangeWithInput
                        label="Roads / Parking (% of building+MEP+sub)"
                        value={app.inputs.roadsPct}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        accent={BRAND.purple}
                        onChange={(v) => setInputs({ roadsPct: clamp(v, 0, 100) })}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label>Substation minimum (ac)</Label>
                      <NumberField
                        value={app.inputs.substationAc}
                        onCommit={(v) => setInputs({ substationAc: Math.max(0, v) })}
                        min={0}
                        step={0.25}
                      />
                    </div>

                    <div className="text-xs text-muted-foreground">
                      MEP and roads are scaled from the required building footprint/developed core (not parcel size). Substation is
                      max(input minimum, MW-based estimate). Land pie + mapping footprints use the <b>required</b> building footprint.
                    </div>
                  </CardContent>
                </Card>

                {/* Racking, Stories, Phasing */}
                <Card>
                  <CardHeader>
                    <CardTitle>Racking, Stories &amp; Phasing</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-700">Design bundle (racking + density + support)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(Object.entries(DESIGN_BUNDLES) as Array<[DesignBundleId, (typeof DESIGN_BUNDLES)[DesignBundleId]]>).map(
                          ([id, cfg]) => (
                            <Button
                              key={id}
                              className="h-auto whitespace-normal py-2 text-xs leading-tight"
                              variant={activeDesignBundle === id ? "default" : "outline"}
                              onClick={() =>
                                setInputs({
                                  ft2PerRack: cfg.ft2PerRack,
                                  kwPerRack: cfg.kwPerRack,
                                  supportPct: cfg.supportPct,
                                })
                              }
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{cfg.label}</span>
                                <span className="text-[10px] opacity-90">{cfg.note}</span>
                              </div>
                            </Button>
                          )
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Current: {activeDesignBundle === "custom" ? "Custom (manual values)" : DESIGN_BUNDLES[activeDesignBundle].label}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3">
                      <RangeWithInput
                        label="Stories"
                        value={Math.max(1, Math.round(app.inputs.stories || 1))}
                        min={1}
                        max={6}
                        step={1}
                        accent={BRAND.midnight}
                        onChange={(v) => setInputs({ stories: Math.max(1, Math.round(v)) })}
                        note="More stories reduce required building footprint for the same IT MW (if not coverage-limited)."
                        valueFormat={(v) => `${Math.max(1, Math.round(v))}`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>ft² / rack</Label>
                        <NumberField
                          value={app.inputs.ft2PerRack}
                          onCommit={(v) => setInputs({ ft2PerRack: Math.max(1, v) })}
                          min={1}
                          step={1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>kW / rack</Label>
                        <NumberField
                          value={app.inputs.kwPerRack}
                          onCommit={(v) => setInputs({ kwPerRack: Math.max(0, v) })}
                          min={0}
                          step={0.5}
                        />
                      </div>
                    </div>

                    <RangeWithInput
                      label="Support area"
                      value={app.inputs.supportPct}
                      min={0}
                      max={90}
                      step={1}
                      suffix="%"
                      accent={BRAND.slate}
                      onChange={(v) => setInputs({ supportPct: clamp(v, 0, 90) })}
                      note="Percent of total floor area assumed to be support (electrical rooms, back-of-house, etc.)."
                    />

                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Manual per-phase IT</div>
                        <div className="text-xs text-muted-foreground">Off = equalized across phases.</div>
                      </div>
                      <Switch
                        checked={app.inputs.phaseMode === "manual"}
                        onCheckedChange={(c) => setInputs({ phaseMode: c ? "manual" : "equal" })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Phases</Label>
                        <NumberField
                          value={app.inputs.phases}
                          onCommit={(v) => {
                            const p = Math.max(1, Math.round(v));
                            const old = Array.isArray(app.inputs.phaseIT) ? app.inputs.phaseIT : [];
                            const next = Array.from({ length: p }).map((_, i) => old[i] ?? 0);
                            setInputs({ phases: p, phaseIT: next });
                          }}
                          min={1}
                          step={1}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground flex items-end">Manual phasing is informational in Results.</div>
                    </div>

                    {app.inputs.phaseMode === "manual" && (
                      <div className="space-y-2">
                        {Array.from({ length: Math.max(1, Math.round(app.inputs.phases || 1)) }).map((_, i) => (
                          <div key={i} className="grid grid-cols-3 items-center gap-2">
                            <div className="text-sm">P{i + 1}</div>
                            <NumberField
                              value={app.inputs.phaseIT[i] ?? 0}
                              onCommit={(v) => {
                                const arr = [...app.inputs.phaseIT];
                                arr[i] = v;
                                setInputs({ phaseIT: arr });
                              }}
                              className="col-span-2"
                              min={0}
                              step={1}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Power & Mix */}
            <TabsContent value="power" className="mt-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      ⚡ Power Mix Builder
                      <span className="text-xs font-normal text-muted-foreground">(mix slider + manual units)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={addPowerRow}>
                          Add row
                        </Button>
                        <Button variant="outline" onClick={removeLastPowerRow}>
                          Remove last
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Size to Facility (IT·PUE)</Label>
                          <Switch
                            checked={app.power.sizeToFacility}
                            onCheckedChange={(c) => setPower({ sizeToFacility: !!c })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">ELCC mode</Label>
                          <Switch checked={app.power.elccEnabled} onCheckedChange={(c) => setPower({ elccEnabled: !!c })} />
                        </div>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs">Library basis</Label>
                          <div className="inline-flex rounded-md border bg-white p-1">
                            {(["conservative", "typical", "aggressive"] as LibraryBasis[]).map((b) => (
                              <Button
                                key={b}
                                type="button"
                                variant={activeLibraryBasis === b ? "default" : "ghost"}
                                className="h-7 px-2 text-[11px]"
                                onClick={() => setPower({ libraryBasis: b })}
                              >
                                {LIBRARY_BASIS_LABELS[b]}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Library basis scales default assumptions for availability, heat rate, water, and land; row overrides still take precedence.
                    </div>

                    <div className="rounded-lg border">
                      <div className="grid grid-cols-14 gap-2 border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                        <div className="col-span-5">Technology</div>
                        <div className="col-span-3">Mix (% of required)</div>
                        <div className="col-span-2">Units</div>
                        <div className="col-span-2">Unit MW</div>
                        <div className="col-span-1">Avail</div>
                        <div className="col-span-1">Heat/Water</div>
                      </div>

                      <div className="divide-y">
                        {app.power.rows.map((r) => {
                          const baseTech = techById(r.techId) || TECH_LIBRARY[0];
                          const t = techWithLibraryBasis(baseTech, activeLibraryBasis);
                          const selectedCategory: TechCategory = baseTech.category;
                          const optionsInCategory = techOptionsByCategory[selectedCategory] || [];
                          const unitMW = r.unitMWOverride != null ? r.unitMWOverride : t.unitMW;
                          const avail = r.availabilityOverride != null ? r.availabilityOverride : t.defaultAvailability;
                          const nonFirm = !t.isFirm;

                          const installedForShare = Math.max(0, Math.round(r.units || 0)) * unitMW;
                          const sharePct = requiredMW > 0 ? (installedForShare / requiredMW) * 100 : 0;
                          const shareUI = clamp(sharePct, 0, 200);

                          return (
                            <div key={r.id} className={`grid grid-cols-14 gap-2 px-3 py-2 ${nonFirm ? "bg-yellow-50" : "bg-white"}`}>
                              <div className="col-span-5">
                                <div className="space-y-1">
                                  <Select
                                    value={selectedCategory}
                                    onValueChange={(nextCat: TechCategory) => {
                                      const first = techOptionsByCategory[nextCat]?.[0];
                                      if (!first) return;
                                      updatePowerRow(r.id, {
                                        techId: first.id,
                                        unitMWOverride: undefined,
                                        availabilityOverride: undefined,
                                      });
                                    }}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TECH_CATEGORY_ORDER.map((cat) => (
                                        <SelectItem key={cat} value={cat}>
                                          {cat}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={r.techId}
                                    onValueChange={(v: any) =>
                                      updatePowerRow(r.id, {
                                        techId: v,
                                        unitMWOverride: undefined,
                                        availabilityOverride: undefined,
                                      })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {optionsInCategory.map((tech: Tech) => (
                                        <SelectItem key={tech.id} value={tech.id}>
                                          {tech.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="col-span-3">
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">Share</span>
                                    <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(sharePct)}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={0}
                                    max={200}
                                    step={1}
                                    value={shareUI}
                                    onChange={(e) => {
                                      const pct = clamp(num((e.target as any).value, shareUI), 0, 200);
                                      const desiredMW = (requiredMW * pct) / 100;
                                      const denom = Math.max(0.0001, unitMW);
                                      const newUnits = requiredMW > 0 ? Math.max(0, Math.ceil(desiredMW / denom)) : 0;
                                      updatePowerRow(r.id, { units: newUnits });
                                    }}
                                    className="w-full"
                                    style={{ accentColor: nonFirm ? BRAND.slate : BRAND.orange }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <NumberField
                                      value={Math.round(sharePct)}
                                      onCommit={(pctIn) => {
                                        const pct = clamp(pctIn, 0, 200);
                                        const desiredMW = (requiredMW * pct) / 100;
                                        const denom = Math.max(0.0001, unitMW);
                                        const newUnits = requiredMW > 0 ? Math.max(0, Math.ceil(desiredMW / denom)) : 0;
                                        updatePowerRow(r.id, { units: newUnits });
                                      }}
                                      min={0}
                                      max={200}
                                      step={1}
                                    />
                                    <div className="text-[10px] text-muted-foreground">%</div>
                                  </div>
                                </div>
                              </div>

                              <div className="col-span-2">
                                <NumberField
                                  value={r.units}
                                  onCommit={(v) => updatePowerRow(r.id, { units: Math.max(0, Math.round(v)) })}
                                  min={0}
                                  step={1}
                                />
                              </div>

                              <div className="col-span-2">
                                <NumberField
                                  value={unitMW}
                                  onCommit={(v) => updatePowerRow(r.id, { unitMWOverride: Math.max(0, v) })}
                                  min={0}
                                  step={0.1}
                                />
                              </div>

                              <div className="col-span-1">
                                <NumberField
                                  value={avail}
                                  onCommit={(v) => updatePowerRow(r.id, { availabilityOverride: clamp(v, 0, 1) })}
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  disabled={nonFirm}
                                />
                              </div>

                              <div className="col-span-1 text-xs text-slate-600">
                                {t.heatRateBtuPerKWh > 0 ? `${Math.round(t.heatRateBtuPerKWh).toLocaleString()} Btu/kWh` : "—"}
                                {t.waterGalPerMWh > 0 ? <div>{`${Math.round(t.waterGalPerMWh).toLocaleString()} gal/MWh`}</div> : <div>—</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {app.power.elccEnabled && (
                      <div className="rounded-lg border p-3">
                        <div className="text-sm font-medium">ELCC settings (screening)</div>
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                          <div className="space-y-1">
                            <Label>PV ELCC (%)</Label>
                            <NumberField
                              value={app.power.pvElccPct}
                              onCommit={(v) => setPower({ pvElccPct: clamp(v, 0, 100) })}
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Wind ELCC (%)</Label>
                            <NumberField
                              value={app.power.windElccPct}
                              onCommit={(v) => setPower({ windElccPct: clamp(v, 0, 100) })}
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>BESS ELCC (%)</Label>
                            <NumberField
                              value={app.power.bessElccPct}
                              onCommit={(v) => setPower({ bessElccPct: clamp(v, 0, 100) })}
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>BESS Duration (hr)</Label>
                            <NumberField
                              value={app.power.bessDurationHr}
                              onCommit={(v) => setPower({ bessDurationHr: Math.max(0, v) })}
                              min={0}
                              step={1}
                            />
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Accredited MW = PV×ELCC + Wind×ELCC + BESS×ELCC×(duration/4h). Screening only.
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Right rail */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>Reliability Check</span>
                        {reliability.meets ? <Badge tone="good">Meets target</Badge> : <Badge tone="bad">Does not meet</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label>Reliability</Label>
                          <Select value={app.power.reliability} onValueChange={(v: any) => setPower({ reliability: v })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="99.9">3 nines (N+1)</SelectItem>
                              <SelectItem value="99.99">4 nines (N+2)</SelectItem>
                              <SelectItem value="99.999">5 nines (N+3)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Required MW</Label>
                          <div className="rounded-md border px-3 py-2 text-sm">{fmt(requiredMW, 1)} MW</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <Metric label="Installed (all tech)" value={`${fmt(installedAll, 1)} MW`} />
                        <Metric
                          label="Installed / Required"
                          value={requiredMW > 0 ? `${fmt((installedAll / requiredMW) * 100, 0)}%` : "—"}
                        />
                        <Metric label="Installed firm (total)" value={`${fmt(reliability.installedFirmTotal, 1)} MW`} />
                        <Metric label="Firm available (pre-event)" value={`${fmt(reliability.availableFirmTotal, 1)} MW`} />
                        <Metric
                          label={`Firm after worst-case loss (k=${reliability.k})`}
                          value={`${fmt(reliability.remainingFirm, 1)} MW`}
                        />
                        <Metric label="Accredited non-firm (ELCC)" value={`${fmt(reliability.accredited, 1)} MW`} />
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="text-sm font-medium">Reliability event (N+k drop)</div>
                        <div className="mt-2 text-xs text-muted-foreground">Dropped units (largest {reliability.k}):</div>
                        <ul className="mt-2 list-disc pl-5 text-sm">
                          {reliability.dropped.length ? (
                            reliability.dropped.map((d: any, i: number) => (
                              <li key={i}>
                                {d.name} — {fmt(d.mw, 1)} MW
                              </li>
                            ))
                          ) : (
                            <li className="text-muted-foreground">None (no firm units)</li>
                          )}
                        </ul>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Firm contribution is availability-derated per unit. Non-firm contributes only via ELCC when enabled.
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>Fuel &amp; Water Summary</span>
                        <Badge tone="info">Screening</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Metric label="Gas (thermal)" value={`${fmt(dispatchSummary.gasMMBtuPerHr, 1)} MMBtu/h`} />
                        <Metric label="Gas (thermal)" value={`${fmt(dispatchSummary.gasMMBtuPerHr * 24, 0)} MMBtu/day`} subtle />
                        <Metric label="Generation water" value={`${fmt(dispatchSummary.waterGalPerHr, 0)} gal/h`} />
                        <Metric label="Generation water" value={`${fmt(dispatchSummary.waterGalPerHr * 24, 0)} gal/day`} />
                        <Metric label="Data center water (WUE)" value={`${fmt(dcWater.galPerDay, 0)} gal/day`} />
                        <Metric label="Total water (DC + gen)" value={`${fmt(dcWater.galPerDay + dispatchSummary.waterGalPerHr * 24, 0)} gal/day`} />
                      </div>

                      {dispatchSummary.byTech.length ? (
                        <div className="rounded-lg border p-3">
                          <div className="text-sm font-medium">Firm dispatch allocation (pro-rata)</div>
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {[...dispatchSummary.byTech]
                              .sort((a: any, b: any) => (b.dispatchMW || 0) - (a.dispatchMW || 0))
                              .slice(0, 6)
                              .map((t: any) => (
                                <div key={t.id} className="flex items-center justify-between gap-3">
                                  <span className="truncate">{t.name}</span>
                                  <span className="tabular-nums">
                                    {fmt(t.dispatchMW, 1)} MW · {fmt(t.mmbtuPerHr, 1)} MMBtu/h · {fmt(t.waterGalPerHr, 0)} gal/h
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No firm dispatch available (add firm generation or grid).</div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        Fuel and water are computed from availability-derated firm dispatch sized to Required MW (pre-contingency). Non-firm rows do not dispatch in this summary.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Installed vs. Available (Firm rows only)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={installedVsAvailable} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="tech"
                          interval={0}
                          tick={{ fontSize: 11 }}
                          label={{ value: "Technology", position: "insideBottom", offset: -10 }}
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="installed" name="Installed MW" fill={BRAND.midnight} />
                        <Bar dataKey="dispatched" name="Available MW" fill={BRAND.orange} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Installed Mix (All Techs)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-72">
                    {mixPie.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={mixPie} dataKey="installed" nameKey="name" outerRadius={105} label={({ value }: any) => `${Math.round(value)} MW`}>
                            {mixPie.map((_, i) => (
                              <Cell key={`cell-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Add units to see mix.</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Representative Dispatch (24h)</span>
                      <Badge tone="info">Screening</Badge>
                    </CardTitle>
                    <div className="text-xs text-muted-foreground">
                      Built-in archetype day; flat required load from current sizing mode.
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-end gap-2">
                      <Label className="text-xs">Min-load constraints</Label>
                      <Switch checked={dispatchMinLoadEnabled} onCheckedChange={(c) => setPower({ dispatchMinLoadEnabled: !!c })} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      <Metric label="Renewable served" value={`${fmt(dispatch24h.totals.renewableServedMWh, 0)} MWh/day`} />
                      <Metric label="Firm served" value={`${fmt(dispatch24h.totals.firmServedMWh, 0)} MWh/day`} />
                      <Metric label="Excess / export" value={`${fmt(dispatch24h.totals.excessMWh, 0)} MWh/day`} />
                      <Metric label="Curtailment" value={`${fmt(dispatch24h.totals.curtailedMWh, 0)} MWh/day`} />
                      <Metric label="Unserved" value={`${fmt(dispatch24h.totals.unservedMWh, 0)} MWh/day`} />
                    </div>

                    {dispatchChartHasData ? (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={dispatch24h.byHour} margin={{ top: 10, right: 28, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="mw" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="mwh" orientation="right" tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="mw" dataKey="pvMW" name="PV" stackId="dispatch" fill={DISPATCH_SERIES_COLORS.pvMW} />
                            <Bar yAxisId="mw" dataKey="windMW" name="Wind" stackId="dispatch" fill={DISPATCH_SERIES_COLORS.windMW} />
                            <Bar
                              yAxisId="mw"
                              dataKey="bessDischargeMW"
                              name="BESS discharge"
                              stackId="dispatch"
                              fill={DISPATCH_SERIES_COLORS.bessDischargeMW}
                            />
                            {dispatchFirmSeries.map((series) => (
                              <Bar key={series.key} yAxisId="mw" dataKey={series.key} name={series.label} stackId="dispatch" fill={series.color} />
                            ))}
                            <Bar
                              yAxisId="mw"
                              dataKey="excessMW"
                              name="Excess / Export"
                              stackId="dispatch"
                              fill={DISPATCH_SERIES_COLORS.excessMW}
                            />
                            <Bar yAxisId="mw" dataKey="unservedMW" name="Unserved" stackId="dispatch" fill={DISPATCH_SERIES_COLORS.unservedMW} />
                            <Line
                              yAxisId="mw"
                              type="monotone"
                              dataKey="requiredMW"
                              name="Required MW"
                              stroke={DISPATCH_SERIES_COLORS.requiredMW}
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              yAxisId="mwh"
                              type="monotone"
                              dataKey="socMWh"
                              name="BESS SOC (MWh)"
                              stroke={DISPATCH_SERIES_COLORS.socMWh}
                              strokeDasharray="5 3"
                              dot={false}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                        No dispatch signal yet. Add required load and technology capacity to render the representative day.
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      Merit + rules screening dispatch: PV/Wind first, then BESS, then firm technologies by heat-rate order. When min-load constraints
                      are enabled, firm minimums are applied by category (Grid 0%, RICE 25%, SCGT 35%, CCGT/FuelCell 50%, Nuclear 90%), and excess
                      shows as export/spill. This is not an hourly market/economic dispatch model, and profile shapes are archetypal rather than
                      site-specific.
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Results */}
            <TabsContent value="results" className="mt-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>IT Capacity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-4xl font-semibold">
                      {fmt(effectiveIT.itMW, 2)} <span className="text-xl font-normal text-muted-foreground">MW</span>
                    </div>
                    {effectiveIT.mode === "target" && <div className="text-sm text-green-700">Target input (within land max).</div>}
                    {effectiveIT.mode === "land-limited" && (
                      <div className="text-sm text-orange-700">
                        Land-limited: target {fmt(app.inputs.targetITMW, 2)} MW → site supports {fmt(envelope.itMW, 2)} MW.
                      </div>
                    )}
                    {effectiveIT.mode === "max" && <div className="text-sm text-green-700">Computed from land (max envelope).</div>}

                    <div className="text-xs text-muted-foreground">
                      Site max from land envelope: {fmt(envelope.itMW, 2)} MW. Unconstrained required building footprint: {fmt(requiredBldg.footprintAc, 2)} ac.
                      Coverage-limited max building footprint: {fmt(envelope.envelopeFootprintAc, 2)} ac.
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Facility Power</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-4xl font-semibold">
                      {fmt(facility.facilityMW, 2)} <span className="text-xl font-normal text-muted-foreground">MW</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      PUE: {fmt(app.inputs.pue, 2)} · IT share ≈ {fmt(facility.itShare * 100, 1)}%
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Required Footprint (for effective IT)</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3">
                    <Metric label="Required building footprint (unconstrained)" value={`${fmt(requiredBldg.footprintAc, 2)} ac`} />
                    <Metric label="Footprint used in land allocation (coverage-capped)" value={`${fmt(requiredBuildingFootprintAc, 2)} ac`} />
                    <Metric label="Coverage-limited max footprint" value={`${fmt(envelope.envelopeFootprintAc, 2)} ac`} />
                    <Metric label="Site coverage setting" value={`${fmt(app.inputs.siteCoveragePct, 0)}%`} />
                    <Metric label="Stories" value={`${Math.max(1, Math.round(app.inputs.stories))}`} />
                    <Metric label="Support %" value={`${fmt(app.inputs.supportPct, 0)}%`} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>White Space &amp; Racks (effective IT)</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3">
                    <Metric label="Racks (needed)" value={`${Math.round(requiredBldg.racksNeeded).toLocaleString()}`} />
                    <Metric label="kW/rack" value={`${fmt(app.inputs.kwPerRack, 1)} kW`} />
                    <Metric label="White space (ft²)" value={`${Math.round(requiredBldg.whiteSpaceFt2).toLocaleString()} ft²`} />
                    <Metric label="Total floor (ft²)" value={`${Math.round(requiredBldg.totalFloorFt2).toLocaleString()} ft²`} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Land Snapshot</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Parcel</span>
                      <span className="font-medium">{fmt(app.inputs.parcelAc, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Buildable</span>
                      <span className="font-medium">{fmt(land.buildable, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Building (required footprint)</span>
                      <span className="font-medium">{fmt(land.building, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>MEP Yard</span>
                      <span className="font-medium">{fmt(land.mep, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Substation</span>
                      <span className="font-medium">{fmt(land.sub, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Roads/Parking</span>
                      <span className="font-medium">{fmt(land.roads, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Generation (power)</span>
                      <span className="font-medium">{fmt(land.gen, 2)} ac</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Open/Other</span>
                      <span className="font-medium">{fmt(land.open, 2)} ac</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Land Allocation</CardTitle>
                  </CardHeader>
                  <CardContent className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={landPie} dataKey="value" nameKey="name" outerRadius={110} label={({ value }: any) => `${fmt(value, 1)} ac`}>
                          {landPie.map((d: any, i) => (
                            <Cell key={`lc-${i}`} fill={d.color || LAND_COLORS[i % LAND_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Phasing (IT MW)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={phasing} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" label={{ value: "Phase", position: "insideBottom", offset: -10 }} />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="itMW" name="IT MW" fill={BRAND.orange} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <div className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Estimated Generation Footprint (ac)</span>
                      <span className="text-sm text-muted-foreground">Total: {fmt(genFootprint.total, 1)} ac</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-slate-600">
                            <th className="py-2">Technology</th>
                            <th className="py-2">Installed MW</th>
                            <th className="py-2">Acres</th>
                            <th className="py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {genFootprint.byTech.length ? (
                            genFootprint.byTech.map((t) => (
                              <tr key={t.id} className="border-b">
                                <td className="py-2">
                                  <div className="flex items-center gap-2">
                                    {t.isFirm ? <Badge tone="info">firm</Badge> : <Badge tone="warn">non-firm</Badge>}
                                    <span>{t.name}</span>
                                  </div>
                                </td>
                                <td className="py-2">{fmt(t.installedMW, 1)}</td>
                                <td className="py-2">{fmt(t.acres, 2)}</td>
                                <td className="py-2 text-xs text-muted-foreground">{techById(t.id)?.notes || "—"}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="py-3 text-muted-foreground" colSpan={4}>
                                Add generation units in Power &amp; Mix to see footprint.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Mapping (ONLY HERE) */}
            <TabsContent value="mapping" className="mt-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapIcon className="h-5 w-5" />
                      Mapping
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Downstream layout workspace</div>
                        <div className="text-xs text-muted-foreground">
                          Generate footprints from Results + Power, then edit on map. Mapping edits do not change Inputs.
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={generateLayoutFromResults} className="bg-black text-white hover:bg-slate-800">
                          Generate from current results
                        </Button>
                        <Button variant="outline" onClick={autoPackIntoParcel} className="gap-2">
                          <PackageOpen className="h-4 w-4" />
                          Auto-pack into parcel
                        </Button>
                        <Button variant="outline" onClick={createParcelFromBuildable}>
                          Create parcel
                        </Button>
                        <Button variant="outline" onClick={setSelectedAsParcel}>
                          Use selected as parcel
                        </Button>
                        <Button variant="outline" onClick={editSelectedPolygon}>
                          Edit selected
                        </Button>
                        <Button variant="outline" onClick={zoomToLayout} className="gap-2">
                          <Focus className="h-4 w-4" />
                          Zoom to
                        </Button>
                        <Button variant="outline" onClick={clearLayout}>
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <div className="lg:col-span-2">
                        <div className="text-sm font-medium">Search (free geocoder; requires network)</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            placeholder="city, address"
                            onKeyDown={(e: any) => {
                              if (e.key === "Enter") {
                                searchLocation(e.currentTarget.value);
                              }
                            }}
                            className="w-full lg:w-80"
                            id="map-search"
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              const el = document.getElementById("map-search") as any;
                              searchLocation(el?.value || "");
                            }}
                          >
                            Search
                          </Button>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Label className="text-xs">Enable network tools</Label>
                          <Switch
                            checked={app.mapping.networkEnabled}
                            onCheckedChange={(c) =>
                              setApp((prev) => ({ ...prev, mapping: { ...prev.mapping, networkEnabled: !!c } }))
                            }
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="w-48">
                            <Select
                              value={app.mapping.basemap}
                              onValueChange={(v: any) =>
                                setApp((prev) => ({ ...prev, mapping: { ...prev.mapping, basemap: v } }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {BASEMAPS.map((b) => (
                                  <SelectItem key={b.id} value={b.id}>
                                    {b.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="text-xs text-muted-foreground">Basemap: Light gray, OSM, Aerial.</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Label className="text-xs">Generation shapes</Label>
                          <div className="w-52">
                            <Select
                              value={currentGenerationShapeModel()}
                              onValueChange={(v) =>
                                setApp((prev) => ({
                                  ...prev,
                                  mapping: { ...prev.mapping, generationShapeModel: v as GenerationShapeModel },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rect_by_tech">Tech rectangles</SelectItem>
                                <SelectItem value="square">Squares</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="text-xs text-muted-foreground">Used by Generate and Auto-pack.</div>
                        </div>

                        <div className="mt-2 text-xs text-muted-foreground">
                          In this workspace, network requests may be disabled. When deployed, enable network tools for basemap + search.
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium">Center</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <NumberField
                            value={app.mapping.center.lat}
                            onCommit={(v) =>
                              setApp((prev) => ({
                                ...prev,
                                mapping: { ...prev.mapping, center: { ...prev.mapping.center, lat: v } },
                              }))
                            }
                            step={0.000001}
                          />
                          <NumberField
                            value={app.mapping.center.lon}
                            onCommit={(v) =>
                              setApp((prev) => ({
                                ...prev,
                                mapping: { ...prev.mapping, center: { ...prev.mapping.center, lon: v } },
                              }))
                            }
                            step={0.000001}
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              const map = mapRef.current;
                              if (!map) return;
                              map.flyTo({ center: [app.mapping.center.lon, app.mapping.center.lat], zoom: app.mapping.zoom, essential: true });
                            }}
                          >
                            Fly
                          </Button>
                          <div className="text-xs text-muted-foreground">Zoom: {fmt(app.mapping.zoom, 2)}</div>
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Buildable used for parcel creation: {fmt(buildableAc, 2)} ac (Parcel {fmt(app.inputs.parcelAc, 1)} ac × {fmt(app.inputs.buildablePct, 0)}%).
                        </div>
                      </div>
                    </div>

                    {packReport && (
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">Auto-pack report</div>
                          <div className="text-xs text-muted-foreground">
                            Placed: {packReport.placed} · Not fit: {packReport.notFit.length}
                          </div>
                        </div>
                        {packReport.notFit.length ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <div className="font-medium text-slate-700">Doesn’t fit (greedy pack)</div>
                            <ul className="mt-1 list-disc pl-5">
                              {packReport.notFit.slice(0, 8).map((x, i) => (
                                <li key={i}>
                                  {x.name} ({fmt(x.acres, 1)} ac)
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-green-700">All footprints placed inside parcel.</div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border">
                      <div ref={mapContainerRef} className="h-[560px] w-full" />
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Draw controls: polygon + trash. Click a polygon to edit vertices (white handles) and drag orange midpoints to add corners. Tip:
                      Move parcel freely; corner edits preserve parcel acreage target. Draw a parcel polygon, then click "Use selected as parcel" to make it the container.
                    </div>
                  </CardContent>
                </Card>

                {/* Legend / Zoom list */}
                <Card>
                  <CardHeader>
                    <CardTitle>Legend &amp; Zoom</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs text-muted-foreground">Click an item to zoom. Colors match polygon shading. Parcel has dashed outline.</div>

                    <div className="space-y-2">
                      {legendItems.length ? (
                        legendItems.map((it) => (
                          <button
                            key={it.id}
                            onClick={() => zoomToFeatureId(it.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left hover:bg-slate-50 ${it.isParcel ? "border-slate-300" : "border-slate-200"}`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-3 w-3 shrink-0 ${it.isParcel ? "rounded-sm border-2 border-dashed border-slate-700" : "rounded-full"}`}
                                style={{ background: it.color, border: it.isParcel ? undefined : "1px solid rgba(0,0,0,0.15)" }}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{it.name}</div>
                                <div className="text-[11px] text-muted-foreground">{it.isParcel ? "parcel" : it.kind}</div>
                              </div>
                            </div>
                            <div className="shrink-0 text-sm tabular-nums text-slate-700">{it.acres > 0.01 ? `${fmt(it.acres, 1)} ac` : ""}</div>
                          </button>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">No polygons yet. Generate a layout or draw a parcel.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Assumptions */}
            <TabsContent value="assumptions" className="mt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Technology Library (screening defaults)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      Screening-level assumptions for heat rate, water, and land. Frame-class values are placeholders.
                      Displayed values reflect current library basis: <b>{LIBRARY_BASIS_LABELS[activeLibraryBasis]}</b>.
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-slate-600">
                            <th className="py-2">Tech</th>
                            <th className="py-2">Firm</th>
                            <th className="py-2">Unit MW</th>
                            <th className="py-2">Avail</th>
                            <th className="py-2">Heat rate</th>
                            <th className="py-2">Water</th>
                            <th className="py-2">Land model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {techLibraryForDisplay.map((t) => (
                            <tr key={t.id} className="border-b">
                              <td className="py-2">{t.name}</td>
                              <td className="py-2">{t.isFirm ? <Badge tone="info">firm</Badge> : <Badge tone="warn">non-firm</Badge>}</td>
                              <td className="py-2">{fmt(t.unitMW, 1)}</td>
                              <td className="py-2">{t.isFirm ? fmt(t.defaultAvailability, 2) : "—"}</td>
                              <td className="py-2">{t.heatRateBtuPerKWh ? `${Math.round(t.heatRateBtuPerKWh).toLocaleString()} Btu/kWh` : "—"}</td>
                              <td className="py-2">{t.waterGalPerMWh ? `${Math.round(t.waterGalPerMWh).toLocaleString()} gal/MWh` : "—"}</td>
                              <td className="py-2">{`${fmt(t.landFixedAc, 1)} ac + ${fmt(t.landAcPerMW, 3)} ac/MW`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Wind acreage is total project area by default. Nuclear is modeled as on-site acreage (includes significant buffer/exclusion area in screening).
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Design &amp; Land-Use Assumptions</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-slate-700">
                    <ul className="list-disc space-y-1 pl-5">
                      <li><b>Buildable:</b> Buildable acres = Parcel acres � Buildable %. This is the total developable land budget used in land allocation.</li>
                      <li><b>Site coverage:</b> Coverage-limited building envelope = Buildable acres � Site coverage %. This only caps building footprint.</li>
                      <li><b>Required footprint:</b> For a given effective IT MW and Stories, unconstrained required building footprint is computed from racks and ft�/rack; land allocation uses the coverage-capped footprint.</li>
                      <li><b>MEP yard land:</b> MEP acres = Building footprint × (MEP %).</li>
                      <li><b>Roads/Parking land:</b> Roads acres = (Building + MEP + Substation) × (Roads %).</li>
                      <li><b>Substation land:</b> Substation acres = max(Substation minimum input, 1.25 + 0.0075 × Facility MW).</li>
                      <li><b>White space:</b> Racks = White space ÷ ft²/rack. IT MW = Racks × (kW/rack) ÷ 1000.</li>
                      <li><b>IT MW cap:</b> Effective IT = min(Target IT, Max IT from land envelope) when Target mode is enabled.</li>
                      <li><b>Power sizing:</b> Facility MW = IT MW × PUE (screening). Reliability targets use Facility MW when “Size to Facility” is enabled.</li>
                      <li><b>Mapping parcel lock:</b> Parcel can be moved; editing parcel corners preserves locked buildable acreage.</li>
                      <li><b>Mapping generation geometry:</b> Squares are area-only placeholders. Tech-rectangles are screening-realistic geometry, not engineering layout.</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Reliability &amp; Accreditation</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-slate-700">
                    <ul className="list-disc space-y-1 pl-5">
                      <li><b>Reliability check:</b> N+k by dropping the largest k firm units (k = 1 for 99.9%, 2 for 99.99%, 3 for 99.999%).</li>
                      <li><b>Firm MW:</b> Availability-derated (unit MW × availability).</li>
                      <li><b>ELCC toggle:</b> When enabled, PV/Wind/BESS contribute accredited MW. BESS is scaled by duration/4h.</li>
                      <li><b>Mapping:</b> Downstream only. Generate &amp; auto-pack footprints, then edit visually without changing the sizing model.</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
