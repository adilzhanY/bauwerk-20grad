import { describe, expect, it } from "vitest";
import {
  formatArea,
  formatBaumass,
  formatMetres,
  formatRelative,
  formatNumber,
  parseNumber,
} from "./format";

describe("formatNumber", () => {
  it("groups thousands by default in both languages", () => {
    expect(formatNumber(1800, "de")).toBe("1.800");
    expect(formatNumber(1800, "en")).toBe("1,800");
    expect(formatNumber(1234.5, "de")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  });

  it("can switch grouping off for editable inputs", () => {
    expect(formatNumber(1800, "de", 2, { useGrouping: false })).toBe("1800");
    expect(formatNumber(1800, "en", 2, { useGrouping: false })).toBe("1800");
    expect(formatNumber(1234.5, "de", 2, { useGrouping: false })).toBe("1234,5");
    expect(formatNumber(1234.5, "en", 2, { useGrouping: false })).toBe("1234.5");
    expect(formatNumber(1000, "de", 0, { useGrouping: false })).toBe("1000");
  });

  it("respects the digit limit and units", () => {
    expect(formatNumber(0.3456, "en", 2)).toBe("0.35");
    expect(formatMetres(2.5, "de")).toBe("2,5 m");
    expect(formatArea(80, "en")).toBe("80 m²");
  });
});

describe("parseNumber", () => {
  const values = [0, 0.3, 1234.5, 999999.99];

  it("round trips grouped German output", () => {
    for (const v of values) expect(parseNumber(formatNumber(v, "de"), "de")).toBe(v);
    expect(parseNumber("1.234,5", "de")).toBe(1234.5);
  });

  it("round trips grouped English output", () => {
    for (const v of values) expect(parseNumber(formatNumber(v, "en"), "en")).toBe(v);
    expect(parseNumber("1,234.5", "en")).toBe(1234.5);
  });

  it("round trips ungrouped output", () => {
    for (const v of values) {
      expect(parseNumber(formatNumber(v, "de", 2, { useGrouping: false }), "de")).toBe(v);
      expect(parseNumber(formatNumber(v, "en", 2, { useGrouping: false }), "en")).toBe(v);
    }
  });

  it("reads comma and dot as the decimal mark without a language", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber(" 1800 ")).toBe(1800);
  });

  it("accepts either decimal mark in both languages", () => {
    expect(parseNumber("0,33", "de")).toBe(0.33);
    expect(parseNumber("0.33", "de")).toBe(0.33);
    expect(parseNumber("0,33", "en")).toBe(0.33);
    expect(parseNumber("0.33", "en")).toBe(0.33);
  });

  it("returns null for empty or unreadable text", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc", "de")).toBeNull();
    expect(parseNumber("1.2.3")).toBeNull();
  });
});

describe("formatNumber with fixed decimals", () => {
  it("keeps trailing zeros and uses the language's decimal mark", () => {
    expect(formatNumber(3.5, "de", 2, { fixed: true })).toBe("3,50");
    expect(formatNumber(3.5, "en", 2, { fixed: true })).toBe("3.50");
    expect(formatNumber(3.5, "de", 2)).toBe("3,5");
  });
});

describe("formatBaumass", () => {
  it("writes centimetres below a metre and metres above, without a unit", () => {
    expect(formatBaumass(0.76, "de")).toBe("76");
    expect(formatBaumass(3.51, "de")).toBe("3,51");
    expect(formatBaumass(3.51, "en")).toBe("3.51");
    expect(formatBaumass(13.88, "de")).toBe("13,88");
    expect(formatBaumass(1, "de")).toBe("1,00");
  });

  it("raises a half centimetre", () => {
    expect(formatBaumass(1.015, "de")).toBe("1,01\u2075");
    expect(formatBaumass(0.365, "de")).toBe("36\u2075");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it("says how long ago, in both languages", () => {
    expect(formatRelative("2026-09-28T10:00:00Z", "en", now)).toBe("2 hours ago");
    expect(formatRelative("2026-09-27T12:00:00Z", "de", now)).toBe("gestern");
    expect(formatRelative("2026-09-28T11:59:50Z", "en", now)).toBe("this minute");
  });
});
