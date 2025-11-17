import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, Gauge, Settings2, TrendingUp, BarChart3, PieChart as PieIcon, Zap, Droplets, ShieldCheck, SlidersHorizontal } from "lucide-react";
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

// --- Helpers ---
function toNumber(v: any, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function acresToSqft(acres: number) { return acres * 43560; }
function galPerHourToGpm(gph: number) { return gph / 60; }
function litersToGallons(l: number) { return l / 3.78541; }

const BTU_PER_SCF = 1037; // natural gas ~Btu/scf (HHV, approx)

// Palette (brand-friendly)
const MIX_COLORS = ["#003865", "#FF6A39", "#52266F", "#72CAC3", "#E09641", "#B6B8BA", "#393A3C"]; // up to 7 rows
const LAND_COLORS = ["#FF6A39", "#003865", "#E09641", "#707070", "#72CAC3"]; // building, mep, sub, roads, open

const LS_KEY = "dc-feasibility-v4";

type Cooling = "Air" | "Liquid";

type PowerTech =
  | "Grid"
  | "Recip (NG)"
  | "SCGT"
  | "CCGT (5000F 1x1)"
  | "Fuel Cells (SOFC)"
  | "PV"
  | "Wind"
  | "BESS";

type ReliabilityTarget = "99.9" | "99.99" | "99.999";

type MixMode = "manual" | "share";

type Inputs = {
  mode: "target" | "land";
  // Parcel & land
  parcelAcres: number;
  buildablePct: number;
  siteCoveragePct: number;
  stories: number;
  supportPct: number;
  mepYardPct: number;
  roadsPct: number;
  substationAcres: number;
  // Racking & white space
  sqftPerRack: number;
  rackDensityKw: number;
  rackingMode: 'simple' | 'detailed';
  rackWidthFt: number;
  rackDepthFt: number;
  coldAisleFt: number;
  hotAisleFt: number;
  layoutFactorPct: number;
  // Cooling & efficiency
  cooling: Cooling;
  pue: number;
  wue_L_per_kWh: number;
  // Target & phasing
  targetItMw: number;
  phases: number;
  equalizePhases: boolean;
  phaseItMw: number[];
  // Reliability & mix
  reliability: ReliabilityTarget;
  mixMode: MixMode;
  genSizeToFacility: boolean;
  // PV panel sizing helper
  pvPanelWatt: number;
};

type MixRow = {
  id: string;
  tech: PowerTech;
  units: number;
  unitMW: number;
  unitAvailability: number;
  heatRate: number;
  water_gal_per_MWh: number;
  isFirm: boolean;
  fuel: "NG" | "H2" | "None";
};

const DEFAULTS: Inputs = {
  mode: "target",
  parcelAcres: 50,
  buildablePct: 60,
  siteCoveragePct: 35,
  stories: 1,
  supportPct: 35,
  mepYardPct: 15,
  roadsPct: 10,
  substationAcres: 2.0,
  sqftPerRack: 45,
  rackDensityKw: 10,
  rackingMode: 'simple',
  rackWidthFt: 2.0,
  rackDepthFt: 4.0,
  coldAisleFt: 4.0,
  hotAisleFt: 4.0,
  layoutFactorPct: 10,
  cooling: "Air",
  pue: 1.35,
  wue_L_per_kWh: 0.30,
  targetItMw: 50,
  phases: 3,
  equalizePhases: true,
  phaseItMw: [16.7, 16.7, 16.7],
  reliability: "99.9",
  mixMode: "share",
  genSizeToFacility: true,
  pvPanelWatt: 550,
};

// Representative tech blocks (screening values)
const MIX_LIBRARY: Record<PowerTech, Omit<MixRow, "id" | "units">> = {
  Grid: { tech: "Grid", unitMW: 100, unitAvailability: 0.9995, heatRate: 0, water_gal_per_MWh: 0, isFirm: true, fuel: "None" },
  "Recip (NG)": { tech: "Recip (NG)", unitMW: 18, unitAvailability: 0.985, heatRate: 8924, water_gal_per_MWh: 1, isFirm: true, fuel: "NG" },
  SCGT: { tech: "SCGT", unitMW: 57, unitAvailability: 0.992, heatRate: 10999, water_gal_per_MWh: 0, isFirm: true, fuel: "NG" },
  "CCGT (5000F 1x1)": { tech: "CCGT (5000F 1x1)", unitMW: 373.3, unitAvailability: 0.99, heatRate: 7548, water_gal_per_MWh: 200, isFirm: true, fuel: "NG" },
  "Fuel Cells (SOFC)": { tech: "Fuel Cells (SOFC)", unitMW: 10, unitAvailability: 0.99, heatRate: 6318, water_gal_per_MWh: 0, isFirm: true, fuel: "NG" },
  PV: { tech: "PV", unitMW: 4.03, unitAvailability: 0.0, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
  Wind: { tech: "Wind", unitMW: 5.89, unitAvailability: 0.0, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
  BESS: { tech: "BESS", unitMW: 100, unitAvailability: 0.99, heatRate: 0, water_gal_per_MWh: 0, isFirm: false, fuel: "None" },
};

const DEFAULT_ELCC = { PV: 40, Wind: 20, BESS: 100 } as const;

function uid() { return Math.random().toString(36).slice(2, 9); }

export default function DataCenterFeasibilityTool() {
  const [inputs, setInputs] = useState<Inputs>(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
  });

  const [mix, setMix] = useState<MixRow[]>([
    { id: uid(), tech: "CCGT (5000F 1x1)", units: 2, ...MIX_LIBRARY["CCGT (5000F 1x1)"] },
    { id: uid(), tech: "PV", units: 0, ...MIX_LIBRARY.PV },
    { id: uid(), tech: "Wind", units: 0, ...MIX_LIBRARY.Wind },
  ]);

  const firmList: PowerTech[] = ["Grid", "Recip (NG)", "SCGT", "CCGT (5000F 1x1)", "Fuel Cells (SOFC)"];
  const nonFirmList: ("PV" | "Wind" | "BESS")[] = ["PV", "Wind", "BESS"];
  const [shares, setShares] = useState<Record<PowerTech, number>>({
    Grid: 56, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0,
    PV: 47, Wind: 0, BESS: 0,
  } as any);

  const [elcc, setElcc] = useState<{ PV:number; Wind:number; BESS:number }>({ ...DEFAULT_ELCC });
  const [bessHours, setBessHours] = useState<number>(4);

  const preset = useMemo(() => {
    const s = inputs.sqftPerRack; const sup = inputs.supportPct;
    if (Math.abs(s - 30) < 0.5 && Math.abs(sup - 35) < 0.5) return 'aggr';
    if (Math.abs(s - 45) < 0.5 && Math.abs(sup - 40) < 0.5) return 'typ';
    if (Math.abs(s - 60) < 0.5 && Math.abs(sup - 45) < 0.5) return 'cons';
    return 'custom';
  }, [inputs.sqftPerRack, inputs.supportPct]);

  useEffect(() => {
    setInputs((s) => {
      const phases = Math.max(1, Math.floor(s.phases));
      const arr = s.phaseItMw.slice(0, phases);
      while (arr.length < phases) arr.push((s.mode === "target" ? s.targetItMw : Math.max(0, s.targetItMw)) / phases);
      return { ...s, phases, phaseItMw: arr };
    });
  }, [inputs.phases]);

  useEffect(() => { setInputs((s)=>({ ...s, wue_L_per_kWh: s.cooling === "Liquid" ? 0.15 : 0.30 })); }, [inputs.cooling]);

  // Derive ft²/rack when using detailed racking layout
  useEffect(() => {
    if (inputs.rackingMode !== 'detailed') return;
    const base = Math.max(0.5, inputs.rackWidthFt) * Math.max(1, inputs.rackDepthFt + inputs.coldAisleFt + inputs.hotAisleFt);
    const eff = base * (1 + Math.max(0, inputs.layoutFactorPct) / 100);
    setInputs((s) => ({ ...s, sqftPerRack: parseFloat(eff.toFixed(1)) }));
  }, [inputs.rackingMode, inputs.rackWidthFt, inputs.rackDepthFt, inputs.coldAisleFt, inputs.hotAisleFt, inputs.layoutFactorPct]);

  useEffect(() => { if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, JSON.stringify(inputs)); }, [inputs]);

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

    const racks = Math.floor(Math.max(1, whiteSqft) / Math.max(1, inputs.sqftPerRack));
    const itMwFromLand = (racks * Math.max(0.1, inputs.rackDensityKw)) / 1000;
    const pue = Math.max(1, inputs.pue);

    const mepYardAcres = buildableAcres * mepFrac;
    const roadsAcres = buildableAcres * roadsFrac;
    const allocSum = buildingFootprintAcres + mepYardAcres + roadsAcres + inputs.substationAcres;
    const openAcres = Math.max(0, buildableAcres - allocSum);

    const targetItMw = inputs.mode === "target" ? Math.max(0, inputs.targetItMw) : itMwFromLand;
    const siteMaxItMw = itMwFromLand;
    const feasible = inputs.mode === "target" ? siteMaxItMw >= targetItMw : siteMaxItMw > 0;

    const phases = Math.max(1, Math.floor(inputs.phases));
    const phaseValues = inputs.equalizePhases
      ? Array.from({ length: phases }, () => (inputs.mode === "target" ? targetItMw : siteMaxItMw) / phases)
      : inputs.phaseItMw.slice(0, phases).map((v) => Math.max(0, v));

    const it_kW = (inputs.mode === "target" ? (inputs.equalizePhases ? targetItMw : phaseValues.reduce((a,b)=>a+b,0)) : siteMaxItMw) * 1000;
    const water_L_per_h_dc = Math.max(0, inputs.wue_L_per_kWh) * it_kW;
    const water_gpm_dc = galPerHourToGpm(litersToGallons(water_L_per_h_dc));

    return {
      parcelAcres, buildableAcres, buildingFootprintAcres, buildingSqft, supportSqft, whiteSqft,
      racks, itMwFromLand, mepYardAcres, roadsAcres, substationAcres: inputs.substationAcres, openAcres,
      feasible, pue, effectiveTargetItMw: inputs.mode === "target" ? targetItMw : siteMaxItMw,
      phases, phaseValues, water_gpm_dc,
    };
  }, [inputs]);

  function kFromReliability(r: ReliabilityTarget) { return r === "99.9" ? 1 : r === "99.99" ? 2 : 3; }

  // Share‑mode sizing + accreditation
  const shareCalc = useMemo(() => {
    if (inputs.mixMode !== "share") return null;
    const reqMW = inputs.genSizeToFacility ? (calc.effectiveTargetItMw * calc.pue) : calc.effectiveTargetItMw;
    const kLoss = kFromReliability(inputs.reliability);

    const firmShares = firmList.map((t) => ({ t, pct: Math.max(0, shares[t] || 0) }));
    const sumFirm = firmShares.reduce((a, b) => a + b.pct, 0);
    const normShares = firmShares.map(({ t, pct }) => ({ t, f: sumFirm > 0 ? pct / sumFirm : (t === "Grid" ? 1 : 0) }));

    const units: Record<PowerTech, number> = { Grid: 0, "Recip (NG)": 0, SCGT: 0, "CCGT (5000F 1x1)": 0, "Fuel Cells (SOFC)": 0, PV: 0, Wind: 0, BESS: 0 } as any;
    normShares.forEach(({ t, f }) => {
      const u = MIX_LIBRARY[t].unitMW; const targetMW = f * reqMW; units[t] = Math.max(0, Math.ceil(targetMW / Math.max(1e-6, u)));
    });

    function evaluate(unitsMap: Record<PowerTech, number>) {
      const unitList: number[] = []; let installed = 0;
      firmList.forEach((t) => { const n = Math.max(0, Math.floor(unitsMap[t] || 0)); const sz = MIX_LIBRARY[t].unitMW; installed += n * sz; for (let i=0;i<n;i++) unitList.push(sz); });
      const sorted = unitList.sort((a,b)=>b-a); const lost = sorted.slice(0, Math.min(kLoss, sorted.length)).reduce((a,b)=>a+b,0);
      return { installed, firmAfterLoss: Math.max(0, installed - lost) };
    }

    let guard = 0; const MAX = 500;
    while (guard++ < MAX) { const { firmAfterLoss } = evaluate(units); if (firmAfterLoss >= reqMW) break;
      let bestT: PowerTech = normShares[0]?.t || "Grid"; let bestScore = -Infinity;
      normShares.forEach(({ t, f }) => { const sz = MIX_LIBRARY[t].unitMW; const dispatchTarget = f * reqMW; const current = (units[t]||0)*sz; const shortfall = Math.max(0, dispatchTarget - current); const score = shortfall - 0.1*sz; if (score > bestScore) { bestScore = score; bestT = t; } });
      units[bestT] = (units[bestT]||0) + 1; }

    const pvMW = (Math.max(0, shares.PV||0)/100) * reqMW;
    const windMW = (Math.max(0, shares.Wind||0)/100) * reqMW;
    const bessMW = (Math.max(0, shares.BESS||0)/100) * reqMW;

    const pvUnits = Math.ceil(pvMW / MIX_LIBRARY.PV.unitMW);
    const windUnits = Math.ceil(windMW / MIX_LIBRARY.Wind.unitMW);
    const bessUnits = Math.ceil(bessMW / MIX_LIBRARY.BESS.unitMW);

    const installedByTech = firmList.map((t)=>({ t, mw: (units[t]||0) * MIX_LIBRARY[t].unitMW })).filter(x=>x.mw>0);
    const totalFirmInstalled = installedByTech.reduce((a,b)=>a+b.mw,0);
    const dispatchMWByTech = new Map<PowerTech, number>();
    installedByTech.forEach(({t,mw}) => dispatchMWByTech.set(t, totalFirmInstalled>0 ? (mw/totalFirmInstalled)*reqMW : 0));

    let fuel_MMBtu_per_h = 0, gas_MSCF_per_h = 0, genWater_gpm = 0;
    installedByTech.forEach(({ t }) => { const lib = MIX_LIBRARY[t]; if (lib.fuel!=="None" && lib.heatRate>0) { const mw = dispatchMWByTech.get(t)??0; const mmbtu_h=(mw*1000*lib.heatRate)/1_000_000; fuel_MMBtu_per_h+=mmbtu_h; gas_MSCF_per_h+=(mmbtu_h*1_000_000)/BTU_PER_SCF/1000; genWater_gpm+=galPerHourToGpm(lib.water_gal_per_MWh*mw); }});

    const bessCredit = Math.min(100, Math.max(0, elcc.BESS)) * Math.min(1, Math.max(0, bessHours/4));
    const accredited = pvMW*(Math.max(0,elcc.PV)/100) + windMW*(Math.max(0,elcc.Wind)/100) + bessMW*(bessCredit/100);

    const { firmAfterLoss } = evaluate(units);
    const meets = (firmAfterLoss + accredited) >= reqMW;

    const compFirm = installedByTech.map(({t,mw}) => ({ name: t, unitMW: MIX_LIBRARY[t].unitMW, installed: mw, dispatched: dispatchMWByTech.get(t)??0, units: units[t]||0, isFirm: true }));
    const compNonFirm = [
      { name: 'PV (non‑firm)', unitMW: MIX_LIBRARY.PV.unitMW, installed: pvMW, dispatched: 0, units: pvUnits, isFirm: false },
      { name: 'Wind (non‑firm)', unitMW: MIX_LIBRARY.Wind.unitMW, installed: windMW, dispatched: 0, units: windUnits, isFirm: false },
      { name: 'BESS (non‑firm)', unitMW: MIX_LIBRARY.BESS.unitMW, installed: bessMW, dispatched: 0, units: bessUnits, isFirm: false },
    ];

    return {
      reqMW, kLoss, units,
      comp: compFirm.concat(compNonFirm),
      fuel_MMBtu_per_h, gas_MSCF_per_h, genWater_gpm,
      pvMW, windMW, bessMW, pvUnits, windUnits,
      accredited, totalWater_gpm: genWater_gpm + calc.water_gpm_dc,
      firmAfterLoss, meets,
    };
  }, [inputs.mixMode, shares, inputs.reliability, inputs.genSizeToFacility, calc.effectiveTargetItMw, calc.pue, calc.water_gpm_dc, elcc.BESS, elcc.PV, elcc.Wind, bessHours]);

  // Manual helpers (left intact)
  function addRow() { setMix((m) => [...m, { id: uid(), tech: "SCGT", units: 1, ...MIX_LIBRARY.SCGT }]); }
  function removeRow(id: string) { setMix((m) => m.filter((r) => r.id !== id)); }
  function updateRow(id: string, patch: Partial<MixRow>) { setMix((m) => m.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function onChangeTech(id: string, tech: PowerTech) {
    const lib = MIX_LIBRARY[tech];
    updateRow(id, { tech, unitMW: lib.unitMW, unitAvailability: lib.unitAvailability, heatRate: lib.heatRate, water_gal_per_MWh: lib.water_gal_per_MWh, isFirm: lib.isFirm, fuel: lib.fuel });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Data Center Feasibility Tool</h1>
          <p className="text-muted-foreground mt-1">V0.10 — racking details (dropdown), ELCC sliders restored, renewables included in charts.</p>
        </div>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
        </div>
      </div>

      <Tabs defaultValue="inputs" className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="powermix">Power & Mix</TabsTrigger>
          <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
        </TabsList>

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

            <Card>
              <CardHeader>
                <CardTitle>Compute, Cooling & Racking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Cooling Approach</Label>
                  <Select value={inputs.cooling} onValueChange={(v:Cooling)=>setInputs((s)=>({ ...s, cooling: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Air">Air</SelectItem>
                      <SelectItem value="Liquid">Liquid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberField id="pue" label="PUE (facility / IT)" value={inputs.pue} onChange={(n)=>setInputs((s)=>({ ...s, pue: n }))} />
                <NumberField id="wue" label="WUE (liters / kWh IT)" value={inputs.wue_L_per_kWh} onChange={(n)=>setInputs((s)=>({ ...s, wue_L_per_kWh: n }))} />
                <NumberField id="rackKw" label="Rack Density" value={inputs.rackDensityKw} onChange={(n)=>setInputs((s)=>({ ...s, rackDensityKw: n }))} suffix="kW/rack" step={0.5} min={0.1} />

                <div className="grid gap-2">
                  <Label>Racking Input Mode</Label>
                  <Select value={inputs.rackingMode} onValueChange={(v:any)=>setInputs((s)=>({ ...s, rackingMode: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple (ft²/rack)</SelectItem>
                      <SelectItem value="detailed">Detailed (layout)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inputs.rackingMode === 'simple' ? (
                  <NumberField id="sqftRack" label="Area per Rack" value={inputs.sqftPerRack} onChange={(n)=>setInputs((s)=>({ ...s, sqftPerRack: n }))} suffix="ft²/rack" step={1} min={1} />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField id="rackWidth" label="Rack Width" value={inputs.rackWidthFt} onChange={(n)=>setInputs((s)=>({ ...s, rackWidthFt: n }))} suffix="ft" step={0.1} min={1} />
                    <NumberField id="rackDepth" label="Rack Depth" value={inputs.rackDepthFt} onChange={(n)=>setInputs((s)=>({ ...s, rackDepthFt: n }))} suffix="ft" step={0.1} min={1} />
                    <NumberField id="coldAisle" label="Cold Aisle" value={inputs.coldAisleFt} onChange={(n)=>setInputs((s)=>({ ...s, coldAisleFt: n }))} suffix="ft" step={0.1} min={0} />
                    <NumberField id="hotAisle" label="Hot Aisle" value={inputs.hotAisleFt} onChange={(n)=>setInputs((s)=>({ ...s, hotAisleFt: n }))} suffix="ft" step={0.1} min={0} />
                    <PercentField id="layoutFactor" label="Layout Factor (extra)" valuePct={inputs.layoutFactorPct} onChange={(pct)=>setInputs((s)=>({ ...s, layoutFactorPct: pct }))} />
                    <div className="col-span-2 text-xs text-muted-foreground">Derived area per rack: <span className="font-medium">{inputs.sqftPerRack.toFixed(1)} ft²/rack</span> (auto‑calculated)</div>
                  </div>
                )}
                <PercentField id="support" label="Support Spaces (of building)" valuePct={inputs.supportPct} onChange={(pct)=>setInputs((s)=>({ ...s, supportPct: pct }))} />
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
                {inputs.mode === "target" && (<p className="text-sm text-muted-foreground">Target (effective): {calc.effectiveTargetItMw.toFixed(2)} MW</p>)}
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
                    <ReTooltip formatter={(v:any,n:any)=>[`${toNumber(v).toFixed(2)} ac`, n]} />
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
                    <Bar dataKey="IT_MW" name="IT MW" fill={MIX_COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Droplets className="h-5 w-5" /> Cooling Water (DC)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{calc.water_gpm_dc.toFixed(1)} <span className="text-base font-normal text-muted-foreground">gpm</span></div>
                <p className="text-sm text-muted-foreground">From WUE × IT (liters/kWh). Adjust to climate/design.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Power & Mix */}
        <TabsContent value="powermix" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5" />
              <Label className="mr-2">Mix mode</Label>
              <Select value={inputs.mixMode} onValueChange={(v:any)=>setInputs((s)=>({ ...s, mixMode: v }))}>
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
                <Select value={inputs.reliability} onValueChange={(v:any)=>setInputs((s)=>({ ...s, reliability: v }))}>
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
                  <p className="text-xs text-muted-foreground">Shares are normalized across firm techs. The tool sizes discrete units to meet N+k after dropping the largest k units.</p>
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
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <NumberField id="elccPV" label="PV ELCC" value={elcc.PV} onChange={(n)=>setElcc((e)=>({ ...e, PV: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="elccWind" label="Wind ELCC" value={elcc.Wind} onChange={(n)=>setElcc((e)=>({ ...e, Wind: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="elccBess" label="BESS ELCC" value={elcc.BESS} onChange={(n)=>setElcc((e)=>({ ...e, BESS: Math.max(0, Math.min(100, n)) }))} suffix="%" step={1} min={0} max={100} />
                    <NumberField id="bessHr" label="BESS Duration" value={bessHours} onChange={(n)=>setBessHours(Math.max(0.5, n))} suffix="hr" step={0.5} min={0.5} />
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
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
                          <span className="text-muted-foreground">Firm after N+{shareCalc.kLoss} loss</span>
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
                        {shareCalc.comp.map((d: any, idx: number) => (
                          <div key={idx} className={`grid grid-cols-10 gap-2 items-center px-3 py-2 border-t ${d.isFirm===false ? 'bg-amber-50/60' : ''}`}>
                            <div className="col-span-3 flex items-center gap-2">{d.name}{d.isFirm===false && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">non‑firm</span>)}</div>
                            <div className="col-span-2 text-right">{(d.unitMW ?? 0).toFixed(1)}</div>
                            <div className="col-span-2 text-right">{d.units}</div>
                            <div className="col-span-3 text-right">{d.installed.toFixed(1)} / {d.dispatched.toFixed(1)} MW</div>
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
                      <BarChart data={(shareCalc?.comp ?? []).map((d: any)=>({ name: d.name, Installed: Number(d.installed.toFixed(2)), Dispatched: Number(d.dispatched.toFixed(2)) }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis unit=" MW" />
                        <Legend />
                        <ReTooltip />
                        <Bar dataKey="Installed" fill={MIX_COLORS[0]} />
                        <Bar dataKey="Dispatched" fill={MIX_COLORS[1]} />
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
                        <Pie data={(shareCalc?.comp ?? []).filter((d:any)=>d.installed>0).map((d: any)=>({ name:d.name, value:d.installed }))} dataKey="value" nameKey="name" outerRadius={110} label>
                          {(shareCalc?.comp ?? []).map((_: any, i: number) => (<Cell key={`m-${i}`} fill={MIX_COLORS[i % MIX_COLORS.length]} />))}
                        </Pie>
                        <Legend />
                        <ReTooltip formatter={(v:any,n:any)=>[`${toNumber(v).toFixed(1)} MW`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            // Manual mode builder (unchanged)
            <div className="grid md:grid-cols-4 gap-4">
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> Power Mix Builder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded border">
                    <div className="grid grid-cols-10 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <div className="col-span-2">Technology</div>
                      <div className="col-span-2 text-right">Units</div>
                      <div className="col-span-2 text-right">Unit MW</div>
                      <div className="col-span-2 text-right">Availability</div>
                      <div className="col-span-2 text-right">Heat rate / Water</div>
                    </div>
                    {mix.map((r) => (
                      <div key={r.id} className="grid grid-cols-10 gap-2 items-center px-3 py-2 border-t">
                        <div className="col-span-2">
                          <Select value={r.tech} onValueChange={(v:PowerTech)=>onChangeTech(r.id, v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(MIX_LIBRARY) as PowerTech[]).map((t)=> (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <Input type="number" inputMode="decimal" step={1} min={0} value={r.units} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,units:toNumber(e.target.value,0)}:x))} className="w-28" />
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <Input type="number" inputMode="decimal" step={0.1} min={0} value={r.unitMW} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,unitMW:toNumber(e.target.value,r.unitMW)}:x))} className="w-28" />
                          <span className="text-sm text-muted-foreground">MW</span>
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <Input type="number" inputMode="decimal" step={0.001} min={0} max={1} value={r.unitAvailability} onChange={(e)=>setMix((m)=>m.map(x=>x.id===r.id?{...x,unitAvailability:Math.max(0,Math.min(1,toNumber(e.target.value,r.unitAvailability)))}:x))} className="w-28" />
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
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={addRow}>Add row</Button>
                    <Button variant="outline" size="sm" onClick={()=>setMix((m)=>m.slice(0,Math.max(0,m.length-1)))}>Remove last</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="assumptions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <p>ELCC sliders (PV/Wind/BESS) let you accredit a portion of non‑firm capacity toward the reliability check.</p>
              <p>Detailed racking uses: <span className="font-mono">width × (depth + cold + hot) × (1 + extra%)</span>.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Reusable fields
function NumberField({ id, label, value, onChange, suffix, step = "any", min, max }:{ id:string; label:string; value:number; onChange:(n:number)=>void; suffix?:string; step?:string|number; min?:number; max?:number; }){
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

function PercentField({ id, label, valuePct, onChange }:{ id:string; label:string; valuePct:number; onChange:(pct:number)=>void; }){
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

function ReSlider({ value, max=100, step=1, onValueChange }:{ value:[number]; max?:number; step?:number; onValueChange:(v:[number])=>void; }){
  return (
    <input type="range" min={0} max={max} step={step} value={value[0]} onChange={(e)=>onValueChange([parseFloat(e.target.value)])} className="w-full" />
  );
}
