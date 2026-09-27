import { describe, expect, it } from "vitest";
import { storeyShortName } from "./storeyName";

describe("storeyShortName", () => {
  it("names the ground floor EG and the ones above by number", () => {
    expect(storeyShortName(0, "Erdgeschoss")).toBe("EG");
    expect(storeyShortName(2, "2. OG")).toBe("2");
  });
  it("recognises basements and attics by name", () => {
    expect(storeyShortName(0, "Kellergeschoss")).toBe("KG");
    expect(storeyShortName(3, "Dachgeschoss")).toBe("DG");
    expect(storeyShortName(1, "Attic")).toBe("DG");
  });
});
