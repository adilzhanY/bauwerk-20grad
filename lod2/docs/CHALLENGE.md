# Coding challenge: photographs onto facades, and the openings in them

## The task

Given a ground-level photograph of a building and that building's LoD2 model, work out how the
photograph relates to one facade, map it onto that facade, and find the window and door openings
in it.

Concretely, we would like to be able to:

1. **Pick a wall** of a building in the 3D view. (You can already click one — see below.)
2. **Give that wall a photograph** and establish the relationship between the image and the wall
   plane. The photograph is taken from the ground by a person, so it is not rectified: the wall
   recedes, verticals converge, and the camera is unknown.
3. **See the photograph on the wall**, deskewed onto the wall plane — in the 3D view, or as a
   rectified image, or both.
4. **Extract the openings**: the windows and doors in that facade, as geometry rather than as a
   picture. We should be able to read off each opening's position and size in metres.
5. **Report per wall**: total opening area, and the window-to-wall ratio.

Beyond that, if you get there and want to: the openings are what an energy assessment needs, so
anything that makes the numbers more trustworthy or the wrong ones easier to spot and correct is
worth more than more features.

## Why this is interesting rather than just fiddly

The LoD2 model is metric and georeferenced. Once the photograph is related to the wall plane, the
rectified image is *metric too* — a pixel is a known number of millimetres of facade. That changes
the problem: an opening is not "a dark rectangle", it is something window-shaped **in metres**, and
its size is a measurement rather than a guess.

It also means you have real constraints to exploit, and real ways to be wrong. We are more
interested in how you reason about that than in how many windows you find.

## Getting it running

Node 22.18 or newer (24 recommended; there is an `.nvmrc`) and Docker, then:

```bash
nvm use && npm run setup && npm run bootstrap
npm run api        # terminal 1
npm run viewer     # terminal 2 -> http://localhost:5175
```

`bootstrap` downloads a few source tiles from Berlin's open-data portal, so it needs network
and takes about a minute in total. [README.md](README.md) has the details, what each script
does, and what to do if something fails.

## What the boilerplate already gives you

Everything up to and including a building on screen. See [README.md](README.md) for the
architecture; the short version:

- **Berlin LoD2 building models** ingested into PostGIS, with per-surface geometry: every wall,
  roof and ground polygon as flat `[x, y, z, …]` rings in EPSG:25833 metres.
- **Geometry metrics** already computed — areas, volume, roof planes with azimuth and tilt, eave
  and ridge height, how far the ground climbs the walls.
- **Berlin's 20 cm TrueDOP orthophoto**, proxied and cached, draped on roofs and on the ground.
- **Contact-line terrain**, so the building stands on something.
- **A 2D map and a 3D viewer**, with per-wall picking wired up: clicking a wall in the 3D view
  sets `selectedWall` in the store (`lod2-viewer/src/state/store.ts`) and the info panel shows
  which surface of which part you picked and the ring that describes it. That readout is
  deliberately the end of the line — it is the hook to build from.

Useful things to know where to find:

| | |
|---|---|
| A wall's 3D polygon | `detail.parts[i].mesh.surfaces[j].rings[0]` — flat xyz, closed, rebased on `mesh.origin` |
| Vector maths, triangulation, areas, normals | `lod2-core/src/geometry.ts` |
| The wire contract between API and viewer | `lod2-core/src/api.ts` (zod, validated both ways) |
| Where a new API route goes | `lod2-api/src/server.ts` |
| Where a migration goes | `lod2-ingest/migrations/` — numbered, applied by `lod2 migrate` |

## What it deliberately does not give you

Nothing here turns a wall into a 2D plane, relates an image to it, or looks at a photograph at
all. There is no image processing in the repo. That is the challenge.

To be clear about what that does and does not rule out: reach for any library, tool or hosted
service you like — see *Practical notes*. What we are asking is that you arrive at your own
approach, so please do not go hunting for a version of this codebase that already has the
answer in it.

There is also no persistence for any of it. If you want a matched photograph to survive a reload,
that is a migration and a route, and how much of that is worth doing is your call.

## The photographs

`sample-photos/` holds three photographs, each **named after the Gebäude-ID of the building it
shows**. Berlin publishes no addresses, so that id is how you find the building: paste it into
the search box, or look it up through `/buildings/<id>`.

All three are the facade facing the street. All three buildings are inside the area
`npm run bootstrap` ingests, a few hundred metres from where the viewer opens, so they are
there as soon as you have set up.

| photo / Gebäude-ID | what it is | roof | footprint | ridge | parts | wall surfaces | flags |
|---|---|---|---|---:|---:|---:|---|
| `DEBE02YY40000BOo` | *Wohnhaus*, red render | Mischform | 202 m² | 21.6 m | 1 | 16 | none |
| `DEBE02YY40000Atr` | *Wohnhaus*, yellow render | Satteldach | 201 m² | 22.7 m | 2 | 12 | `no-geometry` |
| `DEBE02YY400000kY` | *Wohngebäude mit Handel und Dienstleistungen*, pale render | Flachdach | 602 m² | 27.9 m | 11 | 77 | `no-geometry`, `solid-not-closed` |

They are a deliberate spread rather than three of the same thing:

- **`BOo`** is the friendliest: a regular Gründerzeit window grid in direct sun, shot nearly
  square-on. Parked cars cover part of the ground floor, and the camera was about two metres
  from the footprint, so the verticals converge hard.
- **`Atr`** is the building immediately next door — each appears in the other's photograph,
  which is a free consistency check. Flat overcast light, ornate stucco banding, and a skip
  parked across the ground floor.
- **`kY`** is the hard one. It is **oblique**, with two facades of the building visible at
  once, so the plane you want is not the only plane in frame. Deeply set windows with real
  reveals, hard shadows, a tree over part of it, and an LoD2 model of eleven parts and 77 wall
  surfaces whose solid is not watertight.

`no-geometry` on a building is normal here, not a defect: it means the parent record carries
the attributes while its `BuildingPart`s carry the geometry.

### Which wall is the one in the photograph

You should not have to guess. The street-facing wall on each of these has an outward normal of
roughly:

| | |
|---|---|
| `DEBE02YY40000BOo` | 114° (ESE) |
| `DEBE02YY40000Atr` | 113° (ESE) |
| `DEBE02YY400000kY` | 289° (WNW) |

Those are grid-north bearings, the same convention the info panel uses for roof planes.

### About the EXIF

The files are unmodified phone captures, so they still carry their metadata. Two parts of it
are worth different amounts, and the difference matters:

**The focal length is informative.** 2.2 mm, 14 mm equivalent — an ultra-wide lens, which is
why the perspective is as strong as it is and why a building fits in frame from across a
narrow street.

**The GPS is not good enough to build on.** Do not expect to recover a camera pose from it.
The clearest way to see this: `Atr` and `BOo` were shot thirteen minutes and thirteen metres
apart, from street level, standing on ground the models put 0.5 m apart — and their recorded
altitudes differ by 7.3 m. The horizontal fix is no better; for `BOo` it places the camera
about two metres from the footprint, closer than this lens could frame a 21.6 m facade from.
A metre or several of error is ordinary for a phone in a street canyon, and against a standoff
of maybe fifteen metres that is not a small relative error.

The compass bearing (`GPSImgDirection`) is the one positional field that holds up, and only
coarsely: it is consistent between the two neighbouring shots and lands within about ten
degrees of the facade normal, which is enough to say *which* wall is in frame and nothing
more precise than that. The bearings in the table above are partly derived from it.

So the camera has to come from the image and the model, not from the file header. If you do
use the metadata, say what for.

You are free to send these photographs to any third-party service — see *Practical notes*
below. Nothing about them needs to stay on your machine.

### Your own photographs

Welcome, as well as or instead of these — ingest the area the building is in and go. Anything
in Berlin works. Straight-on shots and awkward oblique ones are both fair game; the awkward
ones are more interesting.

## Practical notes

- **Time box:** please do not spend more than a day on this. We would much rather see a smaller
  thing you can explain and defend than a large one you ran out of time to understand.
- **The boilerplate is yours.** Change it, restructure it, delete parts of it, swap the stack if
  you have a reason. It is a starting point, not a specification. If you keep it, match the
  conventions already in it; if you replace something, say why.
- **Libraries and third-party services are both fine.** Use whatever you would use at work,
  including for the vision parts, and including things that are not libraries: a hosted vision
  or segmentation API, a cloud OCR service, a model behind someone else's endpoint, a paid tool
  you already have. We are interested in your judgement about what to reach for, not in whether
  you can implement a matrix solve from scratch. If a service does the heavy lifting, say so,
  and say how you satisfied yourself that its answer was right.
- **GDPR is not a concern for this exercise.** The photographs are ours, they show public
  street frontages, and you may upload them to any service you like. There are readable vehicle
  plates in them; for this exercise, ignore that. Do not spend any of your time box on data
  protection or on scrubbing the images first.
- **Partial is fine, and honest is better than polished.** A README that says "this works for
  roughly frontal shots, breaks on strong perspective, and here is why" tells us more than a demo
  that hides it. Where the right answer is "I cannot tell from this image", saying so is a
  feature.
- **Do not hammer the data sources.** They are public authority servers. The rate limits in
  `lod2-api/src/ondemand.ts` exist for a reason; if you route around them, put something
  equivalent in their place.

## What to hand back

Your working tree, plus a short write-up (in the repo) covering:

- how to run it, and what you should see
- the approach you took, and what you tried that did not work
- where it is accurate, where it is not, and how you know — if you measured something, say what
- what you would do next with more time

## What we look at

- **Does it work, and do you know when it does not?** Honest limits beat claimed generality.
- **The reasoning.** Why this approach, what you rejected, what the constraints let you exploit.
- **Judgement about accuracy.** Which numbers do you trust, to what precision, and on what
  evidence. Knowing what you cannot determine is part of this.
- **Code we would be happy to maintain.** Clear, sized to the problem, tested where a test earns
  its keep.
- **How you handle the data being imperfect.** Models years out of date, flagged geometry, a
  facade in shadow, an ornate stucco front that is not a grid of rectangles.

Ask us anything while you are working on it — a question is not a mark against you, and half of
this problem is figuring out which questions matter.
