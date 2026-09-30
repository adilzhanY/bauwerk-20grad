"""
Interior walls and doors from a floor plan drawing of a building whose outline is known.

The LoD2 model already gives the footprint in metres. A floor plan adds what is inside it:
where the interior walls stand and where their doors are. Four steps:

1. Place the plan. The footprint is slid, scaled and turned over the drawing until its edges
   lie on ink (chamfer matching on a distance transform). That fixes pixels per metre and
   position without the user marking anything, and everything later is in plan metres.
2. Find walls the way they are drawn: two parallel lines 6 to 32 cm apart, or one solid
   stroke that thick. Dimension lines, text underlines and furniture are single thin lines
   and drop out; a third line at the same spacing makes a ladder (stairs), not a wall.
3. Keep only walls inside the outline, off the outer walls, merged along their line,
   extended to meet the walls they end at, and connected to the outline at both ends.
   When a room model ran (Raster2Seq), a wall must also follow one of its room boundaries.
4. Doors: a gap in a wall, and where the room model sees a door on a wall, the gap in the
   wall's ink around it, so a door gets the width drawn, not the model's coarse guess.

Pure over numpy arrays; the room model's rooms and doors come in as plain polygons.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
from scipy.optimize import minimize
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

# Distances in metres.
WALL_MIN_FACE_GAP = 0.06
WALL_MAX_FACE_GAP = 0.32
MIN_WALL_LENGTH = 0.6
OUTLINE_BAND = 0.5
SAME_LINE = 0.25
DOOR_MIN, DOOR_MAX = 0.5, 1.4
SNAP = 0.5
# An interior wall ends at the inner face of an outer wall, up to about this far from the
# outline (the outline is the outer face).
SNAP_OUTLINE = 0.8
MIN_SUPPORT = 0.6
# A door reads thinner across than the wall around it (its thicker parts, the 75th percentile
# close by): the wall's faces stop, a thin line may carry on.
OPEN_BELOW = 0.7
# Pixels: distance cap for the chamfer cost, so far-off points do not dominate.
CHAMFER_CAP = 25.0


@dataclass
class Transform:
    """Plan metres (y up) to image pixels (y down): scale, rotation, pixel of the plan origin."""

    scale: float
    theta: float
    ox: float
    oy: float

    def to_px(self, pts: np.ndarray) -> np.ndarray:
        c, s = math.cos(self.theta), math.sin(self.theta)
        x = pts[:, 0] * c - pts[:, 1] * s
        y = pts[:, 0] * s + pts[:, 1] * c
        return np.stack([self.ox + self.scale * x, self.oy - self.scale * y], axis=1)

    def to_m(self, x: float, y: float) -> tuple[float, float]:
        c, s = math.cos(self.theta), math.sin(self.theta)
        X, Y = (x - self.ox) / self.scale, (self.oy - y) / self.scale
        return (X * c + Y * s, -X * s + Y * c)


@dataclass
class Wall:
    orientation: str  # "h" or "v" in the image
    a: tuple[float, float]
    b: tuple[float, float]
    thickness: float
    support: float | None = None
    parts: list[tuple[float, float]] = field(default_factory=list)

    @property
    def line(self) -> LineString:
        return LineString([self.a, self.b])


@dataclass
class Door:
    a: tuple[float, float]
    b: tuple[float, float]
    source: str  # "gap" or "model"


@dataclass
class Result:
    transform: Transform
    fit_error: float  # metres, mean distance of the footprint from the drawn outline
    walls: list[Wall]
    doors: list[Door]
    used_model: bool


def ink_of(gray: np.ndarray) -> np.ndarray:
    """Dark strokes as 255 on 0, robust to stains and yellowed paper."""
    block = max(15, (min(gray.shape) // 26) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 15)


def _outline_samples(footprint: np.ndarray, step: float = 0.1) -> np.ndarray:
    pts = []
    for i in range(len(footprint)):
        a, b = footprint[i], footprint[(i + 1) % len(footprint)]
        n = max(2, int(np.linalg.norm(b - a) / step))
        pts += [a + (b - a) * t for t in np.linspace(0, 1, n, endpoint=False)]
    return np.array(pts)


def wall_mask(ink: np.ndarray) -> np.ndarray:
    """Ink that looks like walls (two close parallel lines, or one thick stroke), before the
    scale is known: gaps and thicknesses in pixels relative to the image size."""
    h, w = ink.shape
    size = max(h, w)
    min_len = max(8, size // 40)
    strokes = strokes_of(ink, min_len, 0.03 * size)
    mask = np.zeros_like(ink)
    lo_gap, hi_gap = 2.0, 0.02 * size
    for o in ("h", "v"):
        lines = sorted((t for t in strokes if t[0] == o), key=lambda t: t[1])
        for i, a in enumerate(lines):
            thick = a[4] >= 3
            for b in lines[i + 1 :]:
                if b[1] - a[1] > hi_gap:
                    break
                if b[1] - a[1] >= lo_gap and min(a[3], b[3]) - max(a[2], b[2]) >= min_len:
                    thick = True
                    break
            if thick:
                p0 = (int(a[2]), int(a[1])) if o == "h" else (int(a[1]), int(a[2]))
                p1 = (int(a[3]), int(a[1])) if o == "h" else (int(a[1]), int(a[3]))
                cv2.line(mask, p0, p1, 255, max(1, int(a[4])))
    return mask


def register(ink: np.ndarray, footprint: np.ndarray) -> tuple[Transform, float]:
    """The transform that lays the footprint on the drawn outer walls, and its mean error in px.

    Only wall-like ink counts, so dimension lines and text cannot pull the outline. Smaller
    shapes also fit on interior walls; the outer walls are the outermost ones, so among fits
    about as good as the best, the largest wins.
    """
    h, w = ink.shape
    dist = np.minimum(cv2.distanceTransform(255 - wall_mask(ink), cv2.DIST_L2, 5), CHAMFER_CAP)
    samples = _outline_samples(footprint)
    size = footprint.max(axis=0) - footprint.min(axis=0)

    def cost(p: np.ndarray) -> float:
        px = Transform(*p).to_px(samples)
        x, y = px[:, 0], px[:, 1]
        outside = (x < 0) | (x >= w) | (y < 0) | (y >= h)
        xi, yi = np.clip(x, 0, w - 1).astype(int), np.clip(y, 0, h - 1).astype(int)
        return float(np.where(outside, CHAMFER_CAP, dist[yi, xi]).mean())

    centre = footprint.mean(axis=0)
    fit = min(w / size.max(), h / size.max())
    coarse: list[tuple[float, np.ndarray]] = []
    for turn in (0, 90, 180, 270):
        th = math.radians(turn)
        c, s = math.cos(th), math.sin(th)
        for scale in np.linspace(0.3 * fit, 1.05 * fit, 16):
            for tx in np.linspace(0.25 * w, 0.75 * w, 11):
                for ty in np.linspace(0.25 * h, 0.75 * h, 11):
                    ox = tx - scale * (centre[0] * c - centre[1] * s)
                    oy = ty + scale * (centre[0] * s + centre[1] * c)
                    p = np.array([scale, th, ox, oy])
                    coarse.append((cost(p), p))
    coarse.sort(key=lambda t: t[0])
    starts: list[np.ndarray] = []
    for _, p in coarse:
        if all(abs(p[0] - q[0]) > 0.05 * fit or abs(p[1] - q[1]) > 0.1 for q in starts):
            starts.append(p)
        if len(starts) == 8:
            break
    fits = []
    for p in starts:
        res = minimize(cost, p, method="Powell", options={"xtol": 1e-3, "ftol": 1e-4, "maxiter": 4000})
        fits.append((float(res.fun), res.x))
    best = min(v for v, _ in fits)
    good = [(v, p) for v, p in fits if v <= best * 1.25 + 0.5]
    value, params = max(good, key=lambda t: t[1][0])
    return Transform(*(float(v) for v in params)), value


def strokes_of(ink: np.ndarray, min_length_px: int, max_thickness_px: float):
    """Horizontal and vertical ink strokes: (orientation, position, from, to, thickness) in px."""
    out = []
    for o, kernel in (("h", (min_length_px, 1)), ("v", (1, min_length_px))):
        opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
        n, _, stats, _ = cv2.connectedComponentsWithStats(opened)
        for i in range(1, n):
            x, y, w, h, _ = stats[i]
            if o == "h" and h < max_thickness_px:
                out.append(("h", y + h / 2, float(x), float(x + w), float(h)))
            if o == "v" and w < max_thickness_px:
                out.append(("v", x + w / 2, float(y), float(y + h), float(w)))
    return out


def wall_strokes(strokes, scale: float, min_length_px: float):
    """Pairs of parallel strokes one wall thickness apart, and single strokes that thick."""
    lo_gap, hi_gap = WALL_MIN_FACE_GAP * scale, WALL_MAX_FACE_GAP * scale
    walls = []
    for o in ("h", "v"):
        lines = sorted((t for t in strokes if t[0] == o), key=lambda t: t[1])
        for i, a in enumerate(lines):
            for j in range(i + 1, len(lines)):
                b = lines[j]
                gap = b[1] - a[1]
                if gap > hi_gap:
                    break
                if gap < lo_gap:
                    continue
                lo, hi = max(a[2], b[2]), min(a[3], b[3])
                if hi - lo < max(min_length_px, 0.6 * min(a[3] - a[2], b[3] - b[2])):
                    continue
                # A third line at the same spacing makes a ladder: stairs, not a wall.
                ladder = any(
                    abs((t[1] - b[1]) - gap) < 3 and min(t[3], hi) - max(t[2], lo) > 0.5 * (hi - lo)
                    for t in lines[j + 1 :]
                    if t[1] - b[1] < gap + 4
                )
                if not ladder:
                    walls.append((o, (a[1] + b[1]) / 2, lo, hi, gap))
        walls += [(o, t[1], t[2], t[3], t[4]) for t in lines if t[4] >= lo_gap]
    return walls


def _axis(w: Wall) -> tuple[float, float, float]:
    """Position across the wall and its extent along it, in metres, for an image-axis wall."""
    (x0, y0), (x1, y1) = w.a, w.b
    if w.orientation == "v":
        return ((x0 + x1) / 2, min(y0, y1), max(y0, y1))
    return ((y0 + y1) / 2, min(x0, x1), max(x0, x1))


def _from_axis(o: str, pos: float, lo: float, hi: float) -> tuple[tuple[float, float], tuple[float, float]]:
    return ((pos, lo), (pos, hi)) if o == "v" else ((lo, pos), (hi, pos))


def interior_walls(
    candidates,
    transform: Transform,
    footprint: Polygon,
    room_boundaries=None,
) -> list[Wall]:
    """Wall strokes in pixels to the building's interior walls in metres."""
    ring = footprint.exterior
    inner = footprint.buffer(-0.25)
    pieces: list[Wall] = []
    for o, pos, lo, hi, gap in candidates:
        a, b = ((lo, pos), (hi, pos)) if o == "h" else ((pos, lo), (pos, hi))
        line = LineString([transform.to_m(*a), transform.to_m(*b)]).intersection(inner)
        if line.is_empty or line.geom_type != "LineString" or line.length < 0.4:
            continue
        (x0, y0), (x1, y1) = line.coords[0], line.coords[-1]
        near = lambda p: ring.distance(Point(p)) < OUTLINE_BAND + 0.1
        mid = ((x0 + x1) / 2, (y0 + y1) / 2)
        # A face of an outer wall, a window frame or a sill line, not an interior wall.
        if ring.distance(Point(mid)) < OUTLINE_BAND and near((x0, y0)) and near((x1, y1)):
            continue
        # Image axes are close to plan axes only when the plan is not turned: keep the
        # metre axis the stroke runs along.
        mo = "v" if abs(x1 - x0) < abs(y1 - y0) else "h"
        pieces.append(Wall(mo, (x0, y0), (x1, y1), gap / transform.scale))

    walls: list[Wall] = []
    for o in ("h", "v"):
        groups: list[dict] = []
        for pos, lo, hi, t in sorted(((*_axis(p), p.thickness) for p in pieces if p.orientation == o), key=lambda k: k[1]):
            for g in groups:
                if abs(g["pos"] - pos) < SAME_LINE and lo <= g["hi"] + DOOR_MAX:
                    g["parts"].append((lo, hi))
                    g["hi"] = max(g["hi"], hi)
                    g["len"] += hi - lo
                    g["pos"] += (pos - g["pos"]) * (hi - lo) / g["len"]
                    g["t"] = max(g["t"], t)
                    break
            else:
                groups.append({"pos": pos, "lo": lo, "hi": hi, "parts": [(lo, hi)], "len": hi - lo, "t": t})
        for g in groups:
            a, b = _from_axis(o, g["pos"], g["lo"], g["hi"])
            walls.append(Wall(o, a, b, g["t"], parts=g["parts"]))

    _extend_to_neighbours(walls, ring)
    if room_boundaries is not None:
        band = room_boundaries.difference(ring.buffer(0.3)).buffer(0.4)
        for w in walls:
            inside = w.line.difference(ring.buffer(0.3))
            w.support = inside.intersection(band).length / max(inside.length, 1e-6)
        walls = [w for w in walls if (w.support or 0) >= MIN_SUPPORT]
    walls = [w for w in walls if w.line.length >= MIN_WALL_LENGTH]
    return _anchored(walls, ring)


def _extend_to_neighbours(walls: list[Wall], ring) -> None:
    """Each end moves onto the perpendicular wall or the outline it stops short of.

    An end that reaches the outline lands exactly on it, even when the outline's corner lies
    a few centimetres off the wall's line: the editor only splits a room where a wall touches
    the outline, and a wall that stops short by 7 cm would leave two rooms as one.
    """
    for w in walls:
        pos, lo, hi = _axis(w)
        ends: dict[str, tuple[float, float]] = {}
        for end, value in (("lo", lo), ("hi", hi)):
            point = (pos, value) if w.orientation == "v" else (value, pos)
            target, shift = point, None
            q = ring.interpolate(ring.project(Point(point)))
            if q.distance(Point(point)) < SNAP_OUTLINE:
                target, shift = (q.x, q.y), q.distance(Point(point))
            for other in walls:
                if other is w or other.orientation == w.orientation:
                    continue
                opos, olo, ohi = _axis(other)
                if olo - SNAP <= pos <= ohi + SNAP and abs(opos - value) < SNAP:
                    if shift is None or abs(opos - value) < shift:
                        target = (pos, opos) if w.orientation == "v" else (opos, pos)
                        shift = abs(opos - value)
            ends[end] = target
        w.a, w.b = ends["lo"], ends["hi"]


def _anchored(walls: list[Wall], ring) -> list[Wall]:
    """Walls held at both ends, by the outline or another kept wall. Loose stubs are noise."""
    kept = list(walls)
    while True:
        def held(p, w):
            if ring.distance(Point(p)) < 0.05:
                return True
            return any(o is not w and o.line.distance(Point(p)) < 0.05 for o in kept)

        next_kept = [w for w in kept if held(w.a, w) and held(w.b, w)]
        if len(next_kept) == len(kept):
            return kept
        kept = next_kept


def _ink_gap(ink: np.ndarray, transform: Transform, wall: Wall, centre: float) -> tuple[float, float] | None:
    """The door opening in a wall around `centre` (metres along the wall), or None.

    Across the wall, the amount of ink tells wall from door: a wall is drawn full thickness
    (two faces, or one thick stroke), a door as a gap or as one thin line carrying through with
    ticks. Where the ink across drops below OPEN_BELOW of the wall's usual amount, it is open.
    """
    pos, lo, hi = _axis(wall)
    step = 1 / transform.scale
    half = wall.thickness / 2 + 1.5 * step
    across = np.arange(-half, half + step / 2, step)
    along = np.arange(lo, hi, step)
    if len(along) < 5:
        return None
    pts = np.array([(pos + d, u) if wall.orientation == "v" else (u, pos + d) for u in along for d in across])
    px = np.rint(transform.to_px(pts)).astype(int)
    h, w = ink.shape
    px[:, 0] = np.clip(px[:, 0], 0, w - 1)
    px[:, 1] = np.clip(px[:, 1], 0, h - 1)
    amount = (ink[px[:, 1], px[:, 0]] > 0).reshape(len(along), len(across)).sum(axis=1)
    # Compared with the wall close by: one wall line can be drawn thicker in one room than in
    # the next, and a door is thinner than the wall it is in.
    local = np.abs(along - centre) <= 1.5
    median = max(float(np.percentile(amount[local], 75)), 1.0)
    open_ = amount < OPEN_BELOW * median
    near = np.flatnonzero(open_ & (np.abs(along - centre) <= 0.3))
    if len(near) == 0:
        return None
    i = int(near[np.argmin(np.abs(along[near] - centre))])
    # Door symbols inside the opening (a tick, the leaf, a hinge mark) are short: step over them.
    blip = max(2, int(0.15 * transform.scale))
    n = len(along)
    # A jamb is drawn across the wall at each end of the opening: ink right across the band.
    jamb = amount >= 1.3 * median

    def edge(direction: int) -> int:
        k = last = i
        while 0 <= k + direction < n:
            k += direction
            if open_[k]:
                last = k
                continue
            j = k
            while 0 <= j < n and not open_[j] and abs(j - k) < blip:
                j += direction
            if 0 <= j < n and open_[j]:
                k = j - direction
                continue
            break
        return last

    left, right = edge(-1), edge(1)
    # The opening runs up to the jamb lines, when they are drawn.
    while left > 0 and jamb[left - 1]:
        left -= 1
    while right < n - 1 and jamb[right + 1]:
        right += 1
    width = along[right] - along[left] + step
    return (float(along[left]), float(along[right] + step)) if DOOR_MIN <= width <= DOOR_MAX else None


def doors_of(walls: list[Wall], ink: np.ndarray, transform: Transform, model_doors=()) -> list[Door]:
    """Door openings: gaps between the pieces of a wall, and the model's doors measured in ink."""
    doors: list[Door] = []

    def add(wall: Wall, lo: float, hi: float, source: str):
        pos = _axis(wall)[0]
        mid = (lo + hi) / 2
        for d in doors:
            dmid = ((d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2)
            here = (pos, mid) if wall.orientation == "v" else (mid, pos)
            if math.dist(dmid, here) < 0.5:
                return
        a, b = _from_axis(wall.orientation, pos, lo, hi)
        doors.append(Door(a, b, source))

    for w in walls:
        parts = sorted(w.parts)
        if not parts:
            continue
        end = parts[0][1]
        for lo, hi in parts[1:]:
            if DOOR_MIN < lo - end < DOOR_MAX:
                add(w, end, lo, "gap")
            end = max(end, hi)
    for seg in model_doors:
        line = LineString(seg)
        mid = line.interpolate(0.5, normalized=True)
        wall = min(walls, key=lambda w: w.line.distance(mid), default=None)
        if wall is None or wall.line.distance(mid) > 0.4:
            continue
        pos, lo, hi = _axis(wall)
        centre = mid.y if wall.orientation == "v" else mid.x
        gap = _ink_gap(ink, transform, wall, centre)
        if gap:
            add(wall, gap[0], gap[1], "model")
    return doors


def analyse(gray: np.ndarray, footprint_m: np.ndarray, rooms_px=None, doors_px=()) -> Result:
    """The whole pipeline. `rooms_px` and `doors_px` come from a room model, if one ran."""
    ink = ink_of(gray)
    transform, error_px = register(ink, footprint_m)
    footprint = Polygon(footprint_m)
    to_m = lambda pts: [transform.to_m(x, y) for x, y in pts]
    min_len = max(8, int(0.5 * transform.scale))
    strokes = strokes_of(ink, min_len, WALL_MAX_FACE_GAP * transform.scale)
    candidates = wall_strokes(strokes, transform.scale, min_len)
    boundaries = None
    if rooms_px:
        polys = [Polygon(to_m(r)).buffer(0).intersection(footprint) for r in rooms_px if len(r) >= 3]
        polys = [p for p in polys if not p.is_empty and p.area > 1.0]
        boundaries = unary_union([p.boundary for p in polys]) if polys else None
    walls = interior_walls(candidates, transform, footprint, boundaries)
    doors = doors_of(walls, ink, transform, [to_m(d) for d in doors_px if len(d) >= 2])
    return Result(transform, error_px / transform.scale, walls, doors, boundaries is not None)
