import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BuildingDetail } from "lod2-core/api";
import { SourceNote } from "@/components/editor/SourceNote";
import { PrintView } from "@/components/report/PrintView";
import type { Building } from "@/geometry/types";
import type { Language } from "@/i18n";
import { useEditorStore } from "@/store/building";
import { analyzePart } from "./analysis";
import {
  ageClassName,
  buildingFunctionName,
  roofTypeName,
  sourceNoteText,
  surveyText,
} from "./messages";
import { loadFixture, surveyFromFixture } from "./testFixtures";

const GERMAN = [
  "Geschosse",
  "Traufhöhe",
  "vereinfacht",
  "Grundriss",
  "Ecken",
  "ungedämmt",
  "Wohnhaus",
  "Mischform",
  "bis 1918",
];

function surveyed(language: Language) {
  const { detail, survey, neighbours } = loadFixture("DEBE02YY40000BOo");
  const result = analyzePart(
    detail,
    survey.partGid,
    surveyFromFixture(survey),
    neighbours,
    language,
  );
  if (!result.ok) throw new Error(result.reason);
  return { detail, analysis: result.analysis };
}

function load(building: Building, language: Language) {
  useEditorStore.setState({ language, selection: null });
  useEditorStore.getState().loadBuilding(building);
}

/** Everything of a surveyed building and its page that is shown as text. */
function shownText(detail: BuildingDetail, analysis: ReturnType<typeof surveyed>["analysis"]) {
  const { building, report } = analysis;
  const part = detail.parts.find((p) => p.hasGeometry);
  return [
    building.name,
    ...building.storeys.map((s) => s.name),
    ...building.zones.map((z) => z.name),
    ...building.constructions.map((c) => c.name),
    ...Object.values(building.sources ?? {}).map((s) => sourceNoteText(s, "en")),
    ...report.warnings.map((w) => surveyText(w, "en")),
    buildingFunctionName(detail.functionCode, "en"),
    roofTypeName(part?.roofTypeCode, "en"),
    ageClassName("bis1918", "en"),
  ].join("\n");
}

beforeEach(() => {
  window.innerWidth = 1600;
});

describe("survey notes in the UI language", () => {
  it("a full survey in English holds no German", () => {
    const { detail, analysis } = surveyed("en");
    const text = shownText(detail, analysis);
    for (const word of GERMAN) expect(text).not.toContain(word);
    expect(text).toContain("House DEBE02YY40000BOo");
    expect(text).toContain("Mixed form; Mixed form simplified to a gable roof");
    expect(text).toContain("Solid brick over 30 cm, uninsulated");
  });

  it("SourceNote shows the note in the language and follows a switch", () => {
    const { analysis } = surveyed("en");
    load(analysis.building, "en");
    const { unmount } = render(<SourceNote path="constructions" />);
    expect(screen.getByText(/^Default values up to 1918, .*age class assumed$/)).toBeTruthy();
    unmount();
    useEditorStore.getState().setLanguage("de");
    render(<SourceNote path="constructions" />);
    expect(
      screen.getByText(
        "Pauschalwerte bis 1918, Bekanntmachung Datenaufnahme Wohngebäudebestand vom 8.10.2020, Baualtersklasse angenommen",
      ),
    ).toBeTruthy();
    const wall = useEditorStore.getState().building.constructions.find((c) => c.id === "lod2-wall");
    expect(wall?.name).toBe("Vollziegel über 30 cm, ungedämmt");
  });

  it("formats numbers for the language", () => {
    const m = { key: "survey.storeys.estimated", values: { count: 5, height: 14.63 } };
    expect(surveyText(m, "en")).toBe(
      "5 storeys estimated from 14.63 m eaves height above the street",
    );
    expect(surveyText(m, "de")).toBe("5 Geschosse aus 14,63 m Traufhöhe über Straße geschätzt");
  });

  it("an old building with only a German note shows that note", () => {
    const { analysis } = surveyed("en");
    const old = structuredClone(analysis.building);
    for (const source of Object.values(old.sources ?? {})) delete source.messages;
    load(old, "en");
    render(<SourceNote path="roof" />);
    expect(screen.getByText("Mischform; Mischform als Satteldach vereinfacht")).toBeTruthy();
    // An unknown key falls back to the note too.
    expect(
      sourceNoteText({ kind: "lod2", note: "alt", messages: [{ key: "survey.nope" }] }, "en"),
    ).toBe("alt");
  });

  it("the report's sources table reads in English and German", () => {
    const { analysis } = surveyed("en");
    load(analysis.building, "en");
    const english = render(<PrintView embedded />);
    const enRow = screen.getByText(/^LoD2 city model: \d+ corners, [\d,.]+ m², simplified/);
    expect(enRow.textContent).toMatch(/^LoD2 city model: \d+ corners, \d+(,\d+)? m²/);
    english.unmount();
    useEditorStore.getState().setLanguage("de");
    render(<PrintView embedded />);
    expect(
      screen.getByText(
        /^LoD2-Stadtmodell: \d+ Ecken, [\d,.]+ m², aus dem LoD2-Grundriss vereinfacht$/,
      ),
    ).toBeTruthy();
  });
});
