import { describe, expect, it } from "vitest";
import { storeyShortName } from "@/components/editor/storeyName";

describe("storeyShortName", () => {
  it("names the ground floor EG in German, G in English, and the ones above by number", () => {
    expect(storeyShortName(0, "Erdgeschoss", "de")).toBe("EG");
    expect(storeyShortName(0, "Ground floor", "en")).toBe("G");
    expect(storeyShortName(2, "2. OG", "de")).toBe("2");
  });
  it("recognises basements and attics by name, in either language", () => {
    expect(storeyShortName(0, "Kellergeschoss", "de")).toBe("KG");
    expect(storeyShortName(0, "Kellergeschoss", "en")).toBe("B");
    expect(storeyShortName(3, "Dachgeschoss", "de")).toBe("DG");
    expect(storeyShortName(1, "Attic", "en")).toBe("A");
  });
});
