/**
 * Client for lod2-floorplan, the optional local service that reads a floor plan drawing into
 * interior walls and doors, fitted into the building's outline. Like lod2-vision it may simply
 * not be running; `floorplanAvailable` is how the panel decides whether to offer the import.
 */
import { useEffect, useState } from "react";
import { z } from "zod";
import type { Vec2 } from "@/geometry/types";

const BASE = "/floorplan";
const POLL_MS = 15000;

const Point = z.tuple([z.number(), z.number()]);

export const FloorPlanReadingSchema = z.object({
  walls: z.array(
    z.object({
      a: Point,
      b: Point,
      /** Metres between the drawn faces. Missing from services before wall types. */
      thickness: z.number().optional(),
      support: z.number().nullable(),
    }),
  ),
  doors: z.array(z.object({ a: Point, b: Point, source: z.string() })),
  /** Metres: how far the building's outline lies from the drawn outer walls, on average. */
  fitError: z.number(),
  pixelsPerMetre: z.number(),
  /** Plan metres to image pixels, for drawing the result over the plan. */
  transform: z.object({ scale: z.number(), theta: z.number(), ox: z.number(), oy: z.number() }),
  imageSize: z.tuple([z.number(), z.number()]),
  /** Whether the room model (Raster2Seq) took part, or the walls come from the drawing alone. */
  roomModel: z.boolean(),
});

export type FloorPlanReading = z.infer<typeof FloorPlanReadingSchema>;

/** Plan metres to the plan image's pixels, through the reading's transform. */
export function toPlanImage(reading: FloorPlanReading, p: Vec2): Vec2 {
  const { scale, theta, ox, oy } = reading.transform;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: ox + scale * (p.x * c - p.y * s), y: oy - scale * (p.x * s + p.y * c) };
}

export async function floorplanAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether lod2-floorplan answers, checked now and every 15 seconds. Null until known. */
export function useFloorplanAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      void floorplanAvailable(controller.signal).then((ok) => {
        if (!controller.signal.aborted) setAvailable(ok);
      });
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  return available;
}

/** Reads `plan` into interior walls and doors inside `footprint` (plan metres). */
export async function readFloorPlan(
  plan: Blob,
  footprint: readonly Vec2[],
  signal?: AbortSignal,
): Promise<FloorPlanReading> {
  const form = new FormData();
  form.append("plan", plan, "plan.png");
  form.append("footprint", JSON.stringify(footprint.map((p) => ({ x: p.x, y: p.y }))));
  const res = await fetch(`${BASE}/walls`, { method: "POST", body: form, signal });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
    throw new Error(typeof detail === "string" ? detail : `lod2-floorplan ${String(res.status)}`);
  }
  return FloorPlanReadingSchema.parse(await res.json());
}
