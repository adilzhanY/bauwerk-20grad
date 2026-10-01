import { ageConstructionName } from "@/geometry/ageDefaults";
import { defaultConstructions } from "@/geometry/constructions";
import { windowConstruction, windowType } from "@/geometry/windows";
import { surveyBuildingName, surveyConstructionName } from "@/lod2/messages";
import type { Building, Construction } from "@/geometry/types";
import { defaultRoomName, defaultStoreyName } from "./index";
import type { Language } from "./index";

type Pair = readonly [en: string, de: string];

const BUILDINGS: Pair[] = [
  ["Family house", "Einfamilienhaus"],
  ["Office block", "Bürogebäude"],
  ["Berlin office tower, 18 storeys", "Berliner Bürohochhaus, 18 Geschosse"],
  ["Kreuzberg apartment house, built 1905", "Altbau Kreuzberg, Baujahr 1905"],
  ["New building", "Neues Gebäude"],
];

const ROOMS: Pair[] = [
  ["Kitchen", "Küche"],
  ["Living room", "Wohnzimmer"],
  ["Hall", "Flur"],
  ["Bedroom", "Schlafzimmer"],
  ["Office", "Büro"],
  ["Shop", "Ladenlokal"],
  ["Flat left", "Wohnung links"],
  ["Flat right", "Wohnung rechts"],
  ["Living left", "Wohnen links"],
  ["Living right", "Wohnen rechts"],
  ["Bedroom left", "Schlafen links"],
  ["Bedroom right", "Schlafen rechts"],
  ["Stairwell", "Treppenhaus"],
];

const ZONES: Pair[] = [
  ["Heated", "Beheizt"],
  ["Unheated", "Unbeheizt"],
  ["Living", "Wohnen"],
  ["Shop", "Laden"],
  ["Stairwell", "Treppenhaus"],
  ["Offices", "Büros"],
  ["Service core", "Kernbereich"],
];

const SCENARIOS: Pair[] = [
  ["Windows and roof", "Fenster und Dach"],
  ["Insulate the facade", "Fassade dämmen"],
];

function knownName(value: string, pairs: readonly Pair[], language: Language): string {
  const pair = pairs.find(([en, de]) => value === en || value === de);
  return pair?.[language === "de" ? 1 : 0] ?? value;
}

function storeyName(value: string, language: Language): string {
  if (value === "Ground floor" || value === "Erdgeschoss") return defaultStoreyName(0, language);
  const english = /^(\d+)(?:st|nd|rd|th) floor$/.exec(value);
  const german = /^(\d+)\. Obergeschoss$/.exec(value);
  const index = Number(english?.[1] ?? german?.[1]);
  return Number.isInteger(index) && index > 0 ? defaultStoreyName(index, language) : value;
}

function roomName(value: string, language: Language): string {
  const generated = /^(?:Room|Raum) (\d+)$/.exec(value);
  if (generated?.[1]) return defaultRoomName(Number(generated[1]), language);
  const office = /^(?:Office|Büro) (\d+)\.(\d+)$/.exec(value);
  if (office?.[1] && office[2]) {
    return `${language === "de" ? "Büro" : "Office"} ${office[1]}.${office[2]}`;
  }
  const core = /^(?:Core|Kern) (\d+)$/.exec(value);
  if (core?.[1]) return `${language === "de" ? "Kern" : "Core"} ${core[1]}`;
  return knownName(value, ROOMS, language);
}

function constructionName(construction: Construction, language: Language): Construction {
  if (construction.id.startsWith("lod2-"))
    return { ...construction, name: surveyConstructionName(construction.name, language) };
  const age = [
    ageConstructionName(construction.id, "en"),
    ageConstructionName(construction.id, "de"),
  ];
  if (age[0] && age[1] && age.includes(construction.name))
    return {
      ...construction,
      name: ageConstructionName(construction.id, language) ?? construction.name,
    };
  const catalogue = windowType(construction.id);
  const english =
    defaultConstructions("en").find((item) => item.id === construction.id) ??
    (catalogue ? windowConstruction(catalogue, "en") : undefined);
  const german =
    defaultConstructions("de").find((item) => item.id === construction.id) ??
    (catalogue ? windowConstruction(catalogue, "de") : undefined);
  if (!english || !german) return construction;
  const name =
    construction.name === english.name || construction.name === german.name
      ? language === "de"
        ? german.name
        : english.name
      : construction.name;
  const layers = construction.layers?.map((layer) => {
    const enLayer = english.layers?.find((item) => item.id === layer.id);
    const deLayer = german.layers?.find((item) => item.id === layer.id);
    if (!enLayer || !deLayer || (layer.name !== enLayer.name && layer.name !== deLayer.name))
      return layer;
    return { ...layer, name: language === "de" ? deLayer.name : enLayer.name };
  });
  return { ...construction, name, ...(layers ? { layers } : {}) };
}

/** Localises known generated and example names while preserving names entered by the user. */
export function localizeBuilding(building: Building, language: Language): Building {
  return {
    ...building,
    name: surveyBuildingName(knownName(building.name, BUILDINGS, language), language),
    storeys: building.storeys.map((storey) => ({
      ...storey,
      name: storeyName(storey.name, language),
      rooms: storey.rooms.map((room) => ({ ...room, name: roomName(room.name, language) })),
    })),
    zones: building.zones.map((zone) => ({
      ...zone,
      name: knownName(zone.name, ZONES, language),
    })),
    constructions: building.constructions.map((construction) =>
      constructionName(construction, language),
    ),
    scenarios: building.scenarios?.map((scenario) => ({
      ...scenario,
      name: knownName(scenario.name, SCENARIOS, language),
    })),
  };
}
