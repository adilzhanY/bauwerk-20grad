import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "@/App";
import { useRouter } from "@/app/router";
import { useEditorStore, createDefaultBuilding } from "@/store/building";

beforeEach(() => {
  // These tests are about the editor, the page a building opens in.
  useRouter.setState({ route: { page: "editor" } });
  window.innerWidth = 1600;
  window.localStorage.clear();
  useEditorStore.setState({
    building: createDefaultBuilding("en"),
    selection: null,
    tool: "select",
  });
  useEditorStore.setState((s) => ({ activeStoreyId: s.building.storeys[0]?.id ?? null }));
});

/**
 * A small accessible name: aria-labelledby, aria-label, an associated or
 * wrapping label, the title, then the text content. Enough to catch a control
 * that has none of them.
 */
function accessibleName(el: HTMLElement): string {
  const byId = el.getAttribute("aria-labelledby");
  if (byId) {
    const text = byId
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (text.trim()) return text;
  }
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label;
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${el.id}"]`);
    const forText = forLabel?.textContent ?? "";
    if (forText.trim()) return forText;
  }
  const wrapping = el.closest("label");
  const wrapText = wrapping?.textContent ?? "";
  if (wrapText.trim()) return wrapText;
  const title = el.getAttribute("title");
  if (title?.trim()) return title;
  return el.textContent;
}

/** Every control in every panel carries a name a screen reader can speak. */
function expectAllNamed(container: HTMLElement) {
  const unnamed: string[] = [];
  const controls = container.querySelectorAll<HTMLElement>(
    "button, input, [role='radio'], [role='tab'], [role='combobox'], [role='slider'], [role='switch'], [role='checkbox'], [role='img'], a[href]",
  );
  for (const el of controls) {
    if (accessibleName(el).trim() === "") unnamed.push(el.outerHTML.slice(0, 80));
  }
  expect(unnamed).toEqual([]);
}

describe("accessibility", () => {
  it("names every landmark", () => {
    render(<App />);
    expect(screen.getByRole("main", { name: "3D view" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Building panel" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Properties panel" })).toBeTruthy();
  });

  it("every control has an accessible name across all sections and tabs", () => {
    const { container } = render(<App />);
    expectAllNamed(container);
    for (const section of ["Underlay", "Settings"]) {
      fireEvent.click(screen.getByRole("tab", { name: section }));
      expectAllNamed(container);
    }
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expectAllNamed(container);
  });

  it("Escape returns to the select tool and clears the selection", () => {
    render(<App />);
    useEditorStore.getState().setTool("opening");
    useEditorStore.getState().select({ kind: "roof" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useEditorStore.getState().tool).toBe("select");
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it("selected rooms and storeys expose their state", () => {
    render(<App />);
    const tree = screen.getByRole("tree", { name: "Layers" });
    const storey = within(tree).getByRole("button", { name: /^Ground floor/ });
    expect(storey.getAttribute("aria-current")).toBe("true");
  });
});
