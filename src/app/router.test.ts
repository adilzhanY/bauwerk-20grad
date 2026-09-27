import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./router";

describe("routes", () => {
  it("reads the three pages from a path", () => {
    expect(parseRoute("/")).toEqual({ page: "start" });
    expect(parseRoute("/gebaeude/DEBE02YY40000BOo")).toEqual({
      page: "building",
      gid: "DEBE02YY40000BOo",
    });
    expect(parseRoute("/editor")).toEqual({ page: "editor" });
    expect(parseRoute("/unknown/place")).toEqual({ page: "start" });
    expect(parseRoute("/gebaeude")).toEqual({ page: "start" });
  });

  it("works below a base path, as on GitHub Pages", () => {
    expect(parseRoute("/bauwerk/editor", "/bauwerk/")).toEqual({ page: "editor" });
    expect(routePath({ page: "editor" }, "/bauwerk/")).toBe("/bauwerk/editor");
    expect(routePath({ page: "start" }, "/bauwerk/")).toBe("/bauwerk/");
  });

  it("round-trips a building id with characters that need escaping", () => {
    const route = { page: "building" as const, gid: "DE BE/1" };
    expect(parseRoute(routePath(route))).toEqual(route);
  });
});
