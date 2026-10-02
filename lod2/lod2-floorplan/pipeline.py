"""
Interior walls and doors from a floor plan drawing of a building whose outline is known.

The LoD2 model already gives the footprint in metres. A floor plan adds what is inside it:
where the interior walls stand and where their doors are. Four steps:

1. Place the plan. The footprint is slid, scaled and turned over the drawing until its edges
   lie on ink (chamfer matching on a distance transform), guided by the room model's rooms
   when it ran. That fixes pixels per metre and position without the user marking anything,
   and everything later is in plan metres.
2. Find walls the way they are drawn: two parallel lines 6 to 32 cm apart, or one solid
   stroke that thick. Dimension lines, text underlines and furniture are single thin lines
   and drop out; a third line at the same spacing makes a ladder (stairs), not a wall.
3. Keep only walls inside the outline, off the outer walls, merged along their line,
   extended to meet the walls they end at, and connected to the outline or another wall.
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
# Up to a double door of 1.51 m (DIN 18101), measured with a little of its frame.
DOOR_MIN, DOOR_MAX = 0.5, 1.55
# Metres of wall a door found in the ink alone needs on each side.
JAMB = 0.2
# Pieces on one line with up to this much between them are one wall with an opening: a door,
# or a wide passage between two rooms.
MERGE_GAP = 2.0
# A wall held at one end only must be at least this long: shorter ones are stoves, cupboards
# and stair parts more often than walls.
ONE_END_MIN = 2.0
SNAP = 0.5
# A wall end this far past a crossing wall is not pulled back onto it.
OVERSHOOT = 0.15
# An interior wall ends at the inner face of an outer wall, up to about this far from the
# outline (the outline is the outer face).
SNAP_OUTLINE = 0.8
# A wall end this close beside a corner of the outline lies on the corner's line.
CORNER_ACROSS = 0.15
MIN_SUPPORT = 0.6
# The room model's rooms must cover this share of the drawn building's box, or it failed.
MIN_COVER = 0.4
# A wall the room model does not confirm must be drawn along this share of its length (the
# rest is doors), and lie further than this from the outline somewhere (metres).
MIN_DRAWN = 0.7
ALONG_OUTLINE = 1.2
# A door reads thinner across than the wall around it (its thicker parts, the 75th percentile
# close by): the wall's faces stop, a thin line may carry on.
OPEN_BELOW = 0.7
# Pixels: distance cap for the chamfer cost, so far-off points do not dominate.
CHAMFER_CAP = 25.0
# Metres: how far from the room model's rooms the drawn outer walls may lie (a thick outer
# wall, plus the model's own blur at its 256 pixels).
ROOM_REACH = 0.55


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
    source: str  # "gap", "model" or "ink"


@dataclass
class Result:
    transform: Transform
    fit_error: float  # metres, median distance of the footprint from the drawn outline
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


def _drawing(walls: np.ndarray) -> tuple[int, int, int, int] | None:
    """The box (x, y, w, h) of the cluster with the most wall-like ink: the building drawn."""
    h, w = walls.shape
    reach = max(3, max(h, w) // 120)
    joined = cv2.dilate(walls, cv2.getStructuringElement(cv2.MORPH_RECT, (2 * reach + 1, 2 * reach + 1)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(joined)
    if n < 2:
        return None
    # The most wall ink, not the largest box: a sheet's frame is long but thin.
    ink_per = np.bincount(labels[walls > 0], minlength=n)
    i = 1 + int(np.argmax(ink_per[1:]))
    x, y, bw, bh = (int(v) for v in stats[i, :4])
    return x, y, bw, bh


def plan_region(gray: np.ndarray) -> tuple[int, int, int, int]:
    """Where the floor plan is on the sheet, as (x0, y0, x1, y1) pixels.

    An architect's sheet carries a title block, a legend, an area schedule and notes around
    the drawing; read whole, the building is a small part of it and the room model sees it at
    a few dozen of its 256 pixels. The plan is the cluster with the most wall-like ink; a sheet
    that is mostly plan already is returned whole.
    """
    h, w = gray.shape
    drawn = _drawing(wall_mask(ink_of(gray)))
    if drawn is None:
        return 0, 0, w, h
    x, y, bw, bh = drawn
    if bw * bh > 0.6 * w * h:
        return 0, 0, w, h
    margin = int(0.08 * max(bw, bh))
    return max(0, x - margin), max(0, y - margin), min(w, x + bw + margin), min(h, y + bh + margin)


def register(ink: np.ndarray, footprint: np.ndarray, rooms_px=None) -> tuple[Transform, float]:
    """The transform that lays the footprint on the drawn outer walls, and its median error in px.

    Only wall-like ink counts, so dimension lines and text cannot pull the outline, and with the
    room model's rooms only the ink near them: a drawing is rarely in exact proportion with the
    measured building, and a title line or a frame just outside the plan would otherwise win.
    Smaller shapes also fit on interior walls, so among fits about as good as the best the
    largest wins (the outer walls are outermost), with the room model's rooms the largest that
    keeps them inside. Over a wall drawn filled, every place across its thickness fits equally
    well, so the winner is then grown about its middle while it stays on the ink: the outline
    is the outer face.
    """
    h, w = ink.shape
    walls_px = wall_mask(ink)
    size = footprint.max(axis=0) - footprint.min(axis=0)
    rooms = _room_union(rooms_px)
    if rooms is not None:
        # The outer walls touch the rooms: wall-like ink further out (a frame, a title line,
        # a legend) is left out. The rooms cover about the footprint, which sets the scale.
        near = np.zeros_like(walls_px)
        for poly in getattr(rooms, "geoms", [rooms]):
            cv2.fillPoly(near, [np.asarray(poly.exterior.coords, dtype=np.int32)], 255)
        reach = int(ROOM_REACH * math.sqrt(rooms.area / Polygon(footprint).area))
        near = cv2.dilate(near, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * reach + 1, 2 * reach + 1)))
        walls_px = cv2.bitwise_and(walls_px, near)
    dist = np.minimum(cv2.distanceTransform(255 - walls_px, cv2.DIST_L2, 5), CHAMFER_CAP)
    samples = _outline_samples(footprint)

    def cost(p: np.ndarray) -> float:
        px = Transform(*p).to_px(samples)
        x, y = px[:, 0], px[:, 1]
        outside = (x < 0) | (x >= w) | (y < 0) | (y >= h)
        xi, yi = np.clip(x, 0, w - 1).astype(int), np.clip(y, 0, h - 1).astype(int)
        return float(np.where(outside, CHAMFER_CAP, dist[yi, xi]).mean())

    centre = footprint.mean(axis=0)
    fit = min(w / size.max(), h / size.max())
    lo, hi = 0.3 * fit, 1.05 * fit
    drawn = _drawing(wall_mask(ink))
    if drawn is not None:
        # The outer walls are the outermost wall ink, so the drawn building's size sets the
        # scale to within a few tens of percent (more when the drawing is out of proportion).
        # That rules out the outline shrunk onto a grid of interior walls, which can fit the
        # ink better than the real outline does.
        _, _, bw, bh = drawn
        expected = min(max(bw, bh) / size.max(), min(bw, bh) / size.min())
        lo = min(max(lo, 0.8 * expected), hi)
    coarse: list[tuple[float, np.ndarray]] = []
    for turn in (0, 90, 180, 270):
        th = math.radians(turn)
        c, s = math.cos(th), math.sin(th)
        for scale in np.linspace(lo, hi, 16):
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
    in_range = [(v, p) for v, p in fits if 0.95 * lo <= p[0] <= 1.05 * hi]
    fits = in_range or fits
    best = min(v for v, _ in fits)
    good = [(v, Transform(*(float(x) for x in p))) for v, p in fits if v <= best * 1.25 + 0.5]
    if rooms is not None:
        def outside(t: Transform) -> float:
            """Share of the rooms that sticks out of the outline."""
            return rooms.difference(Polygon(t.to_px(footprint)).buffer(0)).area / rooms.area

        # The outer walls are the outermost wall ink near the rooms (ink further out is already
        # left out), so the largest fit that keeps the rooms in; none keeps them: the closest.
        holding = [f for f in good if outside(f[1]) < 0.03]
        if holding:
            value, transform = max(holding, key=lambda f: f[1].scale)
        else:
            value, transform = min(good, key=lambda f: outside(f[1]))
    else:
        value, transform = max(good, key=lambda f: f[1].scale)
    final = _on_outer_faces(_grown(transform, footprint, cost, value), footprint, walls_px, ink)
    # How far the outline lies from the drawn walls, as the median: a shop front of windows and
    # doors has no wall to lie on, and the mean would count every metre of it.
    px = final.to_px(samples)
    xi = np.clip(px[:, 0], 0, w - 1).astype(int)
    yi = np.clip(px[:, 1], 0, h - 1).astype(int)
    return final, float(np.median(dist[yi, xi]))


def _on_outer_faces(t: Transform, footprint: np.ndarray, walls_px: np.ndarray, ink: np.ndarray) -> Transform:
    """`t` refined so the outline lies on the outer faces of the drawn outer walls.

    The search above fits the outline onto wall ink, and a thick wall is ink all across, so the
    outline can settle on the inner face and come out a few percent small. Here each point of
    the outline looks outward and inward across the wall for the outermost wall ink (the edge
    of the ink itself: the wall mask runs a pixel wide), and the
    scale, turn and shift that best put the outline there are solved by least squares; points
    at a window (no wall) or far off (a stain, a wall drawn out of proportion) drop out.
    """
    ring = np.vstack([footprint, footprint[:1]])
    # Outward normals: the footprint may run either way round.
    turn = 1.0 if Polygon(footprint).exterior.is_ccw else -1.0
    h, w = walls_px.shape
    for reach in (0.6, 0.3):
        src, dst = [], []
        for a, b in zip(ring[:-1], ring[1:]):
            edge = b - a
            length = float(np.hypot(*edge))
            if length < 0.5:
                continue
            u = edge / length
            n = turn * np.array([u[1], -u[0]])
            steps = np.arange(-reach, reach, 1 / t.scale)
            for k in np.arange(0.25, length - 0.25, 0.1):
                p = a + u * k
                pts = t.to_px(p + np.outer(steps, n))
                xi, yi = np.rint(pts[:, 0]).astype(int), np.rint(pts[:, 1]).astype(int)
                ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
                hit = np.zeros(len(steps), bool)
                hit[ok] = walls_px[yi[ok], xi[ok]] > 0
                if not hit.any():
                    continue
                inked = np.zeros(len(steps), bool)
                inked[ok] = ink[yi[ok], xi[ok]] > 0
                last = int(np.flatnonzero(hit)[-1])
                # Back to the ink under the mask, then out to the end of that ink.
                while last > 0 and not inked[last]:
                    last -= 1
                while last + 1 < len(steps) and inked[last + 1]:
                    last += 1
                # The outer face lies half a stroke inside the ink's edge.
                d = steps[last] - 0.5 / t.scale
                src.append(p)
                dst.append(t.to_px((p + n * d)[None])[0])
        if len(src) < 12:
            return t
        src, dst = np.array(src), np.array(dst)
        fitted = _similarity(src, dst)
        # Once more without the points that disagree: windows, stains, out of proportion.
        miss = np.linalg.norm(fitted.to_px(src) - dst, axis=1)
        keep = miss <= max(2.0, 2.5 * float(np.median(miss)))
        t = _similarity(src[keep], dst[keep]) if keep.sum() >= 12 else fitted
    return t


def _similarity(src: np.ndarray, dst_px: np.ndarray) -> Transform:
    """The Transform (scale, turn, shift) that maps plan points `src` best onto pixels `dst_px`,
    by least squares (Umeyama)."""
    dst = dst_px * np.array([1.0, -1.0])  # pixels with y up, as the plan
    ms, md = src.mean(axis=0), dst.mean(axis=0)
    a, b = src - ms, dst - md
    cov = b.T @ a / len(src)
    U, S, Vt = np.linalg.svd(cov)
    sign = np.diag([1.0, np.sign(np.linalg.det(U @ Vt))])
    R = U @ sign @ Vt
    scale = float(np.trace(np.diag(S) @ sign) / (a**2).sum(axis=1).mean())
    off = md - scale * R @ ms
    theta = math.atan2(R[1, 0], R[0, 0])
    return Transform(scale, theta, float(off[0]), float(-off[1]))


def _grown(t: Transform, footprint: np.ndarray, cost, value: float) -> Transform:
    """`t` scaled up about the outline's middle as far as the fit stays as good (to half a pixel)."""
    centre = t.to_px(footprint.mean(axis=0, keepdims=True))[0]
    best = t
    for k in np.arange(1.0025, 1.08, 0.0025):
        # Scaling about the middle in pixels: the origin moves away from it by the same factor.
        grown = Transform(t.scale * k, t.theta, centre[0] + (t.ox - centre[0]) * k, centre[1] + (t.oy - centre[1]) * k)
        if cost(np.array([grown.scale, grown.theta, grown.ox, grown.oy])) > value + 0.5:
            break
        best = grown
    return best


def _room_union(rooms_px):
    """The room model's rooms in pixels as one shape, or None when it found too little."""
    polys = [Polygon(r).buffer(0) for r in rooms_px or () if len(r) >= 3]
    polys = [p for p in polys if not p.is_empty and p.area > 0]
    if len(polys) < 2:
        return None
    return unary_union(polys)


def strokes_of(ink: np.ndarray, min_length_px: int, max_thickness_px: float):
    """Horizontal and vertical ink strokes: (orientation, position, from, to, thickness) in px.

    A stroke is a run along which the ink across stays thinner than `max_thickness_px`. One
    piece of ink can hold several: an interior wall that carries on the line of a thicker outer
    wall, or a long wall a degree or two off the image axes (a skewed outline, a scan put in a
    little crooked) whose box is taller than the wall is thick. So a piece whose box is too
    thick is measured across at every step along it and cut into its thin enough runs.
    """
    out = []
    for o, kernel in (("h", (min_length_px, 1)), ("v", (1, min_length_px))):
        opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(opened)
        for i in range(1, n):
            x, y, w, h, _ = stats[i]
            length, box = (w, h) if o == "h" else (h, w)
            if box < max_thickness_px:
                # Across the stroke, the middle of its ink.
                cx, cy = centroids[i]
                if o == "h":
                    out.append(("h", float(cy), float(x), float(x + w), float(box)))
                else:
                    out.append(("v", float(cx), float(y), float(y + h), float(box)))
                continue
            if length < min_length_px:
                continue
            piece = labels[y : y + h, x : x + w] == i
            if o == "v":
                piece = piece.T  # along the rows from here on
            count = piece.sum(axis=0)
            across = np.arange(piece.shape[0])[:, None]
            middle = (piece * across).sum(axis=0) / np.maximum(count, 1)
            thin = (count > 0) & (count < max_thickness_px)
            k = 0
            while k < len(thin):
                if not thin[k]:
                    k += 1
                    continue
                j = k
                while j < len(thin) and thin[j]:
                    j += 1
                if j - k >= min_length_px:
                    pos = float(middle[k:j].mean()) + (y if o == "h" else x)
                    lo, hi = (x + k, x + j) if o == "h" else (y + k, y + j)
                    out.append((o, pos, float(lo), float(hi), float(count[k:j].mean())))
                k = j
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
    rooms=None,
    ink: np.ndarray | None = None,
) -> list[Wall]:
    """Wall strokes in pixels to the building's interior walls in metres. `rooms` are the room
    model's rooms in metres, when it ran."""
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
                if abs(g["pos"] - pos) < SAME_LINE and lo <= g["hi"] + MERGE_GAP:
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
    if ink is not None:
        _across_doors(walls, ring, ink, transform)
    # An end still free after running past a crossing wall stops on that wall after all.
    _extend_to_neighbours(walls, ring, pull_back=True)
    # Both ends on the outline and running along it: a corner cut off by a stain or a window
    # frame, not a wall between rooms.
    walls = [
        w for w in walls
        if not (
            ring.distance(Point(w.a)) < 0.05
            and ring.distance(Point(w.b)) < 0.05
            and ring.distance(w.line.interpolate(0.5, normalized=True)) < OUTLINE_BAND
        )
    ]
    if rooms:
        band = unary_union([r.boundary for r in rooms]).difference(ring.buffer(0.3)).buffer(0.4)
        for w in walls:
            inside = w.line.difference(ring.buffer(0.3))
            w.support = inside.intersection(band).length / max(inside.length, 1e-6)
        # The model at 256 pixels often runs small rooms into one (a light partition between
        # a hall and a study, or half a floor as one room), so a wall it does not confirm still
        # stays when the drawing makes the case: drawn along most of its length, not along the
        # outline, and held at both ends by the outline or established walls (_anchored).
        walls = [
            w for w in walls
            if w.support >= MIN_SUPPORT or (_drawn(w) >= MIN_DRAWN and not _along_outline(w, ring))
        ]
    walls = [w for w in walls if w.line.length >= MIN_WALL_LENGTH]
    return _anchored(walls, ring)


def _drawn(w: Wall) -> float:
    """The share of the wall's length its drawn pieces cover: a partition is drawn all along
    but for its doors, a stair's dashed edge or a run of text is not."""
    _, lo, hi = _axis(w)
    covered, end = 0.0, lo
    for a, b in sorted(w.parts):
        a, b = max(a, end), min(b, hi)
        if b > a:
            covered += b - a
            end = b
    return covered / max(hi - lo, 1e-6)


def _along_outline(w: Wall, ring) -> bool:
    """Whether the wall runs along the outline all its length: an outer wall's face drawn out
    of proportion with the measured outline, not a wall between rooms."""
    return max(ring.distance(Point(p)) for p in (w.a, w.b, w.line.interpolate(0.5, normalized=True))) < ALONG_OUTLINE


def _extend_to_neighbours(walls: list[Wall], ring, pull_back: bool = False) -> None:
    """Each end moves onto the perpendicular wall or the outline it stops short of.

    An end that reaches the outline lands exactly on it, even when the outline's corner lies
    a few centimetres off the wall's line: the editor only splits a room where a wall touches
    the outline, and a wall that stops short by 7 cm would leave two rooms as one.
    """
    corners = list(ring.coords)[:-1]
    for w in walls:
        pos, lo, hi = _axis(w)
        # A wall that ends at a corner of the outline continues that outline edge into the
        # building (the line of a wing's wall): it lies on the corner, not a few cm beside it.
        for cx, cy in corners:
            across, along = (cx, cy) if w.orientation == "v" else (cy, cx)
            if abs(across - pos) < CORNER_ACROSS and min(abs(along - lo), abs(along - hi)) < SNAP_OUTLINE:
                pos = across
                w.a, w.b = _from_axis(w.orientation, pos, lo, hi)
                break
        ends: dict[str, tuple[float, float]] = {}
        for end, value in (("lo", lo), ("hi", hi)):
            point = (pos, value) if w.orientation == "v" else (value, pos)
            target, shift = point, None
            q = ring.interpolate(ring.project(Point(point)))
            if q.distance(Point(point)) < SNAP_OUTLINE:
                # Onto the outline along the wall, not sideways: the outline can run at a slant.
                d = 1 if end == "hi" else -1
                reach = [(pos, value + d * k) if w.orientation == "v" else (value + d * k, pos) for k in (-SNAP_OUTLINE, SNAP_OUTLINE)]
                cross = LineString(reach).intersection(ring)
                pts = [cross] if cross.geom_type == "Point" else list(getattr(cross, "geoms", []))
                pts = [p for p in pts if p.geom_type == "Point"]
                if pts:
                    q = min(pts, key=lambda p: p.distance(Point(point)))
                    target, shift = (q.x, q.y), q.distance(Point(point))
            for other in walls:
                if other is w or other.orientation == w.orientation:
                    continue
                opos, olo, ohi = _axis(other)
                # Not back onto a wall this one runs on past: it goes on to a door or a stub.
                past = (opos - value) if end == "lo" else (value - opos)
                if past > OVERSHOOT and not pull_back:
                    continue
                if olo - SNAP <= pos <= ohi + SNAP and abs(opos - value) < SNAP:
                    if shift is None or abs(opos - value) < shift:
                        target = (pos, opos) if w.orientation == "v" else (opos, pos)
                        shift = abs(opos - value)
            ends[end] = target
        w.a, w.b = ends["lo"], ends["hi"]


def _across_doors(walls: list[Wall], ring, ink: np.ndarray, transform: Transform) -> None:
    """A wall end that stops free a door's width short of another wall or the outline, with
    a stub of wall drawn there, is carried across: the door between the stub and the end is a
    door in this wall (found later in the ink), not a gap between two rooms."""
    for w in walls:
        pos, lo, hi = _axis(w)
        for end, value, d in (("lo", lo, -1), ("hi", hi, 1)):
            here = (pos, value) if w.orientation == "v" else (value, pos)
            if ring.distance(Point(here)) < 0.05 or any(
                o is not w and o.line.distance(Point(here)) < 0.05 for o in walls
            ):
                continue
            far = (pos, value + d * (DOOR_MAX + 0.4)) if w.orientation == "v" else (value + d * (DOOR_MAX + 0.4), pos)
            reach = LineString([here, far])
            stops = [reach.intersection(ring)] + [reach.intersection(o.line) for o in walls if o is not w and o.orientation != w.orientation]
            hits = [p for g in stops for p in ([g] if g.geom_type == "Point" else getattr(g, "geoms", [])) if p.geom_type == "Point"]
            if not hits:
                continue
            stop = min(hits, key=lambda p: p.distance(Point(here)))
            target = stop.y if w.orientation == "v" else stop.x
            if abs(target - value) < DOOR_MIN:
                continue
            # The stub: wall ink across this wall's line just before the wall it reaches.
            probe = Wall(w.orientation, *_from_axis(w.orientation, pos, min(value, target), max(value, target)), w.thickness)
            span = abs(target - value)
            near_stop = 0.35 / span
            amount = _amount_along(ink, transform, probe)
            if amount is None:
                continue
            along, across = amount
            stub = across[(along >= 1 - near_stop) if d > 0 else (along <= near_stop)]
            body = _amount_along(ink, transform, w)
            if body is None or len(stub) == 0:
                continue
            usual = float(np.percentile(body[1], 75))
            if (stub >= OPEN_BELOW * usual).mean() >= 0.3:
                if end == "lo":
                    w.a, w.b = _from_axis(w.orientation, pos, target, hi)
                else:
                    w.a, w.b = _from_axis(w.orientation, pos, lo, target)
                pos, lo, hi = _axis(w)


def _amount_along(ink: np.ndarray, transform: Transform, wall: Wall):
    """(share along 0..1, ink across) sampled every pixel along the wall, or None."""
    pos, lo, hi = _axis(wall)
    step = 1 / transform.scale
    half = wall.thickness / 2 + 1.5 * step
    across = np.arange(-half, half + step / 2, step)
    along = np.arange(lo, hi, step)
    if len(along) < 3:
        return None
    pts = np.array([(pos + d, u) if wall.orientation == "v" else (u, pos + d) for u in along for d in across])
    px = np.rint(transform.to_px(pts)).astype(int)
    h, w = ink.shape
    px[:, 0] = np.clip(px[:, 0], 0, w - 1)
    px[:, 1] = np.clip(px[:, 1], 0, h - 1)
    amount = (ink[px[:, 1], px[:, 0]] > 0).reshape(len(along), len(across)).sum(axis=1)
    return (along - lo) / (hi - lo), amount


def _anchored(walls: list[Wall], ring) -> list[Wall]:
    """Walls held by the outline or another kept wall. A wall may end free at a doorway or a
    passage, so one held end is enough for a long wall the room model confirmed; a stub held at
    neither end is noise. Without the model both ends must be held, as the drawing alone also
    has furniture and fittings that look like short walls. A wall the model ran over must be
    held at both ends by the outline or established walls, in order from the outline in: the
    sides of a text box or a cupboard drawn in a room hold only each other."""
    def checked(w):
        return w.support is None or w.support >= MIN_SUPPORT

    def held(p, w, by):
        if ring.distance(Point(p)) < 0.05:
            return True
        return any(o is not w and o.line.distance(Point(p)) < 0.05 for o in by)

    kept = list(walls)
    while True:
        anchors = [w for w in kept if checked(w)]
        loose = [w for w in kept if not checked(w)]
        grew = True
        while grew:
            grew = False
            for w in list(loose):
                if held(w.a, w, anchors) and held(w.b, w, anchors):
                    anchors.append(w)
                    loose.remove(w)
                    grew = True

        def stays(w):
            ends = held(w.a, w, anchors) + held(w.b, w, anchors)
            if not checked(w):
                return ends == 2
            return ends == 2 or (ends == 1 and w.support is not None and w.line.length >= ONE_END_MIN)

        next_kept = [w for w in anchors if stays(w)]
        if len(next_kept) == len(kept):
            return kept
        kept = next_kept


def _ink_gap(
    ink: np.ndarray, transform: Transform, wall: Wall, centre: float, strict: bool = False
) -> tuple[float, float] | None:
    """The door opening in a wall around `centre` (metres along the wall), or None. `strict`
    for an opening nothing else points at: in a wall drawn as two lines, an opening its two
    lines run on through is none.

    Across the wall, the amount of ink tells wall from door: a wall is drawn full thickness
    (two faces, or one thick stroke), a door as a gap or as one thin line carrying through with
    ticks. Where the ink across drops below OPEN_BELOW of the wall's usual amount, it is open.
    """
    pos, lo, hi = _axis(wall)
    step = 1 / transform.scale
    half = wall.thickness / 2 + 3 * step
    across = np.arange(-half, half + step / 2, step)
    along = np.arange(lo, hi, step)
    if len(along) < 5:
        return None
    pts = np.array([(pos + d, u) if wall.orientation == "v" else (u, pos + d) for u in along for d in across])
    px = np.rint(transform.to_px(pts)).astype(int)
    h, w = ink.shape
    px[:, 0] = np.clip(px[:, 0], 0, w - 1)
    px[:, 1] = np.clip(px[:, 1], 0, h - 1)
    cells = (ink[px[:, 1], px[:, 0]] > 0).reshape(len(along), len(across))
    amount = cells.sum(axis=1)
    # Compared with the wall close by: one wall line can be drawn thicker in one room than in
    # the next, and a door is thinner than the wall it is in.
    local = np.abs(along - centre) <= 1.5
    median = max(float(np.percentile(amount[local], 75)), 1.0)
    open_ = amount < OPEN_BELOW * median
    faces = _faces(cells[local])
    if faces is not None:
        # A wall drawn as two lines is open where its lines stop: the door's label and its
        # swing arc in the opening add ink, but not as both lines along the wall. And its usual
        # amount is that of the rows with both lines: a leaf or an arc drawn alongside the
        # wall must not make the plain wall next to it look thin.
        (a0, a1), (b0, b1) = faces
        lines = cells[:, a0:a1].any(axis=1) & cells[:, b0:b1].any(axis=1)
        if (lines & local).any():
            median = max(float(np.percentile(amount[lines & local], 75)), 1.0)
        open_ = (amount < OPEN_BELOW * median) | ~lines
    near = np.flatnonzero(open_ & (np.abs(along - centre) <= 0.3))
    if len(near) == 0:
        return None
    i = int(near[np.argmin(np.abs(along[near] - centre))])
    # Door symbols inside the opening (a tick, the leaf, a hinge mark) are short: step over them.
    blip = max(2, int(0.25 * transform.scale))
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
    if strict and faces is not None and lines[left : right + 1].mean() >= 0.8:
        return None
    return (float(along[left]), float(along[right] + step)) if DOOR_MIN <= width <= DOOR_MAX else None


def _faces(cells: np.ndarray) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """The two lines of a wall drawn as two lines, as column ranges across the wall, or None
    for a wall drawn as one filled stroke. `cells` is the ink, along the wall by across it."""
    share = cells.mean(axis=0)
    line = share >= 0.5 * share.max()
    runs, start = [], None
    for i, on in enumerate(list(line) + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i))
            start = None
    if len(runs) < 2:
        return None
    first, last = runs[0], runs[-1]
    # Lines with a clear gap of paper between them: a filled wall has no such gap.
    gap = share[first[1] : last[0]]
    if len(gap) == 0 or gap.min() > 0.3 * share.max():
        return None
    # A pixel's slack each side: the lines are not exactly along the image axes.
    n = cells.shape[1]
    return (max(0, first[0] - 1), min(n, first[1] + 1)), (max(0, last[0] - 1), min(n, last[1] + 1))


def doors_of(walls: list[Wall], ink: np.ndarray, transform: Transform, model_doors=()) -> list[Door]:
    """Door openings: gaps between the pieces of a wall, the model's doors measured in ink, and
    the openings the ink shows along each wall."""
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
                # The pieces stop short of the jambs (a leaf or an arc runs on along the wall),
                # so the opening is measured in the ink when it can be.
                measured = _ink_gap(ink, transform, w, (end + lo) / 2)
                add(w, *(measured or (end, lo)), "gap")
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
    # Then every opening the ink shows along each wall, where the model saw no door: the
    # model at 256 pixels misses narrow doors in thin walls. An opening must have wall on both
    # sides, so a wall that ends free at a passage gives none.
    # Nor can a door be where another wall meets this one, or run on from a door already found.
    for w in walls:
        pos, lo, hi = _axis(w)
        meets = [
            _axis(o)[0] for o in walls
            if o.orientation != w.orientation and o.line.distance(w.line) < 0.05
        ]
        taken = [
            (d.a[1], d.b[1]) if w.orientation == "v" else (d.a[0], d.b[0])
            for d in doors
            if abs((d.a[0] if w.orientation == "v" else d.a[1]) - pos) < 0.05
        ]
        for centre in np.arange(lo + DOOR_MIN, hi - DOOR_MIN, 0.25):
            here = Point((pos, centre) if w.orientation == "v" else (centre, pos))
            # Where the model saw a door, the forgiving reading; elsewhere the strict one.
            pointed = any(LineString(seg).distance(here) < 0.6 for seg in model_doors)
            gap = _ink_gap(ink, transform, w, float(centre), strict=not pointed)
            if not gap or gap[0] - lo < JAMB or hi - gap[1] < JAMB:
                continue
            g0, g1 = gap
            if any(g0 - JAMB < m < g1 + JAMB for m in meets):
                continue
            if any(g0 < max(a, b) + 0.3 and min(a, b) - 0.3 < g1 for a, b in taken):
                continue
            add(w, g0, g1, "ink")
    return doors


def _plausible(rooms_px, ink: np.ndarray) -> bool:
    """Whether the room model saw the building: its rooms cover most of the drawn building.
    On some drawings it finds two rooms of twelve; its rooms would then hide the walls."""
    rooms = _room_union(rooms_px)
    drawn = _drawing(wall_mask(ink))
    if rooms is None or drawn is None:
        return rooms is not None
    return rooms.area >= MIN_COVER * drawn[2] * drawn[3]


def analyse(gray: np.ndarray, footprint_m: np.ndarray, rooms_px=None, doors_px=()) -> Result:
    """The whole pipeline. `rooms_px` and `doors_px` come from a room model, if one ran."""
    ink = ink_of(gray)
    rooms_px = rooms_px if _plausible(rooms_px, ink) else None
    transform, error_px = register(ink, footprint_m, rooms_px)
    footprint = Polygon(footprint_m)
    to_m = lambda pts: [transform.to_m(x, y) for x, y in pts]
    min_len = max(8, int(0.5 * transform.scale))
    strokes = strokes_of(ink, min_len, WALL_MAX_FACE_GAP * transform.scale)
    candidates = wall_strokes(strokes, transform.scale, min_len)
    polys = []
    if rooms_px:
        polys = [Polygon(to_m(r)).buffer(0).intersection(footprint) for r in rooms_px if len(r) >= 3]
        polys = [p for p in polys if not p.is_empty and p.area > 1.0]
    walls = interior_walls(candidates, transform, footprint, polys, ink)
    doors = doors_of(walls, ink, transform, [to_m(d) for d in doors_px if len(d) >= 2])
    return Result(transform, error_px / transform.scale, walls, doors, bool(polys))
