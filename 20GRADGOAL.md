# 20° GmbH: what they are, what they want, and where Bauwerk stands

Written 2026-09-25 for the third interview, in their office. Sources: the job posting (screenshots), 20grad.de and its subpages, public directories. Anything not confirmed by a source is marked as a guess.

## 1. The company

- Name: 20° GmbH ("20 Grad"), website 20grad.de (20grad.haus redirects there). Jobs page on Notion: 20degrees.notion.site.
- Offices: Methfesselstr. 43, 10965 Berlin (Kreuzberg), and Behlertstr. 3a, Haus B2, 14467 Potsdam.
- What they are today: an energy consulting and renovation planning firm for residential buildings, from concept to construction. Region Berlin and Brandenburg for on-site work, the subsidy service works across Germany.
- People named on the company page: Hannes Brockdorff (energy consultant, civil engineer), Robin Beckmann (energy consultant, civil engineer), Leon Arif Gebhardt (product manager, computer scientist, co-founder). Guess: the two engineers are the other founders. Founding year and team size are not published.
- Numbers they publish: more than 200 renovation projects, more than 1.5 million euros of subsidies won for clients. Won the "Deutscher Fairness-Preis 2025" (price and performance, reliability, transparency).
- Customers: property management companies (Hausverwaltungen, including owner communities), real estate companies, trade businesses (Fachbetriebe), private landlords, private owners.

### Services

| Service                                    | What it is                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iSFP (individueller Sanierungsfahrplan)    | Step by step renovation roadmap for single and multi family houses. Needs an on-site visit and basic plans. Building at least 10 years old, mainly residential. The concept itself is subsidised (they advertise 650 euros). An iSFP raises the BEG subsidy rate for later measures.                                             |
| Förderservice                              | BAFA/KfW subsidy applications. Trade businesses upload their offer to an online tool, 20° checks eligibility, files the BAFA application the same business day, status is visible in the tool. Free for the trade business, 2.5% of the subsidised cost (min. 199 euros) for the end customer. They advertise 20 to 70% subsidy. |
| Fachplanung and Baubegleitung              | Technical planning and construction supervision, which is also subsidised under BEG.                                                                                                                                                                                                                                             |
| Heizlastberechnung, hydraulischer Abgleich | Room by room heat load, needed for heat pumps and for the heating subsidy.                                                                                                                                                                                                                                                       |
| Energieausweis                             | Energy performance certificates.                                                                                                                                                                                                                                                                                                 |
| 3D models                                  | Their FAQ says the 3D model is the base for the iSFP, the heat load calculation, the hydraulic balancing and the energy certificate. This is the link to the software product.                                                                                                                                                   |

### Vision and mission (their words, summarised from the screenshot)

- Vision: turn buildings into future-proof places through whole-building energy renovation, balancing economics, comfort and long-term property value, and contribute to the EU climate goals.
- Mission: push energy renovation forward with innovative technology and digital tools. Combine construction, architecture and energy consulting know-how with digitalisation for efficient processes, precise analysis and transparent advice. Named tools: simulation software, digital building models (BIM), data analysis. They accompany the client from the on-site analysis (Vor-Ort-Analyse) through digital planning to the realisation, with "Transparenz, Nachvollziehbarkeit und Servicequalität".

"Nachvollziehbarkeit" (traceability) matters: every number in a model should show where it came from. Bauwerk already has a source note per value (`SourceNote`, the `sources` map in `surveyToBauwerk`).

## 2. The product they are building

From the posting: buildings cause 35% of greenhouse gas emissions in the EU. They build browser-based SaaS for the German building energy renovation market. The product:

1. pulls a real building from cadastral LoD2 data, floor plans and facade photos,
2. reconstructs it as a clean, editable 3D model in the browser,
3. exports it to industry formats for downstream energy calculations and grant applications.

"A versioned, real-time-capable, multi-user 3D building editor backed by a purpose-built geometry and computer vision engine."

What the screenshot of their editor shows: a single family house (Märkische Heide 32, 14532 Kleinmachnow, Einfamilienhaus) as grey walls with storey bands and a red roof, a view switch (3D, D, N, O, S, W), a minimap with the footprint, a navy "Export" menu, and a right panel with label and value rows: Klassifizierung, Abdeckung (offen, freistehend), Geschosse, Vollgeschosse, Baujahr (geschätzt), address, Gemeinde, Bundesland, Kreis, Einwohner, then Abmessungen (Breite, Länge, Firsthöhe, Traufhöhe). Bauwerk's current look (TODO section 23) copies this.

Why it exists (my reading): 20° does the consulting work themselves. The slow and expensive part of every iSFP is the survey (Aufmaß): measuring the house, drawing it, typing it into the energy software (Hottgenroth, "Der Energieberater" and similar), which needs an internal model with walls, windows, orientations and areas. A tool that turns an address plus a few phone photos into that model in minutes cuts days of work per project and scales the Förderservice and the iSFP business. The export target is the input of those energy tools and of the BAFA forms. Guess, but it fits every bullet of the posting.

## 3. How they work

Agentic coding tools are the main way code is produced, also in hard domains: 3D geometry, computer vision, numerical optimisation, format reverse engineering. The human skills they hire for:

- Decomposition and specification: hard, fuzzy problems into clean specs an agent can execute, in right-sized steps.
- Review and verification: reading AI code critically, especially algorithmic and numerical code, and proving it correct (test design, edge cases, visual and geometric validation) instead of trusting it.
- Steering and taste: keeping an AI-built codebase coherent, enforcing architecture conventions, catching plausible but wrong solutions, knowing when to stop the agent and think.

"If your instinct is 'I'd rather hand-write everything myself', this isn't the right fit." They say the team is AI-first, with tooling, conventions and dense in-code documentation built around that workflow.

## 4. Stack

| Layer    | 20°                                                         | Bauwerk today                                                                                                    |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend | Vite, React 18, TypeScript, Zustand, Three.js, WebGL        | Vite 8, React 19, TypeScript strict, Zustand, Three.js via react-three-fiber                                     |
| Backend  | NestJS, TypeScript, PostgreSQL, Supabase, Socket.IO, OpenCV | NestJS (`server/`), Postgres, plain `ws`; Fastify + PostGIS (`lod2/lod2-api`); Python SAM 3 (`lod2/lod2-vision`) |

Gaps worth closing: Socket.IO instead of plain `ws` (it is their transport), Supabase is not used (fine, it is Postgres underneath; say so), OpenCV is used on the Python side for the rectification.

## 5. What the role does, and where Bauwerk stands

| Posting                                                            | Bauwerk                                                                                                                                                              | State                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| New element types: windows and openings, rooms, zones, HVAC        | Openings with constraints, rooms from interior walls, zones, radiators, pipes, heat pump                                                                             | Done                                                                                                                                       |
| Multi-storey support                                               | Storeys, storey pill, other storeys display                                                                                                                          | Done                                                                                                                                       |
| Richer editing tools                                               | Move and rotate, dimensions, floor plan drawing, section cut, walkthrough, measure                                                                                   | Done                                                                                                                                       |
| Real-time multi-user collaboration                                 | NestJS server, versions, 409 on conflict, presence, remote selection. Whole-building last write wins. Not started by `npm run dev`. Manual two-tab check never done. | Weakest part, and the one they flag                                                                                                        |
| Geometry engine, reconstruction quality, normalisation             | Pure `src/geometry/` with tests, `lod2-core` reconstruction from LoD2                                                                                                | Done, one known bug: the 3D scene is mirrored against the map (TODO 23.10)                                                                 |
| IFC / CAD exporters, export fidelity                               | IFC4 STEP export, IFC import                                                                                                                                         | Done, not validated by an external IFC tool                                                                                                |
| Full slice: Postgres schema to NestJS to REST/WS to React/Three.js | `server/` projects and events tables, REST, WS gateway, sync client                                                                                                  | Done for whole-building writes                                                                                                             |
| Computer vision                                                    | SAM 3 facade: wall corners, rectification, openings. Classical CV for floor plan scans.                                                                              | Works, but the result reaches the editor only through the full "Sanierungsplanung starten" rebuild, with no per-wall "apply" in the editor |

Essentials they list and the proof in this repo:

- Quality standards: `npm run check` gate, strict TS, CI.
- Agentic development with rigorous review: `DECISIONS.md` (every place the agent was overruled).
- Three.js depth (projection, raycasting, BufferGeometry, render loop): the wall and opening meshes, picking, the bench page with its frame budget, the 719 opening office tower.
- Backend and SQL with transactions and concurrency: `UPDATE ... WHERE version = baseVersion`, concurrent PUT tests against real Postgres.
- Geometric literacy: polygon, rooms, U-values, thermal bridges, placement of photographed openings.

Strong bonus items: BIM/IFC (done), GIS with UTM/EPSG and GeoJSON (done through lod2), computer vision (done), building physics (done), real-time collaborative editing with optimistic concurrency, CRDT-adjacent sync, undo/redo and WebSocket reconciliation (partial, this is the plan below), German C1 (Adilzhan is A2, be honest, show the complete German UI).

"Realistic profile": a strong TypeScript/3D engineer with judgment and a proven AI workflow who grows into BIM and geospatial. "Tell us where you're strong and how you use AI to cover the rest." Bauwerk is that answer.

## 6. What to show in the office

1. Address to model: search a Berlin address, the LoD2 building, its energy data, "Sanierungsplanung starten".
2. Facade photo to openings to 3D: one photo, SAM 3 finds the wall and the windows, one click puts them on that wall in the editor, the rectified photo on the wall proves they match. (Needs TODO Part 4, B.)
3. Two people, one building: their laptop joins over the office Wi-Fi, both edit, both see cursors and selections, a conflict on the same window resolves, undo only undoes your own change. (Needs TODO Part 4, A.)
4. Export: IFC opened in an external viewer, the iSFP style print.
5. `DECISIONS.md`: three concrete stories of catching the agent being plausible but wrong.

## 7. Questions to ask them

- Which formats does the export feed today: which energy software, which BAFA forms? Is gbXML or a vendor format more important than IFC?
- How do consultants use the editor now: one consultant per building, or office and site at the same time? This decides how much collaboration matters.
- How is versioning done: snapshots, an op log, or both? What is the conflict policy?
- Where does computer vision sit in the pipeline: facade photos, floor plan scans, or both? What runs on GPU and where?
- How many buildings per month go through the tool, and what does a consultant still do by hand?
