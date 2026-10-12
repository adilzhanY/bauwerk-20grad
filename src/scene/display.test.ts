import { describe, expect, it } from "vitest";
import { resetIds } from "@/lib/ids";
import { createEditorStore } from "@/store/building";
import { storeyDisplay } from "./display";

describe("storeyDisplay", () => {
  it("active is solid, above follows the above setting, below the below setting", () => {
    resetIds();
    const store = createEditorStore();
    store.getState().addStorey();
    store.getState().addStorey();
    const b = store.getState().building;
    const [g, first, second] = b.storeys.map((s) => s.id) as [string, string, string];
    const other = {
      above: "outline" as const,
      below: "ghost" as const,
      roof: "outline" as const,
      ghostOpacity: 0.15,
    };
    expect(storeyDisplay(b, first, first, other)).toBe("solid");
    expect(storeyDisplay(b, second, first, other)).toBe("outline");
    expect(storeyDisplay(b, g, first, other)).toBe("ghost");
    expect(storeyDisplay(b, second, first, { ...other, above: "hidden" })).toBe("hidden");
    expect(storeyDisplay(b, g, first, { ...other, below: "solid" })).toBe("solid");
    expect(storeyDisplay(b, g, null, other)).toBe("solid");
    store.getState().setOtherStoreys({ above: "ghost", ghostOpacity: 0.3 });
    expect(store.getState().otherStoreys).toEqual({
      above: "ghost",
      below: "ghost",
      roof: "outline",
      ghostOpacity: 0.3,
    });
  });
});
