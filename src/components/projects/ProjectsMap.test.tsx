import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProjectCard } from "@/projects/projects";

/** maplibre needs WebGL; this stand-in keeps what the map does with its pins. */
const fake = vi.hoisted(() => ({ fits: 0, markers: 0 }));

vi.mock("maplibre-gl", () => {
  class Map {
    fitBounds() {
      fake.fits += 1;
    }
    on() {
      return this;
    }
    once() {
      return this;
    }
    remove() {
      return undefined;
    }
  }
  class Marker {
    private readonly element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
      fake.markers += 1;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      document.body.append(this.element);
      return this;
    }
    getElement() {
      return this.element;
    }
    remove() {
      this.element.remove();
    }
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return { default: { Map, Marker, LngLatBounds } };
});

const { ProjectsMap } = await import("@/components/projects/ProjectsMap");

const card = (id: string, lon: number): ProjectCard =>
  ({
    ref: { kind: "server", id },
    buildingId: `b-${id}`,
    summary: { title: `House ${id}`, energyClass: "C", origin: { lon, lat: 52.5 } },
  }) as unknown as ProjectCard;

describe("the projects map", () => {
  it("keeps the view and its pins when a pin is selected; fits again only for other projects", () => {
    const cards = [card("1", 13.4), card("2", 13.5)];
    const selected: string[] = [];
    const { rerender } = render(
      <ProjectsMap cards={cards} selected={null} onSelect={(c) => selected.push(c.buildingId)} />,
    );
    expect(fake.fits).toBe(1);
    expect(fake.markers).toBe(2);

    // The page selects the pin and renders again with a new inline onSelect.
    fireEvent.click(screen.getByRole("button", { name: "House 2" }));
    rerender(
      <ProjectsMap cards={cards} selected="b-2" onSelect={(c) => selected.push(c.buildingId)} />,
    );
    expect(selected).toEqual(["b-2"]);
    expect(fake.fits).toBe(1);
    expect(fake.markers).toBe(2);
    expect(screen.getByRole("button", { name: "House 2" }).dataset.selected).toBe("true");

    // A search narrows the list: same view while the same projects are placed.
    rerender(<ProjectsMap cards={[...cards]} selected="b-2" onSelect={() => undefined} />);
    expect(fake.fits).toBe(1);
    rerender(<ProjectsMap cards={[cards[0]!]} selected="b-2" onSelect={() => undefined} />);
    expect(fake.fits).toBe(2);
  });
});
