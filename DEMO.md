# Bauwerk in the office

The script for the third interview at 20°, in their office. About twelve minutes, then their questions. Two browser windows on your laptop, one on theirs. English UI, light theme. Every step names the click and the sentence to say. Rehearse it twice; the second run is the one that fits.

## Hosted variant (the version on the server)

Everything below works the same on `https://<domain>` instead of the laptop, with these changes:

- An hour before: start the rented graphics card and check `https://<domain>/vision/health` (`deploy/README.md`, last section). Without it the demo works, but openings are drawn by hand.
- Your laptop is signed in with your account. The second person opens the shared link, signs up on the page it leads to (email, password, username, no confirmation mail), and lands in the project.
- Step 10 (Share) copies a link that works from anywhere, no `--host`, no office network needed.
- Keep the laptop version (`npm run dev`) and the screen recording ready in case the network fails.

## Before the meeting

- Stop the local language model if it runs: SAM 3 needs about 3.5 GB of graphics memory (see the vision line in the `npm run dev` output).
- `npm run dev -- --host`. Check the terminal: `collab` says `Bauwerk server listening`, `vision` says `lod2-vision ready`. Note the Network address Vite prints.
- On the phone, on mobile data, open the Network address once. If their Wi-Fi blocks devices from seeing each other, the laptop-to-laptop step becomes two windows on your laptop.
- Open the start page once and search `DEBE02YY40000Atr` (the Gebäude-ID of the yellow house in the sample photo) so the map and the building tiles are cached.
- Have `lod2/sample-photos/DEBE02YY40000Atr.jpg` ready in the file picker's folder. Its file name is the id of the building it shows; keep its EXIF, the photo editor reads the compass bearing from it.
- Have `DECISIONS.md` open in the editor, scrolled to the 2026-09-25 entries.
- Close the browser console. Zoom the browser to 100 %.

## 0:00 The claim (30 s)

Say: "This is Bauwerk. Your job posting describes a versioned, real-time, multi-user 3D building editor fed by LoD2 data and facade photos. I built a working slice of exactly that, with Claude Code writing the code and me specifying, reviewing and correcting it. I want to show you the product, and then how I work, because that is the job."

## 0:30 Address to model (2 min)

1. Start page. Search `DEBE02YY40000Atr` (a Berlin address works too; Berlin's CityGML has no addresses, so the id is the handle). Pick the result. The LoD2 building is highlighted on the map. Say: "Berlin's official LoD2 city model, in PostGIS, served as vector tiles by a small Fastify API."
2. The building page: address, parts, the energy scale with the class of the unrenovated building. Say: "The energy numbers come from the same balance the editor uses, run on the building as the LoD2 data describes it."
3. "Sanierungsplanung starten". The editor opens with the building: footprint, storeys and roof from LoD2, openings from the default rule. Say: "Every value knows where it came from. Select a wall and the panel says: LoD2, estimate, photo, or typed."

## 2:30 Facade photo to 3D (3 min)

4. Click the street facade in 3D. In the right panel: "Openings from photo". The photo editor opens with the wall's real size from the model.
5. Choose the sample photo, then "Detect openings". SAM 3 finds the wall's corners, straightens the photo and finds the windows and doors. Say: "SAM 3 runs locally on the graphics card. Corners, rectification and the openings in metres, in a few seconds."
6. Point at the right column: "Changes to the 3D model", storey by storey, and what could not be placed and why. Point at the heating demand line. Say: "Before anything touches the model you see what changes, and what the photo is worth in kilowatt-hours."
7. Correct one box by hand (drag it), undo it with Ctrl+Z, redo it. Say: "The detector is a proposal. The consultant has the last word."
8. "Apply to 3D model". The editor comes back with the wall selected and the straightened photo on the wall, every opening outlined on it. Say: "Visual validation: if a window is off, you see it here at once, in 3D and in the elevation views."
9. View switch: pick the elevation that faces the camera side. Say: "Same model, straight-on elevation, photo and openings together."

## 5:30 Two people, one building (3 min)

10. Top bar: **Share**. The building becomes a shared project and the dialog shows its link. Say: "One click and the building is on the server; the link is the invitation." Copy it.
11. Ask them to open it on their laptop (the Network address plus the same `?project=…`), or open it in the second window. Their dot appears top right.
12. Move the mouse over the model: they see your pointer with your name. Ask them to click a window: you see it outlined in their colour.
13. Drag a window along its wall: it slides live on their screen, and they cannot grab it until you let go. Say: "A soft lock while someone drags, and the move itself arrives before the lock lets go, so nobody sees it jump."
14. Both move a different window at the same moment: both moves stay. Say: "Edits are small operations per element and field. The server orders them under a row lock in Postgres and every tab replays the same order. Two people editing two windows never overwrite each other."
15. After their edit, press Ctrl+Z on yours: only your own change goes back. Say: "Undo is per person. Their edits are rebased into my history, so undo can never take back their work."
16. History tab on the right: the versions with names and times. Click an older one: the banner, read-only. "Back to live". Say: "Versioned: every batch is a row in Postgres, any version can be rebuilt and restored as a new one."
17. Say why it is not a CRDT: "A CRDT converges, but it does not know that two windows must not overlap. Because there is a server, it checks the merged building and refuses the batch that breaks it. A test plays a thousand random three-person sessions with lost connections, and every screen must end on the server's building."

## 8:30 Export (1 min)

18. Export menu, IFC. Say: "IFC4, written by hand, and read back in the test suite by IfcOpenShell: schema valid, every element's geometry builds, every window cuts a real opening in its wall."
19. Export menu, printable report: the German document with the Energieausweis scale. Close it.

## 9:30 The process (2 min)

20. Switch to DECISIONS.md. Pick three entries, each a place where the agent was plausible but wrong:
    - The collaboration server refused every invalid building. The first client test was refused for the wrong reason, which showed that the editor allows invalid openings on purpose. The rule became: the server only refuses a merge that breaks what the sender saw as valid.
    - The convergence test passed on the first run. Three bugs were put in on purpose, one at a time, to see it fail, before it was trusted.
    - The formula audit: five errors with green tests, because the tests pinned the agent's own numbers. The fix moved the demo house from 324 to 252 kWh per square metre and year, where the IWU typology puts it.
21. Close: "About 680 tests across the app, the server and the LoD2 packages, a fixed stack, one store, pure geometry with no Three.js in it. I can walk through any file you pick."

## If asked

- How the sync works: `src/sync/ops.ts` diffs every change into operations keyed by element id and field; `server/src/projects/projects.service.ts` applies a batch under `SELECT … FOR UPDATE`, validates, writes one event row and broadcasts; `src/sync/client.ts` keeps unconfirmed batches and replays them on every remote batch.
- What happens offline: edits queue in the tab. On reconnect the server says which batches it already has, and the rest are sent once.
- What is simplified: the facade photo covers the wall up to the eaves, not the gable; the photo on the wall lives in the browser session and is not shared; the energy balance uses one reference climate.
- Why Socket.IO: it is your stack, and rooms, acknowledgements and reconnect come with it.
- Why no CSG for openings: walls are split into prisms around the holes, deterministic and testable.
