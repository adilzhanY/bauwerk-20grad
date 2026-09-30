import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { areaList } from "@/geometry/areaList";
import { computeEnergy } from "@/geometry/energy";
import { useEditorStore } from "@/store/building";
import * as download from "@/lib/download";
import { AreaListSection } from "@/components/editor/AreaListSection";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "de" });
});

describe("area list in the panel", () => {
  it("shows every row and downloads the same rows as German CSV", () => {
    const b = exampleHouse("de");
    const e = computeEnergy(b);
    const spy = vi.spyOn(download, "downloadFile").mockImplementation(() => undefined);
    render(<AreaListSection building={b} energy={e} />);
    const rows = areaList(b, e);
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    const [content, name, type] = spy.mock.calls[0] ?? [];
    expect(type).toBe("text/csv");
    expect(String(name)).toMatch(/huellflaechen.*\.csv$/);
    if (typeof content !== "string") throw new Error("not text");
    const text = content;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Bauteil;Richtung;Neigung [°];Fläche [m²];U [W/(m²K)];Fx;HT [W/K];Anzahl",
    );
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[1]).toMatch(/^Außenwand;N;90;\d+,\d{2};/);
  });
});
