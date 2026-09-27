# Measurements on the three sample photos

All numbers below were read off the photo editor in the viewer. "Before" is the state
before the contact-line fix (commit `74e423b`): the rectified wall used the full model wall,
from the floor slab to the top, so the visible facade was stretched over the buried part.
"After" measures the wall above the terrain contact line, which is the model's own street
level. The dots were placed on the same photo corners in both runs; only the wall height
they are mapped to changed.

Every wall is a plain rectangle: the model's polygon area equals width times height in all
six runs, so no gable or notch is involved.

Camera compass from the photos' Exif (`GPSImgDirection`, true north): BOo 302.4, Atr
302.7, kY 113.1. Expected wall facing is that plus 180: 122, 123 and 293 degrees. The
brief gives 114, 113 and 289. For kY the editor reported "Camera direction matches this
wall (4 degrees off)".

## DEBE02YY40000BOo, red render, street wall

| | before | after |
|---|---|---|
| wall size | 14.33 x 15.55 m | 14.33 x 14.38 m above ground, 1.17 m buried |
| rectified image | 1433 x 1555 px | 1433 x 1438 px |
| openings | 24 | 24 |
| opening area | 54.10 m² | 46.58 m² |
| wall area (model) | 222.79 m² | 206.00 m² |
| window-to-wall ratio | 24.3 % | 22.6 % |

Openings, width x height in metres, area in m²:

| # | before | after |
|---|---|---|
| 1 | 0.90 x 1.75, 1.58 | 1.03 x 1.66, 1.71 |
| 2 | 0.98 x 1.98, 1.93 | 0.98 x 1.58, 1.56 |
| 3 | 1.00 x 2.30, 2.31 | 1.03 x 1.67, 1.73 |
| 4 | 1.04 x 1.83, 1.90 | 1.00 x 1.62, 1.62 |
| 5 | 1.06 x 1.80, 1.90 | 0.87 x 1.56, 1.36 |
| 6 | 1.09 x 1.83, 1.98 | 0.91 x 1.64, 1.50 |
| 7 | 0.95 x 1.80, 1.71 | 0.90 x 1.74, 1.56 |
| 8 | 0.91 x 1.76, 1.60 | 0.92 x 1.81, 1.66 |
| 9 | 0.91 x 1.91, 1.74 | 0.97 x 1.72, 1.67 |
| 10 | 1.04 x 1.93, 2.00 | 0.96 x 1.78, 1.70 |
| 11 | 1.06 x 1.98, 2.11 | 1.00 x 1.74, 1.74 |
| 12 | 0.97 x 1.71, 1.66 | 0.98 x 1.65, 1.62 |
| 13 | 0.98 x 1.78, 1.75 | 0.91 x 2.05, 1.87 |
| 14 | 1.00 x 2.30, 2.31 | 1.02 x 2.02, 2.05 |
| 15 | 0.99 x 2.28, 2.27 | 1.03 x 1.98, 2.04 |
| 16 | 0.96 x 2.28, 2.19 | 1.03 x 2.06, 2.11 |
| 17 | 1.01 x 2.29, 2.31 | 0.98 x 2.03, 2.00 |
| 18 | 1.05 x 2.32, 2.43 | 0.96 x 2.08, 2.00 |
| 19 | 1.02 x 1.97, 2.00 | 1.52 x 2.58, 3.93 |
| 20 | 1.65 x 3.29, 5.42 | 0.95 x 1.68, 1.60 |
| 21 | 1.79 x 2.99, 5.34 | 0.90 x 1.75, 1.57 |
| 22 | 1.01 x 2.01, 2.04 | 1.53 x 3.00, 4.60 |
| 23 | 0.88 x 2.01, 1.77 | 0.98 x 1.67, 1.64 |
| 24 | 0.93 x 1.98, 1.84 | 1.03 x 1.67, 1.73 |

The openings were drawn again in the "after" run, so the row numbers do not match between
the two columns. Read them as two independent sets.

What the "after" run shows, by floor, from the labels on the image:

- top floor, six windows: 1.03 x 1.66, 0.98 x 1.58, 1.03 x 1.67, 1.00 x 1.62, 0.87 x 1.56, 0.91 x 1.64
- second floor: 0.98 x 1.65, 1.00 x 1.74, 0.96 x 1.78, 0.97 x 1.72, 0.92 x 1.81, 0.90 x 1.74
- first floor: 0.91 x 2.05, 1.02 x 2.02, 1.03 x 1.98, 1.03 x 2.06, 0.98 x 2.03, 0.96 x 2.08
- ground floor: 1.03 x 1.67, 0.98 x 1.67, door 1.53 x 3.00, 0.90 x 1.75, 0.95 x 1.68, second door 1.52 x 2.58

Widths sit between 0.87 and 1.03 m on every floor: identical windows differ by up to 16 cm
in width. Heights step up from about 1.6 m on the top floor to about 2.0 m on the first
floor.

The two doors were drawn differently in the two runs. Before: 1.65 x 3.29 m and
1.79 x 2.99 m. After: 1.53 x 3.00 m and 1.52 x 2.58 m. Widths are not touched by the
ground fix, so the 12 cm and 27 cm width differences are repeat-drawing error. Dividing
the "before" heights by the 1.08 stretch gives 3.05 m and 2.77 m, against 3.00 m and
2.58 m after: 5 cm and 19 cm apart. Doors are less reliable than windows in these runs.
Their bottoms are behind cars.

The ground-floor window bottoms are behind parked cars in this photo. Those four heights are
estimates.

The 1.17 m of buried wall stretched every height in the "before" run by a factor of
15.55 / 14.38, about 1.08. The "before" top-floor heights of 1.75 to 1.98 m against 1.56 to
1.67 m after are consistent with that.

## DEBE02YY40000Atr, yellow render, street wall

| | before | after |
|---|---|---|
| wall size | 14.28 x 18.02 m | 14.28 x 17.05 m above ground, 0.97 m buried |
| rectified image | 1428 x 1802 px | 1428 x 1705 px |
| openings | 24 | 24 |
| opening area | 63.34 m² | 57.81 m² |
| wall area (model) | 257.43 m² | 243.53 m² |
| window-to-wall ratio | 24.6 % | 23.7 % |

"Before" openings, in table order:

| # | width x height | area |
|---|---|---|
| 1 | 0.84 x 1.95 | 1.64 |
| 2 | 0.95 x 1.94 | 1.84 |
| 3 | 0.94 x 1.97 | 1.86 |
| 4 | 1.02 x 1.95 | 2.00 |
| 5 | 1.08 x 1.93 | 2.09 |
| 6 | 0.98 x 2.04 | 2.00 |
| 7 | 1.04 x 2.27 | 2.37 |
| 8 | 0.96 x 2.42 | 2.33 |
| 9 | 0.96 x 2.39 | 2.29 |
| 10 | 1.09 x 2.29 | 2.50 |
| 11 | 1.02 x 2.30 | 2.34 |
| 12 | 1.12 x 2.40 | 2.68 |
| 13 | 1.01 x 2.61 | 2.63 |
| 14 | 0.98 x 2.52 | 2.47 |
| 15 | 1.09 x 2.55 | 2.77 |
| 16 | 0.97 x 2.60 | 2.52 |
| 17 | 1.07 x 2.64 | 2.83 |
| 18 | 1.07 x 2.64 | 2.83 |
| 19 | 1.20 x 2.74 | 3.29 |
| 20 | 1.03 x 2.58 | 2.66 |
| 21 | 1.14 x 2.17 | 2.48 |
| 22 | 1.05 x 2.59 | 2.72 |
| 23 | 1.12 x 2.67 | 3.00 |
| 24 | 1.77 x 4.06 (door) | 7.18 |

"After" openings. Only rows 1 to 11 of the table were visible in the screenshot, so the
rest is read from the labels on the image, floor by floor:

| floor | width x height, left to right |
|---|---|
| top | 1.02 x 1.93, 1.11 x 1.87, 1.06 x 1.91, 1.18 x 1.86, 1.08 x 1.89, 1.03 x 1.99 |
| second | 1.02 x 2.24, 1.03 x 2.21, 1.02 x 2.14, 1.03 x 2.12, 1.07 x 2.16, 1.01 x 2.14 |
| first | 1.04 x 2.29, 1.06 x 2.26, 0.97 x 2.37, 1.03 x 2.21, 1.05 x 2.38, 0.99 x 2.35 |
| ground | 1.02 x 2.27, 0.98 x 2.39, 0.99 x 2.26, door 1.62 x 4.01, 0.88 x 2.28, 1.04 x 2.38 |

Table rows 1 to 11 of the "after" run, with areas: 1.02 x 1.93 (1.98), 1.11 x 1.87 (2.08),
1.06 x 1.91 (2.02), 1.18 x 1.86 (2.19), 1.08 x 1.89 (2.05), 1.03 x 1.99 (2.06),
1.02 x 2.24 (2.29), 1.03 x 2.21 (2.27), 1.02 x 2.14 (2.18), 1.03 x 2.12 (2.18),
1.07 x 2.16 (2.32).

Heights per floor after the fix: about 1.9 m top, 2.2 m second, 2.3 m first, 2.3 m ground,
plus a 4.0 m entrance door. The "before" run had 2.6 m on the lower floors and a 4.06 m
door; the 0.97 m of buried wall stretched them by 18.02 / 17.05, about 1.06.

The top row widths in the "after" run range from 1.02 to 1.18 m: identical windows differ
by up to 16 cm in width. The "before" top row ranged from 0.84 to 1.08 m, a 24 cm spread.

Ground-floor window bottoms are behind parked cars; those heights are estimates.

## DEBE02YY400000kY, pale render, middle wall of the street front

This wall is one of several at about 289 degrees on an eleven-part building. It is 9.00 m
wide and carries three columns of windows over five floors.

| | before | after |
|---|---|---|
| wall size | 9.00 x 26.22 m | 9.00 x 15.28 m above ground, 10.94 m buried |
| rectified image | 900 x 2622 px | 900 x 1528 px |
| openings | 12 | 12 |
| opening area | 46.72 m² | 24.82 m² |
| wall area (model) | 235.79 m² | 137.31 m² |
| window-to-wall ratio | 19.8 % | 18.1 % |
| compass check | not yet built | matches, 4 degrees off |

The "before" run is the one that showed the buried-slab problem. The model wall is 26.22 m
high but the photo shows five floors and a parapet, about 15 m. The building's floor slab
sits 10.94 m below the street along this wall (the info panel reports 11.04 m as the
deepest point of the whole part). Mapping the visible facade onto 26 m stretched every
height by 26.22 / 15.28, about 1.72, which is why the "before" windows are 2.2 to 3.1 m
tall and the floors came out at over 5 m.

"Before" openings:

| # | width x height | area |
|---|---|---|
| 1 | 2.17 x 2.32 | 5.03 |
| 2 | 1.41 x 2.28 | 3.21 |
| 3 | 2.20 x 2.19 | 4.81 |
| 4 | 1.51 x 2.84 | 4.28 |
| 5 | 1.50 x 2.81 | 4.21 |
| 6 | 1.48 x 2.99 | 4.42 |
| 7 | 1.30 x 2.66 | 3.46 |
| 8 | 1.21 x 2.50 | 3.01 |
| 9 | 1.20 x 2.62 | 3.14 |
| 10 | 1.16 x 3.10 | 3.60 |
| 11 | 1.22 x 3.04 | 3.72 |
| 12 | 1.24 x 3.09 | 3.82 |

"After" openings. Rows 1 to 10 from the table, 11 and 12 from the labels:

| # | width x height | area |
|---|---|---|
| 1 | 2.07 x 1.39 | 2.88 |
| 2 | 1.33 x 1.34 | 1.78 |
| 3 | 2.10 x 1.39 | 2.92 |
| 4 | 1.45 x 1.69 | 2.44 |
| 5 | 1.37 x 1.76 | 2.40 |
| 6 | 1.33 x 1.63 | 2.17 |
| 7 | 1.15 x 1.50 | 1.73 |
| 8 | 1.11 x 1.37 | 1.52 |
| 9 | 1.11 x 1.43 | 1.59 |
| 10 | 1.08 x 1.78 | 1.92 |
| 11 | 1.08 x 1.68 | about 1.81 |
| 12 | 1.03 x 1.61 | about 1.66 |

By floor, from the labels: top 2.07 x 1.39, 1.33 x 1.34, 2.10 x 1.39; fourth 1.33 x 1.63,
1.37 x 1.76, 1.45 x 1.69; third 1.15 x 1.50, 1.11 x 1.37, 1.11 x 1.43; second 1.03 x 1.61,
1.08 x 1.68, 1.08 x 1.78. The ground floor is behind a parked car and a barred window is
visible at the bottom left; no ground-floor openings were drawn.

Things worth noting on kY:

- The two wide top-floor windows (2.07 and 2.10 m) are real: they are two-pane windows in
  the photo. The narrow one between them (1.33 m) is a single pane.
- In the "before" run the widths grew from 1.2 m at the bottom to 2.2 m at the top in the
  same column. After the fix the single-pane windows measure 1.03 to 1.45 m: 1.03 to 1.08 m
  on the second floor, 1.11 to 1.15 m on the third, 1.33 to 1.45 m on the fourth, 1.33 m on
  the top floor.
- Windows on the same floor differ by up to 12 cm in width (1.33 to 1.45 m on the fourth
  floor) and up to 17 cm in height (1.61 to 1.78 m on the second floor).
- The deep reveals were handled by drawing on the outer edge of the reveal, the same rule
  for every window.
- No ground-floor openings were drawn, because a car and a hard shadow hide that floor,
  but the model wall area of 137.31 m² includes the ground floor. The ratio of 18.1 % is
  therefore too low for this wall. The barred window visible at the bottom left alone would
  add to it.

## What changed between "before" and "after"

| building | buried depth | height stretch factor | ratio before | ratio after |
|---|---|---|---|---|
| BOo | 1.17 m | 1.08 | 24.3 % | 22.6 % |
| Atr | 0.97 m | 1.06 | 24.6 % | 23.7 % |
| kY | 10.94 m | 1.72 | 19.8 % | 18.1 % |

The ground fix scales the opening heights and the wall height by the same factor, so on its
own it cannot change the ratio at all. Opening area and wall area both shrink by the same
proportion. Every absolute size changes, though: a 1.6 m window on BOo read 1.75 to
1.98 m before, and a 1.4 m window on kY read 2.3 to 3.1 m.

### Repeat drawing check

Since the fix leaves the ratio alone, the 1 to 2 percentage point difference between the
two columns comes only from drawing the 24 (or 12) openings a second time on the same
photo with the same corners. That is a direct measure of how repeatable the drawing is:
about 1 to 2 percentage points on the window-to-wall ratio.

## Precision, from the numbers themselves

- BOo (frontal): identical windows on one floor differ by up to 16 cm in width (top floor
  after: 0.87 to 1.03 m) and up to 16 cm in height (second floor after: 1.65 to 1.81 m).
- Atr (frontal): up to 16 cm in width (top floor after: 1.02 to 1.18 m) and up to 17 cm in
  height (first floor after: 2.21 to 2.38 m).
- kY (oblique): up to 12 cm in width (fourth floor: 1.33 to 1.45 m) and up to 17 cm in
  height (second floor: 1.61 to 1.78 m).
- Drawing the same wall twice moves the window-to-wall ratio by 1 to 2 percentage points.
- Doors differ by up to 27 cm in width and 19 cm in height between two runs on BOo, so
  they are less reliable than windows.
- Wall width is taken from the model and is exact for the purpose. Wall height above
  ground depends on the contact line, which is a mean along the wall; the panel's deepest
  point differs from it by 10 cm on kY.
- Anything behind cars, skips or trees is an estimate and is marked as such above.
