import React, { useEffect, useMemo, useRef, useState } from "react";
import { Info, Settings2, PieChart as PieIcon, SlidersHorizontal, ShieldAlert } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

// === Mapping libs (no API keys) ===
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

// Restore shadcn/ui components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

// ================= Brand Palette =================
const BRAND = {
  ORANGE: "#FF6A39",
  YELLOW_ORANGE: "#E09A41",
  SLATE: "#707070",
  ONYX: "#393A3C",
  SMOKE: "#B6B8BA",
  MIDNIGHT: "#003B65",
  TEAL: "#72CAC3",
  PURPLE: "#52266F",
};
const LAND_COLORS = [BRAND.MIDNIGHT, BRAND.ORANGE, BRAND.TEAL, BRAND.PURPLE, BRAND.YELLOW_ORANGE, BRAND.SLATE];
const MIX_COLORS = [
  BRAND.ORANGE,
  BRAND.MIDNIGHT,
  BRAND.TEAL,
  BRAND.PURPLE,
  BRAND.YELLOW_ORANGE,
  BRAND.SMOKE,
  BRAND.SLATE,
  "#8F8F8F",
  "#C7D3E3",
  "#F3BDAA",
];

// square meters per acre
const SQM_PER_ACRE = 4046.8564224;

// ================= Defaults =================
const DEFAULT_GENLAND = {
  Grid: { per_unit_acres: 0 },
  "Recip (NG)": { per_unit_acres: 0.7 },
  SCGT: { per_unit_acres: 2.0 },
  "CCGT (5000F 1x1)": { per_unit_acres: 12.0 },
  "Fuel Cells (SOFC)": { per_unit_acres: 0.2 },
  PV: { per_MW_acres: 6.5 },
  Wind: { per_MW_acres: 40 },
  BESS: { per_MW_hr: 0.0075, site_overhead_acres: 0.5 },
};

const DEFAULT_INPUTS = {
  mode: "target",
  parcelAcres: 500,
  buildablePct: 30,
  siteCoveragePct: 50,
  stories: 1,
  supportPct: 35,
  mepYardPct: 15,
  roadsPct: 10,
  substationAcres: 2.0,
  sqftPerRack: 60,
  rackDensityKw: 10,
  cooling: "Air",
  pue: 1.35,
  wue_L_per_kWh: 0.3,
  targetItMw: 100,
  phases: 3,
  equalizePhases: true,
  phaseItMw: [33.3, 33.3, 33.3],
  reliability: "99.9",
  mixMode: "share",
  genSizeToFacility: true,
  pvPanelWatt: 550,
  genLand: DEFAULT_GENLAND,
};

// Helpers
function toNumber(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
function acresToSqft(acres: number) {
  return acres * 43560;
}
function galPerHourToGpm(gph: number) {
  return gph / 60;
}
function litersToGallons(l: number) {
  return l / 3.78541;
}

const BTU_PER_SCF = 1037;
const LS_KEY = "dc-feasibility-v4";
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function DataCenterFeasibilityTool() {
  const [inputs, setInputs] = useState(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    return saved ? { ...DEFAULT_INPUTS, ...JSON.parse(saved) } : DEFAULT_INPUTS;
  });

  const MIX_LIBRARY: Record<string, any> = {
    Grid: { tech: "Grid", unitMW: 100, unitAvailability: 0.9995, heatRate: 0, water_gal_per_MWh: 0, isFirm: true, fuel: "None" },
    "Recip (NG)": { tech: "Recip (NG)", unitMW: 18, unitAvailability: 0.985, heatRate: 8924, water_gal_per_MWh: 1, isFirm: true, fuel: "NG" },
    SCGT: { tech: "SCGT", unitMW: 57, unitAvailability: 0.992, heatRate: 10999, water_gal_per_MWh: 0, isFirm: true, fuel: "NG" },
    "CCGT (5000F 1x1)": { tech: "CCGT (5000F 1x1)", unitMW: 373.3, unitAvailability: 0.99, heatRate: 7548, water_gal_per_MWh: 200, isFirm: true, fuel: "NG" },
    "Fuel Cells (SOFC)": { tech: "Fuel Cells (SOFC)", unitMW: 10, unitAvailability: 0.99, heatRate: 6318, water_gal_per_MWh: 0, isFirm: true, fuel: "NG" },
    PV: { tech: "PV", unitMW: 4.03, unitAvailability: 0.0, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
    Wind: { tech: "Wind", unitMW: 5.89, unitAvailability: 0.0, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
    BESS: { tech: "BESS", unitMW: 100, unitAvailability: 0.99, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
  };

  const DEFAULT_ELCC = { PV: 40, Wind: 20, BESS: 100 };

  const [mix, setMix] = useState(() => [
    { id: uid(), tech: "CCGT (5000F 1x1)", units: 1, ...MIX_LIBRARY["CCGT (5000F 1x1)"] },
    { id: uid(), tech: "PV", units: 0, ...MIX_LIBRARY["PV"] },
    { id: uid(), tech: "Wind", units: 0, ...MIX_LIBRARY["Wind"] },
  ]);

  const firmList = ["Grid", "Recip (NG)", "SCGT", "CCGT (5000F 1x1)", "Fuel Cells (SOFC)"];
  const nonFirmList = ["PV", "Wind", "BESS"];
  const [shares, setShares] = useState({ Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0, PV: 0, Wind: 0, BESS: 0 });
  const [elcc, setElcc] = useState({ ...DEFAULT_ELCC });
  const [bessHours, setBessHours] = useState(4);
  const [elccEnabled, setElccEnabled] = useState(true);

  // Derive rack layout preset for the Select so we don't show duplicate labels
  const rackPreset = useMemo(
    () => (inputs.sqftPerRack === 30 ? "30" : inputs.sqftPerRack === 45 ? "45" : inputs.sqftPerRack === 60 ? "60" : "custom"),
    [inputs.sqftPerRack]
  );

  const preset = useMemo(() => {
    const s = inputs.sqftPerRack,
      sup = inputs.supportPct;
    if (Math.abs(s - 30) < 0.5 && Math.abs(sup - 35) < 0.5) return "aggr";
    if (Math.abs(s - 45) < 0.5 && Math.abs(sup - 40) < 0.5) return "typ";
    if (Math.abs(s - 60) < 0.5 && Math.abs(sup - 45) < 0.5) return "cons";
    return "custom";
  }, [inputs.sqftPerRack, inputs.supportPct]);

  useEffect(() => {
    setInputs((s: any) => {
      const phases = Math.max(1, Math.floor(s.phases));
      const arr = s.phaseItMw.slice(0, phases);
      while (arr.length < phases) arr.push((s.mode === "target" ? s.targetItMw : Math.max(0, s.targetItMw)) / phases);
      return { ...s, phases, phaseItMw: arr };
    });
  }, [inputs.phases]);

  useEffect(() => {
    setInputs((s: any) => ({ ...s, wue_L_per_kWh: s.cooling === "Liquid" ? 0.15 : 0.3 }));
  }, [inputs.cooling]);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, JSON.stringify(inputs));
  }, [inputs]);

  const calc = useMemo(() => {
    const buildableFrac = Math.min(1, Math.max(0, inputs.buildablePct / 100));
    const siteCoverage = Math.min(1, Math.max(0, inputs.siteCoveragePct / 100));
    const supportFrac = Math.min(0.95, Math.max(0, inputs.supportPct / 100));
    const mepFrac = Math.min(1, Math.max(0, inputs.mepYardPct / 100));
    const roadsFrac = Math.min(1, Math.max(0, inputs.roadsPct / 100));

    const parcelAcres = Math.max(0, inputs.parcelAcres);
    const buildableAcres = parcelAcres * buildableFrac;
    const buildingFootprintAcres = buildableAcres * siteCoverage;
    const buildingSqft = acresToSqft(buildingFootprintAcres) * Math.max(1, inputs.stories || 1);

    const supportSqft = buildingSqft * supportFrac;
    const whiteSqft = Math.max(0, buildingSqft - supportSqft);

    const sqftPerRack = Math.max(1, inputs.sqftPerRack);
    const racks = Math.floor(whiteSqft / sqftPerRack);
    const rackDensityKw = Math.max(0.1, inputs.rackDensityKw);

    const itKwFromLand = racks * rackDensityKw;
    const itMwFromLand = itKwFromLand / 1000;
    const pue = Math.max(1.0, inputs.pue);

    const mepYardAcres = buildableAcres * mepFrac;
    const roadsAcres = buildableAcres * roadsFrac;
    const allocSum = buildingFootprintAcres + mepYardAcres + roadsAcres + inputs.substationAcres;
    const openAcres = Math.max(0, buildableAcres - allocSum);

    const targetItMw = inputs.mode === "target" ? Math.max(0, inputs.targetItMw) : itMwFromLand;
    const siteMaxItMw = itMwFromLand;

    let phases = Math.max(1, Math.floor(inputs.phases));
    let phaseValues: number[] = [] as any;
    if (inputs.equalizePhases) {
      const total = inputs.mode === "target" ? targetItMw : siteMaxItMw;
      const per = total / phases;
      for (let i = 0; i < phases; i++) phaseValues.push(per);
    } else {
      phaseValues = inputs.phaseItMw.slice(0, phases).map((v: number) => Math.max(0, v));
    }
    const manualSum = phaseValues.reduce((a: number, b: number) => a + b, 0);
    const effectiveTargetItMw = inputs.equalizePhases ? targetItMw : manualSum;

    const it_kW = (inputs.mode === "target" ? effectiveTargetItMw : siteMaxItMw) * 1000;
    const wue_L_per_kWh = Math.max(0, inputs.wue_L_per_kWh);
    const water_L_per_h_dc = wue_L_per_kWh * it_kW;
    const water_gpm_dc = galPerHourToGpm(litersToGallons(water_L_per_h_dc));

    return {
      parcelAcres,
      buildableAcres,
      buildingFootprintAcres,
      buildingSqft,
      supportSqft,
      whiteSqft,
      racks,
      rackDensityKw,
      itMwFromLand,
      mepYardAcres,
      roadsAcres,
      substationAcres: inputs.substationAcres,
      openAcres,
      siteMaxItMw,
      pue,
      effectiveTargetItMw,
      phases,
      phaseValues,
      water_gpm_dc,
      wue_L_per_kWh,
    };
  }, [inputs]);

  function kFromReliability(r: string) {
    return r === "99.9" ? 1 : r === "99.99" ? 2 : 3;
  }

  const manualMixCalc = useMemo(() => {
    if (inputs.mixMode !== "manual") return null;
    const bindingIt = Math.min(calc.effectiveTargetItMw, calc.itMwFromLand);
    const reqMW = inputs.genSizeToFacility ? bindingIt * calc.pue : bindingIt;
    const kLoss = kFromReliability(inputs.reliability);

    const firmRows = mix.filter((r) => r.isFirm && r.units > 0);
    let totalInstalledFirm = 0;
    const unitList: { tech: string; size: number }[] = [] as any;
    firmRows.forEach((r) => {
      const installed = r.units * r.unitMW;
      totalInstalledFirm += installed;
      for (let i = 0; i < Math.floor(r.units); i++) unitList.push({ tech: r.tech, size: r.unitMW });
    });
    const sortedUnits = unitList.slice().sort((a, b) => b.size - a.size);
    const dropList = sortedUnits.slice(0, Math.min(kLoss, sortedUnits.length));
    const worstLoss = dropList.reduce((a, b) => a + b.size, 0);
    const firmAfterLoss = Math.max(0, totalInstalledFirm - worstLoss);

    const rowBy = (t: string) => mix.find((r) => r.tech === t);
    const pvMW = (rowBy("PV")?.units ?? 0) * (rowBy("PV")?.unitMW ?? 0);
    const windMW = (rowBy("Wind")?.units ?? 0) * (rowBy("Wind")?.unitMW ?? 0);
    const bessMW = (rowBy("BESS")?.units ?? 0) * (rowBy("BESS")?.unitMW ?? 0);

    const bessCredit = Math.min(100, Math.max(0, elcc.BESS)) * Math.min(1, Math.max(0, bessHours / 4));
    const accredited = elccEnabled
      ? pvMW * (Math.max(0, elcc.PV) / 100) + windMW * (Math.max(0, elcc.Wind) / 100) + bessMW * (bessCredit / 100)
      : 0;

    const meets = firmAfterLoss + accredited >= reqMW;

    const compFirm = firmRows.map((r) => ({ name: r.tech, installed: r.units * r.unitMW, units: r.units, isFirm: true }));
    const totalFirmInstalled = compFirm.reduce((a, b) => a + b.installed, 0);
    const dispatchTotal = Math.min(reqMW, totalFirmInstalled);
    const compFirmWithDispatch = compFirm.map((row) => ({
      ...row,
      dispatched: totalFirmInstalled > 0 ? (row.installed / totalFirmInstalled) * dispatchTotal : 0,
    }));

    const compNonFirm = [
      { name: "PV (non-firm)", installed: pvMW, dispatched: 0, units: rowBy("PV")?.units ?? 0, isFirm: false },
      { name: "Wind (non-firm)", installed: windMW, dispatched: 0, units: rowBy("Wind")?.units ?? 0, isFirm: false },
      { name: "BESS (non-firm)", installed: bessMW, dispatched: 0, units: rowBy("BESS")?.units ?? 0, isFirm: false },
    ];

    let fuel_MMBtu_per_h = 0,
      gas_MSCF_per_h = 0,
      genWater_gpm = 0;
    compFirmWithDispatch.forEach((row) => {
      const lib = (MIX_LIBRARY as any)[row.name];
      if (lib && lib.fuel !== "None" && lib.heatRate > 0) {
        const mw = (row.installed / Math.max(1, totalFirmInstalled)) * reqMW;
        const mmbtu_h = (mw * 1000 * lib.heatRate) / 1_000_000;
        fuel_MMBtu_per_h += mmbtu_h;
        gas_MSCF_per_h += (mmbtu_h * 1_000_000) / BTU_PER_SCF / 1000;
        genWater_gpm += galPerHourToGpm(lib.water_gal_per_MWh * mw);
      }
    });

    return {
      reqMW,
      kLoss,
      totalInstalledFirm,
      firmAfterLoss,
      accredited,
      meets,
      comp: compFirmWithDispatch.concat(compNonFirm),
      fuel_MMBtu_per_h,
      gas_MSCF_per_h,
      genWater_gpm,
      totalWater_gpm: genWater_gpm + calc.water_gpm_dc,
      pvMW,
      windMW,
      bessMW,
      dropList,
    };
  }, [inputs.mixMode, mix, inputs, calc.effectiveTargetItMw, calc.pue, calc.water_gpm_dc, elcc, bessHours, elccEnabled]);

  const shareCalc = useMemo(() => {
    if (inputs.mixMode !== "share") return null;
    const bindingIt = Math.min(calc.effectiveTargetItMw, calc.itMwFromLand);
    const reqMW = inputs.genSizeToFacility ? bindingIt * calc.pue : bindingIt;
    const kLoss = kFromReliability(inputs.reliability);

    const firmShares = firmList.map((t) => ({ t, pct: Math.max(0, shares[t] || 0) }));
    const sumFirm = firmShares.reduce((a, b) => a + b.pct, 0);

    const units: Record<string, number> = { Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0, PV: 0, Wind: 0, BESS: 0 };

    function evaluate(unitsMap: Record<string, number>) {
      const unitTags: { tech: string; size: number }[] = [] as any;
      let installed = 0;
      firmList.forEach((t) => {
        const n = Math.max(0, Math.floor(unitsMap[t] || 0));
        const size = MIX_LIBRARY[t].unitMW;
        installed += n * size;
        for (let i = 0; i < n; i++) unitTags.push({ tech: t, size });
      });
      const sorted = unitTags.sort((a, b) => b.size - a.size);
      const lostArr = sorted.slice(0, Math.min(kLoss, sorted.length));
      const lost = lostArr.reduce((a, b) => a + b.size, 0);
      const firmAfterLoss = Math.max(0, installed - lost);
      return { installed, firmAfterLoss, dropList: lostArr };
    }

    let firmAfterLoss = 0;
    let dropList: { tech: string; size: number }[] = [] as any;
    if (sumFirm > 0) {
      const normShares = firmShares
        .filter(({ pct }) => pct > 0)
        .map(({ t, pct }) => ({ t, f: pct / sumFirm }));
      normShares.forEach(({ t, f }) => {
        const u = MIX_LIBRARY[t].unitMW;
        const targetMW = f * reqMW;
        units[t] = Math.max(0, Math.ceil(targetMW / Math.max(1e-6, u)));
      });
      let guard = 0;
      const MAX = 500;
      while (guard++ < MAX) {
        const res = evaluate(units);
        if (res.firmAfterLoss >= reqMW) {
          firmAfterLoss = res.firmAfterLoss;
          dropList = res.dropList;
          break;
        }
        let bestT = normShares[0]?.t || "Grid";
        let bestScore = -Infinity;
        normShares.forEach(({ t, f }) => {
          const size = MIX_LIBRARY[t].unitMW;
          const dispatchTarget = f * reqMW;
          const currentDispatched = (units[t] || 0) * size;
          const shortfall = Math.max(0, dispatchTarget - currentDispatched);
          const score = shortfall - 0.1 * size;
          if (score > bestScore) {
            bestScore = score;
            bestT = t;
          }
        });
        units[bestT] = (units[bestT] || 0) + 1;
      }
      if (firmAfterLoss === 0) {
        const res = evaluate(units);
        firmAfterLoss = res.firmAfterLoss;
        dropList = res.dropList;
      }
    } else {
      firmAfterLoss = 0;
    }

    const pvMW = (Math.max(0, shares.PV || 0) / 100) * reqMW;
    const windMW = (Math.max(0, shares.Wind || 0) / 100) * reqMW;
    const bessMW = (Math.max(0, shares.BESS || 0) / 100) * reqMW;

    const pvUnits = Math.ceil(pvMW / MIX_LIBRARY.PV.unitMW);
    const windUnits = Math.ceil(windMW / MIX_LIBRARY.Wind.unitMW);
    const bessUnits = Math.ceil(bessMW / MIX_LIBRARY.BESS.unitMW);

    const bessCredit = Math.min(100, Math.max(0, elcc.BESS)) * Math.min(1, Math.max(0, bessHours / 4));
    const accredited = elccEnabled
      ? pvMW * (Math.max(0, elcc.PV) / 100) + windMW * (Math.max(0, elcc.Wind) / 100) + bessMW * (bessCredit / 100)
      : 0;

    const compFirmRaw = firmList.map((t) => ({ t, mw: (units[t] || 0) * MIX_LIBRARY[t].unitMW })).filter((x) => x.mw > 0);
    const totalFirmInstalled = compFirmRaw.reduce((a, b) => a + b.mw, 0);
    const dispatchTotal = Math.min(reqMW, totalFirmInstalled);
    const compFirm = compFirmRaw.map(({ t, mw }) => ({
      name: t,
      installed: mw,
      dispatched: totalFirmInstalled > 0 ? (mw / totalFirmInstalled) * dispatchTotal : 0,
      units: units[t] || 0,
      isFirm: true,
    }));

    const compNonFirm = [
      { name: "PV (non-firm)", installed: pvMW, dispatched: 0, units: pvUnits, isFirm: false },
      { name: "Wind (non-firm)", installed: windMW, dispatched: 0, units: windUnits, isFirm: false },
      { name: "BESS (non-firm)", installed: bessMW, dispatched: 0, units: bessUnits, isFirm: false },
    ];

    let fuel_MMBtu_per_h = 0,
      gas_MSCF_per_h = 0,
      genWater_gpm = 0;
    const totalFirmForDispatch = compFirm.reduce((a, b) => a + b.installed, 0);
    compFirm.forEach((row) => {
      const lib = (MIX_LIBRARY as any)[row.name] || (MIX_LIBRARY as any)[(row as any).t] || null;
      if (lib && lib.fuel !== "None" && lib.heatRate > 0) {
        const mw = (row.installed / Math.max(1, totalFirmForDispatch)) * reqMW;
        const mmbtu_h = (mw * 1000 * lib.heatRate) / 1_000_000;
        fuel_MMBtu_per_h += mmbtu_h;
        gas_MSCF_per_h += (mmbtu_h * 1_000_000) / BTU_PER_SCF / 1000;
        genWater_gpm += galPerHourToGpm(lib.water_gal_per_MWh * mw);
      }
    });

    const meets = firmAfterLoss + accredited >= reqMW;

    return {
      reqMW,
      kLoss,
      units,
      comp: compFirm.concat(compNonFirm),
      fuel_MMBtu_per_h,
      gas_MSCF_per_h,
      genWater_gpm,
      pvMW,
      windMW,
      bessMW,
      pvUnits,
      windUnits,
      accredited,
      totalWater_gpm: genWater_gpm + calc.water_gpm_dc,
      firmAfterLoss,
      meets,
      sumFirm,
      dropList,
    };
  }, [inputs.mixMode, shares, inputs.reliability, inputs.genSizeToFacility, calc.effectiveTargetItMw, calc.pue, calc.water_gpm_dc, elcc, bessHours, elccEnabled]);

  const activeCalc = inputs.mixMode === "share" ? shareCalc : manualMixCalc;

  const genFootprint = useMemo(() => {
    const comp = activeCalc?.comp || [];
    const rows: { name: string; acres: number; installed: number; units: number }[] = [] as any;
    let total = 0;
    function baseName(n: string) {
      return String(n || "").replace(/ \(non-firm\)/g, "");
    }
    comp.forEach((d: any) => {
      const name = baseName(d.name);
      const cfg: any = (inputs.genLand || {})[name] || {};
      let acres = 0;
      if (typeof cfg.per_unit_acres === "number") {
        acres = (d.units || 0) * cfg.per_unit_acres;
      } else if (typeof cfg.per_MW_hr === "number") {
        const slope = cfg.per_MW_hr;
        if ((d.installed || 0) > 0) {
          acres = (d.installed || 0) * slope * Math.max(1, bessHours) + (cfg.site_overhead_acres || 0);
        }
      } else if (typeof cfg.per_MW_acres === "number") {
        acres = (d.installed || 0) * cfg.per_MW_acres;
      }
      if (acres > 0.0001) {
        rows.push({ name, acres, installed: d.installed || 0, units: d.units || 0 });
        total += acres;
      }
    });
    return { rows, total };
  }, [activeCalc, inputs.genLand, bessHours]);

  const landPieData = useMemo(() => {
    const data = [
      { name: "Building", value: calc.buildingFootprintAcres },
      { name: "MEP Yard", value: calc.mepYardAcres },
      { name: "Substation", value: calc.substationAcres },
      { name: "Roads/Parking", value: calc.roadsAcres },
      { name: "Generation (power)", value: genFootprint?.total || 0 },
      { name: "Open/Other", value: Math.max(0, calc.openAcres - (genFootprint?.total || 0)) },
    ];
    return data.filter((d) => d.value > 0.0001);
  }, [calc.buildingFootprintAcres, calc.mepYardAcres, calc.substationAcres, calc.roadsAcres, calc.openAcres, genFootprint?.total]);

  function addRow() {
    setMix((m: any[]) => [...m, { id: uid(), tech: "SCGT", units: 1, ...MIX_LIBRARY["SCGT"] }]);
  }
  function removeRow(id: string) {
    setMix((m: any[]) => m.filter((r) => r.id !== id));
  }
  function updateRow(id: string, patch: any) {
    setMix((m: any[]) => m.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function onChangeTech(id: string, tech: string) {
    const lib = MIX_LIBRARY[tech];
    updateRow(id, {
      tech,
      unitMW: lib.unitMW,
      unitAvailability: lib.unitAvailability,
      heatRate: lib.heatRate,
      water_gal_per_MWh: lib.water_gal_per_MWh,
      isFirm: lib.isFirm,
      fuel: lib.fuel,
    });
  }

  function resetAll() {
    if (typeof window !== "undefined") window.localStorage.removeItem(LS_KEY);
    setInputs({ ...DEFAULT_INPUTS });
    setShares({ Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0, PV: 0, Wind: 0, BESS: 0 });
    setElcc({ ...DEFAULT_ELCC });
    setBessHours(4);
    setElccEnabled(true);
    setMix([
      { id: uid(), tech: "CCGT (5000F 1x1)", units: 1, ...MIX_LIBRARY["CCGT (5000F 1x1)"] },
      { id: uid(), tech: "PV", units: 0, ...MIX_LIBRARY["PV"] },
      { id: uid(), tech: "Wind", units: 0, ...MIX_LIBRARY["Wind"] },
    ]);
  }

  const sumFirmShares = useMemo(() => firmList.reduce((a, t) => a + Math.max(0, shares[t] || 0), 0), [shares]);

  const mixPieData = useMemo(() => {
    const comp = activeCalc?.comp || [];
    return comp.filter((d: any) => (d.installed || 0) > 0).map((d: any) => ({ name: d.name, value: d.installed }));
  }, [activeCalc]);

  const phaseSeries = useMemo(() => calc.phaseValues.map((v: number, i: number) => ({ name: `P${i + 1}`, it: v })), [calc.phaseValues]);

  return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
      <style>{`[role="tabpanel"][data-state="inactive"]{display:none !important;}`}</style>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Data Center Feasibility Tool</h1>
          <p className="text-gray-600 mt-1">Shadcn UI + Recharts + Lucide. Restored imports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetAll}>
            Reset to defaults
          </Button>
          <Settings2 className="h-5 w-5 text-gray-500" />
        </div>
      </div>

      <Tabs defaultValue="results" className="w-full">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="powermix">Power & Mix</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="mapping">Mapping</TabsTrigger>
          <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
        </TabsList>

        {/* Assumptions */}
        <TabsContent forceMount value="assumptions">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Generation Footprint Assumptions (ac)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {["Recip (NG)", "SCGT", "CCGT (5000F 1x1)", "Fuel Cells (SOFC)"].map((k) => (
                  <div key={k}>
                    <Label className="text-sm">{k} — acres / unit</Label>
                    <Input
                      type="number"
                      step={0.1}
                      value={(inputs.genLand as any)[k].per_unit_acres}
                      onChange={(e) =>
                        setInputs((s: any) => ({
                          ...s,
                          genLand: { ...s.genLand, [k]: { ...s.genLand[k], per_unit_acres: parseFloat(e.target.value || "0") } },
                        }))
                      }
                    />
                  </div>
                ))}
                <div>
                  <Label className="text-sm">PV — acres / MW</Label>
                  <Input
                    type="number"
                    step={0.1}
                    value={inputs.genLand.PV.per_MW_acres}
                    onChange={(e) => setInputs((s: any) => ({ ...s, genLand: { ...s.genLand, PV: { ...s.genLand.PV, per_MW_acres: parseFloat(e.target.value || "0") } } }))}
                  />
                </div>
                <div>
                  <Label className="text-sm">Wind — acres / MW (spacing)</Label>
                  <Input
                    type="number"
                    step={0.1}
                    value={inputs.genLand.Wind.per_MW_acres}
                    onChange={(e) => setInputs((s: any) => ({ ...s, genLand: { ...s.genLand, Wind: { ...s.genLand.Wind, per_MW_acres: parseFloat(e.target.value || "0") } } }))}
                  />
                </div>
                <div>
                  <Label className="text-sm">BESS — ac/MW per hour</Label>
                  <Input
                    type="number"
                    step={0.001}
                    value={inputs.genLand.BESS.per_MW_hr ?? 0}
                    onChange={(e) => setInputs((s: any) => ({ ...s, genLand: { ...s.genLand, BESS: { ...s.genLand.BESS, per_MW_hr: parseFloat(e.target.value || "0") } } }))}
                  />
                </div>
                <div>
                  <Label className="text-sm">BESS site overhead (ac)</Label>
                  <Input
                    type="number"
                    step={0.1}
                    value={inputs.genLand.BESS.site_overhead_acres ?? 0}
                    onChange={(e) => setInputs((s: any) => ({ ...s, genLand: { ...s.genLand, BESS: { ...s.genLand.BESS, site_overhead_acres: parseFloat(e.target.value || "0") } } }))}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">Screening values; PV/Wind reflect project spacing. BESS footprint scales with duration.</p>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Design & Land-Use Assumptions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>
                  <strong>Parcel & land:</strong> Inputs include Parcel (ac), Buildable %, Site Coverage %, MEP Yard %, Roads/Parking %, and fixed Substation acres.
                </li>
                <li>
                  <strong>Stories:</strong> Stacked floors multiply total building ft² (and white space) without increasing footprint.
                </li>
                <li>
                  <strong>White space:</strong> Building ft² × (1 − Support %) ⇒ White space; Racks = White space ÷ ft²/rack.
                </li>
                <li>
                  <strong>IT MW from land:</strong> Racks × (kW/rack) ÷ 1000.
                </li>
                <li>
                  <strong>Phasing:</strong> Equalized across phases by default; or enter per‑phase IT MW manually.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Cooling, PUE & WUE</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>
                  <strong>PUE:</strong> User‑set; typical ranges: ~1.25–1.5 (air); ~1.10–1.35 (liquid).
                </li>
                <li>
                  <strong>WUE default:</strong> Air ≈ 0.30 L/kWh; Liquid ≈ 0.15 L/kWh (override in Inputs).
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Representative Power Blocks (screening)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>
                  <strong>Grid:</strong> 100 MW (availability 99.95%).
                </li>
                <li>
                  <strong>Recip (NG):</strong> 18 MW; ~8,924 Btu/kWh; ~1 gal/MWh water.
                </li>
                <li>
                  <strong>SCGT:</strong> 57 MW; ~10,999 Btu/kWh; zero process water assumed.
                </li>
                <li>
                  <strong>CCGT (5000F 1x1):</strong> 373.3 MW; ~7,548 Btu/kWh; ~200 gal/MWh water (wet cooling).
                </li>
                <li>
                  <strong>Fuel Cells (SOFC):</strong> 10 MW; ~6,318 Btu/kWh; negligible water.
                </li>
                <li>
                  <strong>PV:</strong> 4.03 MW block; <em>non‑firm</em>.
                </li>
                <li>
                  <strong>Wind:</strong> 5.89 MW; <em>non‑firm</em>.
                </li>
                <li>
                  <strong>BESS:</strong> 100 MW power; duration set separately; <em>non‑firm</em> but can be accredited via ELCC.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Reliability & Accreditation</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>
                  <strong>Target sizing:</strong> Choose IT MW or Facility MW (IT×PUE).
                </li>
                <li>
                  <strong>Reliability check:</strong> N+k by dropping largest k firm units (k = 1/2/3 for 99.9/99.99/99.999%).
                </li>
                <li>
                  <strong>ELCC toggle:</strong> Accredited MW = PV×ELCC% + Wind×ELCC% + BESS×(ELCC%×duration/4h).
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Acre → IT MW Heuristics</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-6 space-y-1 text-sm">
                <li>Single‑story 35–45 ft²/rack @ ~10 kW/rack → ~0.6–1.2 MW IT per ac buildable (before roads/MEP/substation set‑asides).</li>
                <li>Higher density or smaller ft²/rack increases IT/acre; stacking floors scales linearly with stories.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inputs */}
        <TabsContent forceMount value="inputs">{InputsSection({ inputs, setInputs, preset })}</TabsContent>

        {/* Power & Mix */}
        <TabsContent forceMount value="powermix" className="space-y-6">
          {PowerMixSection()}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" /> Reliability Event (N+{kFromReliability(inputs.reliability)} drop)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div>Dropped units (largest {kFromReliability(inputs.reliability)}):</div>
              <ul className="list-disc ml-6">
                {(activeCalc?.dropList || []).map((d: any, i: number) => (
                  <li key={i}>
                    {d.tech || "largest"} — {Number(d.size || 0).toFixed(1)} MW
                  </li>
                ))}
                {(activeCalc?.dropList || []).length === 0 && <li>—</li>}
              </ul>
              <div className="grid md:grid-cols-4 gap-3 mt-2">
                <Metric label="Remaining firm after event" value={`${(activeCalc?.firmAfterLoss || 0).toFixed(1)} MW`} />
                <Metric
                  label="Installed firm (total)"
                  value={`${(
                    ((activeCalc?.comp || []).filter((r: any) => r.isFirm).reduce((a: number, b: any) => a + (b.installed || 0), 0) as number) || 0
                  ).toFixed(1)} MW`}
                />
                <Metric label="Accredited non-firm (ELCC)" value={`${(activeCalc?.accredited || 0).toFixed(1)} MW`} />
                <Metric label="Status" value={activeCalc?.meets ? "Meets target" : "Does not meet target"} status={activeCalc?.meets} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Results */}
        <TabsContent forceMount value="results" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>IT Capacity</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const targetIt = calc.effectiveTargetItMw;
                  const siteIt = calc.itMwFromLand;
                  const bindingIt = inputs.mode === "target" ? Math.min(targetIt, siteIt) : siteIt;
                  return (
                    <>
                      <div className="text-4xl font-semibold">
                        {bindingIt.toFixed(2)} <span className="text-2xl font-normal">MW</span>
                      </div>
                      {inputs.mode === "target" ? (
                        <>
                          {siteIt + 1e-6 < targetIt ? (
                            <div className="text-xs text-amber-700 mt-2">Land-limited: target {targetIt.toFixed(2)} MW → site supports {siteIt.toFixed(2)} MW.</div>
                          ) : (
                            <div className="text-sm text-green-700 mt-2">Target input</div>
                          )}
                          <div className="text-xs text-gray-500">Site max from land: {siteIt.toFixed(2)} MW</div>
                        </>
                      ) : (
                        <div className="text-sm text-green-700 mt-2">Computed from land</div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Facility Power</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const targetIt = calc.effectiveTargetItMw;
                  const siteIt = calc.itMwFromLand;
                  const bindingIt = inputs.mode === "target" ? Math.min(targetIt, siteIt) : siteIt;
                  const facBinding = bindingIt * calc.pue;
                  const facTarget = targetIt * calc.pue;
                  return (
                    <>
                      <div className="text-4xl font-semibold">
                        {facBinding.toFixed(2)} <span className="text-2xl font-normal">MW</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-2">PUE: {calc.pue.toFixed(2)} · IT share ≈ {(100 / calc.pue).toFixed(1)}%</div>
                      {inputs.mode === "target" && targetIt > siteIt && (
                        <div className="text-xs text-amber-700 mt-1">Land-limited: target {facTarget.toFixed(0)} MW → site supports {facBinding.toFixed(0)} MW.</div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieIcon className="h-5 w-5" /> Land Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-3 gap-4 items-center">
                <div className="md:col-span-2" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={landPieData} dataKey="value" nameKey="name" outerRadius={120} label={false} labelLine={false} paddingAngle={1}>
                        {landPieData.map((_, i) => (
                          <Cell key={`c-${i}`} fill={LAND_COLORS[i % LAND_COLORS.length]} />
                        ))}
                      </Pie>
                      <ReTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-sm space-y-1">
                  {landPieData.map((d) => (
                    <div key={d.name} className="flex justify-between">
                      <span>{d.name}</span>
                      <span>{d.value.toFixed(2)} ac</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold pt-2 border-t">
                    <span>Total Buildable</span>
                    <span>{calc.buildableAcres.toFixed(2)} ac</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Installed Mix (All Techs)</CardTitle>
              </CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mixPieData} dataKey="value" nameKey="name" outerRadius={110} label>
                      {mixPieData.map((_, i) => (
                        <Cell key={`m-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend formatter={(value, entry: any) => `${value} (${Number(entry?.payload?.value || 0).toFixed(0)} MW)`} />
                    <ReTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Phasing (IT MW)</CardTitle>
            </CardHeader>
            <CardContent style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={phaseSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis label={{ value: "MW", angle: -90, position: "insideLeft" }} />
                  <ReTooltip />
                  <Bar dataKey="it" name="IT MW" fill={BRAND.ORANGE} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sized Units to Meet Reliability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-5 gap-4 mb-3">
                <Metric label="Required Capacity" value={`${(activeCalc?.reqMW || 0).toFixed(1)} MW (Facility)`} />
                <Metric
                  label={`Firm after N+${kFromReliability(inputs.reliability)} loss (thermal/grid)`}
                  value={`${(activeCalc?.firmAfterLoss || 0).toFixed(1)} MW`}
                />
                <Metric label="Accredited non-firm (ELCC)" value={`${(activeCalc?.accredited || 0).toFixed(1)} MW`} />
                {(() => {
                  const v = (activeCalc?.comp || []).filter((r: any) => r.isFirm).reduce((a: number, b: any) => a + (b.installed || 0), 0);
                  return <Metric label="Installed firm (total)" value={`${v.toFixed(1)} MW`} />;
                })()}
                <Metric label="Status" value={activeCalc?.meets ? "Meets target" : "Does not meet target"} status={activeCalc?.meets} />
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 px-2">Technology</th>
                    <th className="py-2 px-2">Unit MW</th>
                    <th className="py-2 px-2">Units (sized)</th>
                    <th className="py-2 px-2">Installed MW / Dispatched MW</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeCalc?.comp || []).map((row: any, i: number) => (
                    <tr key={i} className={`${row.isFirm ? "" : "bg-amber-50"} border-b`}>
                      <td className="py-2 px-2">
                        {row.name}{" "}
                        {!row.isFirm && <span className="ml-2 text-xs inline-flex px-2 py-0.5 rounded bg-amber-100 text-amber-800">non-firm</span>}
                      </td>
                      <td className="py-2 px-2">
                        {(MIX_LIBRARY as any)[row.name]?.unitMW ?? (MIX_LIBRARY as any)[row.t]?.unitMW ?? row.installed / Math.max(1, row.units || 1)}
                      </td>
                      <td className="py-2 px-2">{row.units ?? 0}</td>
                      <td className="py-2 px-2">
                        {(row.installed || 0).toFixed(1)} / {(row.dispatched || 0).toFixed(1)} MW
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-2">Non-firm add-ons sized from sliders or manual rows. Accreditation contributes to the reliability check; dispatch not modeled for non-firm.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapping */}
        <TabsContent forceMount value="mapping">
          <MappingTab />
        </TabsContent>
      </Tabs>
    </div>
  );

  function Metric({ label, value, status }: { label: string; value: string; status?: boolean }) {
    return (
      <div className="p-3 rounded-xl border">
        <div className="text-xs text-gray-500">{label}</div>
        <div className={`${status === true ? "text-green-700" : status === false ? "text-red-700" : ""} text-base font-medium`}>{value}</div>
      </div>
    );
  }

  function InputsSection({ inputs, setInputs, preset }: any) {
    return (
      <div className="space-y-6">
        <div className="grid lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" /> Mode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="mode">Target IT vs. Max From Land</Label>
                <Switch id="mode" checked={inputs.mode === "target"} onCheckedChange={(c) => setInputs((s: any) => ({ ...s, mode: c ? "target" : "land" }))} />
              </div>
              {inputs.mode === "target" ? (
                <div className="grid gap-2">
                  <NumberField id="targetItMw" label="Target IT Load" value={inputs.targetItMw} onChange={(n: number) => setInputs((s: any) => ({ ...s, targetItMw: n }))} suffix="MW" step={0.1} min={0} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant={preset === "aggr" ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, sqftPerRack: 30, supportPct: 35 }))}>
                      Aggressive (30 ft²/rack)
                    </Button>
                    <Button variant={preset === "typ" ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, sqftPerRack: 45, supportPct: 40 }))}>
                      Typical (45 ft²/rack)
                    </Button>
                    <Button variant={preset === "cons" ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, sqftPerRack: 60, supportPct: 45 }))}>
                      Conservative (60 ft²/rack)
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">Max IT will be computed from land, building, and rack inputs below.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parcel & Land</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <NumberField id="parcelAcres" label="Parcel" value={inputs.parcelAcres} onChange={(n: number) => setInputs((s: any) => ({ ...s, parcelAcres: n }))} suffix="ac" step={1} min={0} />
              <PercentField id="buildablePct" label="Buildable" value={inputs.buildablePct} onChange={(n: number) => setInputs((s: any) => ({ ...s, buildablePct: n }))} />
              <PercentField id="siteCoveragePct" label="Site Coverage" value={inputs.siteCoveragePct} onChange={(n: number) => setInputs((s: any) => ({ ...s, siteCoveragePct: n }))} />
              <NumberField id="stories" label="Stories (stacked)" value={inputs.stories} onChange={(n: number) => setInputs((s: any) => ({ ...s, stories: Math.max(1, Math.floor(n || 1)) }))} step={1} min={1} />
              <PercentField id="mepYardPct" label="MEP Yard % (of buildable)" value={inputs.mepYardPct} onChange={(n: number) => setInputs((s: any) => ({ ...s, mepYardPct: n }))} />
              <PercentField id="roadsPct" label="Roads/Parking %" value={inputs.roadsPct} onChange={(n: number) => setInputs((s: any) => ({ ...s, roadsPct: n }))} />
              <NumberField id="substationAcres" label="Substation" value={inputs.substationAcres} onChange={(n: number) => setInputs((s: any) => ({ ...s, substationAcres: n }))} suffix="ac" step={0.1} min={0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>White Space, Racks & Cooling</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-sm">Rack layout (ft² per rack)</Label>
                <Select
                  value={rackPreset}
                  onValueChange={(v: any) =>
                    setInputs((s: any) => ({
                      ...s,
                      sqftPerRack: v === "30" ? 30 : v === "45" ? 45 : v === "60" ? 60 : s.sqftPerRack,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose layout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Dense (30)</SelectItem>
                    <SelectItem value="45">Typical (45)</SelectItem>
                    <SelectItem value="60">Spacious (60)</SelectItem>
                    {rackPreset === "custom" && <SelectItem value="custom">Custom ({inputs.sqftPerRack})</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <NumberField id="sqftPerRack" label="ft² per rack (override)" value={inputs.sqftPerRack} onChange={(n: number) => setInputs((s: any) => ({ ...s, sqftPerRack: n }))} step={1} min={10} />
              <NumberField id="rackDensityKw" label="kW per rack" value={inputs.rackDensityKw} onChange={(n: number) => setInputs((s: any) => ({ ...s, rackDensityKw: n }))} step={0.5} min={1} />
              <PercentField id="supportPct" label="Support % of building ft²" value={inputs.supportPct} onChange={(n: number) => setInputs((s: any) => ({ ...s, supportPct: n }))} />

              <div className="col-span-2">
                <Label>Cooling</Label>
                <Select value={inputs.cooling} onValueChange={(v: any) => setInputs((s: any) => ({ ...s, cooling: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Cooling" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Air">Air</SelectItem>
                    <SelectItem value="Liquid">Liquid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <NumberField id="pue" label="PUE" value={inputs.pue} onChange={(n: number) => setInputs((s: any) => ({ ...s, pue: Math.max(1.0, n) }))} step={0.01} min={1} />
              <NumberField id="wue" label="WUE (L/kWh)" value={inputs.wue_L_per_kWh} onChange={(n: number) => setInputs((s: any) => ({ ...s, wue_L_per_kWh: Math.max(0, n) }))} step={0.01} min={0} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Phasing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-3">
              <Label className="w-40">Equalize phases</Label>
              <Switch checked={inputs.equalizePhases} onCheckedChange={(c: any) => setInputs((s: any) => ({ ...s, equalizePhases: c }))} />
              <div className="flex items-center gap-2 ml-6">
                <Label>Phases</Label>
                <Input className="w-24" type="number" value={inputs.phases} min={1} step={1} onChange={(e) => setInputs((s: any) => ({ ...s, phases: Math.max(1, parseInt(e.target.value || "1", 10)) }))} />
              </div>
            </div>
            {!inputs.equalizePhases && (
              <div className="grid md:grid-cols-3 gap-3">
                {Array.from({ length: inputs.phases }).map((_, i) => (
                  <NumberField
                    key={i}
                    id={`phase-${i}`}
                    label={`Phase ${i + 1} IT`}
                    value={inputs.phaseItMw[i] || 0}
                    onChange={(n: number) =>
                      setInputs((s: any) => {
                        const arr = s.phaseItMw.slice();
                        arr[i] = Math.max(0, n);
                        return { ...s, phaseItMw: arr };
                      })
                    }
                    suffix="MW"
                    step={0.1}
                    min={0}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  function PowerMixSection() {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" /> Generation Strategy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant={inputs.mixMode === "share" ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, mixMode: "share" }))}>
              Share sliders
            </Button>
            <Button variant={inputs.mixMode === "manual" ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, mixMode: "manual" }))}>
              Manual units
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Label>Size to Facility (IT×PUE)</Label>
              <Switch checked={inputs.genSizeToFacility} onCheckedChange={(c: any) => setInputs((s: any) => ({ ...s, genSizeToFacility: c }))} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label>Reliability</Label>
            {["99.9", "99.99", "99.999"].map((r) => (
              <Button key={r} variant={inputs.reliability === r ? "default" : "outline"} onClick={() => setInputs((s: any) => ({ ...s, reliability: r }))}>
                {r}%
              </Button>
            ))}
            <div className="flex items-center gap-2 ml-4">
              <Label>ELCC enabled</Label>
              <Switch checked={elccEnabled} onCheckedChange={setElccEnabled} />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Mix Inputs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {inputs.mixMode === "share" ? (
                  <div className="space-y-4">
                    <div>
                      <Label className="font-semibold">Firm shares (% of required MW)</Label>
                      <div className="grid md:grid-cols-2 gap-3 mt-2">
                        {firmList.map((t, i) => (
                          <SliderRow key={t} label={t} value={(shares as any)[t]} onChange={(v: number) => setShares((s: any) => ({ ...s, [t]: v }))} color={MIX_COLORS[i % MIX_COLORS.length]} />
                        ))}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        Sum of firm shares: <strong>{sumFirmShares.toFixed(0)}%</strong> (optimizer adds units until reliability target is met).
                      </div>
                    </div>
                    <div>
                      <Label className="font-semibold">Non-firm nameplate (% of required MW)</Label>
                      <div className="grid md:grid-cols-3 gap-3 mt-2">
                        {nonFirmList.map((t, i) => (
                          <SliderRow
                            key={t}
                            label={t}
                            value={(shares as any)[t]}
                            onChange={(v: number) => setShares((s: any) => ({ ...s, [t]: v }))}
                            color={MIX_COLORS[(i + 4) % MIX_COLORS.length]}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="grid md:grid-cols-4 gap-3">
                      <SliderRow label="PV ELCC %" value={elcc.PV} onChange={(v: number) => setElcc((e: any) => ({ ...e, PV: v }))} min={0} max={100} step={1} />
                      <SliderRow label="Wind ELCC %" value={elcc.Wind} onChange={(v: number) => setElcc((e: any) => ({ ...e, Wind: v }))} min={0} max={100} step={1} />
                      <SliderRow label="BESS ELCC %" value={elcc.BESS} onChange={(v: number) => setElcc((e: any) => ({ ...e, BESS: v }))} min={0} max={100} step={1} />
                      <SliderRow label="BESS Duration (h)" value={bessHours} onChange={setBessHours} min={1} max={12} step={1} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mix.map((row: any) => (
                      <div key={row.id} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-5">
                          <Label>Technology</Label>
                          <Select value={row.tech} onValueChange={(v: any) => onChangeTech(row.id, v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Technology" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.keys(MIX_LIBRARY).map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          <NumberField id={`u-${row.id}`} label="Units" value={row.units} onChange={(n: number) => updateRow(row.id, { units: Math.max(0, Math.floor(n)) })} step={1} min={0} />
                        </div>
                        <div className="col-span-3">
                          <div className="text-xs text-gray-500">Nameplate</div>
                          <div className="text-sm font-medium">{(row.units * row.unitMW).toFixed(1)} MW</div>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button variant="ghost" onClick={() => removeRow(row.id)}>
                            ✕
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addRow}>
                      Add row
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reliability Check</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <MiniReliabilitySummary calc={activeCalc} elccEnabled={elccEnabled} />
                {(activeCalc?.dropList || []).length > 0 && <div className="text-xs text-gray-500">Worst-case outage drops {(activeCalc?.dropList || []).length} largest firm unit(s).</div>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Installed vs Dispatched</CardTitle>
            </CardHeader>
            <CardContent style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeCalc?.comp || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" label={{ value: "Technology", position: "insideBottom", offset: -5 }} />
                  <YAxis />
                  <ReTooltip />
                  <Legend />
                  <Bar dataKey="installed" name="Installed MW">
                    {(activeCalc?.comp || []).map((_: any, i: number) => (
                      <Cell key={`i-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />
                    ))}
                  </Bar>
                  <Bar dataKey="dispatched" name="Dispatched MW">
                    {(activeCalc?.comp || []).map((_: any, i: number) => (
                      <Cell key={`d-${i}`} fill={i % 2 ? BRAND.MIDNIGHT : BRAND.TEAL} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    );
  }

  function MappingTab() {
    // Mapping is downstream-only: Inputs/Results feed Mapping, but Mapping edits do not write back.

    const mapRef = useRef<any>(null);
    const drawRef = useRef<any>(null);
    const drawAddedRef = useRef<boolean>(false);
    const mapLoadedRef = useRef<boolean>(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [lat, setLat] = useState(39.7392); // default Denver
    const [lon, setLon] = useState(-104.9903);
    const [zoom, setZoom] = useState(12);
    const [query, setQuery] = useState("");

    const [layout, setLayout] = useState<any>({ type: "FeatureCollection", features: [] });

    const [editEnabled, setEditEnabled] = useState(true);
    const [showReliability, setShowReliability] = useState(true);
    const [kDrop, setKDrop] = useState<number>(1);

    const [statusMsg, setStatusMsg] = useState<string>("");
    const [fitIssues, setFitIssues] = useState<string[]>([]);

    const NET_LS = "dcft_mapping_network_tools_v1";
    const BASEMAP_LS = "dcft_mapping_basemap_v1";

    const [networkTools, setNetworkTools] = useState(() => {
      try {
        return window.localStorage.getItem(NET_LS) === "1";
      } catch {
        return false;
      }
    });

    const [basemapId, setBasemapId] = useState(() => {
      try {
        return window.localStorage.getItem(BASEMAP_LS) || "off";
      } catch {
        return "off";
      }
    });

    const [mapReady, setMapReady] = useState(false);
    const [styleEpoch, setStyleEpoch] = useState(0);
    const lastBasemapRef = useRef<string>("off");

    useEffect(() => {
      try {
        window.localStorage.setItem(NET_LS, networkTools ? "1" : "0");
      } catch {
        // ignore
      }
    }, [networkTools]);

    useEffect(() => {
      try {
        window.localStorage.setItem(BASEMAP_LS, basemapId);
      } catch {
        // ignore
      }
    }, [basemapId]);

    // Keep latest values available to map event handlers (registered once)
    const stateRef = useRef<any>({ layout, showReliability, kDrop, editEnabled });
    useEffect(() => {
      stateRef.current = { layout, showReliability, kDrop, editEnabled };
    }, [layout, showReliability, kDrop, editEnabled]);

    // Scenario key for save/restore (inputs + mix state)
    const scenarioKey = useMemo(() => {
      const sig = JSON.stringify({ inputs, mix, shares, elccEnabled, bessHours });
      let h = 0;
      for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
      return `dcft_mapping_layout_v1_${h.toString(16)}`;
    }, [inputs, mix, shares, elccEnabled, bessHours]);

    const OFFLINE_STYLE: any = useMemo(
      () => ({
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#F6F7FB" } }],
      }),
      []
    );

    // Basemap styles (no API keys). Note: Public tile endpoints may have usage limits; for production, a dedicated tile provider is recommended.
    const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

    const OSM_STREETS_STYLE: any = useMemo(
      () => ({
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "basemap-osm", type: "raster", source: "osm" }],
      }),
      []
    );

    const LIGHT_GRAY_STYLE: any = useMemo(
      () => ({
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
          carto: {
            type: "raster",
            tiles: ["https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
          },
        },
        layers: [{ id: "basemap-carto-light", type: "raster", source: "carto" }],
      }),
      []
    );

    const AERIAL_STYLE: any = useMemo(
      () => ({
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
          esri: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          },
          cartoLabels: {
            type: "raster",
            tiles: ["https://basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
          },
        },
        layers: [
          { id: "basemap-esri", type: "raster", source: "esri" },
          { id: "basemap-labels", type: "raster", source: "cartoLabels" },
        ],
      }),
      []
    );

    function toast(msg: string) {
      setStatusMsg(msg);
      window.clearTimeout((toast as any)._t);
      (toast as any)._t = window.setTimeout(() => setStatusMsg(""), 2500);
    }

    function acresFromFeature(f: any) {
      try {
        return (turf.area(f) || 0) / SQM_PER_ACRE;
      } catch {
        return 0;
      }
    }

    function dest(pt: [number, number], meters: number, bearing: number): [number, number] {
      const g = turf.destination(pt, meters, bearing, { units: "meters" }).geometry as any;
      return (g?.coordinates || pt) as [number, number];
    }

    function rectFromCenter(center: [number, number], wM: number, hM: number) {
      const halfW = wM / 2;
      const halfH = hM / 2;
      const north = dest(center, halfH, 0);
      const south = dest(center, halfH, 180);
      const nw = dest(north, halfW, 270);
      const ne = dest(north, halfW, 90);
      const se = dest(south, halfW, 90);
      const sw = dest(south, halfW, 270);
      return turf.polygon([[nw, ne, se, sw, nw]]);
    }

    function dimsMetersFromFeature(f: any) {
      const [minX, minY, maxX, maxY] = turf.bbox(f);
      const midLat = (minY + maxY) / 2;
      const midLon = (minX + maxX) / 2;
      const wM = turf.distance([minX, midLat], [maxX, midLat], { units: "meters" });
      const hM = turf.distance([midLon, minY], [midLon, maxY], { units: "meters" });
      return { wM: Math.max(5, wM), hM: Math.max(5, hM) };
    }

    function hasDrawSources(map: any) {
      try {
        return !!map.getSource("mapbox-gl-draw-cold") || !!map.getSource("mapbox-gl-draw-hot");
      } catch {
        return false;
      }
    }

    function safeAddDrawControl(map: any) {
      const draw = drawRef.current;
      if (!draw) return;

      // If MapboxDraw has already injected its sources, treat draw as "already active" even if our flag was lost.
      if (hasDrawSources(map)) {
        drawAddedRef.current = true;
        return;
      }

      if (drawAddedRef.current) return;

      try {
        map.addControl(draw, "top-left");
        drawAddedRef.current = true;
      } catch (e: any) {
        // Protect against double-adds; MapboxDraw will throw if its sources already exist.
        const msg = String(e?.message || "");
        if (msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("mapbox-gl-draw")) {
          drawAddedRef.current = true;
          return;
        }
        // Unexpected: surface for debugging
        // eslint-disable-next-line no-console
        console.error("Failed to add draw control", e);
      }
    }

    function safeRemoveDrawControl(map: any) {
      const draw = drawRef.current;
      if (!draw) return;
      if (!drawAddedRef.current) return;
      try {
        map.removeControl(draw);
      } catch {
        // ignore
      } finally {
        drawAddedRef.current = false;
      }
    }

    function ensureMapLayers(map: any) {
      // Source
      if (!map.getSource("layout")) {
        map.addSource("layout", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }

      const has = (id: string) => !!map.getLayer(id);

      // Parcel
      if (!has("parcel-fill")) {
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "layout",
          filter: ["==", ["get", "role"], "parcel"],
          paint: { "fill-color": BRAND.SLATE, "fill-opacity": 0.06 },
        });
      }
      if (!has("parcel-outline")) {
        map.addLayer({
          id: "parcel-outline",
          type: "line",
          source: "layout",
          filter: ["==", ["get", "role"], "parcel"],
          paint: { "line-color": BRAND.SLATE, "line-width": 2, "line-dasharray": [2, 2] },
        });
      }

      // Blocks fill
      if (!has("blocks-fill")) {
        map.addLayer({
          id: "blocks-fill",
          type: "fill",
          source: "layout",
          filter: ["!=", ["get", "role"], "parcel"],
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#94A3B8"],
            "fill-opacity": ["case", ["==", ["get", "nonFirm"], true], 0.16, 0.22],
          },
        });
      }

      // Blocks outline
      if (!has("blocks-outline")) {
        map.addLayer({
          id: "blocks-outline",
          type: "line",
          source: "layout",
          filter: ["!=", ["get", "role"], "parcel"],
          paint: { "line-color": "#0F172A", "line-width": 1 },
        });
      }

      // Fit issues outline
      if (!has("fit-outline")) {
        map.addLayer({
          id: "fit-outline",
          type: "line",
          source: "layout",
          filter: ["==", ["get", "fit"], false],
          paint: { "line-color": "#EF4444", "line-width": 3 },
        });
      }

      // Dropped units outline
      if (!has("drop-outline")) {
        map.addLayer({
          id: "drop-outline",
          type: "line",
          source: "layout",
          filter: ["==", ["get", "dropped"], true],
          paint: { "line-color": BRAND.YELLOW_ORANGE, "line-width": 4 },
        });
      }

      // Labels (may not render offline without glyphs; still useful when basemap is enabled)
      if (!has("labels")) {
        map.addLayer({
          id: "labels",
          type: "symbol",
          source: "layout",
          filter: ["all", ["!=", ["get", "role"], "parcel"], ["has", "label"]],
          layout: {
            "text-field": ["get", "label"],
            "text-size": 12,
            "text-offset": [0, 0.7],
            "text-anchor": "top",
          },
          paint: { "text-color": "#0F172A", "text-halo-color": "#FFFFFF", "text-halo-width": 1 },
        });
      }
    }

    function syncDraw(fc: any) {
      const draw = drawRef.current;
      if (!draw) return;
      try {
        if (typeof draw.deleteAll === "function") {
          draw.deleteAll();
        } else {
          const existing = draw.getAll?.()?.features || [];
          for (const f of existing) if (f?.id != null) draw.delete(String(f.id));
        }
      } catch {
        // ignore
      }

      for (const f of fc.features || []) {
        try {
          draw.add(f);
        } catch {
          // ignore
        }
      }
    }

    function computeFit(fc: any) {
      const features = (fc?.features || []) as any[];
      const parcel = features.find((f) => f?.properties?.role === "parcel");
      if (!parcel) {
        const next = {
          type: "FeatureCollection",
          features: features.map((f) => ({ ...f, properties: { ...(f.properties || {}), fit: true } })),
        };
        return next;
      }
      const nextFeatures = features.map((f) => {
        if (f?.properties?.role === "parcel") return f;
        let fit = true;
        try {
          fit = turf.booleanContains(parcel, f);
        } catch {
          fit = true;
        }
        return { ...f, properties: { ...(f.properties || {}), fit } };
      });
      return { type: "FeatureCollection", features: nextFeatures };
    }

    function applyReliabilityOverlay(fc: any, show: boolean, k: number) {
      const features = (fc?.features || []) as any[];
      const cleared = features.map((f) => ({ ...f, properties: { ...(f.properties || {}), dropped: false } }));
      if (!show) return { type: "FeatureCollection", features: cleared };

      const firmUnits = cleared
        .filter((f) => f?.properties?.role === "gen-firm-unit")
        .map((f) => ({ id: String(f.id ?? ""), mw: Number(f?.properties?.unitMW || 0) }))
        .filter((x) => x.mw > 0 && x.id);

      firmUnits.sort((a, b) => b.mw - a.mw);
      const toDrop = new Set(firmUnits.slice(0, Math.max(0, Math.floor(k))).map((x) => x.id));

      return {
        type: "FeatureCollection",
        features: cleared.map((f) => ({
          ...f,
          properties: { ...(f.properties || {}), dropped: toDrop.has(String(f.id ?? "")) },
        })),
      };
    }

    const displayLayout = useMemo(() => {
      const withFit = computeFit(layout);
      return applyReliabilityOverlay(withFit, showReliability, kDrop);
    }, [layout, showReliability, kDrop]);

    useEffect(() => {
      const issues = (displayLayout.features || [])
        .filter((f: any) => f?.properties?.role !== "parcel" && f?.properties?.fit === false)
        .map((f: any) => String(f?.properties?.label || f?.properties?.role || f?.id || "block"));
      setFitIssues(issues);
    }, [displayLayout]);

    // Initialize map once
    useEffect(() => {
      if (mapRef.current || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OFFLINE_STYLE,
        center: [lon, lat],
        zoom,
        preserveDrawingBuffer: true,
      });

      // Keep MapLibre rendering correct when switching tabs (container size changes)
      const resizeObs = new ResizeObserver(() => {
        try {
          map.resize();
        } catch {
          // ignore
        }
      });
      try {
        resizeObs.observe(containerRef.current);
      } catch {
        // ignore
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

      // Draw (for editing)
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        // Keep draw geometry invisible; we render via our GeoJSON layer.
        styles: [
          {
            id: "gl-draw-polygon-fill",
            type: "fill",
            filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
            paint: { "fill-color": "#000000", "fill-opacity": 0.0 },
          },
          {
            id: "gl-draw-polygon-stroke",
            type: "line",
            filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
            paint: { "line-color": "#000000", "line-width": 0.0 },
          },
          {
            id: "gl-draw-vertex-halo",
            type: "circle",
            filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
            paint: { "circle-radius": 6, "circle-color": "#FFFFFF" },
          },
          {
            id: "gl-draw-vertex",
            type: "circle",
            filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
            paint: { "circle-radius": 4, "circle-color": BRAND.ORANGE },
          },
        ],
      });
      drawRef.current = draw;
      drawAddedRef.current = false;
      mapLoadedRef.current = false;

      const getDisplay = () => {
        const s = stateRef.current;
        const withFit = computeFit(s.layout);
        return applyReliabilityOverlay(withFit, s.showReliability, s.kDrop);
      };

      map.on("load", () => {
        mapLoadedRef.current = true;
        setMapReady(true);
        ensureMapLayers(map);
        setStyleEpoch((e) => e + 1);

        // Rehydrate overlay GeoJSON on initial load
        try {
          const fc = getDisplay();
          const src = map.getSource("layout") as any;
          if (src) src.setData(fc);
        } catch {
          // ignore
        }

        // Add draw control once (fixes: "mapbox-gl-draw-cold already exists")
        if (stateRef.current.editEnabled) {
          safeAddDrawControl(map);
          try {
            syncDraw(getDisplay());
          } catch {
            // ignore
          }
        }

        const onDrawChange = () => {
          const d = drawRef.current;
          if (!d) return;
          const fc = d.getAll();
          setLayout(fc);
        };

        map.on("draw.create", onDrawChange);
        map.on("draw.update", onDrawChange);
        map.on("draw.delete", onDrawChange);

        map.on("moveend", () => {
          const c = map.getCenter();
          setLon(Number(c.lng.toFixed(6)));
          setLat(Number(c.lat.toFixed(6)));
          setZoom(Number(map.getZoom().toFixed(2)));
        });
      });

      // When style is swapped (basemap), re-add sources/layers and redraw.
      // Do NOT blindly add draw control again; it causes duplicate MapboxDraw sources.
      map.on("style.load", () => {
        try {
          ensureMapLayers(map);
        } catch {
          // ignore
        }

        // Rehydrate overlay GeoJSON after basemap style swaps
        try {
          const fc = getDisplay();
          const src = map.getSource("layout") as any;
          if (src) src.setData(fc);
        } catch {
          // ignore
        }

        // If draw is enabled but its sources are missing (style swap), re-add draw control safely.
        if (stateRef.current.editEnabled) {
          if (drawAddedRef.current && !hasDrawSources(map)) {
            safeRemoveDrawControl(map);
          }
          safeAddDrawControl(map);
          try {
            syncDraw(getDisplay());
          } catch {
            // ignore
          }
        }

        setStyleEpoch((e) => e + 1);
      });

      return () => {
        try {
          try {
          resizeObs.disconnect();
        } catch {
          // ignore
        }
        map.remove();
        } catch {
          // ignore
        }
        mapRef.current = null;
        drawRef.current = null;
        drawAddedRef.current = false;
        mapLoadedRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply basemap (off / streets / light / aerial). Mapping layers are re-attached in the existing style.load handler.
    useEffect(() => {
      if (!mapReady) return;
      const map = mapRef.current;
      if (!map) return;

      // If network tools are disabled, force the map back to offline.
      if (!networkTools && basemapId !== "off") {
        setBasemapId("off");
        return;
      }

      const key = networkTools ? basemapId : "off";
      if (key === lastBasemapRef.current) return;
      lastBasemapRef.current = key;

      const style =
        key === "off" ? OFFLINE_STYLE : key === "streets" ? OSM_STREETS_STYLE : key === "light" ? LIGHT_GRAY_STYLE : AERIAL_STYLE;

      try {
        map.setStyle(style);
      } catch {
        toast("Basemap failed to load (network blocked or unavailable).");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, networkTools, basemapId, OFFLINE_STYLE, OSM_STREETS_STYLE, LIGHT_GRAY_STYLE, AERIAL_STYLE]);

    // Toggle draw control on/off
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (!mapLoadedRef.current) return; // avoid races before initial load

      if (editEnabled) {
        safeAddDrawControl(map);
        // keep draw features in sync when enabling edit
        syncDraw(displayLayout);
      } else {
        safeRemoveDrawControl(map);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editEnabled]);

    // Keep map source updated (also re-push after style swaps / late map load)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (!mapReady) return;
      try {
        ensureMapLayers(map);
        const src = map.getSource("layout") as any;
        if (src) src.setData(displayLayout);
      } catch {
        // ignore
      }
    }, [displayLayout, mapReady, styleEpoch]);

    function fitToLayout(fc: any) {
      const map = mapRef.current;
      if (!map) return;
      if (!fc?.features?.length) return;
      try {
        const [minX, minY, maxX, maxY] = turf.bbox(fc);
        map.fitBounds(
          [
            [minX, minY],
            [maxX, maxY],
          ],
          { padding: 40, duration: 600 }
        );
      } catch {
        // ignore
      }
    }

    async function search() {
      if (!networkTools) return toast("Network tools are disabled. Toggle them on to enable search.");
      if (!query.trim()) return;
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await res.json();
        if (data && data[0]) {
          const nlat = parseFloat(data[0].lat);
          const nlon = parseFloat(data[0].lon);
          setLat(nlat);
          setLon(nlon);
          const map = mapRef.current;
          if (map) map.flyTo({ center: [nlon, nlat], zoom: Math.max(14, Math.max(14), zoom), essential: true });
        }
      } catch {
        toast("Search failed (network blocked or unavailable).");
      }
    }

    // Basemap is controlled via the selector (basemapId). Use Fly to recenter/zoom.
    function fly() {
      const map = mapRef.current;
      if (map) map.flyTo({ center: [lon, lat], zoom: Math.max(14, Math.max(2), zoom), essential: true });
    }

    function createParcelFromBuildable() {
      const buildableAc = Math.max(0, calc.buildableAcres || 0);
      if (buildableAc <= 0.0001) return toast("Buildable acres is 0. Update Inputs first.");

      const areaM2 = buildableAc * SQM_PER_ACRE;
      const aspect = 1.6;
      const wM = Math.sqrt(areaM2 * aspect);
      const hM = areaM2 / wM;

      const parcel = turf.feature(rectFromCenter([lon, lat], wM, hM).geometry, {
        role: "parcel",
        label: `Parcel (buildable ~${buildableAc.toFixed(1)} ac)`,
        color: BRAND.SLATE,
        expectedAc: buildableAc,
      });
      (parcel as any).id = "parcel";

      const keep = (layout.features || []).filter((f: any) => f?.properties?.role !== "parcel");
      const next = { type: "FeatureCollection", features: [parcel, ...keep] };
      setLayout(next);
      syncDraw(applyReliabilityOverlay(computeFit(next), showReliability, kDrop));
      fitToLayout(next);
      toast("Parcel created from buildable acres.");
    }

    function markFirstPolygonAsParcel() {
      // Converts the most recently drawn polygon into the parcel boundary.
      const draw = drawRef.current;
      if (!draw) return;
      try {
        const fc = draw.getAll();
        const polys = (fc.features || []).filter((f: any) => f?.geometry?.type === "Polygon");
        if (!polys.length) return toast("Draw a polygon first.");

        const newest = polys[polys.length - 1];
        const keep = (fc.features || []).filter((f: any) => String(f.id) !== String(newest.id) && f?.properties?.role !== "parcel");

        const parcel = {
          ...newest,
          id: "parcel",
          properties: { ...(newest.properties || {}), role: "parcel", label: "Parcel (buildable)", color: BRAND.SLATE },
        };

        const next = { type: "FeatureCollection", features: [parcel, ...keep] };
        setLayout(next);
        syncDraw(applyReliabilityOverlay(computeFit(next), showReliability, kDrop));
        toast("Parcel replaced.");
      } catch {
        toast("Could not set parcel.");
      }
    }

    function generateFromResults() {
      const origin: [number, number] = [lon, lat];

      // Always ensure a parcel exists for packing.
      const hasParcel = (layout.features || []).some((f: any) => f?.properties?.role === "parcel");

      const features: any[] = [];

      // Parcel
      if (!hasParcel) {
        const buildableAc = Math.max(0, calc.buildableAcres || 0);
        if (buildableAc > 0.0001) {
          const areaM2 = buildableAc * SQM_PER_ACRE;
          const aspect = 1.6;
          const wM = Math.sqrt(areaM2 * aspect);
          const hM = areaM2 / wM;
          const parcel = turf.feature(rectFromCenter(origin, wM, hM).geometry, {
            role: "parcel",
            label: `Parcel (buildable ~${buildableAc.toFixed(1)} ac)`,
            color: BRAND.SLATE,
            expectedAc: buildableAc,
          });
          (parcel as any).id = "parcel";
          features.push(parcel);
        }
      } else {
        const parcel = (layout.features || []).find((f: any) => f?.properties?.role === "parcel");
        if (parcel) features.push(parcel);
      }

      // Helper to turn acres into dims
      const acresToDims = (ac: number, aspect = 1.5) => {
        const m2 = ac * SQM_PER_ACRE;
        const h = Math.sqrt(m2 / aspect);
        const w = aspect * h;
        return { w, h };
      };

      // DC site blocks from Results
      const siteItems = [
        { role: "dc-building", label: "Building", ac: calc.buildingFootprintAcres, color: BRAND.MIDNIGHT, aspect: 2.0, nonFirm: false },
        { role: "dc-mep", label: "MEP Yard", ac: calc.mepYardAcres, color: BRAND.ORANGE, aspect: 1.4, nonFirm: false },
        { role: "dc-substation", label: "Substation", ac: calc.substationAcres, color: BRAND.TEAL, aspect: 1.0, nonFirm: false },
        { role: "dc-roads", label: "Roads/Parking", ac: calc.roadsAcres, color: BRAND.PURPLE, aspect: 2.6, nonFirm: false },
      ].filter((x) => (x.ac || 0) > 0.0001);

      // Layout them below the origin for visibility
      let yOffset = 220; // meters
      for (const it of siteItems) {
        const { w, h } = acresToDims(it.ac, it.aspect);
        const c = dest(origin, yOffset + h / 2, 180);
        const poly = rectFromCenter(c, w, h);
        const f = turf.feature(poly.geometry, {
          role: it.role,
          label: `${it.label} (${it.ac.toFixed(2)} ac)`,
          color: it.color,
          nonFirm: it.nonFirm,
          expectedAc: it.ac,
        });
        (f as any).id = it.role;
        features.push(f);
        yOffset += h + 30;
      }

      // Generation blocks: create unit-level firm blocks so N+k can tint dropped units.
      const comp = (activeCalc?.comp || []) as any[];
      const firmRows = comp.filter((r) => r.isFirm && (r.units || 0) > 0);
      const nonFirmRows = comp.filter((r) => !r.isFirm && (r.installed || 0) > 0);

      let genXOffset = 240; // meters east
      let genYOffset = 0;

      const MAX_UNITS_PER_TECH = 120;

      for (const row of firmRows) {
        const tech = String(row.name);
        const units = Math.max(0, Math.floor(row.units || 0));
        const unitMW = Number((MIX_LIBRARY as any)[tech]?.unitMW ?? row.installed / Math.max(1, units));
        const perUnitAc = Number((inputs.genLand as any)?.[tech]?.per_unit_acres ?? 0);

        if (!(perUnitAc > 0.0001) || units === 0) continue;

        const drawUnits = Math.min(units, MAX_UNITS_PER_TECH);
        for (let i = 0; i < drawUnits; i++) {
          const { w, h } = acresToDims(perUnitAc, 1.8);
          const base = dest(origin, genXOffset, 90);
          const c = dest(base, genYOffset + h / 2, 180);
          const poly = rectFromCenter(c, w, h);

          const f = turf.feature(poly.geometry, {
            role: "gen-firm-unit",
            label: `${tech} #${i + 1}`,
            color: BRAND.SLATE,
            nonFirm: false,
            expectedAc: perUnitAc,
            unitMW,
            tech,
          });
          (f as any).id = `gen_${tech.replace(/[^a-z0-9]+/gi, "_")}_${i + 1}`;
          features.push(f);
          genYOffset += h + 18;
        }

        if (units > drawUnits) {
          // Aggregate remainder (not part of the N+k tinting; still counted for fit/area)
          const remUnits = units - drawUnits;
          const remAc = perUnitAc * remUnits;
          const { w, h } = acresToDims(remAc, 2.2);
          const base = dest(origin, genXOffset, 90);
          const c = dest(base, genYOffset + h / 2, 180);
          const poly = rectFromCenter(c, w, h);
          const f = turf.feature(poly.geometry, {
            role: "gen-firm-agg",
            label: `${tech} (+${remUnits} units)`,
            color: BRAND.SLATE,
            nonFirm: false,
            expectedAc: remAc,
            unitMW,
            tech,
          });
          (f as any).id = `gen_${tech.replace(/[^a-z0-9]+/gi, "_")}_REMAINDER`;
          features.push(f);
          genYOffset += h + 22;
        }

        genYOffset += 20;
      }

      // Non-firm (PV/Wind/BESS) as aggregate blocks from genFootprint
      const nonFirmByName: Record<string, number> = {};
      for (const r of genFootprint?.rows || []) nonFirmByName[String(r.name)] = Number(r.acres || 0);

      for (const row of nonFirmRows) {
        const tech = String(row.name).replace(/ \(non-firm\)/g, "");
        const ac = Number(nonFirmByName[tech] ?? 0);
        if (!(ac > 0.0001)) continue;

        const { w, h } = acresToDims(ac, 2.0);
        const base = dest(origin, genXOffset + 240, 90);
        const c = dest(base, genYOffset + h / 2, 180);
        const poly = rectFromCenter(c, w, h);

        const f = turf.feature(poly.geometry, {
          role: "gen-nonfirm",
          label: `${tech} (${ac.toFixed(2)} ac)`,
          color: BRAND.YELLOW_ORANGE,
          nonFirm: true,
          expectedAc: ac,
          tech,
        });
        (f as any).id = `gen_nf_${tech.replace(/[^a-z0-9]+/gi, "_")}`;
        features.push(f);
        genYOffset += h + 22;
      }

      // Choose a default k based on current reliability selection on first generate
      const derivedK = kFromReliability(inputs.reliability);
      if (kDrop !== 1 && kDrop !== 2 && kDrop !== 3) setKDrop(derivedK);
      if (kDrop === 0) setKDrop(derivedK);

      const next = { type: "FeatureCollection", features };
      setLayout(next);
      syncDraw(applyReliabilityOverlay(computeFit(next), showReliability, kDrop));
      fitToLayout(next);
      toast("Generated layout from current Results + Power & Mix.");
    }

    function autoPack() {
      const base = layout;
      const features = (base.features || []) as any[];
      const parcel = features.find((f) => f?.properties?.role === "parcel");
      if (!parcel) return toast("No parcel boundary. Create one first.");

      const blocks = features.filter((f) => f?.properties?.role !== "parcel");
      if (!blocks.length) return toast("No blocks to pack. Generate first.");

      // pack largest-first
      const sorted = [...blocks].sort((a, b) => (turf.area(b) || 0) - (turf.area(a) || 0));

      const [minX, minY, maxX, maxY] = turf.bbox(parcel);
      const topLeft: [number, number] = [minX, maxY];
      const topRight: [number, number] = [maxX, maxY];
      const widthM = turf.distance(topLeft, topRight, { units: "meters" });

      const padM = 18;
      let rowStart = dest(topLeft, padM, 180);
      let cursor = rowStart;
      let usedW = 0;
      let rowH = 0;

      const placed: any[] = [];

      for (const f of sorted) {
        const { wM, hM } = dimsMetersFromFeature(f);

        if (usedW + wM > widthM - padM) {
          rowStart = dest(rowStart, rowH + padM, 180);
          cursor = rowStart;
          usedW = 0;
          rowH = 0;
        }

        // Place rectangle with same bbox dims
        const c1 = dest(cursor, wM / 2, 90);
        const center = dest(c1, hM / 2, 180);
        const poly = rectFromCenter(center, wM, hM);

        const nextF = {
          ...f,
          geometry: poly.geometry,
          properties: { ...(f.properties || {}) },
        };

        let fit = true;
        try {
          fit = turf.booleanContains(parcel, nextF);
        } catch {
          fit = true;
        }
        nextF.properties.fit = fit;

        placed.push(nextF);

        cursor = dest(cursor, wM + padM, 90);
        usedW += wM + padM;
        rowH = Math.max(rowH, hM);
      }

      const next = { type: "FeatureCollection", features: [parcel, ...placed] };
      setLayout(next);
      syncDraw(applyReliabilityOverlay(computeFit(next), showReliability, kDrop));
      fitToLayout(next);
      toast("Auto-pack complete.");
    }

    function exportGeoJSON() {
      const blob = new Blob([JSON.stringify(displayLayout, null, 2)], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dcft_layout.geojson";
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportPNG() {
      const map = mapRef.current;
      if (!map) return;
      try {
        const url = map.getCanvas().toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = "dcft_layout.png";
        a.click();
      } catch {
        toast("PNG export failed.");
      }
    }

    function saveLayout() {
      try {
        const payload = { layout, view: { lat, lon, zoom }, kDrop, showReliability };
        window.localStorage.setItem(scenarioKey, JSON.stringify(payload));
        toast("Layout saved for this scenario.");
      } catch {
        toast("Save failed (localStorage unavailable).");
      }
    }

    function loadLayout() {
      try {
        const raw = window.localStorage.getItem(scenarioKey);
        if (!raw) return toast("No saved layout for this scenario.");
        const parsed = JSON.parse(raw);
        if (parsed?.layout?.type === "FeatureCollection") {
          setLayout(parsed.layout);
          syncDraw(applyReliabilityOverlay(computeFit(parsed.layout), showReliability, kDrop));
          fitToLayout(parsed.layout);
        }
        if (typeof parsed?.kDrop === "number") setKDrop(parsed.kDrop);
        if (typeof parsed?.showReliability === "boolean") setShowReliability(parsed.showReliability);
        const map = mapRef.current;
        if (map && parsed?.view) {
          map.flyTo({ center: [parsed.view.lon ?? lon, parsed.view.lat ?? lat], zoom: Math.max(14, parsed.view.zoom ?? zoom), essential: true });
        }
        toast("Layout loaded.");
      } catch {
        toast("Load failed.");
      }
    }

    // Lightweight internal self-tests (non-fatal)
    useEffect(() => {
      try {
        // area sanity
        const poly = rectFromCenter([0, 0], 100, 100);
        const ac = acresFromFeature(poly);
        console.assert(ac > 2.2 && ac < 2.8, "Mapping self-test: rect area out of expected range");

        // fit sanity
        const parcel = turf.feature(rectFromCenter([0, 0], 200, 200).geometry, { role: "parcel" });
        (parcel as any).id = "parcel";
        const inside = turf.feature(rectFromCenter([0, 0], 40, 40).geometry, { role: "block" });
        (inside as any).id = "a";
        const far = turf.feature(rectFromCenter(dest([0, 0], 400, 90), 40, 40).geometry, { role: "block" });
        (far as any).id = "b";
        const fc = { type: "FeatureCollection", features: [parcel, inside, far] };
        const fitted = computeFit(fc);
        const aFit = (fitted.features || []).find((f: any) => String(f.id) === "a")?.properties?.fit;
        const bFit = (fitted.features || []).find((f: any) => String(f.id) === "b")?.properties?.fit;
        console.assert(aFit === true, "Mapping self-test: expected inside block to fit");
        console.assert(bFit === false, "Mapping self-test: expected outside block to not fit");

        // reliability overlay sanity
        const u1 = turf.feature(rectFromCenter([0, 0], 10, 10).geometry, { role: "gen-firm-unit", unitMW: 300 });
        (u1 as any).id = "u1";
        const u2 = turf.feature(rectFromCenter([0, 0], 10, 10).geometry, { role: "gen-firm-unit", unitMW: 100 });
        (u2 as any).id = "u2";
        const u3 = turf.feature(rectFromCenter([0, 0], 10, 10).geometry, { role: "gen-firm-unit", unitMW: 50 });
        (u3 as any).id = "u3";
        const tagged = applyReliabilityOverlay({ type: "FeatureCollection", features: [u1, u2, u3] }, true, 2);
        const dropped = (tagged.features || []).filter((f: any) => f.properties?.dropped).map((f: any) => String(f.id));
        console.assert(dropped.includes("u1") && dropped.includes("u2") && dropped.length === 2, "Mapping self-test: expected top-2 units dropped");
      } catch {
        // ignore
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const totals = useMemo(() => {
      const feats = (displayLayout.features || []) as any[];
      const rows = feats
        .filter((f) => f?.properties?.role !== "parcel")
        .map((f) => {
          const expected = Number(f?.properties?.expectedAc || 0);
          const actual = acresFromFeature(f);
          return {
            id: String(f.id ?? ""),
            label: String(f?.properties?.label || f?.properties?.role || "block"),
            role: String(f?.properties?.role || ""),
            expected,
            actual,
            delta: actual - expected,
            fit: f?.properties?.fit !== false,
          };
        });
      const expectedTotal = rows.reduce((s, r) => s + (r.expected || 0), 0);
      const actualTotal = rows.reduce((s, r) => s + (r.actual || 0), 0);
      return { rows, expectedTotal, actualTotal };
    }, [displayLayout]);

    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Mapping</CardTitle>
              <div className="text-sm text-muted-foreground">Downstream layout workspace. Generate footprints from Results + Power & Mix, then drag/resize, auto-pack into parcel, and export.</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">Edit</span>
                <Switch checked={editEnabled} onCheckedChange={setEditEnabled} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Reliability overlay</span>
                <Switch checked={showReliability} onCheckedChange={setShowReliability} />
              </div>
              <Select value={String(kDrop)} onValueChange={(v: any) => setKDrop(Number(v))}>
                <SelectTrigger className="w-[90px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">k = 1</SelectItem>
                  <SelectItem value="2">k = 2</SelectItem>
                  <SelectItem value="3">k = 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div className="space-y-2">
              <Label>Search (free geocoder; requires network)</Label>
              <div className="flex gap-2">
                <Input placeholder="city, address" value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button variant="outline" onClick={search} disabled={!networkTools}>
                  Search
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Enable network tools</span>
                <Switch
                  checked={networkTools}
                  onCheckedChange={(v) => {
                    setNetworkTools(v);
                    if (!v) {
                      setBasemapId("off");
                    } else if (basemapId === "off") {
                      setBasemapId("streets");
                    }
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Select value={basemapId} onValueChange={(v: any) => setBasemapId(v)}>
                  <SelectTrigger className="w-[220px]" disabled={!networkTools}>
                    <SelectValue placeholder="Basemap" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off (blank)</SelectItem>
                    <SelectItem value="streets">Streets (OSM)</SelectItem>
                    <SelectItem value="light">Light gray</SelectItem>
                    <SelectItem value="aerial">Aerial (imagery)</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={fly}>
                  Fly
                </Button>

              <Button
                variant="outline"
                onClick={() => fitToLayout(displayLayout)}
              >
                Zoom to layout
              </Button>
              </div>
              {!networkTools && (
                <div className="text-xs text-amber-700">Network tools are off by default to avoid Canvas network restrictions. When deployed, toggle on to enable basemap tiles and geocoding.</div>
              )}
            </div>

            <div>
              <Label>Center</Label>
              <div className="flex gap-2">
                <Input className="w-32" placeholder="Lat" value={lat} onChange={(e) => setLat(parseFloat(e.target.value || "0"))} />
                <Input className="w-32" placeholder="Lon" value={lon} onChange={(e) => setLon(parseFloat(e.target.value || "0"))} />
              </div>
              <div className="text-xs text-gray-500 mt-1">Zoom: {zoom.toFixed(2)}</div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button onClick={generateFromResults}>Generate from current results</Button>
              <Button variant="outline" onClick={createParcelFromBuildable}>
                Create parcel
              </Button>
              <Button variant="outline" onClick={markFirstPolygonAsParcel} disabled={!editEnabled}>
                Use drawn polygon as parcel
              </Button>
              <Button variant="outline" onClick={autoPack}>
                Auto-pack
              </Button>
              <Button variant="outline" onClick={saveLayout}>
                Save
              </Button>
              <Button variant="outline" onClick={loadLayout}>
                Load
              </Button>
              <Button variant="outline" onClick={exportPNG}>
                PNG
              </Button>
              <Button variant="outline" onClick={exportGeoJSON}>
                GeoJSON
              </Button>
            </div>
          </div>

          {statusMsg ? <div className="text-sm text-muted-foreground">{statusMsg}</div> : null}

          {fitIssues.length ? (
            <div className="rounded-xl border p-3">
              <div className="text-sm font-medium text-red-600">Doesn’t fit in parcel:</div>
              <ul className="text-sm text-red-600 list-disc ml-5">
                {fitIssues.slice(0, 12).map((x) => (
                  <li key={x}>{x}</li>
                ))}
                {fitIssues.length > 12 ? <li>…and {fitIssues.length - 12} more</li> : null}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border overflow-hidden">
            <div ref={containerRef} style={{ height: 560, width: "100%" }} />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2 rounded-xl border p-3">
              <div className="text-sm font-medium mb-2">Area check (expected vs. actual)</div>
              <div className="text-xs text-gray-500 mb-2">Editing changes geometry; expected is the generated starting point (screening). Red outline means outside parcel.</div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-2">Block</th>
                      <th className="py-2 pr-2">Expected (ac)</th>
                      <th className="py-2 pr-2">Actual (ac)</th>
                      <th className="py-2 pr-2">Δ (ac)</th>
                      <th className="py-2 pr-2">Fit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.rows.slice(0, 60).map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 pr-2">{r.label}</td>
                        <td className="py-2 pr-2">{r.expected ? r.expected.toFixed(2) : "—"}</td>
                        <td className="py-2 pr-2">{r.actual.toFixed(2)}</td>
                        <td className={`py-2 pr-2 ${Math.abs(r.delta) > 0.25 ? "text-amber-700" : "text-gray-700"}`}>{r.expected ? r.delta.toFixed(2) : "—"}</td>
                        <td className={`py-2 pr-2 ${r.fit ? "text-green-700" : "text-red-700"}`}>{r.fit ? "OK" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between text-sm pt-2 mt-2 border-t">
                <div>
                  Expected total: <strong>{totals.expectedTotal.toFixed(2)} ac</strong>
                </div>
                <div>
                  Actual total: <strong>{totals.actualTotal.toFixed(2)} ac</strong>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <div className="text-sm font-medium mb-2">Legend</div>
              <div className="text-sm space-y-1">
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.MIDNIGHT }} />Building
                </div>
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.ORANGE }} />MEP Yard
                </div>
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.TEAL }} />Substation
                </div>
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.PURPLE }} />Roads/Parking
                </div>
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.SLATE }} />Firm generation units
                </div>
                <div>
                  <span className="inline-block w-3 h-3 mr-2" style={{ background: BRAND.YELLOW_ORANGE }} />Non-firm generation
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-3">Dropped (N+k) firm units get a thick amber outline when Reliability overlay is enabled.</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
}

// UI helpers
function NumberField({ id, label, value, onChange, suffix, step = 1, min = -Infinity, max = Infinity }: any) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(toNumber(e.target.value, value))} />
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
    </div>
  );
}

function PercentField({ id, label, value, onChange }: any) {
  const v = Math.max(0, Math.min(100, toNumber(value, 0)));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <Slider className="w-full" value={[v]} min={0} max={100} step={1} onValueChange={([x]: any) => onChange(x)} />
        <Input
          id={id}
          className="w-20"
          type="number"
          value={v}
          min={0}
          max={100}
          step={1}
          onChange={(e) => onChange(Math.max(0, Math.min(100, toNumber(e.target.value, v))))}
        />
        <span>%</span>
      </div>
    </div>
  );
}

function SliderRow({ label, value = 0, onChange, min = 0, max = 100, step = 1, color = BRAND.ORANGE }: any) {
  const v = Math.max(min, Math.min(max, toNumber(value, 0)));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span>
          {v}
          {max === 100 ? "%" : ""}
        </span>
      </div>
      <Slider value={[v]} min={min} max={max} step={step} onValueChange={([x]: any) => onChange(x)} className="w-full" />
    </div>
  );
}

function MiniReliabilitySummary({ calc, elccEnabled }: any) {
  if (!calc) return <div className="text-sm text-gray-500">No mix yet.</div>;
  const badgeClass = calc.meets ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  const installedFirm = (calc?.comp || []).filter((r: any) => r.isFirm).reduce((a: number, b: any) => a + (b.installed || 0), 0);
  return (
    <div className="text-sm space-y-1">
      <div className={`inline-flex px-2 py-1 rounded ${badgeClass}`}>{calc.meets ? "Meets target" : "Does not meet target"}</div>
      <div className="flex justify-between">
        <span>Required MW</span>
        <span>{calc.reqMW?.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>Installed firm (total)</span>
        <span>{installedFirm.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>Firm after worst-case loss</span>
        <span>{calc.firmAfterLoss?.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>Accredited non-firm {elccEnabled ? "(ELCC on)" : "(ELCC off)"}</span>
        <span>{calc.accredited?.toFixed(1)}</span>
      </div>
    </div>
  );
}
