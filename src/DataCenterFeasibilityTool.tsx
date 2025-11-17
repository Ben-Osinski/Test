import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, Gauge, Settings2, TrendingUp, BarChart3, PieChart as PieIcon, Zap, Droplets, ShieldCheck, SlidersHorizontal, AlertTriangle } from "lucide-react";
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

// ================= Brand Palette (single source of truth) =================
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
// Charts/slices
const LAND_COLORS = [BRAND.MIDNIGHT, BRAND.ORANGE, BRAND.TEAL, BRAND.PURPLE, BRAND.SLATE];
const MIX_COLORS = [BRAND.ORANGE, BRAND.MIDNIGHT, BRAND.TEAL, BRAND.PURPLE, BRAND.YELLOW_ORANGE, BRAND.SMOKE, BRAND.SLATE, "#8F8F8F", "#C7D3E3", "#F3BDAA"];

// --- Helpers ---
function toNumber(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
function acresToSqft(acres) { return acres * 43560; }
function galPerHourToGpm(gph) { return gph / 60; }
function litersToGallons(l) { return l / 3.78541; }

const BTU_PER_SCF = 1037; // natural gas ~Btu/scf (HHV, approx)

// Persist simple UI state
const LS_KEY = "dc-feasibility-v3";
function uid() { return Math.random().toString(36).slice(2, 9); }

export default function DataCenterFeasibilityTool() {
  const [inputs, setInputs] = useState(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    const DEFAULTS = {
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
      wue_L_per_kWh: 0.30,
      targetItMw: 100,
      phases: 3,
      equalizePhases: true,
      phaseItMw: [33.3, 33.3, 33.3],
      reliability: "99.9",
      mixMode: "share",
      genSizeToFacility: true,
      pvPanelWatt: 550,
    };
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
  });

  const MIX_LIBRARY = {
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

  // Manual-mix rows (for Manual mode)
  const [mix, setMix] = useState(() => [
    { id: uid(), tech: "CCGT (5000F 1x1)", units: 1, ...MIX_LIBRARY["CCGT (5000F 1x1)"] },
    { id: uid(), tech: "PV", units: 0, ...MIX_LIBRARY["PV"] },
    { id: uid(), tech: "Wind", units: 0, ...MIX_LIBRARY["Wind"] },
  ]);

  // Share-mode sliders (STRICT: default everything to 0%)
  const firmList = ["Grid", "Recip (NG)", "SCGT", "CCGT (5000F 1x1)", "Fuel Cells (SOFC)"];
  const nonFirmList = ["PV", "Wind", "BESS"];
  const [shares, setShares] = useState({
    Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0,
    PV: 0, Wind: 0, BESS: 0,
  });

  // Accredited capacity (ELCC) sliders for PV/Wind/BESS
  const [elcc, setElcc] = useState({ ...DEFAULT_ELCC });
  const [bessHours, setBessHours] = useState(4);
  const [elccEnabled, setElccEnabled] = useState(true);

  // Which density preset is active? (for button highlighting)
  const preset = useMemo(() => {
    const s = inputs.sqftPerRack; const sup = inputs.supportPct;
    if (Math.abs(s - 30) < 0.5 && Math.abs(sup - 35) < 0.5) return 'aggr';
    if (Math.abs(s - 45) < 0.5 && Math.abs(sup - 40) < 0.5) return 'typ';
    if (Math.abs(s - 60) < 0.5 && Math.abs(sup - 45) < 0.5) return 'cons';
    return 'custom';
  }, [inputs.sqftPerRack, inputs.supportPct]);

  // keep phase array length in sync
  useEffect(() => {
    setInputs((s) => {
      const phases = Math.max(1, Math.floor(s.phases));
      const arr = s.phaseItMw.slice(0, phases);
      while (arr.length < phases) arr.push((s.mode === "target" ? s.targetItMw : Math.max(0, s.targetItMw)) / phases);
      return { ...s, phases, phaseItMw: arr };
    });
  }, [inputs.phases]);

  // Suggest WUE on cooling change (user can override)
  useEffect(() => {
    setInputs((s) => ({ ...s, wue_L_per_kWh: s.cooling === "Liquid" ? 0.15 : 0.30 }));
  }, [inputs.cooling]);

  // save persistent subset
  useEffect(() => { if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, JSON.stringify(inputs)); }, [inputs]);

  // =================== Land/IT Calculation ===================
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
    const feasible = inputs.mode === "target" ? siteMaxItMw >= targetItMw : siteMaxItMw > 0;

    let phases = Math.max(1, Math.floor(inputs.phases));
    let phaseValues = [];
    if (inputs.equalizePhases) {
      const total = inputs.mode === "target" ? targetItMw : siteMaxItMw;
      const per = total / phases;
      for (let i = 0; i < phases; i++) phaseValues.push(per);
    } else {
      phaseValues = inputs.phaseItMw.slice(0, phases).map((v) => Math.max(0, v));
    }
    const manualSum = phaseValues.reduce((a, b) => a + b, 0);
    const effectiveTargetItMw = inputs.equalizePhases ? targetItMw : manualSum;

    const it_kW = (inputs.mode === "target" ? effectiveTargetItMw : siteMaxItMw) * 1000;
    const wue_L_per_kWh = Math.max(0, inputs.wue_L_per_kWh);
    const water_L_per_h_dc = wue_L_per_kWh * it_kW; // kWh per hour = kW
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
      feasible,
      pue,
      effectiveTargetItMw,
      phases,
      phaseValues,
      water_gpm_dc,
      wue_L_per_kWh,
    };
  }, [inputs]);

  // =============== Reliability + Mix =================
  function kFromReliability(r) { return r === "99.9" ? 1 : r === "99.99" ? 2 : 3; }

  // Manual-mix calculations (units entered by user)
  const manualMixCalc = useMemo(() => {
    if (inputs.mixMode !== "manual") return null;
    const reqMW = inputs.genSizeToFacility ? (calc.effectiveTargetItMw * calc.pue) : calc.effectiveTargetItMw;
    const kLoss = kFromReliability(inputs.reliability);

    const firmRows = mix.filter((r) => r.isFirm && r.units > 0);
    const firmUnits = [];
    let totalInstalledFirm = 0;
    firmRows.forEach((r) => {
      totalInstalledFirm += r.units * r.unitMW;
      for (let i = 0; i < Math.floor(r.units); i++) firmUnits.push(r.unitMW);
    });

    const sorted = firmUnits.sort((a, b) => b - a);
    const worstLoss = sorted.slice(0, Math.min(kLoss, sorted.length)).reduce((a, b) => a + b, 0);
    const firmAfterLoss = Math.max(0, totalInstalledFirm - worstLoss);

    const pv = mix.find((r) => r.tech === "PV");
    const wind = mix.find((r) => r.tech === "Wind");
    const bess = mix.find((r) => r.tech === "BESS");
    const pvMW = (pv?.units ?? 0) * (pv?.unitMW ?? 0);
    const windMW = (wind?.units ?? 0) * (wind?.unitMW ?? 0);
    const bessMW = (bess?.units ?? 0) * (bess?.unitMW ?? 0);

    const bessCredit = Math.min(100, Math.max(0, elcc.BESS)) * Math.min(1, Math.max(0, bessHours / 4));
    const accredited = elccEnabled ? (pvMW * (Math.max(0, elcc.PV) / 100) + windMW * (Math.max(0, elcc.Wind) / 100) + bessMW * (bessCredit / 100)) : 0;

    const meets = (firmAfterLoss + accredited) >= reqMW;

    const firmInstalledByRow = firmRows.map((r) => ({ id: r.id, mw: r.units * r.unitMW }));
    const totalFirmInstalled = firmInstalledByRow.reduce((a, b) => a + b.mw, 0);
    const dispatchByRow = new Map();
    firmRows.forEach((r) => {
      const share = totalFirmInstalled > 0 ? (r.units * r.unitMW) / totalFirmInstalled : 0;
      dispatchByRow.set(r.id, share * reqMW);
    });

    let fuel_MMBtu_per_h = 0; let gas_MSCF_per_h = 0; let genWater_gpm = 0;
    firmRows.forEach((r) => {
      if (r.fuel !== "None" && r.heatRate > 0) {
        const mw = dispatchByRow.get(r.id) ?? 0;
        const mmbtu_h = (mw * 1000 * r.heatRate) / 1_000_000;
        fuel_MMBtu_per_h += mmbtu_h;
        gas_MSCF_per_h += (mmbtu_h * 1_000_000) / BTU_PER_SCF / 1000;
        genWater_gpm += galPerHourToGpm(r.water_gal_per_MWh * mw);
      }
    });

    const comp = mix.map((r) => ({ name: r.tech, installed: r.units * r.unitMW, dispatched: r.isFirm ? (dispatchByRow.get(r.id) ?? 0) : 0, units: r.units, isFirm: r.isFirm }));

    return { reqMW, kLoss, totalInstalledFirm, firmAfterLoss, accredited, meets, comp, fuel_MMBtu_per_h, gas_MSCF_per_h, genWater_gpm, totalWater_gpm: genWater_gpm + calc.water_gpm_dc, pvMW, windMW, bessMW };
  }, [inputs.mixMode, mix, inputs, calc.effectiveTargetItMw, calc.pue, calc.water_gpm_dc, elcc, bessHours, elccEnabled]);

  // Share-mode calculations (STRICT sliders: no hidden fallback)
  const shareCalc = useMemo(() => {
    if (inputs.mixMode !== "share") return null;
    const reqMW = inputs.genSizeToFacility ? (calc.effectiveTargetItMw * calc.pue) : calc.effectiveTargetItMw;
    const kLoss = kFromReliability(inputs.reliability);

    const firmShares = firmList.map((t) => ({ t, pct: Math.max(0, shares[t] || 0) }));
    const sumFirm = firmShares.reduce((a, b) => a + b.pct, 0);

    const units = { Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0, PV: 0, Wind: 0, BESS: 0 };

    function evaluate(unitsMap) {
      const unitList = [];
      let installed = 0;
      firmList.forEach((t) => {
        const n = Math.max(0, Math.floor(unitsMap[t] || 0));
        const size = MIX_LIBRARY[t].unitMW;
        installed += n * size;
        for (let i = 0; i < n; i++) unitList.push(size);
      });
      const sorted = unitList.sort((a, b) => b - a);
      const lost = sorted.slice(0, Math.min(kLoss, sorted.length)).reduce((a, b) => a + b, 0);
      const firmAfterLoss = Math.max(0, installed - lost);
      return { installed, firmAfterLoss };
    }

    let firmAfterLoss = 0;
    if (sumFirm > 0) {
      const normShares = firmShares.map(({ t, pct }) => ({ t, f: pct / sumFirm }));
      // initial units from target dispatched per firm tech
      normShares.forEach(({ t, f }) => {
        const u = MIX_LIBRARY[t].unitMW;
        const targetMW = f * reqMW;
        units[t] = Math.max(0, Math.ceil(targetMW / Math.max(1e-6, u)));
      });
      // add units until N+k satisfied
      let guard = 0; const MAX = 500;
      while (guard++ < MAX) {
        const { firmAfterLoss: current } = evaluate(units);
        if (current >= reqMW) { firmAfterLoss = current; break; }
        let bestT = normShares[0]?.t || "Grid";
        let bestScore = -Infinity;
        normShares.forEach(({ t, f }) => {
          const size = MIX_LIBRARY[t].unitMW;
          const dispatchTarget = f * reqMW;
          const currentDispatched = (units[t] || 0) * size;
          const shortfall = Math.max(0, dispatchTarget - currentDispatched);
          const score = shortfall - 0.1 * size;
          if (score > bestScore) { bestScore = score; bestT = t; }
        });
        units[bestT] = (units[bestT] || 0) + 1;
      }
      if (firmAfterLoss === 0) firmAfterLoss = evaluate(units).firmAfterLoss;
    } else {
      // sumFirm === 0 → no firm capacity installed
      firmAfterLoss = 0;
    }

    // Non‑firm nameplate from sliders (% of required MW)
    const pvMW = (Math.max(0, shares.PV || 0) / 100) * reqMW;
    const windMW = (Math.max(0, shares.Wind || 0) / 100) * reqMW;
    const bessMW = (Math.max(0, shares.BESS || 0) / 100) * reqMW; // power rating only

    const pvUnits = Math.ceil(pvMW / MIX_LIBRARY.PV.unitMW);
    const windUnits = Math.ceil(windMW / MIX_LIBRARY.Wind.unitMW);
    const bessUnits = Math.ceil(bessMW / MIX_LIBRARY.BESS.unitMW);

    const bessCredit = Math.min(100, Math.max(0, elcc.BESS)) * Math.min(1, Math.max(0, bessHours / 4));
    const accredited = elccEnabled ? (pvMW * (Math.max(0, elcc.PV) / 100) + windMW * (Math.max(0, elcc.Wind) / 100) + bessMW * (bessCredit / 100)) : 0;

    const compFirmRaw = firmList
      .map((t) => ({ t, mw: (units[t] || 0) * MIX_LIBRARY[t].unitMW }))
      .filter((x) => x.mw > 0);
    const totalFirmInstalled = compFirmRaw.reduce((a,b)=>a+b.mw,0);
    const dispatchTotal = Math.min(reqMW, totalFirmInstalled);
    const compFirm = compFirmRaw.map(({ t, mw }) => ({
      name: t,
      installed: mw,
      dispatched: totalFirmInstalled > 0 ? (mw / totalFirmInstalled) * dispatchTotal : 0,
      units: units[t] || 0,
      isFirm: true,
    }));

    const compNonFirm = [
      { name: 'PV (non‑firm)', installed: pvMW, dispatched: 0, units: pvUnits, isFirm: false },
      { name: 'Wind (non‑firm)', installed: windMW, dispatched: 0, units: windUnits, isFirm: false },
      { name: 'BESS (non‑firm)', installed: bessMW, dispatched: 0, units: bessUnits, isFirm: false },
    ];

    const meets = (firmAfterLoss + accredited) >= reqMW;

    // generation water/fuel (proportional across firm techs only)
    let fuel_MMBtu_per_h = 0; let gas_MSCF_per_h = 0; let genWater_gpm = 0;
    compFirm.forEach((row) => {
      const lib = MIX_LIBRARY[row.name] || MIX_LIBRARY[row.t] || null;
      if (lib && lib.fuel !== "None" && lib.heatRate > 0) {
        const mw = (row.installed / Math.max(1, compFirm.reduce((a,b)=>a+b.installed,0))) * reqMW;
        const mmbtu_h = (mw * 1000 * lib.heatRate) / 1_000_000;
        fuel_MMBtu_per_h += mmbtu_h;
        gas_MSCF_per_h += (mmbtu_h * 1_000_000) / BTU_PER_SCF / 1000;
        genWater_gpm += galPerHourToGpm(lib.water_gal_per_MWh * mw);
      }
    });

    return {
      reqMW, kLoss, units,
      comp: compFirm.concat(compNonFirm),
      fuel_MMBtu_per_h,
      gas_MSCF_per_h,
      genWater_gpm,
      pvMW, windMW, bessMW,
      pvUnits, windUnits,
      accredited,
      totalWater_gpm: genWater_gpm + calc.water_gpm_dc,
      firmAfterLoss,
      meets,
      sumFirm,
    };
  }, [inputs.mixMode, shares, inputs.reliability, inputs.genSizeToFacility, calc.effectiveTargetItMw, calc.pue, calc.water_gpm_dc, elcc, bessHours, elccEnabled]);

  // Manual-mix helpers
  function addRow() { setMix((m) => [...m, { id: uid(), tech: "SCGT", units: 1, ...MIX_LIBRARY["SCGT"] }]); }
  function removeRow(id) { setMix((m) => m.filter((r) => r.id !== id)); }
  function updateRow(id, patch) { setMix((m) => m.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function onChangeTech(id, tech) {
    const lib = MIX_LIBRARY[tech];
    updateRow(id, { tech, unitMW: lib.unitMW, unitAvailability: lib.unitAvailability, heatRate: lib.heatRate, water_gal_per_MWh: lib.water_gal_per_MWh, isFirm: lib.isFirm, fuel: lib.fuel });
  }

  const sumFirmShares = useMemo(() => firmList.reduce((a,t)=> a + Math.max(0, shares[t]||0), 0), [shares]);

  // =============== UI ===============
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Data Center Feasibility Tool — Js Rewrite (v0)</h1>
          <p className="text-muted-foreground mt-1">Strict firm sliders (0% means 0 capacity). ELCC can accredit a portion of PV/Wind/BESS toward the reliability check. Dispatch is carried by firm pro‑rata up to required facility MW.</p>
        </div>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          <span className="text-sm text-muted-foreground">Prototype · v0.9</span>
        </div>
      </div>

      <Tabs defaultValue="inputs" className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="powermix">Power & Mix</TabsTrigger>
          <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
        </TabsList>

        {/* Assumptions */}
        <TabsContent value="assumptions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Design & Land‑Use Assumptions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>Parcel & land</strong>: Inputs include Parcel (ac), Buildable %, Site Coverage %, MEP Yard %, Roads/Parking %, and fixed Substation acres.</li>
                <li><strong>Stories</strong>: Stacked floors multiply total building ft² (and white space) without increasing footprint.</li>
                <li><strong>White space</strong>: Building ft² × (1 − Support %) → White space; Racks = White space ÷ ft²/rack.</li>
                <li><strong>IT MW from land</strong>: Racks × (kW/rack) ÷ 1000.</li>
                <li><strong>Phasing</strong>: Equalized across phases by default; or enter per‑phase IT MW manually.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cooling, PUE & WUE</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>PUE</strong> is user‑set and independent of cooling choice for screening. Typical ranges: ~1.25–1.5 (air); ~1.10–1.35 (liquid) depending on climate and density.</li>
                <li><strong>WUE</strong> default suggestion: Air ≈ 0.30 L/kWh; Liquid ≈ 0.15 L/kWh. You can override directly.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Representative Power Blocks (screening)</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>Grid</strong>: 100 MW block (availability 99.95%); no heat or water accounting.</li>
                <li><strong>Recip (NG)</strong>: 18 MW/unit; heat rate ~8,924 Btu/kWh; ~1 gal/MWh water.</li>
                <li><strong>SCGT</strong>: 57 MW/unit; ~10,999 Btu/kWh; zero process water assumed.</li>
                <li><strong>CCGT (5000F 1x1)</strong>: 373.3 MW/unit; ~7,548 Btu/kWh; ~200 gal/MWh water (wet cooling representative).</li>
                <li><strong>Fuel Cells (SOFC)</strong>: 10 MW block; ~6,318 Btu/kWh; negligible water.</li>
                <li><strong>PV</strong>: 4.03 MW block (for count approximation); <em>non‑firm</em>.</li>
                <li><strong>Wind</strong>: 5.89 MW block; <em>non‑firm</em>.</li>
                <li><strong>BESS</strong>: 100 MW power block; duration set separately; <em>non‑firm</em> but can be accredited via ELCC.</li>
              </ul>
              <p className="mt-2">Values are screening‑level and inspired by prior study inputs and industry ranges; refine per project and OEM data.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reliability & Accreditation</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>Target</strong> is sized on IT MW or Facility MW (PUE applied) per the toggle.</li>
                <li><strong>Reliability check</strong>: N+k by dropping the largest <em>k</em> firm units (k = 1 for 99.9%, 2 for 99.99%, 3 for 99.999%).</li>
                <li><strong>ELCC (toggle)</strong>: When enabled, accredited MW = PV×ELCC% + Wind×ELCC% + BESS×(ELCC%×duration/4h). Defaults: PV 40%, Wind 20%, BESS 100%.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acre → IT MW Heuristics</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <ul className="list-disc ml-5 space-y-1">
                <li>Single‑story, 35–45 ft²/rack @ ~10 kW/rack typically yields ~0.6–1.2 MW IT per acre buildable (before roads/MEP/substation set‑asides).</li>
                <li>Higher density or smaller ft²/rack increases IT/acre; stacking floors scales linearly with story count.</li>
              </ul>
              <p className="mt-2">Use this tool to stress test sensitivity (ft²/rack, support %, stories) rather than as a fixed rule.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inputs */}
        <TabsContent value="inputs" className="space-y-6">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" /> Mode</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mode">Target IT vs. Max From Land</Label>
                  <Switch id="mode" checked={inputs.mode === "target"} onCheckedChange={(c)=>setInputs((s)=>({ ...s, mode: c ? "target" : "land" }))} />
                </div>
                {inputs.mode === "target" ? (
                  <div className="grid gap-2">
                    <NumberField id="targetItMw" label="Target IT Load" value={inputs.targetItMw} onChange={(n)=>setInputs((s)=>({ ...s, targetItMw: n }))} suffix="MW" step={0.1} min={0} />
                    <div className="flex flex-wrap gap-2">
                      <Button variant={preset==='aggr' ? 'default' : 'outline'} onClick={()=>setInputs((s)=>({ ...s, sqftPerRack: 30, supportPct: 35 }))}>Aggressive (30 ft²/rack)</Button>
                      <Button variant={preset==='typ' ? 'default' : 'outline'} onClick={()=>setInputs((s)=>({ ...s, sqftPerRack: 45, supportPct: 40 }))}>Typical (45 ft²/rack)</Button>
                      <Button variant={preset==='cons' ? 'default' : 'outline'} onClick={()=>setInputs((s)=>({ ...s, sqftPerRack: 60, supportPct: 45 }))}>Conservative (60 ft²/rack)</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">In <strong>From Land</strong> mode, the tool computes maximum IT MW from parcel & design assumptions.</p>
                )}

                <div className="flex items-center justify-between pt-2">
                  <Label htmlFor="phases">Equalize Phases</Label>
                  <Switch id="phases" checked={inputs.equalizePhases} onCheckedChange={(c)=>setInputs((s)=>({ ...s, equalizePhases: c }))} />
                </div>
                <NumberField id="phaseCount" label="Number of Phases" value={inputs.phases} onChange={(n)=>setInputs((s)=>({ ...s, phases: Math.max(1, Math.floor(n)) }))} step={1} min={1} />

                {!inputs.equalizePhases && (
                  <div className="grid gap-2">
                    <Label>Per-Phase IT (MW)</Label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {Array.from({ length: inputs.phases }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-8">P{i+1}</span>
                          <Input type="number" inputMode="decimal" step={0.1} value={inputs.phaseItMw[i] ?? 0} onChange={(e)=>{
                            const v = toNumber(e.target.value, 0);
                            setInputs((s)=>{ const arr = s.phaseItMw.slice(); arr[i] = v; return { ...s, phaseItMw: arr };});
                          }} />
                          <span className="text-xs text-muted-foreground">MW</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">Sum: {inputs.phaseItMw.slice(0, inputs.phases).reduce((a,b)=>a+ (Number.isFinite(b)?b:0), 0).toFixed(2)} MW</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stacked floors callout */}
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle>Stacked Floors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <NumberField id="stories" label="Stories (stacked floors)" value={inputs.stories} onChange={(n)=>setInputs((s)=>({ ...s, stories: Math.max(1, Math.floor(n)) }))} step={1} min={1} />
                <div className="flex flex-wrap gap-2">
                  {[1,2,3].map((n)=> (
                    <Button key={n} variant={inputs.stories===n? 'default':'outline'} size="sm" onClick={()=>setInputs((s)=>({ ...s, stories: n }))}>{n}x</Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Increases usable white space and racks by the number of stacked floors without increasing footprint.</p>
              </CardContent>
            </Card>

            {/* Parcel & Land */}
            <Card>
              <CardHeader>
                <CardTitle>Parcel & Land</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <NumberField id="parcel" label="Parcel area" value={inputs.parcelAcres} onChange={(n)=>setInputs((s)=>({ ...s, parcelAcres: n }))} suffix="ac" step={0.1} min={0} />
                <div className="grid md:grid-cols-2 gap-3">
                  <PercentField id="buildable" label="Buildable area" valuePct={inputs.buildablePct} onChange={(n)=>setInputs((s)=>({ ...s, buildablePct: Math.max(0, Math.min(100, n)) }))} />
                  <PercentField id="coverage" label="Site coverage (building footprint)" valuePct={inputs.siteCoveragePct} onChange={(n)=>setInputs((s)=>({ ...s, siteCoveragePct: Math.max(0, Math.min(100, n)) }))} />
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <PercentField id="mepyard" label="MEP yard" valuePct={inputs.mepYardPct} onChange={(n)=>setInputs((s)=>({ ...s, mepYardPct: Math.max(0, Math.min(100, n)) }))} />
                  <PercentField id="roads" label="Roads/Parking" valuePct={inputs.roadsPct} onChange={(n)=>setInputs((s)=>({ ...s, roadsPct: Math.max(0, Math.min(100, n)) }))} />
                </div>
                <NumberField id="subac" label="Substation" value={inputs.substationAcres} onChange={(n)=>setInputs((s)=>({ ...s, substationAcres: Math.max(0, n) }))} suffix="ac" step={0.1} min={0} />
                <div className="grid md:grid-cols-3 gap-3">
                  <NumberField id="sqftRack" label="White space per rack" value={inputs.sqftPerRack} onChange={(n)=>setInputs((s)=>({ ...s, sqftPerRack: Math.max(1, n) }))} suffix="ft²/rack" step={1} />
                  <PercentField id="supportPct" label="Support space share" valuePct={inputs.supportPct} onChange={(n)=>setInputs((s)=>({ ...s, supportPct: Math.max(0, Math.min(95, n)) }))} />
                  <NumberField id="rackKw" label="Rack density" value={inputs.rackDensityKw} onChange={(n)=>setInputs((s)=>({ ...s, rackDensityKw: Math.max(0.1, n) }))} suffix="kW/rack" step={0.1} />
                </div>
              </CardContent>
            </Card>

            {/* Cooling & Efficiency */}
            <Card>
              <CardHeader>
                <CardTitle>Cooling & Efficiency</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Cooling approach</Label>
                  <Select value={inputs.cooling} onValueChange={(v)=>setInputs((s)=>({ ...s, cooling: v }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Air">Air-cooled</SelectItem>
                      <SelectItem value="Liquid">Liquid/Water-cooled</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Changing cooling updates suggested WUE; you can override below.</p>
                </div>
                <NumberField id="pue" label="PUE" value={inputs.pue} onChange={(n)=>setInputs((s)=>({ ...s, pue: Math.max(1, n) }))} />
                <NumberField id="wue" label="WUE (L/kWh)" value={inputs.wue_L_per_kWh} onChange={(n)=>setInputs((s)=>({ ...s, wue_L_per_kWh: Math.max(0, n) }))} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Results */}
        <TabsContent value="results" className="space-y-6">
          <div className="grid xl:grid-cols-4 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5" /> IT Capacity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-3xl font-semibold">{calc.itMwFromLand.toFixed(2)} <span className="text-base font-normal text-muted-foreground">MW (max from land)</span></div>
                {inputs.mode === "target" && (
                  <p className="text-sm text-muted-foreground">Target (effective): {calc.effectiveTargetItMw.toFixed(2)} MW</p>
                )}
                <div className={`text-sm font-medium ${calc.feasible ? "text-emerald-600" : "text-rose-600"}`}>
                  {inputs.mode === "target" ? (calc.itMwFromLand >= calc.effectiveTargetItMw ? "Feasible for target" : "Not feasible for target") : "Computed from land"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Facility Power</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{(calc.effectiveTargetItMw * calc.pue).toFixed(2)} <span className="text-base font-normal text-muted-foreground">MW (total)</span></div>
                <p className="text-sm text-muted-foreground">PUE: {calc.pue.toFixed(2)} · IT share ≈ {(100 / calc.pue).toFixed(1)}%</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>White Space & Racks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-2xl font-semibold">{Math.round(calc.whiteSqft).toLocaleString()} <span className="text-base font-normal text-muted-foreground">ft² white space</span></div>
                <div className="text-2xl font-semibold">{calc.racks.toLocaleString()} <span className="text-base font-normal text-muted-foreground">racks</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Land Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <div>Parcel</div><div className="text-right font-medium">{calc.parcelAcres.toFixed(2)} ac</div>
                <div>Buildable</div><div className="text-right font-medium">{calc.buildableAcres.toFixed(2)} ac</div>
                <div>Building</div><div className="text-right">{calc.buildingFootprintAcres.toFixed(2)} ac</div>
                <div>MEP Yard</div><div className="text-right">{calc.mepYardAcres.toFixed(2)} ac</div>
                <div>Substation</div><div className="text-right">{calc.substationAcres.toFixed(2)} ac</div>
                <div>Roads/Parking</div><div className="text-right">{calc.roadsAcres.toFixed(2)} ac</div>
                <div>Open/Other</div><div className="text-right">{calc.openAcres.toFixed(2)} ac</div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="min-h-[360px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><PieIcon className="h-5 w-5" /> Land Allocation</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ name: "Building", value: calc.buildingFootprintAcres }, { name: "MEP Yard", value: calc.mepYardAcres }, { name: "Substation", value: calc.substationAcres }, { name: "Roads/Parking", value: calc.roadsAcres }, { name: "Open/Other", value: calc.openAcres }].filter(d=>d.value>0.0001)} dataKey="value" nameKey="name" outerRadius={110} label>
                      {[0,1,2,3,4].map((i) => (<Cell key={`c-${i}`} fill={LAND_COLORS[i % LAND_COLORS.length]} />))}
                    </Pie>
                    <ReTooltip formatter={(v,n)=>[`${toNumber(v).toFixed(2)} ac`, n]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="min-h-[360px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Phasing (IT MW)</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(inputs.equalizePhases ? calc.phaseValues : inputs.phaseItMw.slice(0, calc.phases)).map((v,i)=>({ phase:`P${i+1}`, IT_MW:Number((v ?? 0).toFixed(2)) }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="phase" />
                    <YAxis unit=" MW" />
                    <ReTooltip />
                    <Legend />
                    <Bar dataKey="IT_MW" name="IT MW" fill={BRAND.ORANGE} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Droplets className="h-5 w-5" /> Water Use Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <div>Data center cooling (WUE)</div><div className="text-right font-medium">{calc.water_gpm_dc.toFixed(1)} gpm</div>
                <div className="col-span-2 text-xs text-muted-foreground">Generation-side water varies by mix; see Power & Mix for a tech-by-tech tally. Totals shown there include DC cooling + generation.</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Power & Mix (merged) */}
        <TabsContent value="powermix" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5" />
              <Label className="mr-2">Mix mode</Label>
              <Select value={inputs.mixMode} onValueChange={(v)=>setInputs((s)=>({ ...s, mixMode: v }))}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="share">Target Mix (%)</SelectItem>
                  <SelectItem value="manual">Manual Units</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Label>Size to Facility MW</Label>
                <Switch checked={inputs.genSizeToFacility} onCheckedChange={(c)=>setInputs((s)=>({ ...s, genSizeToFacility: c }))} />
              </div>
              <div className="grid gap-1">
                <Label>Reliability Target</Label>
                <Select value={inputs.reliability} onValueChange={(v)=>setInputs((s)=>({ ...s, reliability: v }))}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="99.9">99.9% (N+1)</SelectItem>
                    <SelectItem value="99.99">99.99% (N+2)</SelectItem>
                    <SelectItem value="99.999">99.999% (N+3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>PV Panel Wattage</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="decimal" step={10} value={inputs.pvPanelWatt} onChange={(e)=>setInputs((s)=>({ ...s, pvPanelWatt: toNumber(e.target.value, 550) }))} className="w-28" />
                  <span className="text-sm text-muted-foreground">W/panel</span>
                </div>
              </div>
            </div>
          </div>

          {inputs.mixMode === "share" ? (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Firm Mix (% of required MW)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {firmList.map((t) => (
                    <div key={t} className="grid grid-cols-8 gap-3 items-center">
                      <div className="col-span-2 text-sm">{t}</div>
                      <div className="col-span-5">
                        <ReSlider value={[shares[t] ?? 0]} max={100} step={1} onValueChange={(v)=>setShares((s)=>({ ...s, [t]: v[0] }))} />
                      </div>
                      <div className="col-span-1 text-right text-sm font-medium">{Math.round(shares[t] ?? 0)}%</div>
                    </div>
                  ))}
                  {sumFirmShares === 0 && (
                    <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs">
                      <AlertTriangle className="h-4 w-4 mt-0.5" />
                      <span>No firm technologies selected. Firm capacity = 0. Enable ELCC and add PV/Wind/BESS or increase firm shares to meet the reliability target.</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">With strict sliders, no hidden fallback is applied. Only the technologies you select are built.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Non‑firm Add‑ons (% of required MW)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {nonFirmList.map((t) => (
                    <div key={t} className="grid grid-cols-8 gap-3 items-center">
                      <div className="col-span-2 text-sm">{t}</div>
                      <div className="col-span-5">
                        <ReSlider value={[shares[t] ?? 0]} max={100} step={1} onValueChange={(v)=>setShares((s)=>({ ...s, [t]: v[0] }))} />
                      </div>
                      <div className="col-span-1 text-right text-sm font-medium">{Math.round(shares[t] ?? 0)}%</div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">PV/Wind/BESS are modeled as add‑ons; you can accredit a portion below.</p>
                  <div className="flex items-center justify-between py-1">
                    <Label>Accredit renewables (ELCC)</Label>
                    <Switch checked={elccEnabled} onCheckedChange={(c)=>setElccEnabled(!!c)} />
                  </div>
                  <div className={`grid grid-cols-2 gap-3 mt-2 ${!elccEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <NumberField id="elccPV" label="PV ELCC" value={elcc.PV} onChange={(n)=>setElcc((e)=>({ ...e, PV: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="elccWind" label="Wind ELCC" value={elcc.Wind} onChange={(n)=>setElcc((e)=>({ ...e, Wind: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="elccBess" label="BESS ELCC" value={elcc.BESS} onChange={(n)=>setElcc((e)=>({ ...e, BESS: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="bessHr" label="BESS Duration" value={bessHours} onChange={(n)=>setBessHours(Math.max(0.5, n))} suffix="hr" step={0.5} min={0.5} />
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Sized Units to Meet Reliability</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {shareCalc && (
                    <>
                      <div className="grid md:grid-cols-4 gap-4 text-sm">
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Required Capacity</span>
                          <span className="font-medium">{shareCalc.reqMW.toFixed(1)} MW ({inputs.genSizeToFacility ? "Facility" : "IT"})</span>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Firm after N+{shareCalc.kLoss} loss (thermal/grid)</span>
                          <span className="font-medium">{shareCalc.firmAfterLoss.toFixed(1)} MW</span>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Accredited non‑firm (ELCC)</span>
                          <span className="font-medium">{shareCalc.accredited.toFixed(1)} MW</span>
                        </div>
                        <div className={`grid gap-1 ${shareCalc.meets ? "text-emerald-600" : "text-rose-600"}`}>
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-semibold">{shareCalc.meets ? "Meets target" : "Does not meet target"}</span>
                        </div>
                      </div>

                      <div className="rounded border mt-2">
                        <div className="grid grid-cols-10 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                          <div className="col-span-3">Technology</div>
                          <div className="col-span-2 text-right">Unit MW</div>
                          <div className="col-span-2 text-right">Units (sized)</div>
                          <div className="col-span-3 text-right">Installed MW / Dispatched MW</div>
                        </div>
                        {(shareCalc.comp ?? []).map((d, idx) => (
                          <div key={idx} className={`grid grid-cols-10 gap-2 items-center px-3 py-2 border-t ${d.isFirm === false ? 'bg-amber-50/60' : ''}`}>
                            <div className="col-span-3 flex items-center gap-2">{d.name}{d.isFirm===false && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">non‑firm</span>)}</div>
                            <div className="col-span-2 text-right">{Number.isFinite(d.installed) && (d.units ?? 0) > 0 ? (d.installed / Math.max(1, d.units)).toFixed(1) : '—'}</div>
                            <div className="col-span-2 text-right">{d.units ?? 0}</div>
                            <div className="col-span-3 text-right">{(d.installed ?? 0).toFixed(1)} / {(d.dispatched ?? 0).toFixed(1)} MW</div>
                          </div>
                        ))}
                        <div className="px-3 py-2 text-xs text-muted-foreground">Non‑firm add‑ons sized from sliders. Accreditation contributes to the reliability check; dispatch not modeled.</div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-2 gap-4 lg:col-span-2">
                <Card className="min-h-[360px]">
                  <CardHeader>
                    <CardTitle>Installed vs. Dispatched (All Techs)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={(shareCalc?.comp ?? []).map((d)=>({ name: d.name, Installed: Number((d.installed ?? 0).toFixed(2)), Dispatched: Number((d.dispatched ?? 0).toFixed(2)) }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis unit=" MW" />
                        <Legend />
                        <ReTooltip />
                        <Bar dataKey="Installed" name="Installed" fill={BRAND.MIDNIGHT} />
                        <Bar dataKey="Dispatched" name="Dispatched" fill={BRAND.ORANGE} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="min-h-[360px]">
                  <CardHeader>
                    <CardTitle>Installed Mix (All Techs)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={(shareCalc?.comp ?? []).filter((d)=> (d.installed ?? 0) > 0).map((d)=>({ name:d.name, value:d.installed }))} dataKey="value" nameKey="name" outerRadius={110} label>
                          {(shareCalc?.comp ?? []).map((_, i) => (<Cell key={`m-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />))}
                        </Pie>
                        <Legend />
                        <ReTooltip formatter={(v,n)=>[`${toNumber(v).toFixed(1)} MW`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Dev sanity */}
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Sanity Tests (Dev)</CardTitle></CardHeader>
                <CardContent className="text-xs text-muted-foreground grid gap-1">
                  <div>ELCC enabled: {String(elccEnabled)}; Accredited MW: {(shareCalc?.accredited ?? 0).toFixed(2)}</div>
                  <div>Comp rows: {(shareCalc?.comp ?? []).length}; Firm-share sum: {sumFirmShares.toFixed(1)}%</div>
                </CardContent>
              </Card>
            </div>
          ) : (
            // Manual mode builder
            <div className="grid md:grid-cols-4 gap-4">
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> Power Mix Builder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded border overflow-x-auto">
                    <div className="min-w-[820px]">
                      <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <div className="col-span-4">Technology</div>
                        <div className="col-span-2 text-right">Units</div>
                        <div className="col-span-2 text-right">Unit MW</div>
                        <div className="col-span-2 text-right">Availability</div>
                        <div className="col-span-2 text-right">Heat rate / Water</div>
                      </div>
                      {mix.map((r) => (
                        <div key={r.id} className="grid grid-cols-12 gap-3 items-center px-3 py-2 border-t">
                          <div className="col-span-4">
                            <Select value={r.tech} onValueChange={(v)=>onChangeTech(r.id, v)}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.keys(MIX_LIBRARY).map((t)=> (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Input type="number" inputMode="decimal" step={1} min={0} value={r.units} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,units:toNumber(e.target.value,0)}:x))} className="w-full text-right tabular-nums" />
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-2">
                            <Input type="number" inputMode="decimal" step={0.1} min={0} value={r.unitMW} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,unitMW:toNumber(e.target.value,r.unitMW)}:x))} className="w-full text-right tabular-nums" />
                            <span className="text-sm text-muted-foreground">MW</span>
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-2">
                            <Input type="number" inputMode="decimal" step={0.001} min={0} max={1} value={r.unitAvailability} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,unitAvailability:Math.max(0,Math.min(1,toNumber(e.target.value,r.unitAvailability)))}:x))} className="w-full text-right tabular-nums" />
                            <span className="text-sm text-muted-foreground">0–1</span>
                          </div>
                          <div className="col-span-2 text-right text-xs text-muted-foreground">
                            {r.fuel !== "None" ? (<>
                              <div>{r.heatRate.toLocaleString()} Btu/kWh</div>
                              <div>{r.water_gal_per_MWh} gal/MWh</div>
                            </>) : (<div>—</div>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={addRow}>Add row</Button>
                    <Button variant="outline" size="sm" onClick={()=>setMix((m)=>m.slice(0,Math.max(0,m.length-1)))}>Remove last</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Reliability Check</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {manualMixCalc && (
                    <>
                      <div className="grid md:grid-cols-4 gap-4 text-sm">
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Required Capacity</span>
                          <span className="font-medium">{manualMixCalc.reqMW.toFixed(1)} MW ({inputs.genSizeToFacility ? "Facility" : "IT"})</span>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Firm after N+{manualMixCalc.kLoss} loss</span>
                          <span className="font-medium">{manualMixCalc.firmAfterLoss.toFixed(1)} MW</span>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-muted-foreground">Accredited non‑firm (ELCC)</span>
                          <span className="font-medium">{manualMixCalc.accredited.toFixed(1)} MW</span>
                        </div>
                        <div className={`grid gap-1 ${manualMixCalc.meets ? "text-emerald-600" : "text-rose-600"}`}>
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-semibold">{manualMixCalc.meets ? "Meets target" : "Does not meet target"}</span>
                        </div>
                      </div>

                      <div className="rounded border mt-2">
                        <div className="grid grid-cols-10 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                          <div className="col-span-3">Technology</div>
                          <div className="col-span-2 text-right">Unit MW</div>
                          <div className="col-span-2 text-right">Units</div>
                          <div className="col-span-3 text-right">Installed MW / Dispatched MW</div>
                        </div>
                        {(manualMixCalc.comp ?? []).map((d, idx) => (
                          <div key={idx} className={`grid grid-cols-10 gap-2 items-center px-3 py-2 border-t ${d.isFirm === false ? 'bg-amber-50/60' : ''}`}>
                            <div className="col-span-3 flex items-center gap-2">{d.name}{d.isFirm===false && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">non‑firm</span>)}</div>
                            <div className="col-span-2 text-right">{Number.isFinite(d.installed) && (d.units ?? 0) > 0 ? (d.installed / Math.max(1, d.units)).toFixed(1) : '—'}</div>
                            <div className="col-span-2 text-right">{d.units ?? 0}</div>
                            <div className="col-span-3 text-right">{(d.installed ?? 0).toFixed(1)} / {(d.dispatched ?? 0).toFixed(1)} MW</div>
                          </div>
                        ))}
                        <div className="px-3 py-2 text-xs text-muted-foreground">Non‑firm rows are display‑only for dispatch; accreditation affects the reliability check when enabled.</div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 mt-4">
                        <Card className="min-h-[320px]">
                          <CardHeader><CardTitle>Installed vs. Dispatched (All Techs)</CardTitle></CardHeader>
                          <CardContent className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={(manualMixCalc?.comp ?? []).map((d)=>({ name: d.name, Installed: Number((d.installed ?? 0).toFixed(2)), Dispatched: Number((d.dispatched ?? 0).toFixed(2)) }))}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis unit=" MW" />
                                <Legend />
                                <ReTooltip />
                                <Bar dataKey="Installed" name="Installed" fill={BRAND.MIDNIGHT} />
                                <Bar dataKey="Dispatched" name="Dispatched" fill={BRAND.ORANGE} />
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                        <Card className="min-h-[320px]">
                          <CardHeader><CardTitle>Installed Mix (All Techs)</CardTitle></CardHeader>
                          <CardContent className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={(manualMixCalc?.comp ?? []).filter((d)=> (d.installed ?? 0) > 0).map((d)=>({ name:d.name, value:d.installed }))} dataKey="value" nameKey="name" outerRadius={100} label>
                                  {(manualMixCalc?.comp ?? []).map((_, i) => (<Cell key={`mi-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />))}
                                </Pie>
                                <Legend />
                                <ReTooltip formatter={(v,n)=>[`${toNumber(v).toFixed(1)} MW`, n]} />
                              </PieChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid md:grid-cols-3 gap-4 mt-2">
                        <Card>
                          <CardHeader><CardTitle>Fuel</CardTitle></CardHeader>
                          <CardContent className="text-sm">
                            <div>Thermal fuel: <span className="font-medium">{(manualMixCalc.fuel_MMBtu_per_h).toFixed(1)}</span> MMBtu/h</div>
                            <div>Gas flow: <span className="font-medium">{(manualMixCalc.gas_MSCF_per_h).toFixed(2)}</span> MSCF/h</div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader><CardTitle>Water (generation)</CardTitle></CardHeader>
                          <CardContent className="text-sm">
                            <div>Gen water: <span className="font-medium">{(manualMixCalc.genWater_gpm).toFixed(1)}</span> gpm</div>
                            <div>Total (DC + gen): <span className="font-medium">{(manualMixCalc.totalWater_gpm).toFixed(1)}</span> gpm</div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader><CardTitle>Renewables</CardTitle></CardHeader>
                          <CardContent className="text-sm">
                            <div>PV nameplate: <span className="font-medium">{(manualMixCalc.pvMW).toFixed(1)}</span> MW</div>
                            <div>Wind nameplate: <span className="font-medium">{(manualMixCalc.windMW).toFixed(1)}</span> MW</div>
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ================= Reusable fields =================
function NumberField({ id, label, value, onChange, suffix, step = "any", min, max }){
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : 0} onChange={(e)=>onChange(toNumber(e.target.value,0))} />
        {suffix ? <span className="text-sm text-muted-foreground w-16 text-right">{suffix}</span> : null}
      </div>
    </div>
  );
}

function PercentField({ id, label, valuePct, onChange }){
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" type="number" step={0.1} min={0} max={100} value={Number.isFinite(valuePct) ? valuePct : 0} onChange={(e)=>onChange(toNumber(e.target.value,0))} />
        <span className="text-sm text-muted-foreground w-16 text-right">%</span>
      </div>
    </div>
  );
}

function ReSlider({ value, max=100, step=1, onValueChange }){
  return (
    <input type="range" min={0} max={max} step={step} value={value[0]} onChange={(e)=>onValueChange([parseFloat(e.target.value)])} className="w-full" />
  );
}

// --- Lightweight dev tests ---
(function runDevTests(){
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('devtest')) return;
  try {
    console.group('DC Tool Dev Tests');
    console.assert(toNumber('1,234.5') === 1234.5, 'toNumber should parse commas');
    console.assert(toNumber('abc', 7) === 7, 'toNumber fallback works');
    console.assert(acresToSqft(1) === 43560, 'acresToSqft basic');
    console.assert(Math.abs(galPerHourToGpm(60) - 1) < 1e-9, 'galPerHourToGpm basic');
    console.assert(Math.abs(litersToGallons(3.78541) - 1) < 1e-6, 'litersToGallons basic');
    // Palette sanity
    console.assert(LAND_COLORS.length >= 5 && MIX_COLORS.length >= 5, 'brand palettes defined');
    // Simple N+1 drop test
    const unitList = [100,100,50];
    const sorted = unitList.slice().sort((a,b)=>b-a);
    const installed = unitList.reduce((a,b)=>a+b,0);
    const after = installed - sorted[0];
    console.assert(after === 150, 'N+1 drop largest unit');
    console.groupEnd();
  } catch (e) {
    console.error('Dev tests failed:', e);
  }
})();