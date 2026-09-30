# Sample photographs

Ground-level photographs, each **named after the Gebäude-ID of the building it shows** (a
second photo of the same building adds a suffix, `-street`).
Berlin's CityGML carries no addresses, so that id is the handle: paste it into the viewer's
search box, or fetch `/buildings/<id>`.

All show the facade facing the street, and all the buildings sit inside the area
`npm run bootstrap` ingests.

| file | building | character |
|---|---|---|
| `DEBE02YY40000BOo.jpg` | *Wohnhaus*, red render, 202 m² | near square-on, direct sun, regular window grid; cars over the ground floor, strong vertical convergence |
| `DEBE02YY40000Atr.jpg` | *Wohnhaus*, yellow render, 201 m² | the building next door to `BOo`, each visible in the other's photo; flat overcast light, a skip over the ground floor |
| `DEBE02YY400000kY.jpg` | *Wohngebäude mit Handel und Dienstleistungen*, 602 m² | oblique, two facades in frame, deep window reveals, hard shadows, a tree over part of it |

| `DEBE02YY400001Vh.jpg` | Methfesselstraße 4, grey render, a pub on the ground floor | street-level view, the next house after `Atr`; no Exif |
| `DEBE02YY400003eq.jpg` | Wilhelmshöhe, tiles and glass | street-level view from below, graffiti, a glazed corner; no Exif |
| `DEBE02YY40000BOo-street.jpg` | `BOo` again | street-level view into the sun; no Exif |
| `DEBE02YY40000Atr-street.jpg` | `Atr` again | street-level view, square on; no Exif |

The three phone photos are 4284 × 5712 px (`kY` is landscape, 5712 × 4284), about 2 MB each.

These are unmodified phone captures, so the EXIF is intact: focal length (2.2 mm, 14 mm equivalent), GPS position, altitude and compass bearing. The photo editor uses the compass bearing to warn when the selected wall does not face the camera, so keep the EXIF. The GPS is not accurate enough to recover a camera pose from: two of these were taken 13 m apart on ground half a metre apart, and their recorded altitudes differ by 7.3 m.

`thumbs/` holds small copies (360 px on the long side, no metadata) that the photo editor shows
as "No photo at hand? Try one of these". Picking one opens the full photo above, Exif and all.
