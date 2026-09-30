/**
 * What a signed in user may store about themselves (TODO Part 20, AD.6), checked with zod
 * before anything reaches the database: the settings, bookmarks, and per LoD2 building a note
 * and the facade survey. Unknown fields are dropped; sizes are bounded.
 */
import { z } from "zod";

/** A Gebäude-ID from the LoD2 data, e.g. DEBE02YY40000BOo. The same rule as the table. */
export const gidSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

export const settingsSchema = z
  .object({
    language: z.enum(["en", "de"]).nullable(),
    theme: z.enum(["light", "dark", "system"]).nullable(),
    projectsView: z.enum(["grid", "list", "map"]).nullable(),
  })
  .partial();

export type Settings = z.infer<typeof settingsSchema>;

// z.number() refuses Infinity and NaN since zod 4.
const finite = z.number();

const openingSchema = z.object({
  x: finite,
  y: finite,
  width: finite.nonnegative(),
  height: finite.nonnegative(),
  score: finite.min(0).max(1).optional(),
  kind: z.enum(["window", "door"]).optional(),
});

const wallSchema = z.object({
  partGid: gidSchema,
  surfaceIndex: z.number().int().min(0).max(100_000),
  openings: z.array(openingSchema).max(500),
  photo: z.string().max(260).optional(),
  method: z.enum(["detected", "drawn"]),
  updatedAt: finite,
});

const AGE_CLASSES = [
  "bis1918",
  "1919-1948",
  "1949-1957",
  "1958-1968",
  "1969-1978",
  "1979-1983",
  "1984-1994",
  "1995-2001",
  "ab2002",
] as const;

export const surveySchema = z.object({
  walls: z
    .record(z.string().regex(/^[A-Za-z0-9._-]{1,64}:\d{1,6}$/), wallSchema)
    .refine((walls) => Object.keys(walls).length <= 200, { error: "too many walls" }),
  facts: z.object({
    ageClass: z.enum(AGE_CLASSES),
    ageClassConfirmed: z.boolean(),
    storeys: z.number().int().min(1).max(200).optional(),
  }),
});

export type Survey = z.infer<typeof surveySchema>;

/** A change to one building's entry: a field set to null is removed. */
export const buildingPatchSchema = z
  .object({
    note: z.string().max(20_000).nullable(),
    survey: surveySchema.nullable(),
  })
  .partial();
