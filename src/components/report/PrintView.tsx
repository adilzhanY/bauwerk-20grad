import { useEffect } from "react";
import { computeEnergy } from "@/geometry/energy";
import type { EnergySummary } from "@/geometry/energy";
import { findConstruction } from "@/geometry/constructions";
import { epsgForZone, toUtm } from "@/geometry/geo";
import { bounds, edges } from "@/geometry/polygon";
import type { Building, Storey, ConstructionCategory } from "@/geometry/types";
import { heatingOf, priceOf } from "@/geometry/supply";
import { areaList } from "@/geometry/areaList";
import { AREA_HEADER_KEYS, DIRECTION_KEYS, ELEMENT_KEYS } from "@/lib/areaWords";
import { useT } from "@/i18n/useT";
import { EnergyScale } from "@/components/shared/EnergyScale";
import { gegChecks, gegPassCount } from "@/geometry/geg";
import type { MessageKey } from "@/i18n";
import { useEditorStore } from "@/store/building";
import { LayerSection, LayerTable } from "@/components/shared/LayerSection";
import { buildRoof, roofOf } from "@/geometry/roof";
import { buildRoadmap, evaluateAll } from "@/geometry/scenarios";
import { sourceRows } from "@/geometry/sources";
import { sourceNoteText } from "@/lod2/messages";
import type { SourceKind } from "@/geometry/types";

/*
  The report is a document, not an interface. It follows the conventions of
  German building documents: plain sans type, black hairlines, grey field
  labels over white value boxes, a numbered section order, the energy scale
  from A+ to H with kWh/(m²a) ticks. No rounded corners, no shadows, no colour
  outside the scale. Numbers, dates and times use German conventions whatever
  the interface language: 1.234,5 and 05.09.2026, 18:04.
*/

const DE = "de-DE";
const num = (v: number, digits = 1) =>
  new Intl.NumberFormat(DE, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(v);
const dateTime = (d: Date) =>
  `${new Intl.DateTimeFormat(DE, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)}, ${new Intl.DateTimeFormat(DE, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d)}`;

/** `embedded`: shown as a project's Report step, where the step bar is the way back. */
export function PrintView({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const energy = computeEnergy(building);
  const renovated =
    evaluateAll(building).find((result) => result.scenario.id === "full-envelope")?.energy ??
    energy;
  const now = new Date();
  const hasSources = sourceRows(building).length > 0;
  const methodNumber = 5 + building.storeys.length + (hasSources ? 1 : 0);

  // Opened by Print in the Report step: print as soon as the page has drawn.
  useEffect(() => {
    if (embedded || new URLSearchParams(window.location.search).get("autoprint") !== "1") return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [embedded]);

  return (
    <div
      className="doc min-h-full bg-white text-black"
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: "11pt",
        lineHeight: 1.4,
        colorScheme: "light",
      }}
    >
      <style>{`
        .doc { --rule: #000; }
        .doc .page { max-width: 190mm; margin: 0 auto; padding: 14mm 0 12mm; }
        .doc .page + .page { border-top: 1px dashed #999; }
        .doc h1 { font-size: 20pt; font-weight: bold; margin: 0; letter-spacing: 0; }
        .doc h2 { font-size: 12pt; font-weight: bold; margin: 0; padding: 4pt 0 3pt; border-bottom: 1.5px solid var(--rule); }
        .doc h2 span.n { display: inline-block; width: 22pt; }
        .doc .fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; border-left: 1px solid var(--rule); border-top: 1px solid var(--rule); }
        .doc .field { border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); display: grid; grid-template-columns: 42% 58%; }
        .doc .field .k { background: #e6e6e6; padding: 4pt 6pt; font-size: 9pt; }
        .doc .field .v { padding: 4pt 6pt; font-size: 10.5pt; }
        .doc table { width: 100%; border-collapse: collapse; font-size: 10pt; }
        .doc th { text-align: left; background: #e6e6e6; font-weight: normal; font-size: 9pt; padding: 3pt 5pt; border-bottom: 1px solid var(--rule); border-top: 1px solid var(--rule); }
        .doc td { padding: 3pt 5pt; border-bottom: 1px solid #999; vertical-align: top; }
        .doc td.r, .doc th.r { text-align: right; font-variant-numeric: tabular-nums; }
        .doc .small { font-size: 9pt; color: #333; }
        .doc .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8pt 0; border-bottom: 1px solid #999; margin-bottom: 8pt; }
        .doc .toolbar a, .doc .toolbar button { font: inherit; font-size: 10pt; color: #000; background: #fff; border: 1px solid #000; padding: 4pt 10pt; cursor: pointer; text-decoration: none; }
        @media print {
          @page { size: A4; margin: 16mm 18mm; }
          .doc .toolbar { display: none; }
          .doc .page { max-width: none; padding: 0; break-after: page; }
          .doc .page:last-child { break-after: auto; }
          .doc .page + .page { border-top: none; }
        }
      `}</style>

      <div className="page">
        <div className="toolbar">
          {embedded ? (
            <span />
          ) : (
            <a href={typeof window === "undefined" ? "/" : window.location.pathname}>
              {t("print.back")}
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              // Inside the app the page around the report would print too, cut at the scroll
              // position: the report alone opens in a tab of its own and prints from there.
              if (!embedded) {
                window.print();
                return;
              }
              const url = new URL(window.location.href);
              url.searchParams.set("print", "1");
              url.searchParams.set("autoprint", "1");
              window.open(url.toString(), "_blank", "noopener");
            }}
          >
            {t("print.print")}
          </button>
        </div>

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderBottom: "2px solid #000",
            paddingBottom: "6pt",
            marginBottom: "10pt",
          }}
        >
          <div>
            <div className="small">{t("print.title")}</div>
            <h1>{building.name}</h1>
          </div>
          <div className="small" style={{ textAlign: "right" }}>
            <div>
              {t("print.issued")}: <time dateTime={now.toISOString()}>{dateTime(now)}</time>
            </div>
            <div>{t("print.generatedBy")}</div>
          </div>
        </header>
        <p
          className="small"
          style={{ border: "1px solid #000", padding: "4pt 6pt", margin: "0 0 10pt" }}
        >
          {t("print.disclaimer")}
        </p>

        <h2>
          <span className="n">1</span>
          {t("print.section.building")}
        </h2>
        <BuildingFields building={building} energy={energy} />

        <h2 style={{ marginTop: "12pt" }}>
          <span className="n">2</span>
          {t("print.section.energy")}
        </h2>
        <EnergyTable current={energy} renovated={renovated} />
        <EnergyScale variant="print" current={energy} compare={renovated} />

        <h2 style={{ marginTop: "12pt" }}>
          <span className="n">3</span>
          {t("print.section.elements")}
        </h2>
        <ElementsTable energy={energy} />
        <AreaListTable building={building} energy={energy} />
        <GegTable building={building} />
        <ConstructionLayers building={building} />
        <BridgesTable energy={energy} />
      </div>

      {building.storeys.map((storey, i) => (
        <div className="page" key={storey.id}>
          <h2>
            <span className="n">{4 + i}</span>
            {t("print.section.storey")}: {storey.name}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10pt",
              marginTop: "8pt",
            }}
          >
            <StoreyPlan storey={storey} />
            <div>
              <div className="fields" style={{ gridTemplateColumns: "1fr", marginBottom: "8pt" }}>
                <Field k={t("storey.height")} v={`${num(storey.height, 2)} m`} />
                <Field k={t("storey.openings")} v={String(storey.openings.length)} />
                <Field k={t("storey.rooms")} v={String(storey.rooms.length)} />
                <Field
                  k={t("room.area")}
                  v={`${num(
                    storey.rooms.reduce((s, r) => s + r.area, 0),
                    2,
                  )} m²`}
                />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>{t("room.title")}</th>
                    <th>{t("room.zone")}</th>
                    <th className="r">{t("room.area")}</th>
                  </tr>
                </thead>
                <tbody>
                  {storey.rooms.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{building.zones.find((z) => z.id === r.zoneId)?.name ?? ""}</td>
                      <td className="r">{num(r.area, 2)} m²</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      <div className="page">
        <h2>
          <span className="n">{4 + building.storeys.length}</span>
          {t("scenarios.roadmap")}
        </h2>
        <Roadmap building={building} />
      </div>

      {hasSources && (
        <div className="page">
          <h2>
            <span className="n">{5 + building.storeys.length}</span>
            {t("print.section.sources")}
          </h2>
          <SourcesTable building={building} />
        </div>
      )}

      <div className="page">
        <h2>
          <span className="n">{methodNumber}</span>
          {t("print.section.method")}
        </h2>
        <p className="small" style={{ marginTop: "6pt" }}>
          {t("energy.assumptions")}
        </p>
        <p className="small">{t("print.methodText")}</p>
        <p
          className="small"
          style={{ marginTop: "16pt", borderTop: "1px solid #999", paddingTop: "4pt" }}
        >
          {t("print.generated", { date: dateTime(now) })}
        </p>
      </div>
    </div>
  );
}

/** Variants as steps in order of payback, the way the iSFP presents measure packages. */
function Roadmap({ building }: { building: Building }) {
  const t = useT();
  const steps = buildRoadmap(building);
  return (
    <>
      <p className="small" style={{ marginTop: "6pt" }}>
        {t("scenarios.roadmapIntro")}{" "}
        {t("scenarios.costHint", {
          carrier: t(`carrier.${heatingOf(building).carrier}`),
          price: num(priceOf(building, heatingOf(building).carrier), 2),
        })}
      </p>
      <table style={{ marginTop: "6pt" }}>
        <thead>
          <tr>
            <th style={{ width: "7%" }}>{t("scenarios.step")}</th>
            <th style={{ width: "8%" }}>{t("scenarios.yearHeader")}</th>
            <th>{t("scenarios.measure")}</th>
            <th className="r">{t("energy.energyClass")}</th>
            <th className="r">{t("energy.specificEndEnergy")} [kWh/(m²a)]</th>
            <th className="r">{t("scenarios.demandSaved")} [kWh/a]</th>
            <th className="r">{t("scenarios.investment")} [€]</th>
            <th className="r">{t("scenarios.cumulative")} [€]</th>
            <th className="r">{t("scenarios.saving")} [€]</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.scenario.id}>
              <td>{s.index + 1}</td>
              <td>{num(s.year, 0)}</td>
              <td>{s.scenario.id === "full-envelope" ? t("scenarios.full") : s.scenario.name}</td>
              <td className="r">{s.energy.energyClass}</td>
              <td className="r">{num(s.energy.specificEndEnergy, 0)}</td>
              <td className="r">{num(s.demandSaved, 0)}</td>
              <td className="r">{num(s.investment, 0)}</td>
              <td className="r">{num(s.cumulativeInvestment, 0)}</td>
              <td className="r">{num(s.savingPerYear, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BridgesTable({ energy }: { energy: EnergySummary }) {
  const t = useT();
  const keys: Record<string, MessageKey> = {
    corner: "bridges.type.corner",
    opening: "bridges.type.opening",
    slabEdge: "bridges.type.slabEdge",
    roofEdge: "bridges.type.roofEdge",
    floorJoint: "bridges.type.floorJoint",
    junction: "bridges.type.junction",
  };
  const detail = energy.bridges;
  const rows = (Object.entries(detail.lengths) as [keyof typeof detail.lengths, number][]).filter(
    ([, l]) => l > 0,
  );
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: "10pt" }}>
      <div
        style={{
          fontSize: "10pt",
          fontWeight: "bold",
          borderBottom: "1px solid #000",
          padding: "2pt 0",
        }}
      >
        {t("bridges.title")}
      </div>
      <table style={{ marginTop: "4pt" }}>
        <thead>
          <tr>
            <th>{t("print.element")}</th>
            <th className="r">l [m]</th>
            <th className="r">ψ [W/(m·K)]</th>
            <th className="r">ψ·l [W/K]</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, l]) => (
            <tr key={k}>
              <td>{t(keys[k] ?? "bridges.title")}</td>
              <td className="r">{num(l, 1)}</td>
              <td className="r">{num(detail.losses[k] / l, 2)}</td>
              <td className="r">{num(detail.losses[k], 1)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: "bold" }}>{t("print.total")}</td>
            <td />
            <td />
            <td className="r" style={{ fontWeight: "bold" }}>
              {num(detail.total, 1)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GegTable({ building }: { building: Building }) {
  const t = useT();
  const checks = gegChecks(building);
  const label: Record<ConstructionCategory, MessageKey> = {
    wall: "energy.wallConstruction",
    roof: "energy.roofConstruction",
    floor: "energy.floorConstruction",
    window: "energy.windowDefault",
    door: "energy.doorDefault",
  };
  return (
    <>
      <h3 style={{ marginTop: "10pt" }}>
        {t("geg.title")}: {t("geg.passed", { n: gegPassCount(checks), total: checks.length })}
      </h3>
      <table style={{ marginTop: "4pt" }}>
        <thead>
          <tr>
            <th>{t("energy.construction")}</th>
            <th>{t("print.element")}</th>
            <th className="r">U [W/(m²K)]</th>
            <th className="r">{t("geg.limit")} [W/(m²K)]</th>
            <th className="r">{t("geg.result")}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.category}>
              <td>{c.construction?.name ?? t("print.notGiven")}</td>
              <td>{t(label[c.category])}</td>
              <td className="r">{Number.isFinite(c.uValue) ? num(c.uValue, 2) : ""}</td>
              <td className="r">{num(c.limit, 2)}</td>
              <td className="r">{t(c.ok ? "geg.pass" : "geg.fail")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small" style={{ marginTop: "4pt" }}>
        {t("geg.hint")}
      </p>
    </>
  );
}

function ConstructionLayers({ building }: { building: Building }) {
  const ids = [
    building.wallConstructionId,
    building.roofConstructionId,
    building.floorConstructionId,
  ];
  const layered = ids
    .map((id) => findConstruction(building.constructions, id))
    .filter((c): c is NonNullable<typeof c> => c?.layers !== undefined && c.layers.length > 0);
  if (layered.length === 0) return null;
  return (
    <div style={{ marginTop: "10pt" }}>
      {layered.map((c) => (
        <div key={c.id} style={{ marginBottom: "10pt", breakInside: "avoid" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10pt",
              fontWeight: "bold",
              borderBottom: "1px solid #000",
              padding: "2pt 0",
            }}
          >
            <span>{c.name}</span>
            <span>U = {num(c.uValue, 3)} W/(m²K)</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr",
              gap: "8pt",
              alignItems: "start",
              marginTop: "4pt",
            }}
          >
            <LayerSection layers={c.layers ?? []} language="de" plain />
            <LayerTable layers={c.layers ?? []} language="de" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="field">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function BuildingFields({ building, energy }: { building: Building; energy: EnergySummary }) {
  const t = useT();
  const c = (id: string) => findConstruction(building.constructions, id);
  const construction = (id: string) => {
    const x = c(id);
    return x ? `${x.name} (U = ${num(x.uValue, 2)} W/(m²K))` : "";
  };
  const origin = building.origin;
  const location = origin
    ? (() => {
        const u = toUtm(origin);
        const latitude = `${num(Math.abs(origin.lat), 6)}° ${origin.lat >= 0 ? "N" : "S"}`;
        const longitude = `${num(Math.abs(origin.lon), 6)}° ${origin.lon >= 0 ? "E" : "W"}`;
        const hemisphere = u.north ? "N" : "S";
        return `${latitude}, ${longitude} · UTM ${u.zone}${hemisphere} ${num(u.easting, 0)} E ${num(u.northing, 0)} N (EPSG:${epsgForZone(u.zone)})`;
      })()
    : t("print.notGiven");
  const height = building.storeys.reduce((s, x) => s + x.height, 0);
  return (
    <div className="fields">
      <Field k={t("building.name")} v={building.name} />
      <Field k={t("location.title")} v={location} />
      <Field k={t("status.storeys")} v={String(building.storeys.length)} />
      <Field
        k={t("status.rooms")}
        v={String(building.storeys.reduce((s, x) => s + x.rooms.length, 0))}
      />
      <Field k={t("print.totalHeight")} v={`${num(height, 2)} m`} />
      <Field k={t("energy.heatedFloorArea")} v={`${num(energy.heatedFloorArea, 2)} m²`} />
      <Field k={t("energy.referenceArea")} v={`${num(energy.referenceArea, 2)} m²`} />
      <Field k={t("energy.envelopeArea")} v={`${num(energy.envelopeArea, 2)} m²`} />
      <Field k={t("energy.windowToWall")} v={`${num(energy.windowToWallRatio * 100, 0)} %`} />
      <Field
        k={t("roof.kind")}
        v={`${t(`roof.${roofOf(building).kind}`)}${roofOf(building).kind === "flat" ? "" : `, ${num(roofOf(building).pitch, 0)}°`}`}
      />
      <Field k={t("energy.wallConstruction")} v={construction(building.wallConstructionId)} />
      <Field k={t("energy.roofConstruction")} v={construction(building.roofConstructionId)} />
      <Field k={t("energy.floorConstruction")} v={construction(building.floorConstructionId)} />
      <Field k={t("energy.windowDefault")} v={construction(building.windowConstructionId)} />
    </div>
  );
}

function EnergyTable({ current, renovated }: { current: EnergySummary; renovated: EnergySummary }) {
  const t = useT();
  const rows: [MessageKey, (e: EnergySummary) => string][] = [
    ["energy.transmissionLoss", (e) => `${num(e.transmissionLoss, 1)} W/K`],
    ["energy.specificTransmissionLoss", (e) => `${num(e.specificTransmissionLoss, 2)} W/(m²K)`],
    ["energy.ventilationLoss", (e) => `${num(e.ventilationLoss, 1)} W/K`],
    ["energy.solarGains", (e) => `${num(e.solarGains, 0)} kWh/a`],
    ["energy.internalGains", (e) => `${num(e.internalGains, 0)} kWh/a`],
    ["energy.heatingDemand", (e) => `${num(e.heatingDemand, 0)} kWh/a`],
    ["energy.specificHeatingDemand", (e) => `${num(e.specificHeatingDemand, 0)} kWh/(m²a)`],
    ["energy.specificEndEnergy", (e) => `${num(e.specificEndEnergy, 0)} kWh/(m²a)`],
    ["energy.energyClass", (e) => e.energyClass],
  ];
  return (
    <table style={{ marginTop: "6pt" }}>
      <thead>
        <tr>
          <th style={{ width: "50%" }}>{t("print.indicator")}</th>
          <th className="r">{t("energy.scenario.current")}</th>
          <th className="r">{t("energy.scenario.renovated")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, f]) => (
          <tr key={key}>
            <td>{t(key)}</td>
            <td className="r">{f(current)}</td>
            <td className="r">{f(renovated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The envelope by element and direction, as it goes into the calculation software. */
function AreaListTable({ building, energy }: { building: Building; energy: EnergySummary }) {
  const t = useT();
  const rows = areaList(building, energy);
  return (
    <>
      <h3 style={{ marginTop: "8pt" }}>{t("areas.title")}</h3>
      <table style={{ marginTop: "4pt" }}>
        <thead>
          <tr>
            {AREA_HEADER_KEYS.map((key, i) => (
              <th key={key} className={i < 2 ? undefined : "r"}>
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{t(ELEMENT_KEYS[r.element])}</td>
              <td>{r.direction === null ? "" : t(DIRECTION_KEYS[r.direction])}</td>
              <td className="r">{num(r.tilt, 0)}</td>
              <td className="r">{num(r.area, 2)}</td>
              <td className="r">{num(r.uValue, 2)}</td>
              <td className="r">{num(r.fx, 2)}</td>
              <td className="r">{num(r.ht, 2)}</td>
              <td className="r">{r.count > 0 ? r.count : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ElementsTable({ energy }: { energy: EnergySummary }) {
  const t = useT();
  const categoryKey: Record<string, MessageKey> = {
    wall: "category.wall",
    window: "category.window",
    door: "category.door",
    floor: "category.floor",
    roof: "category.roof",
    interiorWall: "category.interiorWall",
    bridge: "category.bridge",
  };
  // Aggregate by category and U-value so the table stays short.
  const groups = new Map<
    string,
    { category: string; uValue: number; area: number; loss: number }
  >();
  for (const e of energy.elements) {
    const key = `${e.category}:${e.uValue}`;
    const g = groups.get(key) ?? { category: e.category, uValue: e.uValue, area: 0, loss: 0 };
    g.area += e.area;
    g.loss += e.loss;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.loss - a.loss);
  const total = rows.reduce((s, r) => s + r.loss, 0);
  return (
    <table style={{ marginTop: "6pt" }}>
      <thead>
        <tr>
          <th>{t("print.element")}</th>
          <th className="r">U [W/(m²K)]</th>
          <th className="r">{t("print.heatTransferArea")} [m²]</th>
          <th className="r">U·A [W/K]</th>
          <th className="r">{t("print.share")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.category}-${r.uValue}`}>
            <td>{t(categoryKey[r.category] ?? "category.wall")}</td>
            <td className="r">{r.category === "bridge" ? "" : num(r.uValue, 2)}</td>
            <td className="r">{r.category === "bridge" ? "" : num(r.area, 2)}</td>
            <td className="r">{num(r.loss, 1)}</td>
            <td className="r">{total > 0 ? `${num((r.loss / total) * 100, 0)} %` : ""}</td>
          </tr>
        ))}
        <tr>
          <td style={{ fontWeight: "bold" }}>{t("print.total")}</td>
          <td />
          <td className="r" style={{ fontWeight: "bold" }}>
            {num(
              rows.reduce((s, r) => s + r.area, 0),
              2,
            )}
          </td>
          <td className="r" style={{ fontWeight: "bold" }}>
            {num(total, 1)}
          </td>
          <td className="r">100 %</td>
        </tr>
      </tbody>
    </table>
  );
}

function StoreyPlan({ storey }: { storey: Storey }) {
  const building = useEditorStore((s) => s.building);
  const { min, max } = bounds(building.footprint);
  const pad = 1;
  const w = max.x - min.x + 2 * pad;
  const h = max.y - min.y + 2 * pad;
  const px = (x: number) => x - min.x + pad;
  const py = (y: number) => max.y - y + pad;
  const pt = (p: { x: number; y: number }) => `${px(p.x)},${py(p.y)}`;
  const es = edges(building.footprint);
  const ridges =
    storey === building.storeys[building.storeys.length - 1] ? buildRoof(building, 0).ridges : [];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", border: "1px solid #000" }}
      role="img"
      aria-label={storey.name}
    >
      <rect x="0" y="0" width={w} height={h} fill="#fff" />
      {storey.rooms.map((r) => (
        <polygon key={r.id} points={r.polygon.map(pt).join(" ")} fill="#f2f2f2" stroke="none" />
      ))}
      <polygon
        points={building.footprint.map(pt).join(" ")}
        fill="none"
        stroke="#000"
        strokeWidth={0.3}
      />
      {storey.interiorWalls.map((s, i) => (
        <line
          key={i}
          x1={px(s.a.x)}
          y1={py(s.a.y)}
          x2={px(s.b.x)}
          y2={py(s.b.y)}
          stroke="#000"
          strokeWidth={0.1}
        />
      ))}
      {storey.openings.map((o) => {
        const e = o.interior
          ? (() => {
              const seg = storey.interiorWalls[o.wallIndex];
              if (!seg) return undefined;
              const d = { x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y };
              const len = Math.hypot(d.x, d.y) || 1;
              return { a: seg.a, direction: { x: d.x / len, y: d.y / len } };
            })()
          : es[o.wallIndex];
        if (!e) return null;
        const a = { x: e.a.x + e.direction.x * o.offset, y: e.a.y + e.direction.y * o.offset };
        const b = { x: a.x + e.direction.x * o.width, y: a.y + e.direction.y * o.width };
        return (
          <line
            key={o.id}
            x1={px(a.x)}
            y1={py(a.y)}
            x2={px(b.x)}
            y2={py(b.y)}
            stroke="#fff"
            strokeWidth={0.36}
            strokeDasharray={o.kind === "door" ? "0.3 0.15" : undefined}
          />
        );
      })}
      {ridges.map((ridge, i) => (
        <line
          key={i}
          x1={px(ridge.a.x)}
          y1={py(ridge.a.y)}
          x2={px(ridge.b.x)}
          y2={py(ridge.b.y)}
          stroke="#000"
          strokeWidth={0.12}
          strokeDasharray="0.6 0.3"
        />
      ))}
      {storey.rooms.map((r) => {
        const c = r.polygon.reduce(
          (s, p) => ({ x: s.x + p.x / r.polygon.length, y: s.y + p.y / r.polygon.length }),
          { x: 0, y: 0 },
        );
        return (
          <g key={`${r.id}-l`}>
            <text x={px(c.x)} y={py(c.y) - 0.1} fontSize={0.42} textAnchor="middle" fill="#000">
              {r.name}
            </text>
            <text x={px(c.x)} y={py(c.y) + 0.45} fontSize={0.32} textAnchor="middle" fill="#333">
              {num(r.area, 1)} m²
            </text>
          </g>
        );
      })}
      {es.map((e) => (
        <text
          key={e.index}
          x={px((e.a.x + e.b.x) / 2 + e.normal.x * 0.55)}
          y={py((e.a.y + e.b.y) / 2 + e.normal.y * 0.55)}
          fontSize={0.3}
          textAnchor="middle"
          fill="#000"
        >
          {num(e.length, 2)} m
        </text>
      ))}
    </svg>
  );
}

const SOURCE_KIND_KEYS: Record<SourceKind, MessageKey> = {
  lod2: "source.kind.lod2",
  photo: "source.kind.photo",
  catalogue: "source.kind.catalogue",
  estimate: "source.kind.estimate",
  typed: "source.kind.typed",
};

const SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  footprint: "print.sources.footprint",
  storeys: "print.sources.storeys",
  roof: "print.sources.roof",
  sharedEdges: "print.sources.sharedEdges",
  constructions: "print.sources.constructions",
};

/** Every value brought in from a survey, where it came from, and whether it was changed. */
function SourcesTable({ building }: { building: Building }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const rows = sourceRows(building);
  // In the UI language, numbers the German way like the rest of the report.
  const note = (row: (typeof rows)[number]) => {
    const text = sourceNoteText(row.source, language, "de");
    return text ? `: ${text}` : "";
  };
  const label = (path: string) => {
    const key = SOURCE_LABEL_KEYS[path];
    if (key) return t(key);
    return t("print.sources.opening", { id: path.replace(/^opening:/, "") });
  };
  const state = (row: (typeof rows)[number]) =>
    row.gone
      ? t("print.sources.gone")
      : row.edited
        ? t("print.sources.edited")
        : t("print.sources.unchanged");
  return (
    <>
      <p className="small" style={{ marginTop: "6pt" }}>
        {t("print.sources.intro")}
      </p>
      <table style={{ marginTop: "6pt" }}>
        <thead>
          <tr>
            <th style={{ width: "22%" }}>{t("print.sources.value")}</th>
            <th>{t("print.sources.source")}</th>
            <th style={{ width: "16%" }}>{t("print.sources.state")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td>{label(row.path)}</td>
              <td>
                {t(SOURCE_KIND_KEYS[row.source.kind])}
                {row.source.photo ? ` (${row.source.photo})` : ""}
                {note(row)}
              </td>
              <td>{state(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
