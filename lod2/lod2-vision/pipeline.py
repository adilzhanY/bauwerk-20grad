"""
Corners and openings for one wall of a LoD2 building, from a street photo, with SAM 3.

Everything here works in image pixels. The wall's size in metres comes in from the caller,
who reads it from the LoD2 model, and the openings go out in metres because the caller
rectifies the wall at a known number of pixels per metre. No LoD2 knowledge lives here.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np
import torch
from PIL import Image

from sam3.model_builder import build_sam3_image_model
from sam3.model import box_ops
from sam3.model.data_misc import interpolate
from sam3.model.sam3_image_processor import Sam3Processor

# Longest side the photo is reduced to before SAM 3 sees it. SAM 3 works at 1008 px
# internally, so a 24 megapixel phone photo gains nothing from going in whole.
WORK_MAX_SIDE = 3000
# Boxes below this confidence are dropped.
MIN_SCORE = 0.5
# Things that stand between the camera and a wall and must not become openings.
OCCLUDER_PROMPTS = ["car", "van", "truck", "tree", "person", "bicycle", "motorcycle", "skip container", "street lamp"]
FACADE_PROMPTS = ["building facade", "house", "building"]
ROOF_PROMPT = "roof"
# Columns whose base pixel has an occluder within this many pixels below are not ground.
BASE_MARGIN_PX = 60
# Above this hidden fraction the ground line cannot be fitted from the mask.
BASE_HIDDEN_LIMIT = 0.8
# Perspective moves the photo's proportions from the wall's by up to about 15 percent.
ASPECT_TOLERANCE = 0.2
# Candidate corners further than this many image sizes outside the photo come from
# near parallel lines and are skipped.
MAX_CORNER_REACH = 3


@dataclass
class Detection:
    mask: np.ndarray
    box: list[float]
    score: float


@dataclass
class WallCorners:
    """Corners in the coordinates of the photo the caller sent, top-left first, clockwise."""
    corners: list[list[float]]
    base_hidden: float
    bottom_from_vanishing_point: bool
    facade_score: float
    facade_prompt: str
    painted_photo: Image.Image
    seconds: float


@dataclass
class Opening:
    kind: str
    score: float
    x: float
    y: float
    width: float
    height: float


class Sam3:
    """One loaded model, reused for every request."""

    def __init__(self) -> None:
        with torch.inference_mode():
            self.processor = Sam3Processor(build_sam3_image_model())
        self.device = str(next(self.processor.model.parameters()).device)

    def encode(self, image: Image.Image) -> "Encoded":
        """
        Run the image encoder once. Every prompt on the same picture reuses the result, so a
        wall with twelve prompts costs one pass through the heavy part of the model, not twelve.
        """
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            state = self.processor.set_image(image)
        return Encoded(state=state, width=image.width, height=image.height)

    def detect(self, encoded: "Encoded", prompt: str) -> list[Detection]:
        """
        The objects matching one short text prompt, each with a full-size mask, a box in
        pixels and a score.

        This does what Sam3Processor.set_text_prompt does, with one change. The processor
        enlarges every candidate mask to the full image at once, as 32-bit numbers plus a
        second copy, which for thirty windows on a 3000 pixel photo is several gigabytes of
        video memory for a moment. Here the masks are enlarged one at a time and turned into
        true/false straight away, which gives the same pixels at a small fraction of the peak.
        """
        processor, model = self.processor, self.processor.model
        # The reference notebook runs under bfloat16 autocast. Autocast is per thread, and a
        # web server calls from a worker thread, so it is entered here for every call.
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            backbone = encoded.state["backbone_out"]
            backbone.update(model.backbone.forward_text([prompt], device=processor.device))
            outputs = model.forward_grounding(
                backbone_out=backbone,
                find_input=processor.find_stage,
                geometric_prompt=model._get_dummy_prompt(),
                find_target=None,
            )
            presence = outputs["presence_logit_dec"].sigmoid().unsqueeze(1)
            scores = (outputs["pred_logits"].sigmoid() * presence).squeeze(-1)
            keep = scores > max(processor.confidence_threshold, MIN_SCORE)
            scores = scores[keep].float().cpu().numpy()
            boxes = box_ops.box_cxcywh_to_xyxy(outputs["pred_boxes"][keep]).float()
            size = torch.tensor([encoded.width, encoded.height, encoded.width, encoded.height], device=boxes.device)
            boxes = (boxes * size[None, :]).cpu().numpy()
            low_res = outputs["pred_masks"][keep]
            found = []
            for low, box, score in zip(low_res, boxes, scores):
                found.append(Detection(self._full_mask(low, encoded), [float(v) for v in box], float(score)))
        return found

    @staticmethod
    def _full_mask(low: torch.Tensor, encoded: "Encoded") -> np.ndarray:
        """One low-resolution mask enlarged to the picture's size, as true/false on the CPU."""
        big = interpolate(low[None, None].float(), (encoded.height, encoded.width), mode="bilinear", align_corners=False)
        # A logit above 0 is a probability above 0.5, the processor's own cut-off.
        return (big[0, 0] > 0).cpu().numpy()


@dataclass
class Encoded:
    """A picture after the image encoder, ready for any number of text prompts."""

    state: dict
    width: int
    height: int


def shrink(image: Image.Image, max_side: int = WORK_MAX_SIDE) -> tuple[Image.Image, float]:
    """The image reduced to max_side on its longest edge, and the scale that was applied."""
    scale = min(1.0, max_side / max(image.size))
    if scale >= 1.0:
        return image, 1.0
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS), scale


def union(items: list[Detection], shape) -> np.ndarray:
    u = np.zeros(shape, dtype=bool)
    for d in items:
        u |= d.mask
    return u


def pick_target(facades: list[Detection], shape) -> Detection | None:
    """The facade nearest the photo centre, with a little weight for size."""
    H, W = shape
    best, best_cost = None, None
    for d in facades:
        b = d.box
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        area = (b[2] - b[0]) * (b[3] - b[1]) / (W * H)
        cost = np.hypot((cx - W / 2) / W, (cy - H / 2) / H) - 0.5 * area
        if best is None or cost < best_cost:
            best, best_cost = d, cost
    return best


def largest_component(mask: np.ndarray) -> np.ndarray:
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if num <= 1:
        return mask
    return labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))


# --- lines and quads -----------------------------------------------------------------------

def ransac_line(points: np.ndarray, iters=400, tol=4.0):
    """Best line through 2D points as (point, direction, inlier mask), or None."""
    if len(points) < 2:
        return None
    # Seeded on every call, so a result never depends on earlier requests.
    rng = np.random.default_rng(0)
    best = None
    for _ in range(iters):
        a, b = points[rng.choice(len(points), 2, replace=False)]
        d = b - a
        n = np.hypot(*d)
        if n < 1e-6:
            continue
        d = d / n
        normal = np.array([-d[1], d[0]])
        inliers = np.abs((points - a) @ normal) < tol
        if best is None or inliers.sum() > best.sum():
            best = inliers
    pts = points[best]
    mean = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - mean)
    return mean, vt[0], best


def candidate_lines(points, total, min_share=0.06, max_lines=3):
    """Up to three lines through the points, fitted one after another with inliers removed."""
    points = np.array(points, float)
    out = []
    while len(points) >= 2 and len(out) < max_lines:
        fit = ransac_line(points)
        if fit is None:
            break
        mean, d, inliers = fit
        if inliers.sum() < min_share * total:
            break
        out.append((mean, d, int(inliers.sum())))
        points = points[~inliers]
    return out


def intersect(l1, l2):
    p, d = l1[:2]
    q, e = l2[:2]
    t = np.linalg.solve(np.array([d, -e]).T, q - p)
    return p + d * t[0]


def quad_aspect(quad) -> float:
    tl, tr, br, bl = (np.array(p) for p in quad)
    width = (np.hypot(*(tr - tl)) + np.hypot(*(br - bl))) / 2
    height = (np.hypot(*(bl - tl)) + np.hypot(*(br - tr))) / 2
    return width / max(height, 1e-6)


def is_convex(quad) -> bool:
    pts = np.array(quad)
    signs = []
    for i in range(4):
        u = pts[(i + 1) % 4] - pts[i]
        v = pts[(i + 2) % 4] - pts[(i + 1) % 4]
        signs.append(np.sign(u[0] * v[1] - u[1] * v[0]))
    return signs[0] != 0 and all(s == signs[0] for s in signs)


def vanishing_point(lines, image_width):
    """Where the wall's horizontals meet, by voting over pairwise intersections, or None."""
    cands = []
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            try:
                cands.append(intersect(lines[i], lines[j]))
            except np.linalg.LinAlgError:
                continue
    best, best_votes = None, 0
    for c in cands:
        if not np.all(np.isfinite(c)) or np.hypot(*c) > 40 * image_width:
            continue
        votes = 0
        for pnt, d in lines:
            normal = np.array([-d[1], d[0]])
            if abs((c - pnt) @ normal) < 3.0 + 0.004 * np.hypot(*(c - pnt)):
                votes += 1
        if votes > best_votes:
            best, best_votes = c, votes
    if best is None or best_votes < max(3, len(lines) // 2):
        return None
    return best


def window_row_lines(boxes, region, min_per_row=3):
    """Lines through the top-left and bottom-right corners of each row of windows in the region."""
    inside = []
    for b in boxes:
        cx, cy = int((b[0] + b[2]) / 2), int((b[1] + b[3]) / 2)
        if 0 <= cy < region.shape[0] and 0 <= cx < region.shape[1] and region[cy, cx]:
            inside.append(b)
    if not inside:
        return []
    tol = 0.6 * float(np.median([b[3] - b[1] for b in inside]))
    inside.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows, current = [], [inside[0]]
    for b in inside[1:]:
        if abs((b[1] + b[3]) / 2 - (current[-1][1] + current[-1][3]) / 2) < tol:
            current.append(b)
        else:
            rows.append(current)
            current = [b]
    rows.append(current)
    lines = []
    for row in rows:
        if len(row) < min_per_row:
            continue
        for pts in (np.array([[b[0], b[1]] for b in row], float), np.array([[b[2], b[3]] for b in row], float)):
            mean = pts.mean(axis=0)
            _, _, vt = np.linalg.svd(pts - mean)
            lines.append((mean, vt[0]))
    return lines


def bottom_through_vanishing_point(bot_pts, vp, top_dir, image_width, lowest=False):
    """
    The bottom edge aimed at the vanishing point, through the median clear ground pixel,
    or through the lowest of the points when lowest is set.
    """
    proposals = []
    for p in np.array(bot_pts, float):
        d = (p - vp) if vp is not None else np.array(top_dir, float)
        n = np.hypot(*d)
        if n < 1e-6:
            continue
        d = d / n
        if abs(d[0]) < 1e-6:
            continue
        proposals.append((p[1] + (image_width / 2 - p[0]) * d[1] / d[0], p, d))
    if not proposals:
        return None
    proposals.sort(key=lambda t: t[0])
    _, p, d = proposals[-1 if lowest else len(proposals) // 2]
    return (p, d, len(proposals))


def occluder_bottom(occluders: np.ndarray, x: int, y: int) -> int:
    """The last row of the occluder that starts just below (x, y), or y if none does."""
    below = occluders[y + 1:, x]
    hits = np.flatnonzero(below[:BASE_MARGIN_PX])
    if len(hits) == 0:
        return y
    start = hits[0]
    gaps = np.flatnonzero(~below[start:])
    run = gaps[0] if len(gaps) else len(below) - start
    return int(y + start + run)


def near_image(quad, width: int, height: int) -> bool:
    """True when every corner lies within MAX_CORNER_REACH image sizes of the photo."""
    for x, y in quad:
        if not (-MAX_CORNER_REACH * width <= x <= (1 + MAX_CORNER_REACH) * width):
            return False
        if not (-MAX_CORNER_REACH * height <= y <= (1 + MAX_CORNER_REACH) * height):
            return False
    return True


def fit_quad(wall: np.ndarray, occluders: np.ndarray, wall_aspect: float, window_boxes):
    """
    Four corners of the wall from its mask. Top and bottom from the per-column extremes,
    left and right from the per-row extremes, several candidates per side. The quad whose
    proportions are near the model wall's and that has the most wall behind it wins.
    Returns (quad, base_hidden, bottom_from_vp) or (None, base_hidden, False).
    """
    H, W = wall.shape
    cols = np.where(wall.any(axis=0))[0]
    rows = np.where(wall.any(axis=1))[0]
    ys, xs = np.arange(H), np.arange(W)
    top_pts, bot_pts, left_pts, right_pts = [], [], [], []
    for x in cols:
        col = wall[:, x]
        y_top, y_bot = ys[col][0], ys[col][-1]
        top_pts.append((x, y_top))
        if not occluders[min(H - 1, y_bot + 1):min(H, y_bot + BASE_MARGIN_PX), x].any():
            bot_pts.append((x, y_bot))
    for y in rows:
        row = wall[y, :]
        x_l, x_r = xs[row][0], xs[row][-1]
        if not occluders[y, max(0, x_l - BASE_MARGIN_PX):x_l].any():
            left_pts.append((x_l, y))
        if not occluders[y, x_r + 1:min(W, x_r + BASE_MARGIN_PX)].any():
            right_pts.append((x_r, y))
    base_hidden = 1.0 - len(bot_pts) / max(1, len(cols))
    # With almost no base visible, the mask's lowest pixels are the tops of the cars and
    # bushes in front, well above the ground. Their bottoms stand on the ground, so the
    # bottom edge goes through the lowest of those, still aimed at the vanishing point.
    base_nearly_gone = len(bot_pts) < 0.03 * len(cols)
    if base_nearly_gone:
        on_ground = [(x, occluder_bottom(occluders, x, ys[wall[:, x]][-1])) for x in cols]
        # An occluder cut off by the photo's lower edge does not show where it stands.
        inside = [p for p in on_ground if p[1] < H - 1]
        bot_pts = inside if len(inside) >= 2 else on_ground

    sides = {
        "top": candidate_lines(top_pts, len(cols)),
        "bottom": candidate_lines(bot_pts, len(bot_pts)),
        "left": candidate_lines(left_pts, len(rows)),
        "right": candidate_lines(right_pts, len(rows)),
    }
    if any(len(v) == 0 for v in sides.values()):
        return None, base_hidden, False

    # With the base hidden, the bottom edge must aim where the top edge and the window
    # rows aim. With the base visible the mask wins, because pavements slope.
    bottom_from_vp = False
    horizontals = [(m, d) for m, d, _ in sides["top"]] + window_row_lines(window_boxes, wall)
    if base_hidden > BASE_HIDDEN_LIMIT and len(horizontals) >= 3:
        vp = vanishing_point(horizontals, W)
        constrained = bottom_through_vanishing_point(bot_pts, vp, sides["top"][0][1], W, lowest=base_nearly_gone)
        if constrained is not None:
            sides["bottom"] = [constrained]
            bottom_from_vp = True

    filled = (wall | occluders).astype(np.uint8)
    best, best_cost = None, None
    for top in sides["top"]:
        for bottom in sides["bottom"]:
            for left in sides["left"]:
                for right in sides["right"]:
                    try:
                        tl, tr = intersect(top, left), intersect(top, right)
                        br, bl = intersect(bottom, right), intersect(bottom, left)
                    except np.linalg.LinAlgError:
                        continue
                    quad = [[float(x), float(y)] for x, y in (tl, tr, br, bl)]
                    if not is_convex(quad) or tr[0] <= tl[0] or bl[1] <= tl[1]:
                        continue
                    if not near_image(quad, W, H):
                        continue
                    poly = np.zeros_like(filled)
                    cv2.fillPoly(poly, [np.array(quad, dtype=np.int32)], 1)
                    area = int(poly.sum())
                    if area == 0:
                        continue
                    occupancy = float((poly & filled).sum()) / area
                    ratio_cost = 0.0 if wall_aspect <= 0 else 5.0 * max(0.0, abs(np.log(quad_aspect(quad) / wall_aspect)) - ASPECT_TOLERANCE)
                    support = top[2] + bottom[2] + left[2] + right[2]
                    cost = ratio_cost + 2.0 * (1.0 - occupancy) - 0.1 * np.log(support)
                    if best is None or cost < best_cost:
                        best, best_cost = quad, cost
    return best, base_hidden, bottom_from_vp


# --- the two operations ---------------------------------------------------------------------

def find_wall(sam: Sam3, photo: Image.Image, wall_width_m: float, wall_height_m: float) -> WallCorners:
    """Corners of the clicked wall in the photo, and the photo with occluders painted flat."""
    t0 = time.time()
    work, scale = shrink(photo.convert("RGB"))
    shape = (work.height, work.width)

    encoded = sam.encode(work)
    facades, prompt_used = [], FACADE_PROMPTS[-1]
    for prompt in FACADE_PROMPTS:
        facades = sam.detect(encoded, prompt)
        if facades:
            prompt_used = prompt
            break
    target = pick_target(facades, shape)
    if target is None:
        raise ValueError("No building facade found in the photo.")
    facade = largest_component(target.mask)
    roof = union(sam.detect(encoded, ROOF_PROMPT), shape)
    occluders = union([d for p in OCCLUDER_PROMPTS for d in sam.detect(encoded, p)], shape)
    # The LoD2 wall stops at the eave, so anything SAM calls roof leaves the wall mask.
    wall = largest_component(facade & ~roof & ~occluders)
    window_boxes = [d.box for d in sam.detect(encoded, "window")]
    del encoded

    aspect = wall_width_m / wall_height_m if wall_width_m > 0 and wall_height_m > 0 else 0.0
    quad, base_hidden, from_vp = fit_quad(wall, occluders, aspect, window_boxes)
    if quad is None:
        raise ValueError("Could not fit four edges to the wall.")

    # Paint occluders inside the quad flat, in the wall's median colour, so a parked car
    # cannot become a window and nothing new is invented in its place.
    quad_mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(quad_mask, [np.array(quad, dtype=np.int32)], 1)
    to_paint = occluders & quad_mask.astype(bool)
    work_np = np.array(work)
    colour = np.median(work_np[wall], axis=0).astype(np.uint8) if wall.any() else np.array([128, 128, 128], np.uint8)
    full = np.array(photo.convert("RGB"))
    if scale < 1.0:
        to_paint = np.asarray(Image.fromarray(to_paint.astype(np.uint8) * 255).resize(photo.size, Image.NEAREST)) > 0
    full[to_paint] = colour
    corners = [[x / scale, y / scale] for x, y in quad]

    return WallCorners(
        corners=corners, base_hidden=base_hidden, bottom_from_vanishing_point=from_vp,
        facade_score=target.score, facade_prompt=prompt_used,
        painted_photo=Image.fromarray(full), seconds=time.time() - t0,
    )


def find_openings(sam: Sam3, rectified: Image.Image, pixels_per_metre: float) -> list[Opening]:
    """Windows and doors on a rectified wall image, in wall metres with the origin bottom left."""
    image = rectified.convert("RGB")
    encoded = sam.encode(image)
    found = []
    for prompt, kind in (("window", "window"), ("door", "door")):
        for d in sam.detect(encoded, prompt):
            x0, y0, x1, y1 = d.box
            found.append(Opening(
                kind=kind, score=round(d.score, 3),
                x=round(x0 / pixels_per_metre, 3), y=round((image.height - y1) / pixels_per_metre, 3),
                width=round((x1 - x0) / pixels_per_metre, 3), height=round((y1 - y0) / pixels_per_metre, 3),
            ))
    found.sort(key=lambda o: (-o.y, o.x))
    return found
