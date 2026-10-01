import { describe, expect, it } from "vitest";
import { loginPath, parseRoute, routePath, safeNext } from "./router";

describe("routes", () => {
  it("reads the pages from a path, the Projects page first", () => {
    expect(parseRoute("/")).toEqual({ page: "projects" });
    expect(parseRoute("/karte")).toEqual({ page: "map" });
    expect(parseRoute("/varianten")).toEqual({ page: "variants" });
    expect(parseRoute("/bericht")).toEqual({ page: "report" });
    expect(parseRoute("/gebaeude/DEBE02YY40000BOo")).toEqual({
      page: "building",
      gid: "DEBE02YY40000BOo",
    });
    expect(parseRoute("/editor")).toEqual({ page: "editor" });
    expect(parseRoute("/unknown/place")).toEqual({ page: "projects" });
    expect(parseRoute("/gebaeude")).toEqual({ page: "projects" });
  });

  it("works below a base path, as on GitHub Pages", () => {
    expect(parseRoute("/bauwerk/editor", "/bauwerk/")).toEqual({ page: "editor" });
    expect(routePath({ page: "editor" }, "/bauwerk/")).toBe("/bauwerk/editor");
    expect(routePath({ page: "projects" }, "/bauwerk/")).toBe("/bauwerk/");
    expect(routePath({ page: "map" }, "/bauwerk/")).toBe("/bauwerk/karte");
  });

  it("round-trips a building id with characters that need escaping", () => {
    const route = { page: "building" as const, gid: "DE BE/1" };
    expect(parseRoute(routePath(route))).toEqual(route);
  });
});

describe("after sign in", () => {
  it("goes to the Projects page without a safe place to return to", () => {
    const projects = routePath({ page: "projects" }, "/");
    expect(safeNext(null)).toBe(projects);
    expect(safeNext("https://evil.example")).toBe(projects);
    expect(safeNext("//evil.example")).toBe(projects);
    expect(safeNext("/editor?project=1")).toBe("/editor?project=1");
  });

  it("does not put a login page inside the login page's own next", () => {
    window.history.replaceState(null, "", "/login?next=%2Fprojekte");
    expect(loginPath()).toBe("/login?next=%2Fprojekte");
    window.history.replaceState(null, "", "/editor");
    expect(loginPath()).toBe("/login?next=%2Feditor");
  });
});
