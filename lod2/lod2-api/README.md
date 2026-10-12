# lod2-api

Fastify, sitting directly on the same PostGIS the CLI writes to, and reusing the CLI's loader for
on-demand fetches, so there is exactly one fetch-parse-load path in the system.

```bash
npm run dev     # :8788, with --watch
npm start
```

Configuration comes from a gitignored `.env` at the repo root or from the real environment:
`DATABASE_URL`, `LOD2_API_PORT`, `LOD2_API_HOST`, `LOG_LEVEL`. All optional; the defaults match the local
docker-compose setup.

## Routes

Every one is a GET.

| | |
|---|---|
| `/tiles/:z/:x/:y.mvt` | building footprints as a vector tile, and the trigger for on-demand ingestion |
| `/coverage/:z/:x/:y.mvt` | which source tiles are ingested, pending or missing |
| `/buildings/:gid` | the full detail: attributes, totals, per-part metrics, meshes, roof planes, orthophoto descriptor |
| `/buildings/:gid/neighbours?box=` | surrounding buildings' meshes, for context in 3D |
| `/search?q=` | Gebäude-ID prefix lookup. No address search, Berlin publishes none |
| `/orthophoto/:gid/:kind` | a building's DOP crop (`roof` or `context`) in the state's own CRS, cached in Postgres |
| `/aerial/:z/:x/:y.jpg` | the DOP as web-mercator map tiles, for the 2D basemap |
| `/health` | `{ ok, states, pipelineVersion }` |

Responses are validated against the `lod2-core/api` schemas on the way out: a schema drift should
fail here, not in the browser.

## Orthophoto crops

The bbox is in the state's own CRS, the same frame as the building meshes, so the client can
drape the result by (x, y) with no projection maths and no camera model. Two crops per building:
one tight on the roof at native resolution, one 800 m box for the ground and the neighbours'
roofs. The wider one is sized to match the neighbour query, so anything that query can return
falls inside the image.

**The context crop is deliberately capped below native resolution**, at 2048 px rather than the
4000 a native 800 m crop would be. It is the ground plane seen from above at a distance, where
the screen is already coarser than a metre per pixel, and the cost of the larger version is not
bandwidth but a frozen tab: 16 megapixels to decode and 61 MB to upload on the main thread, plus
about six seconds of cold WMS fetch. The route computes both boxes and caps from the
building itself, with the same code `buildingDetail` uses to advertise `widthPx`/`heightPx`, so
it serves exactly that, and a client cannot ask for any other patch of the state.

Requests are proxied rather than made from the browser, even though the service sends permissive
CORS headers: going direct would put one uncached GetMap per selection per user against
gdi.berlin.de and bypass the per-host pacing. Results are cached in `orthophoto_cache`, keyed by a
hash of state, layer, bbox and pixel size, and cut back to the newest 2 GB every 20 inserts. A crop
that would wait more than 10 s for its upstream slot is answered 503 rather than held.

Two numbers worth knowing about:

- **`HARD_MAX_PX = 4096`.** The cap protects the upstream service and our own memory, not
  bandwidth, so it has to sit *above* what native resolution needs, or it silently becomes the
  thing limiting image quality. The 800 m context crop wants 4000 px at Berlin's 20 cm, and 4096
  is also inside the texture size every WebGL2 implementation must support.
- **PNG below 1.5 Mpx, JPEG above.** JPEG costs a few percent of the finest detail; on the one
  image anybody looks at closely, the tight crop on the selected roof, that is worth more than
  the saving in bytes. The context crop stays JPEG, where it is not.

Asking a WMS for more pixels than it holds never fails: it interpolates and returns a larger,
softer image. So `gsdM` on the adapter is the truth about resolution, and it is not something to
raise hopefully.

## On-demand ingestion

When the map requests a tile, the API serves what it has and queues anything missing. Because that
turns map panning into traffic against a public authority server, the limits in `ondemand.ts` are
correctness requirements rather than polish, see the root README for the list.

## Resolving a coordinate to a state

`stateAt()` answers from the extent of each state's indexed tiles, and **the smallest match
wins**. State extents nest, Berlin's sits wholly inside Brandenburg's, Bremen's inside Lower
Saxony's, and returning the first match would make the answer depend on the row order of an
unordered `GROUP BY`. The failure would be silent: a WMS asked for ground it does not hold returns
a perfectly valid *white* image with 200 OK. Only Berlin is indexed here, so this matters the
moment a second state is added. The answer is cached for a minute, not for the life of the
process, so a freshly indexed state appears without a restart.

## No authentication

There is none. Fine on localhost, not fine anywhere else.

```bash
npm test        # WMS request building, pixel budgets, state resolution. No network, no database.
npm run typecheck
npm run lint
```
