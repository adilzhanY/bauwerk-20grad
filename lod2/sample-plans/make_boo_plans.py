"""
Floor plans of Methfesselstraße 8 (BOo) as an architect would hand them over: one A3 sheet per
storey at 1:100, drawn like a German Bestandsplan, put together as one PDF.

    ../lod2-floorplan/.venv/bin/python make_boo_plans.py      # writes DEBE02YY40000BOo-Grundrisse.pdf

The outline, the storey heights and the street windows are the building's own (LoD2 and the
facade photo); the ground floor walls and doors are the ones read from the old ground floor
plan. The upper storeys are a likely layout for a Berlin Gründerzeit house of this shape: the
stairwell stacked on the ground floor's, two flats per storey, the 1st and 2nd floor alike, the
3rd floor with some rooms used differently. Conventions (DIN 1356-1, DIN 277, ISO 7200):
- scale 1:100, walls cut: load bearing ones filled, light partitions drawn with two lines;
- a room stamp per room: room number (storey and running number), name, area to two decimals
  (net floor area, DIN 277), perimeter, clear height, floor finish;
- dimension chains outside the building, under one metre in centimetres, half centimetres as a
  raised 5; openings as width/height, windows with their sill height (BRH);
- a title block (Plankopf) with project, address, owner, content, scale, date, author, plan
  number, index and sheet; a north arrow, a legend and an area schedule.
Needs shapely (the floor plan service's environment) and rsvg-convert.
"""
from __future__ import annotations

import json
import math
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
OUT = HERE / "DEBE02YY40000BOo-Grundrisse.pdf"

FOOTPRINT = [(-6.798, 7.27), (-6.604, -2.452), (-8.188, -2.485), (-8.099, -6.682), (7.215, -7.131), (7.007, 7.195)]
OUTER = 0.40  # outer wall
BEARING = 0.24
PARTITION = 0.115
FONT = "Liberation Sans"

# Sheet: A3 landscape, millimetres. The plan at 1:100: 10 mm per metre.
W, H = 420.0, 297.0
PLAN_X, PLAN_Y = 138.0, 146.0  # where plan (0, 0) lands on the sheet
K = 10.0


def sx(x: float) -> float:
    return PLAN_X + x * K


def sy(y: float) -> float:
    return PLAN_Y - y * K


def pts(coords) -> str:
    return " ".join(f"{sx(x):.2f},{sy(y):.2f}" for x, y in coords)


def num(v: float, digits: int = 2) -> str:
    return f"{v:.{digits}f}".replace(".", ",")


def dim_text(m: float) -> str:
    """DIN dimension: under 1 m in cm, else m with two decimals; a half cm as a raised 5."""
    half = round(m * 200)  # half centimetres
    cm, five = divmod(half, 2)
    sup = '<tspan baseline-shift="super" font-size="70%">5</tspan>' if five else ""
    if cm < 100:
        return f"{cm}{sup}"
    return f"{cm // 100},{cm % 100:02d}{sup}"


@dataclass
class Wall:
    a: tuple[float, float]
    b: tuple[float, float]
    thickness: float

    def shape(self):
        # Ends reach half a thickness past the axis points, so joints close.
        line = LineString([self.a, self.b])
        dx, dy = self.b[0] - self.a[0], self.b[1] - self.a[1]
        n = math.hypot(dx, dy)
        ux, uy = dx / n, dy / n
        e = self.thickness / 2
        longer = LineString([(self.a[0] - ux * e, self.a[1] - uy * e), (self.b[0] + ux * e, self.b[1] + uy * e)])
        return longer.buffer(self.thickness / 2, cap_style=2)

    @property
    def bearing(self) -> bool:
        return self.thickness > 0.2


@dataclass
class Door:
    wall: Wall
    centre: float  # metres from wall.a along the wall
    width: float
    side: int = 1  # which side of the wall the leaf swings to (+1 left of a to b)
    hinge: int = -1  # -1 at the start of the opening, +1 at its end
    double: bool = False
    height: float = 2.01


@dataclass
class Window:
    edge: int
    offset: float  # metres from the edge start to the opening's left edge
    width: float
    height: float
    sill: float
    door: bool = False


@dataclass
class Room:
    number: str
    name: str
    seed: tuple[float, float]
    floor: str
    flat: str = ""
    label_at: tuple[float, float] | None = None


@dataclass
class Storey:
    code: str  # EG, 1. OG ...
    title: str  # Erdgeschoss ...
    prefix: str  # room number prefix: E, 1, 2, 3
    level: float  # OKFF above ±0,00
    height: float
    walls: list[Wall]
    doors: list[Door]
    windows: list[Window]
    rooms: list[Room]
    stair_up: int  # steps up to the next storey
    stair_from_below: int | None = None
    notes: list[str] = field(default_factory=list)


def outline() -> Polygon:
    return Polygon(FOOTPRINT)


def inner() -> Polygon:
    return outline().buffer(-OUTER, join_style=2)


def edge(i: int):
    a = FOOTPRINT[i]
    b = FOOTPRINT[(i + 1) % len(FOOTPRINT)]
    L = math.dist(a, b)
    u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    # Outward normal of a clockwise ring is to the left of a to b.
    n = (-u[1], u[0])
    if outline().contains(Point(a[0] + u[0] * L / 2 + n[0] * 0.1, a[1] + u[1] * L / 2 + n[1] * 0.1)):
        n = (u[1], -u[0])
    return a, b, L, u, n


# --- The storeys ------------------------------------------------------------------------------

# Load bearing walls standing on each other from the ground floor up.
SPINE = Wall((-2.19, -7.2), (-2.19, 7.35), BEARING)
CROSS = Wall((-6.75, 2.23), (7.2, 2.23), BEARING)
NOTCH = Wall((-6.6, -2.45), (-2.19, -2.45), BEARING)
EAST_N = Wall((2.25, 2.23), (2.25, 7.3), BEARING)

# Street windows (edge 4, from the south end): the facade photo's six bays.
BAYS = [1.09, 3.38, 5.64, 7.9, 10.15, 12.38]


def upper_windows() -> list[Window]:
    w = [Window(4, o, 0.96, 1.60, 0.90) for o in BAYS]
    # The yard side: the stairwell (at its landing), the room behind the kitchen, the wing.
    w += [Window(0, 2.10, 1.00, 1.40, 1.60), Window(0, 7.10, 0.86, 1.40, 0.90), Window(2, 1.60, 1.01, 1.40, 0.90)]
    return w


def ground_floor() -> Storey:
    p = Wall((-2.18, 3.66), (2.25, 3.66), PARTITION)
    q = Wall((2.25, 4.65), (7.1, 4.66), PARTITION)
    walls = [SPINE, CROSS, NOTCH, EAST_N, p, q]
    # The doors read from the old ground floor plan, along each wall from its start point.
    doors = [
        Door(SPINE, 10.075, 1.27, side=-1),  # stairwell to the passage
        Door(NOTCH, 2.45, 1.02, side=-1),  # staff room to the workshop
        Door(CROSS, 2.83, 0.90, side=-1),  # stairwell to the staff room
        Door(SPINE, 4.02, 0.94, side=-1),  # workshop to the shop
        Door(p, 2.305, 0.97, side=1),  # passage to the store
        Door(EAST_N, 0.875, 1.11, side=-1),  # passage to the office
        Door(CROSS, 9.79, 1.28, side=-1, double=True),  # office to the shop
        Door(q, 1.645, 0.97, side=1),  # hall to the office
    ]
    windows = [
        Window(4, 1.09, 0.96, 1.78, 0.55), Window(4, 3.39, 0.95, 1.50, 0.86),
        Window(4, 5.34, 1.54, 2.40, 0.0, door=True),  # shop door
        Window(4, 7.90, 0.95, 1.70, 0.82), Window(4, 9.75, 0.96, 1.61, 0.94),
        Window(4, 12.01, 0.89, 2.20, 0.0, door=True),  # house door
        Window(0, 2.10, 1.00, 1.40, 1.60), Window(0, 7.10, 0.86, 1.40, 0.90), Window(2, 1.60, 1.01, 1.40, 0.90),
    ]
    rooms = [
        Room("E.01", "Laden", (2.5, -3.0), "Fliesen"),
        Room("E.02", "Hausflur", (4.6, 5.9), "Terrazzo"),
        Room("E.03", "Büro", (4.6, 3.4), "Linoleum"),
        Room("E.04", "Flur", (0.0, 2.95), "Terrazzo", label_at=(0.0, 2.95)),
        Room("E.05", "Lager", (0.0, 5.4), "Estrich"),
        Room("E.06", "Treppenhaus", (-4.4, 4.7), "Terrazzo", label_at=(-3.1, 4.6)),
        Room("E.07", "Personalraum", (-4.4, 0.0), "Linoleum"),
        Room("E.08", "Werkstatt", (-5.0, -4.6), "Estrich"),
    ]
    return Storey("EG", "Erdgeschoss", "E", 0.0, 3.70, walls, doors, windows, rooms, stair_up=22,
                  notes=["Laden mit Lager und Büro, Wohnungen ab 1. OG"])


def upper_walls(variant: str) -> tuple[list[Wall], dict[str, Wall]]:
    w = {
        "flat1": Wall((-2.19, 3.66), (2.25, 3.66), PARTITION),
        "bath1": Wall((0.6, 3.66), (0.6, 7.3), PARTITION),
        "hall2": Wall((-4.0, -2.45), (-4.0, 2.23), PARTITION),
        "wing": Wall((-5.2, -6.75), (-5.2, -2.45), PARTITION),
        "east_s": Wall((2.25, -7.2), (2.25, 2.23), BEARING),
        "south": Wall((-2.19, -2.45), (7.2, -2.45), PARTITION),
    }
    if variant == "3":
        del w["wing"]
    return [SPINE, CROSS, NOTCH, EAST_N, *w.values()], w


def upper(level: float, height: float, n: int, steps: int, variant: str) -> Storey:
    walls, w = upper_walls(variant)
    doors = [
        Door(SPINE, 7.2 + 2.95, 0.90, side=-1),  # stairwell to flat 1
        Door(CROSS, 3.45, 1.00, side=1),  # stairwell to flat 2
        Door(w["flat1"], 1.4, 0.85, side=1),  # hall 1 to the kitchen
        Door(w["flat1"], 3.6, 0.75, side=1, hinge=1),  # hall 1 to the bath
        Door(w["east_s"], 7.1, 1.40, side=1, double=True),  # dining to living (two leaves)
        Door(EAST_N, 0.75, 0.90, side=1),  # hall 1 to the living room
        Door(w["hall2"], 3.65, 0.80, side=-1),  # hall 2 to the yard room
        Door(SPINE, 7.2, 1.00, side=1),  # hall 2 to dining
        Door(NOTCH, 3.4, 0.85, side=-1),  # hall 2 to store 2
        Door(w["south"], 2.2, 0.90, side=-1),  # dining to the bath
        Door(w["south"], 6.8, 0.90, side=-1),  # living to bedroom
    ]
    if variant != "3":
        doors.append(Door(w["wing"], 2.15, 0.85, side=-1))  # store to kitchen
    names = {
        "1": {"living1": "Wohnzimmer", "yard": "Kinderzimmer", "store": "Abstellraum", "dining": "Esszimmer", "street_s": "Schlafzimmer"},
        "2": {"living1": "Wohnzimmer", "yard": "Gästezimmer", "store": "HWR", "dining": "Speisezimmer", "street_s": "Schlafzimmer"},
        "3": {"living1": "Wohnen/Schlafen", "yard": "Arbeitszimmer", "store": None, "dining": "Esszimmer", "street_s": "Kinderzimmer"},
    }[variant]
    p = str(n)
    spec = [
        ("Treppenhaus", (-4.4, 4.7), "Terrazzo", "", (-3.1, 4.6)),
        ("Flur", (0.0, 2.95), "Dielen", "WE 1", (0.0, 2.95)),
        ("Küche", (-0.8, 5.4), "Fliesen", "WE 1", None),
        ("Bad", (1.45, 5.4), "Fliesen", "WE 1", None),
        (names["living1"], (4.6, 4.7), "Dielen", "WE 1", None),
        ("Diele", (-3.1, 0.0), "Dielen", "WE 2", None),
        (names["yard"], (-5.3, 0.0), "Dielen", "WE 2", None),
        ("Wohnküche" if variant == "3" else "Küche", (-6.7, -4.6), "Fliesen", "WE 2", (-5.0, -4.6) if variant == "3" else None),
    ]
    if names["store"]:
        spec.append((names["store"], (-3.7, -4.6), "Dielen", "WE 2", None))
    spec += [
        (names["dining"], (0.0, 0.0), "Parkett", "WE 2", None),
        ("Bad", (0.0, -4.8), "Fliesen", "WE 2", None),
        ("Wohnzimmer", (4.6, 0.0), "Parkett", "WE 2", None),
        (names["street_s"], (4.6, -4.8), "Dielen", "WE 2", None),
    ]
    rooms = [Room(f"{p}.{i:02d}", name, seed, finish, flat, label_at=at) for i, (name, seed, finish, flat, at) in enumerate(spec, start=1)]
    titles = {1: "1. Obergeschoss", 2: "2. Obergeschoss", 3: "3. Obergeschoss"}
    notes = {
        "1": ["Zwei Wohnungen: WE 1 (Nord) und WE 2 (Süd)"],
        "2": ["Grundriss wie 1. OG, Nutzung einzelner Räume abweichend"],
        "3": ["Wie 1. OG, in WE 2 Küche und Abstellraum zur Wohnküche zusammengelegt"],
    }[variant]
    return Storey(f"{n}. OG", titles[n], p, level, height, walls, doors, upper_windows(), rooms, stair_up=steps,
                  stair_from_below=None, notes=notes)


STOREYS = [
    ground_floor(),
    upper(3.70, 3.76, 1, 22, "1"),
    upper(7.46, 3.39, 2, 20, "2"),
    upper(10.85, 3.78, 3, 22, "3"),
]


# --- Geometry of a storey -----------------------------------------------------------------------

def wall_shapes(storey: Storey):
    shell = outline().difference(inner())
    bearing = unary_union([w.shape() for w in storey.walls if w.bearing]).intersection(outline())
    partitions = unary_union([w.shape() for w in storey.walls if not w.bearing]).intersection(inner()).difference(bearing)
    return shell, bearing, partitions


def rooms_of(storey: Storey):
    # The walls as drawn, not clipped to the inside: a clipped end can leave a hairline gap at
    # a slanted outer wall that would join two rooms.
    free = inner().difference(unary_union([w.shape() for w in storey.walls]))
    faces = list(getattr(free, "geoms", [free]))
    out = []
    for room in storey.rooms:
        face = next((f for f in faces if f.contains(Point(room.seed))), None)
        if face is None:
            raise SystemExit(f"{storey.code}: no face at {room.seed} for {room.name}")
        out.append((room, face))
    return out


# --- Drawing ---------------------------------------------------------------------------------------

def path_of(geom) -> str:
    d = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        for ring in [poly.exterior, *poly.interiors]:
            c = list(ring.coords)
            d.append("M" + " L".join(f"{sx(x):.2f},{sy(y):.2f}" for x, y in c) + " Z")
    return " ".join(d)


def text(x, y, s, size=2.5, anchor="middle", weight="normal", rotate=0.0, fill="#111", style=""):
    t = f' transform="rotate({rotate:.1f} {x:.2f} {y:.2f})"' if rotate else ""
    return (f'<text x="{x:.2f}" y="{y:.2f}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" '
            f'font-weight="{weight}" fill="{fill}"{t} {style}>{s}</text>')


def opening_rect(a, u, n, start, width, depth0, depth1):
    p0 = (a[0] + u[0] * start, a[1] + u[1] * start)
    p1 = (p0[0] + u[0] * width, p0[1] + u[1] * width)
    return Polygon([
        (p0[0] + n[0] * depth0, p0[1] + n[1] * depth0), (p1[0] + n[0] * depth0, p1[1] + n[1] * depth0),
        (p1[0] + n[0] * depth1, p1[1] + n[1] * depth1), (p0[0] + n[0] * depth1, p0[1] + n[1] * depth1),
    ])


def draw_windows(storey: Storey) -> list[str]:
    out = []
    for w in storey.windows:
        a, b, L, u, n = edge(w.edge)
        # Across the wall: from the outer face (0) inward (-OUTER), normals point outward.
        cut = opening_rect(a, u, n, w.offset, w.width, 0.02, -OUTER - 0.02)
        out.append(f'<path d="{path_of(cut)}" fill="#fff" stroke="none"/>')
        p0 = (a[0] + u[0] * w.offset, a[1] + u[1] * w.offset)
        p1 = (p0[0] + u[0] * w.width, p0[1] + u[1] * w.width)
        # Reveals: the wall's faces closed across the opening's ends.
        for p in (p0, p1):
            out.append(f'<line x1="{sx(p[0]):.2f}" y1="{sy(p[1]):.2f}" x2="{sx(p[0] - n[0] * OUTER):.2f}" '
                       f'y2="{sy(p[1] - n[1] * OUTER):.2f}" stroke="#111" stroke-width="0.35"/>')
        if w.door:
            # An entrance: the threshold line and the leaf opening inward.
            hinge = p0
            tip = (hinge[0] - n[0] * w.width, hinge[1] - n[1] * w.width)
            inner_hinge = (hinge[0] - n[0] * OUTER, hinge[1] - n[1] * OUTER)
            tip = (inner_hinge[0] - n[0] * w.width, inner_hinge[1] - n[1] * w.width)
            end = (inner_hinge[0] + u[0] * w.width, inner_hinge[1] + u[1] * w.width)
            out.append(f'<line x1="{sx(inner_hinge[0]):.2f}" y1="{sy(inner_hinge[1]):.2f}" x2="{sx(tip[0]):.2f}" '
                       f'y2="{sy(tip[1]):.2f}" stroke="#111" stroke-width="0.35"/>')
            r = w.width * K
            out.append(f'<path d="M{sx(tip[0]):.2f},{sy(tip[1]):.2f} A{r:.2f},{r:.2f} 0 0 {1 if u[1] > 0 else 0} '
                       f'{sx(end[0]):.2f},{sy(end[1]):.2f}" fill="none" stroke="#111" stroke-width="0.18"/>')
        else:
            for depth in (-OUTER * 0.42, -OUTER * 0.58):
                q0 = (p0[0] + n[0] * depth, p0[1] + n[1] * depth)
                q1 = (p1[0] + n[0] * depth, p1[1] + n[1] * depth)
                out.append(f'<line x1="{sx(q0[0]):.2f}" y1="{sy(q0[1]):.2f}" x2="{sx(q1[0]):.2f}" y2="{sy(q1[1]):.2f}" '
                           f'stroke="#111" stroke-width="0.18"/>')
            # Sill outside, as a thin line past the face.
            s0 = (p0[0] + n[0] * 0.06, p0[1] + n[1] * 0.06)
            s1 = (p1[0] + n[0] * 0.06, p1[1] + n[1] * 0.06)
            out.append(f'<line x1="{sx(s0[0]):.2f}" y1="{sy(s0[1]):.2f}" x2="{sx(s1[0]):.2f}" y2="{sy(s1[1]):.2f}" '
                       f'stroke="#111" stroke-width="0.18"/>')
        # The opening's size inside the building: width/height, then the sill height.
        mid = (p0[0] + u[0] * w.width / 2 - n[0] * (OUTER + 0.55), p0[1] + u[1] * w.width / 2 - n[1] * (OUTER + 0.55))
        rot = -90 if abs(u[1]) > abs(u[0]) else 0
        label = f"{dim_text(w.width)}/{dim_text(w.height)}"
        out.append(text(sx(mid[0]), sy(mid[1]), label, 1.9, rotate=rot))
        if not w.door:
            mid2 = (mid[0] - n[0] * 0.3, mid[1] - n[1] * 0.3)
            out.append(text(sx(mid2[0]), sy(mid2[1]), f"BRH {dim_text(w.sill)}", 1.7, rotate=rot, fill="#333"))
    return out


def draw_doors(storey: Storey) -> list[str]:
    out = []
    for d in storey.doors:
        wl = d.wall
        L = math.dist(wl.a, wl.b)
        u = ((wl.b[0] - wl.a[0]) / L, (wl.b[1] - wl.a[1]) / L)
        n = (-u[1] * d.side, u[0] * d.side)
        start = d.centre - d.width / 2
        t = wl.thickness / 2 + 0.01
        cut = opening_rect(wl.a, u, (-u[1], u[0]), start, d.width, t, -t)
        out.append(f'<path d="{path_of(cut)}" fill="#fff" stroke="none"/>')
        p0 = (wl.a[0] + u[0] * start, wl.a[1] + u[1] * start)
        p1 = (p0[0] + u[0] * d.width, p0[1] + u[1] * d.width)
        for p in (p0, p1):
            a0 = (p[0] - u[1] * t, p[1] + u[0] * t)
            a1 = (p[0] + u[1] * t, p[1] - u[0] * t)
            out.append(f'<line x1="{sx(a0[0]):.2f}" y1="{sy(a0[1]):.2f}" x2="{sx(a1[0]):.2f}" y2="{sy(a1[1]):.2f}" '
                       f'stroke="#111" stroke-width="0.3"/>')
        leaves = [(p0, d.width / 2, 1), (p1, d.width / 2, -1)] if d.double else [((p0 if d.hinge < 0 else p1), d.width, -d.hinge)]
        for hinge, length, along in leaves:
            face = (hinge[0] + n[0] * wl.thickness / 2, hinge[1] + n[1] * wl.thickness / 2)
            tip = (face[0] + n[0] * length, face[1] + n[1] * length)
            end = (face[0] + u[0] * length * along, face[1] + u[1] * length * along)
            out.append(f'<line x1="{sx(face[0]):.2f}" y1="{sy(face[1]):.2f}" x2="{sx(tip[0]):.2f}" y2="{sy(tip[1]):.2f}" '
                       f'stroke="#111" stroke-width="0.3"/>')
            cross = n[0] * (u[1] * along) - n[1] * (u[0] * along)
            sweep = 1 if cross > 0 else 0
            r = length * K
            out.append(f'<path d="M{sx(tip[0]):.2f},{sy(tip[1]):.2f} A{r:.2f},{r:.2f} 0 0 {sweep} {sx(end[0]):.2f},{sy(end[1]):.2f}" '
                       f'fill="none" stroke="#111" stroke-width="0.15"/>')
        # Size of the door, next to it on the swing side.
        mid = (p0[0] + u[0] * d.width / 2 + n[0] * (wl.thickness / 2 + 0.28), p0[1] + u[1] * d.width / 2 + n[1] * (wl.thickness / 2 + 0.28))
        rot = -90 if abs(u[1]) > abs(u[0]) else 0
        out.append(text(sx(mid[0]), sy(mid[1]) + 0.6, f"{dim_text(d.width)}/{dim_text(d.height)}", 1.6, rotate=rot, fill="#333"))
    return out


def draw_stair(storey: Storey) -> list[str]:
    """A dogleg stair in the stairwell: two flights side by side, the landing at the north."""
    out = []
    x0, x1, x2, x3 = -6.32, -5.27, -5.02, -3.97
    y0, y1, y2 = 2.75, 5.85, 6.80
    tread = (y1 - y0) / 11
    style = 'fill="none" stroke="#111" stroke-width="0.18"'
    out.append(f'<rect x="{sx(x0):.2f}" y="{sy(y1):.2f}" width="{(x3 - x0) * K:.2f}" height="{(y1 - y0) * K:.2f}" {style}/>')
    out.append(f'<rect x="{sx(x1):.2f}" y="{sy(y1):.2f}" width="{(x2 - x1) * K:.2f}" height="{(y1 - y0) * K:.2f}" fill="#fff" stroke="#111" stroke-width="0.25"/>')
    for i in range(1, 11):
        y = y0 + i * tread
        out.append(f'<line x1="{sx(x0):.2f}" y1="{sy(y):.2f}" x2="{sx(x1):.2f}" y2="{sy(y):.2f}" stroke="#111" stroke-width="0.13"/>')
        out.append(f'<line x1="{sx(x2):.2f}" y1="{sy(y):.2f}" x2="{sx(x3):.2f}" y2="{sy(y):.2f}" stroke="#111" stroke-width="0.13"/>')
    out.append(f'<line x1="{sx(x0):.2f}" y1="{sy(y2):.2f}" x2="{sx(x3):.2f}" y2="{sy(y2):.2f}" stroke="#111" stroke-width="0.13" stroke-dasharray="1.2 0.8"/>')
    # Walking line with its arrow: up the west flight, round the landing, down the east one.
    lx0, lx1 = (x0 + x1) / 2, (x2 + x3) / 2
    ym = (y1 + y2) / 2
    out.append(f'<path d="M{sx(lx0):.2f},{sy(y0 + 0.1):.2f} L{sx(lx0):.2f},{sy(ym):.2f} L{sx(lx1):.2f},{sy(ym):.2f} '
               f'L{sx(lx1):.2f},{sy(y0 + 0.5):.2f}" fill="none" stroke="#111" stroke-width="0.2"/>')
    out.append(f'<circle cx="{sx(lx0):.2f}" cy="{sy(y0 + 0.1):.2f}" r="0.6" fill="#111"/>')
    ax, ay = sx(lx1), sy(y0 + 0.5)
    out.append(f'<path d="M{ax - 1.0:.2f},{ay - 1.8:.2f} L{ax:.2f},{ay:.2f} L{ax + 1.0:.2f},{ay - 1.8:.2f}" fill="none" stroke="#111" stroke-width="0.2"/>')
    # The cut through the flight at about 1 m height (DIN 1356): a diagonal break line.
    cy0, cy1 = y0 + 4.5 * tread, y0 + 6.5 * tread
    out.append(f'<line x1="{sx(x0):.2f}" y1="{sy(cy0):.2f}" x2="{sx(x1):.2f}" y2="{sy(cy1):.2f}" stroke="#111" stroke-width="0.25"/>')
    rise = storey.height / storey.stair_up * 100
    out.append(text(sx(lx0), sy(y0 - 0.25), f"{storey.stair_up} STG {num(rise, 1)}/27", 1.7))
    return out


def stamp(room: Room, face: Polygon, storey: Storey) -> list[str]:
    at = room.label_at or room.seed
    x, y = sx(at[0]), sy(at[1])
    area = face.area
    perimeter = face.exterior.length
    clear = storey.height - 0.30
    small = area < 8
    lines = [
        (f"{room.number}", 1.8, "normal", "#333"),
        (room.name, 2.6 if not small else 2.1, "bold", "#111"),
        (f"{num(area)} m²", 2.2, "normal", "#111"),
    ]
    if not small:
        lines += [(f"U {num(perimeter)} m", 1.6, "normal", "#333"), (f"LH {num(clear)} m", 1.6, "normal", "#333"),
                  (room.floor, 1.6, "normal", "#333")]
    gap = 2.5 if not small else 2.1
    top = y - gap * (len(lines) - 1) / 2
    out = []
    w = max(len(room.name) * 1.55 + 4, 15) if not small else len(room.name) * 1.3 + 4
    h = gap * len(lines) + 0.6
    out.append(f'<rect x="{x - w / 2:.2f}" y="{top - gap + 0.3:.2f}" width="{w:.2f}" height="{h:.2f}" fill="#fff" '
               f'stroke="#555" stroke-width="0.15" rx="0.6"/>')
    for i, (s, size, weight, fill) in enumerate(lines):
        out.append(text(x, top + i * gap, s, size, weight=weight, fill=fill))
    return out


def chain(points: list[float], fixed: float, vertical: bool, side: int) -> list[str]:
    """A dimension chain: points along x (or y), the line at `fixed` (metres, plan)."""
    out = []
    pts_ = sorted(points)
    if vertical:
        x = sx(fixed)
        out.append(f'<line x1="{x:.2f}" y1="{sy(pts_[0]):.2f}" x2="{x:.2f}" y2="{sy(pts_[-1]):.2f}" stroke="#111" stroke-width="0.15"/>')
        for p in pts_:
            out.append(f'<line x1="{x - 1:.2f}" y1="{sy(p) + 1:.2f}" x2="{x + 1:.2f}" y2="{sy(p) - 1:.2f}" stroke="#111" stroke-width="0.3"/>')
            out.append(f'<line x1="{x - 1.6:.2f}" y1="{sy(p):.2f}" x2="{x + 1.6:.2f}" y2="{sy(p):.2f}" stroke="#111" stroke-width="0.1"/>')
        for a, b in zip(pts_, pts_[1:]):
            m = (a + b) / 2
            out.append(text(x - 1.0 * side, sy(m), dim_text(b - a), 1.9, rotate=-90))
    else:
        y = sy(fixed)
        out.append(f'<line x1="{sx(pts_[0]):.2f}" y1="{y:.2f}" x2="{sx(pts_[-1]):.2f}" y2="{y:.2f}" stroke="#111" stroke-width="0.15"/>')
        for p in pts_:
            out.append(f'<line x1="{sx(p) - 1:.2f}" y1="{y + 1:.2f}" x2="{sx(p) + 1:.2f}" y2="{y - 1:.2f}" stroke="#111" stroke-width="0.3"/>')
            out.append(f'<line x1="{sx(p):.2f}" y1="{y - 1.6:.2f}" x2="{sx(p):.2f}" y2="{y + 1.6:.2f}" stroke="#111" stroke-width="0.1"/>')
        for a, b in zip(pts_, pts_[1:]):
            m = (a + b) / 2
            out.append(text(sx(m), y - 0.9, dim_text(b - a), 1.9))
    return out


def dimensions(storey: Storey) -> list[str]:
    out = []
    # Street side (edge 4): openings chain, then the whole length.
    a, b, L, u, n = edge(4)
    marks = [0.0, L]
    for w in storey.windows:
        if w.edge == 4:
            marks += [w.offset, w.offset + w.width]
    ys = [a[1] + u[1] * m for m in marks]
    out += chain(ys, 7.45 + 0.9, True, -1)
    out += chain([a[1], b[1]], 7.45 + 1.9, True, -1)
    # North (edge 5), south (edge 3) and the yard side (edges 0, 1, 2).
    out += chain([FOOTPRINT[5][0], FOOTPRINT[0][0]], 7.27 + 1.0, False, 1)
    out += chain([FOOTPRINT[3][0], FOOTPRINT[4][0]], -7.13 - 1.6, False, 1)
    out += chain([FOOTPRINT[3][1], FOOTPRINT[2][1], FOOTPRINT[0][1]], -8.19 - 1.4, True, 1)
    # Inside: the clear widths across the south rooms, the way they are measured on site.
    out += chain([-7.69, -2.31, -2.07, 2.13, 2.37, 6.80], -6.2 if storey.code == "EG" else -6.4, False, 1) if storey.code != "EG" else []
    return out


def legend_and_frame(storey: Storey, sheet: int, total: int, rooms) -> list[str]:
    out = []
    # Frame: 20 mm filing margin on the left, 5 mm elsewhere (DIN 824 folding).
    out.append(f'<rect x="20" y="5" width="{W - 25}" height="{H - 10}" fill="none" stroke="#111" stroke-width="0.5"/>')
    # Title of the drawing on the sheet.
    out.append(text(28, 18, f"Grundriss {storey.title}", 6.0, anchor="start", weight="bold"))
    out.append(text(28, 25, "Bestand, M 1:100", 3.2, anchor="start", fill="#333"))
    out.append(text(28, 31, f"OKFF {'±' if storey.level == 0 else '+'}{num(storey.level)} m  ·  Geschosshöhe {num(storey.height)} m", 2.4,
                    anchor="start", fill="#333"))
    # Surroundings.
    out.append(text(sx(7.45 + 3.2), sy(0.0), "Methfesselstraße", 4.0, rotate=-90, fill="#444", style='letter-spacing="1.2"'))
    out.append(text(sx(-8.19 - 3.0), sy(2.5), "Hof", 3.4, rotate=-90, fill="#444"))
    out.append(text(sx(0.2), sy(7.27 + 2.6), "Brandwand, Nachbargebäude Nr. 10", 2.2, fill="#555"))
    out.append(text(sx(0.2), sy(-7.13 - 3.0), "Brandwand, Nachbargebäude Nr. 6", 2.2, fill="#555"))
    # North arrow (the plan's north is up; the street faces east).
    nx, ny = 300.0, 30.0
    out.append(f'<circle cx="{nx}" cy="{ny}" r="8" fill="none" stroke="#111" stroke-width="0.3"/>')
    out.append(f'<path d="M{nx},{ny - 10} L{nx + 3},{ny + 4} L{nx},{ny + 1.5} L{nx - 3},{ny + 4} Z" fill="#111"/>')
    out.append(text(nx, ny - 11.5, "N", 3.4, weight="bold"))
    # Legend.
    lx, ly = 318.0, 16.0
    out.append(text(lx, ly, "Legende", 2.8, anchor="start", weight="bold"))
    out.append(f'<rect x="{lx}" y="{ly + 3}" width="9" height="2.4" fill="#222"/>')
    out.append(text(lx + 11, ly + 5.1, "Mauerwerk, tragend (Bestand)", 2.0, anchor="start"))
    out.append(f'<rect x="{lx}" y="{ly + 8}" width="9" height="1.2" fill="#fff" stroke="#111" stroke-width="0.25"/>')
    out.append(text(lx + 11, ly + 9.6, "Leichte Trennwand, nichttragend", 2.0, anchor="start"))
    for i, (abbr, meaning) in enumerate([("BRH", "Brüstungshöhe"), ("LH", "lichte Raumhöhe"), ("U", "Raumumfang"),
                                         ("OKFF", "Oberkante Fertigfußboden"), ("STG", "Steigungen"), ("WE", "Wohneinheit")]):
        out.append(text(lx, ly + 15 + i * 3.3, abbr, 2.0, anchor="start", weight="bold"))
        out.append(text(lx + 11, ly + 15 + i * 3.3, meaning, 2.0, anchor="start"))
    out.append(text(lx, ly + 37, "Flächen: Netto-Raumfläche nach DIN 277.", 1.8, anchor="start", fill="#333"))
    out.append(text(lx, ly + 40, "Alle Maße sind am Bau zu prüfen.", 1.8, anchor="start", fill="#333"))
    # Area schedule.
    tx, ty = 288.0, 64.0
    out.append(text(tx, ty, "Flächenzusammenstellung", 2.8, anchor="start", weight="bold"))
    out.append(text(tx, ty + 5, "Nr.", 1.9, anchor="start", weight="bold"))
    out.append(text(tx + 12, ty + 5, "Raum", 1.9, anchor="start", weight="bold"))
    out.append(text(tx + 62, ty + 5, "Boden", 1.9, anchor="start", weight="bold"))
    out.append(text(tx + 112, ty + 5, "m²", 1.9, anchor="end", weight="bold"))
    out.append(f'<line x1="{tx}" y1="{ty + 6.3}" x2="{tx + 113}" y2="{ty + 6.3}" stroke="#111" stroke-width="0.2"/>')
    row = ty + 9.6
    sums: dict[str, float] = {}
    for room, face in rooms:
        out.append(text(tx, row, room.number, 1.9, anchor="start"))
        out.append(text(tx + 12, row, room.name + (f"  ({room.flat})" if room.flat else ""), 1.9, anchor="start"))
        out.append(text(tx + 62, row, room.floor, 1.9, anchor="start", fill="#333"))
        out.append(text(tx + 112, row, num(face.area), 1.9, anchor="end"))
        sums[room.flat or "allgemein"] = sums.get(room.flat or "allgemein", 0) + face.area
        row += 3.1
    out.append(f'<line x1="{tx}" y1="{row - 1.8}" x2="{tx + 113}" y2="{row - 1.8}" stroke="#111" stroke-width="0.2"/>')
    for key, value in sums.items():
        label = {"allgemein": "Allgemein / Gewerbe"}.get(key, f"Wohnfläche {key}")
        out.append(text(tx + 12, row + 1.0, label, 1.9, anchor="start", weight="bold"))
        out.append(text(tx + 112, row + 1.0, num(value), 1.9, anchor="end", weight="bold"))
        row += 3.1
    total_area = sum(f.area for _, f in rooms)
    out.append(text(tx + 12, row + 1.0, "Summe Netto-Raumfläche", 1.9, anchor="start", weight="bold"))
    out.append(text(tx + 112, row + 1.0, num(total_area), 1.9, anchor="end", weight="bold"))
    for i, note in enumerate(storey.notes):
        out.append(text(tx, row + 6.5 + i * 3, note, 1.9, anchor="start", fill="#333"))
    # Title block (Plankopf), bottom right, after ISO 7200.
    bx, by, bw = 288.0, 218.0, 127.0
    bh = H - 5 - by
    out.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="#fff" stroke="#111" stroke-width="0.5"/>')
    rows = [
        ("Bauvorhaben", "Energetische Sanierung, Wohn- und Geschäftshaus"),
        ("Adresse", "Methfesselstraße 8, 10965 Berlin-Kreuzberg"),
        ("Bauherr", "Eigentümergemeinschaft Methfesselstraße 8"),
        ("Planinhalt", f"Grundriss {storey.title} ({storey.code}), Bestand"),
        ("Planart", "Bestandsplan nach Aufmaß"),
    ]
    y = by + 5.5
    for k, v in rows:
        out.append(text(bx + 2.5, y, k, 1.7, anchor="start", fill="#555"))
        out.append(text(bx + 24, y, v, 2.2, anchor="start", weight="bold" if k == "Planinhalt" else "normal"))
        out.append(f'<line x1="{bx}" y1="{y + 1.8}" x2="{bx + bw}" y2="{y + 1.8}" stroke="#111" stroke-width="0.15"/>')
        y += 6.0
    grid = [
        [("Maßstab", "1:100"), ("Format", "A3"), ("Datum", "02.10.2026")],
        [("Gezeichnet", "A. Yerzhan"), ("Geprüft", "ausstehend"), ("Index", "a")],
        [("Plan-Nr.", f"BOo-BST-{storey.code.replace('. ', '').replace(' ', '')}-01"), ("Blatt", f"{sheet} von {total}"),
         ("Gebäude-ID", "DEBE02YY40000BOo")],
    ]
    cw = bw / 3
    for r, cells in enumerate(grid):
        yy = y + r * 7.5
        for c, (k, v) in enumerate(cells):
            out.append(text(bx + c * cw + 2.5, yy + 0.4, k, 1.6, anchor="start", fill="#555"))
            out.append(text(bx + c * cw + 2.5, yy + 4.4, v, 2.2, anchor="start"))
            if c:
                out.append(f'<line x1="{bx + c * cw}" y1="{yy - 2.4}" x2="{bx + c * cw}" y2="{yy + 5.6}" stroke="#111" stroke-width="0.15"/>')
        out.append(f'<line x1="{bx}" y1="{yy + 5.6}" x2="{bx + bw}" y2="{yy + 5.6}" stroke="#111" stroke-width="0.15"/>')
    return out


def sheet(storey: Storey, index: int, total: int) -> str:
    shell, bearing, partitions = wall_shapes(storey)
    rooms = rooms_of(storey)
    parts = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="#fff"/>']
    # Room floors, a very light tone so the rooms read as rooms.
    for _, face in rooms:
        parts.append(f'<path d="{path_of(face)}" fill="#fbfaf7" stroke="none"/>')
    parts.append(f'<path d="{path_of(partitions)}" fill="#fff" stroke="#111" stroke-width="0.25" fill-rule="evenodd"/>')
    parts.append(f'<path d="{path_of(unary_union([shell, bearing]))}" fill="#222" stroke="#111" stroke-width="0.25" fill-rule="evenodd"/>')
    parts += draw_windows(storey)
    parts += draw_doors(storey)
    parts += draw_stair(storey)
    for room, face in rooms:
        parts += stamp(room, face, storey)
    parts += dimensions(storey)
    parts += legend_and_frame(storey, index, total, rooms)
    body = "\n".join(parts)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">\n'
            f"<title>Grundriss {storey.title}, Methfesselstraße 8</title>\n{body}\n</svg>\n")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for i, storey in enumerate(STOREYS, start=1):
            path = Path(tmp) / f"{i:02d}.svg"
            path.write_text(sheet(storey, i, len(STOREYS)), encoding="utf-8")
            files.append(str(path))
        subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(OUT), *files], check=True)
    summary = {s.code: {r.number: r.name for r, _ in rooms_of(s)} for s in STOREYS}
    (HERE / "DEBE02YY40000BOo-Grundrisse.rooms.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print("wrote", OUT.name)


if __name__ == "__main__":
    main()
