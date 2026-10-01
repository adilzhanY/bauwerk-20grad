import { describe, expect, it } from "vitest";
import { people } from "./people";

const tab = (clientId: string, userId: string | null, state: "here" | "away", page = "editor") => ({
  clientId,
  actor: "Lena Berg",
  color: "#2a9d8f",
  selection: null,
  userId,
  firstName: userId ? "Lena" : null,
  lastName: userId ? "Berg" : null,
  state,
  page,
  storeyId: null,
});

describe("people in the project", () => {
  it("are one per person however many tabs, here when any tab is, here first", () => {
    const list = people([
      tab("t1", "lena", "away", "report"),
      tab("t2", "lena", "here", "variants"),
      tab("t3", "tom", "away"),
      tab("t4", null, "here"),
    ]);
    expect(list.map((p) => [p.userId, p.state, p.tabs])).toEqual([
      ["lena", "here", 2],
      ["t4", "here", 1],
      ["tom", "away", 1],
    ]);
    // Following Lena follows the tab where she is here.
    expect(list[0]?.tab.clientId).toBe("t2");
  });
});
