import { describe, expect, it } from "vitest";
import { matchRoomName, nameForRoom, roomNameFor, roomNameHints } from "./roomNames";

const name = (text: string, language: "de" | "en" = "de") =>
  roomNameFor(text, language)?.name ?? null;

describe("room names read from a plan", () => {
  it("knows German and English names, any case", () => {
    expect(name("Wohnzimmer")).toBe("Wohnzimmer");
    expect(name("KÜCHE")).toBe("Küche");
    expect(name("Living room", "de")).toBe("Wohnzimmer");
    expect(name("Wohnzimmer", "en")).toBe("Living room");
    expect(name("BIBLIOTHEK", "en")).toBe("Library");
  });

  it("forgives what a text reader gets wrong on old or scanned plans", () => {
    expect(name("Kiiche")).toBe("Küche");
    expect(name("KUCHE")).toBe("Küche");
    expect(name("Vorraim 14 |i")).toBe("Vorraum");
    expect(name("BOUDOlR")).toBe("Boudoir");
    expect(name("Wohnzlmmer")).toBe("Wohnzimmer");
  });

  it("reads abbreviations and old names", () => {
    expect(name("HWR")).toBe("Hauswirtschaftsraum");
    expect(name("WC")).toBe("WC");
    expect(name("Abort")).toBe("WC");
    expect(name("Contor")).toBe("Büro");
    expect(name("Stube", "en")).toBe("Living room");
  });

  it("keeps two names joined as the plan writes them", () => {
    expect(name("Wohnen/Schlafen")).toBe("Wohnzimmer/Schlafzimmer");
    expect(name("Wohnen/Schlafen", "en")).toBe("Living room/Bedroom");
  });

  it("does not take floor finishes, measurements or plan words for rooms", () => {
    expect(matchRoomName("Dielen")).toBeNull();
    expect(matchRoomName("Parkett")).toBeNull();
    expect(matchRoomName("LH 3,46 m")).toBeNull();
    expect(matchRoomName("18,91 m²")).toBeNull();
    expect(matchRoomName("BRH 90")).toBeNull();
    expect(matchRoomName("Grundriss Erdgeschoss")).toBeNull();
    expect(matchRoomName("1.03")).toBeNull();
  });

  it("names a room after the best words inside it, else the model's guess", () => {
    const room = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const hints = roomNameHints(
      [
        { text: "Dielen", confidence: 95, at: { x: 2, y: 1 } },
        { text: "Esszimmer", confidence: 90, at: { x: 2, y: 2 } },
        { text: "Küche", confidence: 90, at: { x: 9, y: 9 } },
      ],
      [{ kind: "bedroom", at: { x: 2, y: 3 } }],
      "de",
    );
    expect(nameForRoom(room, hints)).toBe("Esszimmer");
    const unreadable = roomNameHints([], [{ kind: "bath", at: { x: 1, y: 1 } }], "en");
    expect(nameForRoom(room, unreadable)).toBe("Bathroom");
    expect(nameForRoom(room, [])).toBeNull();
  });
});
