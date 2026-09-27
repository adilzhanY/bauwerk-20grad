# TODO

## Part 5: Hosted demo with accounts

Goal: the fused app runs on a rented server under its own domain with HTTPS, not on this PC. People sign up with email, password and a username, and anyone who is signed in can open a shared project link and edit with the others. Accounts, projects, versions and memberships live in Supabase. The public GitHub repository keeps showing the portfolio version.

Order matters. R and D give a working hosted demo without accounts; E, F and G add accounts on top; H adds SAM 3 for the day. Each section ends in a working state, so if time runs out before the presentation, stop after D (or E, or F) and present that. Tick a box only after its check ran.

### Decisions (confirm or change them before starting)

- Two repositories. `adilzhanY/bauwerk` (public) stays at `8d2407b`, the portfolio version with GitHub Pages and without SAM 3. A new private repository, `adilzhanY/bauwerk-20grad`, gets everything since, with the full history. Only the private one is deployed to the server.
- One small x86 server: Hetzner Cloud CX22 (2 vCPU, 4 GB RAM, 40 GB disk, Ubuntu 24.04), about 4 to 5 euro a month at the time of writing; check the price on the day. x86 and not the cheaper ARM type, because the `postgis/postgis` image is published for amd64 only.
- Supabase on the free plan holds accounts, projects, versions and memberships, a few MB. The LoD2 data is 575 MB (the `building` table alone 494 MB) and the free plan allows 500 MB, so it stays in PostGIS on the server: public, read only data that can always be loaded again. Moving it to Supabase later means the paid plan or a smaller area.
- SAM 3 is not on the server: it needs a graphics card, and a GPU server running all month costs far more than everything else together. The hosted app works without it (openings are drawn by hand, and "Detect openings" hides itself when the service does not answer). For the presentation, section H rents a graphics card by the hour.
- Running cost: the server, the domain, and a few hours of a rented graphics card on the presentation day. Supabase stays free.
- No email confirmation and no one time codes: sign up with email, password and username, and the account works at once. Acceptable for a demo, recorded as a known gap.
- The browser never reads or writes the Supabase database. It signs in through Supabase Auth and sends the access token to our NestJS server, which verifies it and is the only one touching the tables. The tables are not reachable through Supabase's public Data API.

### R. Split the repository

- [x] R.1 Check what would be committed: `git status`, and that `.env`, `.venv`, `.sam3`, `node_modules`, `dist`, `coverage` and `.lavish` are ignored. Search the tree for secrets (`HF_TOKEN=hf_`, anything starting `sb_secret_` or `eyJ`, private keys) before the first commit; none may be tracked.
- [x] R.2 Create the private repository on GitHub, empty, without README: `gh repo create adilzhanY/bauwerk-20grad --private` (plain `gh`: repository creation is not something to guess a wrapper's syntax for).
- [x] R.3 In this folder: rename the remote `origin` to `public` and add the private repository as `origin`. Create the branch `demo` from the current `main`, commit the working tree there in a few one line commits (fusion with lod2, sync, photo to 3D, share), and push it with `git push -u origin demo:main`. Nothing is pushed to `public`. (One commit, not several: the store, i18n and panel files hold changes of every feature at once, so commits split by folder would not build on their own.)
- [x] R.4 Guard against a push to the public repository by mistake: `git config remote.public.pushurl DISABLED`, so any push there fails. Portfolio fixes happen in a separate clone of the public repository.
- [x] R.5 Check: the public repository on GitHub still shows `8d2407b` as its newest commit and its Pages site is unchanged; a fresh clone of the private repository runs `npm run setup` and `npm run check` green. (The fresh clone failed first: `npm run setup` gives `lod2-core` its own zod, and the app wrapped lod2-core schemas with its own zod copy. Fixed by list schemas in lod2-core itself.)

### D. Server and domain, without accounts

- [ ] D.1 Hetzner account, a project, the SSH key `~/.ssh/id_ed25519.pub`, one CX22 in Nuremberg or Falkenstein with Ubuntu 24.04, IPv4 and IPv6. Note both addresses. (Yours: needs your Hetzner account. `deploy/cloud-init.yaml` does D.2 and D.3 when pasted into "Cloud config".)
- [ ] D.2 Harden it: log in as root once, create a user with sudo and the SSH key, turn off password and root login in `sshd_config`, `ufw allow 22,80,443/tcp` and enable ufw, turn on `unattended-upgrades`, add a 2 GB swap file (the TypeScript and Vite builds need it on 4 GB).
- [ ] D.3 Docker Engine and the compose plugin from Docker's own apt repository; the user in the `docker` group.
- [ ] D.4 Domain: an `A` record to the IPv4 and an `AAAA` record to the IPv6, TTL 300. Check with `dig +short <domain>` from this PC before going on; the HTTPS certificate in D.10 needs it.
- [x] D.5 `deploy/docker-compose.yml` in the repository, one service per process, each with `restart: unless-stopped` and a health check. Only `caddy` publishes ports (80, 443); the rest talk on the compose network.
- [x] D.6 Service `postgis`: `postgis/postgis:17-3.5` with a named volume. The settings in `lod2/docker-compose.yml` are for bulk ingest on a desktop; on the 4 GB server use `shared_buffers=256MB` and `work_mem=16MB`, since nothing is ingested there.
- [x] D.7 Service `lod2-api`: Node 22, built from `lod2/` (it links `lod2-core` by file path), `DATABASE_URL` to `postgis` from the compose environment. Check it starts without a `.env` file next to it.
- [x] D.8 Service `server`: the NestJS collaboration server, built from the repository root like `server/Dockerfile.compose` (it imports `src/geometry` and `src/sync`), but on `node:22-slim` and with `npm ci --ignore-scripts`, so Playwright's post-install downloads no browser. `DATABASE_URL` points at `postgis` until section E moves it.
- [x] D.9 The server PDF export needs a browser on the server and is left out there. `VITE_SERVER_PDF=false` at build time hides that entry in the Export menu; the printable report in the browser stays. Test for the menu with and without the flag.
- [ ] D.10 Service `caddy`: `caddy:2`, volumes for its data and config, and `deploy/Caddyfile` with one site block for the domain. Caddy gets the Let's Encrypt certificate on its own once the DNS records resolve. (Config done and tested over HTTP on this PC; the certificate comes on the server once D.4 resolves.)
- [x] D.11 Routes in the Caddyfile: `handle_path /api/*` to `lod2-api:8788`; `handle_path /collab/*` to `server:8789` (WebSocket upgrades pass through); `handle_path /vision/*` to `{$VISION_URL:http://127.0.0.1:9}`, so without a GPU address the default refuses the connection, the app gets a 502 and hides "Detect openings", and Caddy still starts; everything else from the built app with `try_files {path} /index.html`, because the app's routes (`/editor`, `/gebaeude/<id>`) are paths, not files.
- [x] D.12 In the Caddyfile: `encode zstd gzip`, and long cache headers for `/assets/*` only, since Vite puts a hash in those names and `index.html` must always be fresh.
- [x] D.13 The app build for the server: `VITE_API_URL=/collab VITE_SERVER_PDF=false npm run build`, base `/`. The same relative paths as in development, so no code changes for the proxy.
- [ ] D.14 LoD2 data without ingesting again: `pg_dump -Fc` of the `lod2` database from the local container, `scp` to the server, `pg_restore` into its `postgis`, then compare `select count(*) from building` on both sides. Keep the dump file; it is the backup. (Rehearsed on this PC: a 168 MB dump, restored in 20 s, 178449 buildings on both sides. Repeat on the server, commands in `deploy/README.md`.)
- [x] D.15 Secrets only on the server: `/srv/bauwerk/.env`, `chmod 600`, never in the repository. `deploy/.env.example` lists every variable with a comment and no value.
- [ ] D.16 First deploy: clone the private repository to `/srv/bauwerk` with a read only deploy key, then `docker compose -f deploy/docker-compose.yml up -d --build`. `deploy/README.md` holds the steps, how to update (`git pull`, the same command), and how to read logs (`docker compose logs -f server`). (`deploy/README.md` written; the deploy itself waits for the server.)
- [ ] D.17 Check from outside, on the phone on mobile data: the start page, a building search, the building page, the editor, Share, and a second device opening the link and editing live. `curl -I https://<domain>/assets/<a file>` shows the long cache header, and `/editor` reloads without a 404.

### E. Projects in Supabase

- [ ] E.1 A Supabase project on the free plan in Frankfurt (`eu-central-1`), a long database password kept in the password manager. Free projects pause after a week without use: open the dashboard the day before the presentation.
- [ ] E.2 The server connects through Supabase's session pooler (the IPv4 connection string from the dashboard's Connect dialog, port 5432) as the `postgres` role, which owns the tables. Session mode behaves like a direct connection; the transaction pooler forbids session state between statements, which buys nothing for one long running server with its own pool. TLS is verified against Supabase's own certificate authority (`DATABASE_CA_CERT`, downloaded in the dashboard): `sslmode=require` fails with it unknown in recent `pg`, and `no-verify` would allow a man in the middle. Pool size 5 (`DATABASE_POOL_MAX`), well under the free plan's connection limit. (Code done: `server/src/db.ts`. The connection itself waits for E.1.)
- [x] E.3 A schema of our own, `app`, for every table. `anon` and `authenticated` get no grants on it and `app` is not among the Data API's exposed schemas. Row level security is on for every table in `app`, with no policies, as a second lock: only the server's `postgres` connection, which owns the tables, reaches the rows.
- [x] E.4 Migrations run once each. Today `ensureSchema` runs every file on every start, which only works while every statement is `IF NOT EXISTS`; moving a table would recreate an empty one on the next start. So: `app.schema_migrations (name text primary key, applied_at timestamptz not null default now())`, each file applied in its own transaction and recorded, applied files skipped. `003_app_schema.sql` creates `app` and moves `projects` and `project_events` out of `public` when they are there (existing local databases); the queries use `app.projects` and `app.project_events`.
- [x] E.5 Migration tests: start twice on an empty database, and once on a database with the old `public` tables and a project in them; the tables end in `app` and the project is kept.
- [ ] E.6 `DATABASE_URL` on the server points at Supabase. Check: create a project through the hosted app, see its row and its events in Supabase's table editor, `docker compose restart server`, and the project is still there.
- [x] E.7 The server tests keep running against a local Postgres; nothing in `npm run check` or CI touches Supabase.

### F. Accounts: email, password, username

- [ ] F.1 Supabase Auth: the email provider on, "Confirm email" off, sign ups allowed, minimum password length 8, site URL `https://<domain>`. Default rate limits kept.
- [ ] F.2 Usernames: `app.profiles (id uuid primary key references auth.users on delete cascade, username text not null, created_at timestamptz not null default now())`, a check that the username is 3 to 24 letters, digits, `_` or `-`, and a unique index on `lower(username)`, so `Ada` and `ada` cannot both exist. A `security definer` trigger function on `auth.users` inserts the profile from `raw_user_meta_data->>'username'`; the client passes it in `signUp({ email, password, options: { data: { username } } })`.
- [ ] F.3 A taken username makes that trigger fail, and Supabase then answers the sign up with a generic database error. So the server offers `GET /auth/username-available?name=<name>` for a clear message before signing up; the unique index still decides in a race, and the client reads the generic error as "username taken" when the check said free a moment ago. The check tells anyone whether a username exists, which is acceptable for usernames; nothing like it is offered for emails.
- [ ] F.4 The server checks every request: a Nest guard for REST and a Socket.IO middleware (`server.use` in the gateway's `afterInit`) read the access token (`Authorization: Bearer <token>`, or `socket.handshake.auth.token`) and verify it with `jose` against the project's JWKS (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`, cached by `createRemoteJWKSet`): signature, expiry, issuer `https://<ref>.supabase.co/auth/v1`, audience `authenticated`. A project still on the legacy shared secret verifies HS256 with `SUPABASE_JWT_SECRET` instead. The user id is the token's `sub`; the name shown to others is the profile's username, read by the server, never taken from the client.
- [ ] F.5 Without `SUPABASE_URL` the server runs as today, without accounts, so `npm run dev` and the tests need nothing new. With `NODE_ENV=production` and no `SUPABASE_URL` it refuses to start, so the hosted server can never run open by accident.
- [ ] F.6 Client: `@supabase/supabase-js`, one client in `src/auth/supabase.ts` from `VITE_SUPABASE_URL` and the publishable (anon) key, which is meant to be public. A small auth store (user, username, loading) of its own, since the session is not editor state. The sync client sends the token when it connects and asks for a fresh one on every reconnect (`io(url, { auth: (cb) => cb({ token }) })`), so a refreshed token keeps working.
- [ ] F.7 Page `/login` with two tabs, "Sign in" and "Create account": email, password with a show toggle, and on the second tab the username with the availability check. Plain messages for a wrong password, an email already registered, a username taken, a password too short, and no network. Built from the `Custom*` components (the text input gets a password mode), usable by keyboard alone, English and German complete, with tests that drive both tabs.
- [ ] F.8 The avatar in the top bar shows the username's initials when signed in, with a menu: the username and "Sign out". Signed out it says "Sign in".
- [ ] F.9 The editor still works signed out, as a local editor in the browser. Share, and opening a `?project=` link, need an account: signed out, they lead to `/login?next=<the link>`, and signing in comes back there. `next` only accepts paths on the same site, so the login page cannot be used to send people elsewhere.

### G. Sharing with accounts

- [ ] G.1 `app.projects` gets `owner_id uuid not null references auth.users on delete cascade` (a deleted account takes its own projects with it) and `app.project_events` gets `actor_id uuid`. New table `app.project_members (project_id uuid not null references app.projects on delete cascade, user_id uuid not null references auth.users on delete cascade, role text not null check (role in ('owner', 'editor')), joined_at timestamptz not null default now(), primary key (project_id, user_id))`.
- [ ] G.2 Creating a project makes the creator its owner and first member, in the same transaction as the project row.
- [ ] G.3 Anyone signed in who opens the link joins: the socket's `join` and `POST /projects/:id/join` add the membership with `ON CONFLICT DO NOTHING`. The project id is a random UUID, so the link is the invitation and cannot be guessed.
- [ ] G.4 Every other route checks membership: reading a project, its versions, sending batches, and the socket room. `GET /projects` lists only the projects the user is a member of, newest first, with the owner's username. Only the owner may delete a project.
- [ ] G.5 The presence list and the history show usernames, and each person keeps one colour on every device, derived from the user id.
- [ ] G.6 Tests: a test key pair signs tokens and a stubbed JWKS serves its public key. Without a token 401; with an expired token or one from another project 401; a member reads and writes; someone signed in but not yet a member joins by opening the project and then reads; a non-owner cannot delete. The convergence and client tests stay as they are.
- [ ] G.7 Check with two real accounts on two devices: A shares, B opens the link, signs up, lands in the project, both edit, and the history shows both by name.

### H. SAM 3 for the presentation, by the hour

- [ ] H.1 Rent one GPU instance with at least 8 GB of graphics memory by the hour (for example a community RTX 3090 or 4090 on RunPod or Vast.ai, usually under a dollar an hour). Start it only for the rehearsal and the presentation, and stop it afterwards.
- [ ] H.2 Run `lod2/lod2-vision` there, with the Hugging Face token set on that instance only. The first start downloads the model (about 3.4 GB), so start it an hour before.
- [ ] H.3 The vision service gets a shared secret: it refuses any request without the header `X-Vision-Key` carrying the value from its environment. Caddy adds the header when it forwards `/vision` (`header_up X-Vision-Key {$VISION_KEY}`, plus `header_up Host {upstream_hostport}` for the https upstream), so the key never reaches the browser and a stranger who finds the GPU address gets nothing.
- [ ] H.4 `VISION_URL` and `VISION_KEY` in the server's `.env`, then `docker compose up -d caddy` recreates Caddy with them. Check: the photo editor on the hosted app shows "Detect openings" and detection works. With the instance stopped the button hides again, and the rest of the app is unaffected.

### I. Before the presentation

- [ ] I.1 `DEMO.md` gets a hosted variant: the domain instead of `localhost`, the second person signing up as the first step, the GPU instance started an hour before.
- [ ] I.2 A fallback ready: the local `npm run dev` on the laptop, and a two minute screen recording of the photo detection and of two people editing, in case the network fails.
- [ ] I.3 `DECISIONS.md`: why two repositories, why the LoD2 data is not in Supabase, why the server and not the browser talks to the database, and what the demo leaves out (email confirmation, backups beyond the dump, monitoring).

## Part 4: Third interview at 20° (office)

Goal: close the two gaps between Bauwerk and the posting that `20GRADGOAL.md` names. First, real-time
multi-user collaboration that merges edits instead of overwriting the whole building. Second, the
SAM 3 facade result reaching the 3D editor in one visible step. Work A, then B, then C. Tick a box
only after its check ran.

### A. Real-time collaboration, operation based

Today: every change PUTs the whole building, a 409 reloads and resends it, last write wins. Two
people editing different windows at the same time overwrite each other. The target is the
Figma model: the server orders small operations, clients apply their own at once and rebase on
the others. Merging stays per property and a server validator holds the geometry invariants.
A text CRDT (Yjs, Automerge) cannot know that two windows must not overlap.

- [x] A.1 `npm run dev` also starts the collaboration server (`server/`, NestJS) with its Postgres,
      and the editor connects when it is up. Today it is never started, so nobody sees the feature.
      (Done: a `bauwerk` database in the LoD2 PostGIS container, the server on 8789, the app
      reaches it through the `/collab` proxy, HTTP and WebSocket.)
- [x] A.2 Operations as data, pure, in `src/sync/ops.ts` with tests: `diffBuilding(prev, next)`
      returns a list of ops keyed by element id and field (`set`, `insert`, `remove`), and
      `applyOps(building, ops)` applies them. Property: `applyOps(prev, diffBuilding(prev, next))`
      deep-equals `next` for every store action. No store action has to change.
- [x] A.3 Server: `POST /projects/:id/ops` (and the same over the socket) takes
      `{ clientId, seq, baseVersion, ops }`. In one transaction: lock the project row, apply the
      ops to the current building, run `validateBuilding`, write the new version and one
      `project_events` row with the ops, broadcast `{ version, actor, ops }`. An op on a deleted
      element is dropped. An op that breaks an invariant rejects the whole batch with the reason.
      (Changed on the way: the editor allows an invalid opening and draws it in the warning
      colour, so the invariants are checked only when the sender's own result was valid. A merge
      can no longer break what someone saw as valid, and nobody is blocked mid-edit.)
- [x] A.4 Client: optimistic apply, a queue of unacknowledged batches, and on a remote batch:
      apply it to the last confirmed building, then replay the pending local ops on top. On a
      reject, drop that batch and show the reason as a toast. Delete the whole-building PUT path.
- [x] A.5 Undo only undoes your own changes: the history keeps the inverse ops of each local
      step. Undo sends the inverse as a new batch. If a remote op changed the same field since,
      the undo of that field is skipped. Test: A moves window 1, B moves window 2, A undoes, and
      window 2 stays where B put it. (Built differently: every remote batch is also applied to
      the undo and redo snapshots, so the history never holds a stale copy of the other
      person's work. Same result, no inverse ops to keep.)
- [x] A.6 Convergence test: three simulated clients, random edits, random delivery order and
      delay, a seeded generator. In the end all three buildings are deep-equal and valid. Run
      1000 seeds in CI.
- [x] A.7 Socket.IO instead of plain `ws` (their stack): a room per project, acks for batches,
      built-in reconnect. On reconnect the client sends its last version and gets the missed
      events from `project_events`, or a snapshot when too far behind. (Always the snapshot:
      the join answers with the building, its version and the last batch of this tab the server
      has; the rest of the queue is resent. One path instead of two.)
- [x] A.8 Presence: remote cursors on the ground plane in the actor's colour with the name,
      remote selection outline (exists), and a soft lock while someone drags an element: others
      see it outlined and cannot start a drag on it until the gesture ends. (Also live: the
      others see the window slide while it is dragged, in the dragger's colour. Openings only;
      the drag end is held back until the move is confirmed, so nobody sees it jump back.)
- [x] A.9 Version history panel: list of versions with actor and time, grouped by minute,
      preview of an old version in the viewport, "restore" as a new version. This is the
      "versioned" in their product line.
- [x] A.10 Two machines: `npm run dev -- --host` (or a flag) binds the app and server to the LAN
      so an interviewer's laptop can join over the office Wi-Fi. The project link carries the id.
- [ ] A.11 Manual check with two browsers and then two machines: edit different windows at the
      same time, drag the same window at the same time, pull the network for 10 s and edit,
      undo after a remote change. Record what broke in `DECISIONS.md`.
- [x] A.12 `DECISIONS.md`: why ops with server ordering and not a CRDT library, and why
      invariants are checked on the server.

### B. Facade photo to the 3D editor

Today: the photo editor finds the wall and its openings with SAM 3 and stores them in the survey.
They reach the editor only when "Sanierungsplanung starten" rebuilds the whole building. Inside
the editor there is no way to bring a photo in, and no way to see if the openings match.

- [x] B.1 In the editor, a selected exterior wall gets "Openings from photo" in the right panel.
      It opens the photo editor for that wall with its real width and height from the model.
      (The wall is the footprint edge up to the eaves; a gable above it is not part of it yet.)
- [x] B.2 After detection, a preview in the photo editor lists what changes on that wall: added,
      removed and moved openings per storey, and openings that could not be placed with the
      reason. Uses `placeOpenings` from `lod2-core`, the same code as the hand-over.
- [x] B.3 "Apply to 3D model" replaces the openings of that wall on every storey in one undo
      step (and one sync batch), and returns to the editor with the wall selected.
- [x] B.4 The rectified facade photo as a texture on that wall in 3D and in the elevation views
      (N, E, S, W), with a layer toggle. Opening frames drawn over it, so anyone sees at once
      if a window is off. This is the "visual validation" in the posting. (Built and tested for
      types only; not seen yet. The photo stays in the browser session, it is not synced.)
- [x] B.5 Each opening keeps its source (detected from photo, drawn, default catalogue) and the
      detection confidence. The properties panel shows it with the photo name and date. The
      layers panel can filter "not yet from a photo". (Source, photo name and confidence show
      through the existing source note, which also says when the opening was edited since. No
      date, and the layers filter is not built.)
- [x] B.6 Energy delta: after apply, the Energy panel shows how the window area and the
      transmission heat loss changed against before, in kWh/a and percent. This is why a photo
      is worth taking. (Shown before applying instead, in the change preview: opening area and
      heating demand now and after, with the change in percent. That is where the decision is.)
- [x] B.7 Tests: apply on a wall with existing openings, apply twice is the same as once, undo
      restores the old openings exactly, an opening that crosses a storey slab is reported and
      not placed. (The shared placement rule trims it to the storey that holds most of it and
      says so, rather than dropping it; an opening above the eaves is dropped with the reason.)
- [ ] B.8 Manual check on the sample photos in `lod2/sample-photos/`, then `DECISIONS.md` on
      what SAM 3 got wrong and how the preview catches it.

### C. Smaller fixes before the demo

- [x] C.1 Fix 23.10, the 3D scene mirrored against the map. A geometry bug on a geometry job
      interview must not be in the demo.
      (Done with one group mirrored in z around all scene content, `PLAN_MIRROR` in
      `src/scene/three.ts`, instead of changing every mesh. Only world space code converts: the
      pointer, the camera, the walkthrough, the plan camera, the section cut. A projection test
      checks east is right seen from the south and north is up from the top. Not seen yet.)
- [x] C.2 Validate the IFC export with IfcOpenShell (the vision venv already has Python): a test
      script that opens the file, counts walls, slabs and openings per storey against the model.
      (`npm run check:ifc`: schema validation, geometry built for every element, windows and doors
      in openings that cut walls, counts per storey, on all four examples. uv fetches IfcOpenShell
      into a throwaway environment; CI runs it too. Merged into the existing
      `scripts/validate-ifc.py`, which already checked schema, EXPRESS rules and geometry.)
- [ ] C.3 Do the open manual checks in sections 13, 36 to 40.
- [ ] C.4 `DEMO.md`: the office script from `20GRADGOAL.md` section 6, timed, rehearsed twice.
      (Script written and timed at about twelve minutes; the two rehearsals are still to do.)

## Part 3: Fusion with lod2-challenge, and the new design

Goal: one repository, one product. The LoD2 map, the building page with its energy data, the
facade photo tools with SAM 3, and the Bauwerk editor become one app. `npm run dev` in this
repository starts everything: the PostGIS database, the LoD2 API, the vision service when it
is installed, and the app. The whole interface gets a new design in Inter, after the reference
screens in `docs/design/` (light panels, round pill toolbars, a left navigation rail, a dark
map, a German building page with the energy scale).

Rules stay as in `CLAUDE.md`, with the changes in 18.7. Tick a box only after its check ran.

### 18. Move lod2-challenge in

- [x] 18.1 Copy every tracked and working file of lod2-challenge (no node_modules, no caches, no
      .venv, no .sam3, no .env) into `lod2/`, keeping the package folder names so their
      `file:../lod2-core` links still work.
- [x] 18.2 `lod2/docs/`: its README (as `LOD2.md`), MEASUREMENTS, WRITEUP, CHALLENGE and the
      presentation. The sample photos stay in `lod2/sample-photos/`.
- [x] 18.3 One `.env` at this repository's root for everything: the API, the ingest CLI, the
      vision service and the viewer read it from here. Merge `.env.example`.
- [x] 18.4 The LoD2 database keeps its own compose file, `lod2/docker-compose.yml`, so it never
      starts Bauwerk's server containers.
- [x] 18.5 Root scripts: `setup`, `db`, `db:stop`, `migrate`, `index`, `ingest`, `bootstrap`,
      `status`, `api`, `vision`, `viewer`, `dev:editor`.
- [x] 18.6 `npm run dev`: a small runner (`scripts/dev.mjs`, no new dependency) that starts the
      database and waits for it, then the API, the vision service when its Python exists,
      and the app, each line prefixed with its name, all stopped together with Ctrl+C.
- [x] 18.7 `CLAUDE.md` and `INFO.md`: the stack is now React 19, the repository has a backend,
      and lod2 packages follow their own style (no semicolons, oxlint).
- [x] 18.8 Prettier and ESLint ignore `lod2/`; lod2 keeps its own lint and tests, wired into
      `npm run check` as `check:lod2`.
- [x] 18.9 `lod2/scripts/check-bauwerk.mjs` points at this repository.
- [x] 18.10 Everything green: Bauwerk check, lod2 typecheck, lint and tests, the viewer build.
- [x] 18.11 DECISIONS.md entry: why the fusion, and why in stages.

### 19. One set of versions

- [x] 19.1 Upgrade the editor to React 19, @react-three/fiber 9, drei 10, the types to 19.
- [x] 19.2 Upgrade Vite to 8 and @vitejs/plugin-react to 6, check the build config (manual chunks
      under Rolldown).
- [x] 19.3 Fix what the upgrade breaks: `JSX` namespace, ref callbacks, r3f event types,
      `useRef` without an argument, drei component props.
- [x] 19.4 Tests: @testing-library/react with React 19, the jsdom panel tests.
- [x] 19.5 Add maplibre-gl, zod and `lod2-core` (file link) to the app.
- [x] 19.6 Full check green, the bench page still reaches its frame budget.

### 20. One app

- [x] 20.1 A small router without a dependency: `/` start page (search and map), `/gebaeude/:gid`
      building page, `/editor` the Bauwerk editor. The URL keeps `?at=` and `gid=` as before.
- [x] 20.2 Move the viewer's code under `src/lod2/`: api clients, state, map, 3D scene, photo
      editor, survey. One Zustand store per concern, as now.
- [x] 20.3 The Vite dev server proxies `/api` and `/vision` like the viewer did.
- [x] 20.4 Viewer strings through the i18n layer, German and English complete.
- [x] 20.5 The hand-over becomes direct: "Sanierungsplanung starten" builds the Bauwerk building
      with `surveyToBauwerk` and loads it into the editor store; the link import stays for
      files from elsewhere.
- [x] 20.6 The editor's back arrow returns to the building page.
- [x] 20.7 Remove `lod2/lod2-viewer` once everything lives in the app; `npm run viewer` goes.
- [x] 20.8 Tests for the router and the direct hand-over.

### 21. The new design

Reading of the reference screens (`docs/design/`):

- Inter everywhere, tabular numbers for values. Large bold headings (about 32 px), grey subtitles.
- Light grey page ground, white or near white panels with very large radii (about 24 px),
  hairline borders and soft wide shadows.
- A narrow left navigation rail inside its own rounded card: logo at the top, a round "+"
  button, home, documents and tools icons, the user's initials in a dark circle at the bottom.
- Start page: a big two line question as the title, a subtitle, a pill search field with a
  soft shadow, results as a list with a pin icon, the street in bold and the place in grey.
  The map fills the right side, dark, with round dark icon buttons stacked top left, a north
  arrow top right, a scale bar bottom left, and a light mini map with "Quellen" bottom right.
- Building page: a back arrow and share and bookmark icons, the address as the title, the post
  code and city under it, tabs with an underline for the building parts ("Grundstück",
  "Wohnhaus", ...), then "Energiedaten unsanierter Zustand" with a green to red scale A+ to H
  and the class as a coloured tag on it, then rows of label, info icon and a right aligned
  value with hairline dividers, a small bar chart for the monthly yield. At the bottom a black
  pill button "Sanierungsplanung starten" and a round black chat button.
- Editor: a white 3D view, the building in light grey with its floors drawn as lines and the
  terrain contact line in blue. At the bottom a floating pill tool dock with grouped icon
  tools and small shortcut letters under each icon; the active tool is a filled sky blue
  circle. On the left a vertical storey pill (home icon, DG, 4, 3, 2, 1, EG, KG). Top right a
  view pill ("Perspektive" with a select, and small icon buttons). Top centre a version pill
  ("v1 gespeichert" with undo and redo). A small axis gizmo bottom right.

Tasks:

- [x] 21.1 Inter as the only font (local, `@fontsource-variable/inter`), numbers tabular.
- [x] 21.2 New tokens: page, panel, line, ink, muted, the sky blue accent, the energy scale
      colours, radii (pill, 24, 16, 12), two shadows.
- [x] 21.3 Shell: the rounded app card on the page ground, the navigation rail with logo, plus,
      home, documents, tools and initials.
- [x] 21.4 Start page: title, subtitle, pill search with the result list, the dark map with its
      controls (layers, 3D, statistics, north arrow, scale, mini map, sources).
- [x] 21.5 Building page: back, share, bookmark, title and address line, part tabs, the energy
      scale, the data rows with info tooltips, "Allgemeine Gebäudedaten", the facade survey
      and photo actions, the black CTA and the chat button.
- [x] 21.6 Energy numbers on the building page from the Bauwerk balance of the pre-filled
      building: total demand, specific demand, heat load, specific heat load; PV potential from
      the roof planes (area, orientation, tilt), yearly and monthly yield.
- [x] 21.7 Editor: the bottom tool dock with groups, shortcut letters and the blue active tool.
- [x] 21.8 Editor: the storey pill on the left (DG, upper floors, EG, KG) that switches the active
      storey.
- [x] 21.9 Editor: the view pill top right (Perspektive select, section, bookmark, camera,
      panel toggle) and the version pill top centre (version, saved state, undo, redo).
- [x] 21.10 Editor 3D look: light grey building, storey lines, blue terrain line, axis gizmo.
- [x] 21.11 Side panels of the editor in the new card style, the same controls restyled.
- [x] 21.12 Photo editor restyled to match: white stage frame, pill toolbar, the detection card.
- [x] 21.13 Dark mode stays working with the new tokens.
- [x] 21.14 Every screen at 1440 px and at 1920 px wide without overflow; keyboard focus visible. (Worked out from the widths, not seen: the editor pills rearrange by container width.)

### 22. Finish

- [x] 22.1 README for the fused repository: what it is, `npm run setup`, `npm run dev`, the
      vision service, the Hugging Face token, the architecture.
- [x] 22.2 Full check, lod2 checks, the build green (the check-bauwerk script became tests in `src/lod2/analysis.test.ts`).
- [x] 22.3 `npm run dev` from a clean clone of the working tree starts everything.
- [x] 22.4 lod2-challenge gets a README note pointing here.
- [x] 22.5 Remove the ESLint override for `src/lod2/` and fix what it hid (about 80 findings,
      mostly non-null assertions).

### 23. Redesign after the 20° app

- [x] 23.1 Tokens and fonts: navy, navy-black ink, green-grey muted and faint, hairlines, the
      blue-grey scene; Geist and Geist Mono; square 8 px corners instead of pills.
- [x] 23.2 White top bar replaces the shell card and the navigation rail: mark, search, editor,
      building name, version, undo and redo, the navy Export menu, language, avatar.
- [x] 23.3 Side panels docked and flush; the right panel heads with the building name, and with
      nothing selected shows building, dimensions and location as label and value rows.
- [x] 23.4 Layers panel after Figma: the building as a tree with an eye per storey and on the
      scene layers; zones, site, underlay and settings as tabs.
- [x] 23.5 Tool card at the top left with the layers and whole-building toggles, the tools with
      their shortcut numbers beside them, and the shortcut sheet.
- [x] 23.6 View switch 3D, top, N, E, S, W that moves the camera, plus floor plan, walkthrough
      and section cut.
- [x] 23.7 Minimap at the bottom left: footprint north up over faint streets, camera direction,
      place name, back to the 3D view.
- [x] 23.8 The plain grid is the default ground and draws at every angle; the map is a setting.
- [x] 23.9 Start and building pages in the same look: light map, mono values, navy action.
- [x] 23.11 Floor plan view as a drawing: walls cut and filled between their faces, windows and
      doors as breaks with their symbols (door leaf and swing), a white sheet with zone tints,
      and dimension lines outside (overall length and the chain of openings) with ticks and
      labels along the line, sized in pixels so any building reads the same.
- [x] 23.10 The 3D scene is a mirror image of the map: with north up, east is on the left, and
      map tiles on the ground read backwards. Plan (x, y) goes to world (x, 0, y), which flips
      the handedness. Fixing it means mapping plan y to world -z in every mesh and in every
      tool's pointer handling, with tests. The minimap is already correct.

## Part 1 and 2: history

Work top to bottom. Tick with `[x]`. A task is done when `npm run check` passes and the human has looked at it. Anything that breaks an invariant in `INFO.md` goes back to open.

## 0. Scaffold

- [x] `npm create vite@latest . -- --template react-ts`, React 18, TypeScript strict, `noUncheckedIndexedAccess` on.
- [x] Install zustand, immer, three, @react-three/fiber, @react-three/drei, @types/three, lucide-react, tailwindcss @tailwindcss/vite.
- [x] Install dev: vitest, jsdom, @testing-library/react, eslint, typescript-eslint, prettier, eslint-config-prettier.
- [x] Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `check` (typecheck plus lint plus test).
- [x] `vite.config.ts` with `base` set from an env var so GitHub Pages works under `/bauwerk/`.
- [x] Tailwind v4 set up with the palette from `INFO.md` as CSS variables, Inter and JetBrains Mono loaded locally (no external requests at runtime).
- [x] `.gitignore`, `.prettierrc`, ESLint config, `README.md` with a one-paragraph description and the run commands.
- [x] Repository layout from `INFO.md` created with empty modules and one passing smoke test.
- [x] First commit.

## 1. Data model and store

- [x] `src/geometry/types.ts` with the interfaces from `INFO.md`.
- [x] `src/lib/ids.ts`: short unique ids, deterministic in tests.
- [x] `src/store/building.ts`: Zustand store holding `building`, `activeStoreyId`, `selection`, `tool`, `language`. Default building: a 10 m by 8 m rectangle, one storey, no openings.
- [x] `src/store/history.ts`: undo and redo middleware. Every action that changes `building` pushes a snapshot. Cap history at 200 entries. UI state (selection, tool, language) is not part of history.
- [x] Actions: `setFootprintVertex`, `addStorey`, `removeStorey`, `setStoreyHeight`, `renameStorey`, `setWallThickness`, `addOpening`, `updateOpening`, `removeOpening`, `addInteriorWall`, `removeInteriorWall`, `renameRoom`, `assignRoomToZone`, `addZone`, `updateZone`, `removeZone`, `loadBuilding`, `undo`, `redo`, `select`, `clearSelection`, `setTool`, `setLanguage`.
- [x] Tests: undo then redo is identity for every action. History cap holds. UI state is untouched by undo.

## 2. Geometry

- [x] `polygon.ts`: signed area, orientation, ensure counter-clockwise, simple-polygon check (no self-intersection), point-in-polygon, edge list with lengths and outward normals.
- [x] Tests for `polygon.ts` including a concave L-shaped footprint and a self-intersecting bowtie that must be rejected.
- [x] `walls.ts`: from footprint and thickness, produce each exterior wall as a quad footprint (inner and outer offset lines, mitred at corners) plus height from the storey.
- [x] Tests: wall count equals vertex count, mitred corners meet, thickness is honoured on a rectangle and on the L shape.
- [x] `openings.ts`: validate an opening against its wall and its siblings (the invariants in `INFO.md`), clamp helper for the UI, and produce the wall's 2D profile with the opening subtracted as a polygon with a hole.
- [x] Tests: every invariant has a failing case and a passing case. Two adjacent openings that touch exactly are allowed, overlapping by 1 mm is rejected.
- [x] `rooms.ts`: from footprint and interior wall segments on the grid, compute the room polygons (planar face extraction on the grid) and their areas.
- [x] Tests: no interior walls gives one room equal to the footprint. One wall across a rectangle gives two rooms whose areas sum to the footprint area. A dangling wall that does not split anything still gives one room.
- [x] `export.ts`: `toJson(building)` and `fromJson(text)` with validation of every invariant on import and a clear error message on failure.
- [x] Tests: round trip is deep equal, a JSON with an overlapping opening is rejected with the right message.

## 3. Scene

- [x] `Viewport.tsx`: Canvas, orbit controls limited so the camera never goes below the ground, soft lighting, grid at 0.5 m, a ground plane.
- [x] `Camera.tsx`: fit the building on load, animate to the active storey over 300 ms.
- [x] `Wall.tsx`: extrude the wall profile (with holes) into a mesh. Exterior walls in the wall colour, selected wall in the accent colour, hovered wall slightly lighter.
- [x] `Opening.tsx`: draw a translucent pane for windows and a door slab for doors inside the hole, so the hole reads as an opening and not as a gap.
- [x] `Storey.tsx`: floor slab, walls, openings, interior walls, room fills coloured by zone. Inactive storeys at 25 percent opacity and not clickable.
- [x] `Room.tsx`: flat fill on the floor with the zone colour, name label facing the camera (drei `Html` or `Text`).
- [x] Picking: click selects, click on empty space clears, hover state in the store is throttled so the viewport does not re-render on every mouse move.
- [ ] Performance: 5 storeys with 20 openings each stays above 60 fps on the RTX 5070 and above 30 fps on integrated graphics. Memoise geometry per element by a hash of its inputs. (Memoisation done; the fps numbers need a manual check in the browser.)

## 4. Tools and editing

- [x] Select tool: click any element, Delete removes it, Escape clears.
- [x] Footprint tool: vertices shown as draggable handles on the ground plane, snapped to the grid, live validation, invalid shapes shown in the warning colour and not committed.
- [x] Opening tool: click a wall to place a window at the click position with default size; hold Shift for a door. Then drag the opening along the wall, snapped to 0.1 m.
- [x] Interior wall tool: click two grid points on the active storey to add a wall segment. Preview line while placing.
- [x] Zone tool: click rooms to toggle them into the active zone.
- [x] Keyboard shortcuts from `INFO.md`, with a small shortcut sheet behind a `?` button.

## 5. UI panels

- [x] `LeftPanel.tsx`: storey list with add, remove, rename, reorder by drag; tool palette; settings for wall thickness, grid visibility, language.
- [x] `RightPanel.tsx`: properties of the selection. Wall: length, thickness, number of openings. Opening: kind, offset, width, height, sill, with sliders and number inputs, validation message when invalid. Room: name, area, zone select. Storey: name, height. Zone: name, colour from the fixed set.
- [x] `BottomBar.tsx`: undo, redo (disabled when nothing to do), export, import, status line.
- [x] Empty state when the building has no storeys, and a WebGL-missing state.
- [x] Below 1024 px: full-screen message that the editor needs a desktop browser.
- [x] Focus rings, labels, keyboard operation of every panel control.

## 6. Internationalisation

- [x] `src/i18n/index.ts`: `t(key)` hook bound to the store language, typed keys, missing key is a compile error.
- [x] `en.ts` complete.
- [x] `de.ts` complete, checked against a dictionary. Storey naming rules: ground floor "Erdgeschoss", then "1. Obergeschoss", "2. Obergeschoss"; English "Ground floor", "1st floor", "2nd floor".
- [x] Language persisted in localStorage, default from `navigator.language`.
- [x] Number formatting via `Intl.NumberFormat` in inputs and status line.

## 7. Persistence and export

- [x] Autosave the building to localStorage on every change, restore on load, "Reset to example" button.
- [x] Export button downloads `bauwerk-<name>-<date>.json`.
- [x] Import button opens a file picker, validates, shows the error message inline if invalid.
- [x] Two example buildings bundled: a simple two-storey house and an L-shaped three-storey block.

## 8. Quality gates

- [x] `npm run check` green with zero warnings.
- [x] Test coverage on `src/geometry/` and `src/store/` above 90 percent lines. (98.5 and 95.3 on 2026-09-05, `npx vitest run --coverage`.)
- [ ] Manual visual check of every state listed in `INFO.md` design principles, in both languages.
- [x] `grep -rn "dash characters" src docs *.md` returns nothing.
- [ ] Lighthouse performance above 90 on the production build.

## 9. CI and deployment

- [x] `.github/workflows/check.yml`: on push and pull request, install, `npm run check`, build.
- [x] `.github/workflows/deploy.yml`: on push to `main`, build with the Pages base path and deploy with `actions/deploy-pages`, gated behind a GitHub environment that requires manual approval.
- [x] Create the GitHub repository `adilzhanY/bauwerk`, public, push. Do not enable Pages until local testing is signed off by Adilzhan.
- [ ] After sign-off: enable Pages, approve the deployment, verify the live URL, add it to `README.md`.

## 10. Interview preparation

- [x] Write the three minute walkthrough in `README.md` under "Demo path": open, add a storey, place a door and three windows, split into three rooms, create a heated zone with two rooms, undo four steps, redo them, export, switch the UI to German.
- [ ] Rehearse the walkthrough three times against the live URL, timed.
- [ ] `DECISIONS.md` has at least five real entries from the build. Pick the two best to tell.
- [ ] One minute explanations ready for: how openings cut the wall, how undo works, why geometry has no Three.js imports, what was cut and why.
- [ ] Read the Three.js basics once: scene, camera, mesh, BufferGeometry, raycasting, so the questions on the call land.

## Phase 2

Everything below extends the demo toward the other three bullets of the posting: the full stack slice, IFC export fidelity, and collaboration, plus the energy language 20grad's customers speak. Same rules as above: pure functions with tests first, one commit per task, `DECISIONS.md` entry for every correction. Order is by value. Stop after any section and the demo still works.

## 11. Building physics

Goal: the model answers "what does this tell me about the building's energy?" Pure functions in `src/geometry/energy.ts`, no UI dependency, every number traceable to a formula in a comment.

- [x] Data model: `Construction { id, name, uValue }` presets for exterior walls, windows, doors, floor slab and roof. Default set: uninsulated brick wall 1.4, 1970s wall 1.0, insulated wall 0.25, single glazing 5.0, double glazing 2.8, triple glazing 0.8, old door 3.0, insulated door 1.3, uninsulated floor 1.0, insulated floor 0.35, uninsulated roof 1.3, insulated roof 0.2 W/(m²K). Values editable, presets stored in the building JSON.
- [x] Building gets `constructions: Construction[]`, `wallConstructionId`, `floorConstructionId`, `roofConstructionId`. Each opening gets `constructionId`. Existing JSON without these fields imports with the uninsulated defaults (migration in `export.ts`, test it).
- [x] Zones get `heated: boolean` and an indoor design temperature (default 20 °C heated, 10 °C unheated).
- [x] `envelope.ts`: for every storey compute exterior wall net area (gross minus openings), window area, door area, floor area on the ground storey, roof area on the top storey. Envelope area per storey and per building. Window-to-wall ratio per orientation (N, E, S, W from the wall normal).
- [x] Tests: rectangle with two windows gives gross minus opening areas exactly; L shape orientation buckets are right; a storey with no openings has ratio 0.
- [x] `heatLoss.ts`: transmission heat loss coefficient H_T = Σ U·A over the envelope of heated rooms, in W/K. Interior walls between a heated and an unheated room count with a fixed U of 1.0 (document the simplification). Ventilation loss H_V = 0.34 · n · V with n = 0.5 1/h and V the heated volume. Specific transmission loss H_T' = H_T / A_envelope.
- [x] Tests: hand-computed H_T for the default building with all presets uninsulated versus all insulated; swapping one window preset changes H_T by exactly U difference times area; unheated rooms contribute nothing.
- [x] Simple annual heating demand: Q_h = (H_T + H_V) · G_t with G_t = 84 kKh for Berlin (heating degree hours, DIN V 4108-6 style, document the source and that it ignores solar and internal gains). Output kWh/a and kWh/(m²a) over heated floor area.
- [x] Energy class band from kWh/(m²a) using the Energieausweis scale A+ to H. Pure lookup, tested at the boundaries.
- [x] Store actions: `setConstruction`, `assignConstruction`, `setZoneHeated`. Undoable, tests.
- [x] Energy panel in the right panel when nothing is selected, and an Energy tab: envelope area, window-to-wall ratio, H_T, H_T', heating demand, energy class with the coloured band. Per zone breakdown.
- [x] Before and after: a "Scenario" toggle that swaps every construction to its insulated counterpart without touching the model, shows both columns side by side, and the difference in percent. Not stored in history, it is a view.
- [x] Opening and wall properties show the construction select and the resulting U·A for that element.
- [x] Export JSON includes constructions and the computed energy summary block (marked derived).
- [x] i18n for every new string, German checked: Wärmedurchgangskoeffizient, Transmissionswärmeverlust, Lüftungswärmeverlust, Heizwärmebedarf, Hüllfläche, Fensterflächenanteil, Energieeffizienzklasse.

## 12. IFC export

Goal: a file that opens in a real IFC viewer with correct storeys, walls, openings, windows, doors and spaces. STEP physical file, IFC4. Written by hand in `src/geometry/ifc.ts`, no library, so the schema knowledge is visible in the code.

- [x] Read the IFC4 spatial structure once: IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey, IfcRelAggregates, IfcRelContainedInSpatialStructure. Note the entity list and required attributes in a comment block at the top of `ifc.ts`.
- [x] STEP writer: entity id counter, `#12=IFCWALL(...)` line encoding, string escaping, enum and typed value formatting (`IFCLABEL('x')`, `IFCLENGTHMEASURE(1.)`), `$` for null, `*` for derived. Header section with FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA (('IFC4')).
- [x] Tests for the writer: escaping of apostrophes and non-ASCII (German umlauts use the `\X2\` encoding), number formatting always with a dot and a trailing point for integers written as REAL, ids unique and monotonic.
- [x] Units: IfcUnitAssignment with metres, square metres, cubic metres, radians. Geometric context with world coordinate system and precision 1e-5.
- [x] Spatial tree: one IfcProject, one IfcSite, one IfcBuilding, one IfcBuildingStorey per storey with Elevation set to the storey elevation. Aggregation relationships in the right direction.
- [x] Walls: one IfcWall per exterior wall per storey with an IfcExtrudedAreaSolid from the mitred plan quad (IfcArbitraryClosedProfileDef over an IfcPolyline) extruded by the storey height. Placement relative to the storey.
- [x] Openings: one IfcOpeningElement per opening as an extruded rectangle through the wall thickness, related with IfcRelVoidsElement to its wall. One IfcWindow or IfcDoor filling it with IfcRelFillsElement, with OverallHeight and OverallWidth set.
- [x] Interior walls as IfcWall with a 0.1 m thick box solid.
- [x] Rooms as IfcSpace with the room polygon extruded by the storey height, contained in the storey, LongName from the room name. Zones as IfcZone grouping their spaces through IfcRelAssignsToGroup.
- [x] Slabs: one IfcSlab per storey floor (0.2 m, PredefinedType FLOOR), roof slab on the top storey (PredefinedType ROOF).
- [x] Property sets: Pset_WallCommon with ThermalTransmittance from section 11 when present, Pset_WindowCommon and Pset_DoorCommon likewise, Pset_SpaceCommon with the floor area. Skip when section 11 is not done.
- [x] Tests: entity counts match the model (walls, openings, windows, doors, spaces, storeys); every referenced `#id` exists; every wall has exactly one representation; file parses with a small STEP tokenizer written in the test.
- [ ] Manual verification by Adilzhan: open the export of the two example buildings in an IFC viewer (BlenderBIM, or a web viewer such as ifc.js), check storeys, holes in walls, room volumes. Screenshot into `docs/ifc-verification.png` and reference it in the README. Any mismatch goes into `DECISIONS.md`. (Already validated with IfcOpenShell 0.8.5: zero schema issues, all solids build, openings cut real holes. `scripts/validate-ifc.py`. The viewer screenshot is still yours to take.)
- [x] Export IFC button next to Export JSON, file name `bauwerk-<name>-<date>.ifc`.
- [x] README section "IFC export": what is written, what is left out (no materials layers, no IfcCurtainWall, no georeferencing until section 14), and the viewer screenshot.

## 13. Full stack slice: server and live collaboration

Goal: two browser tabs edit the same building and see each other's changes, with a Postgres project store behind a NestJS API. The client keeps working alone with localStorage when no server is configured, so GitHub Pages still works.

- [x] `server/` folder, own `package.json`, NestJS 10, TypeScript strict, Prisma or plain `pg` (decided: plain `pg`, see `DECISIONS.md`), Vitest for unit tests, `docker-compose.yml` with Postgres 16. Same lint and format rules as the client.
- [x] Schema: `projects (id uuid pk, name text, building jsonb, version integer not null, updated_at timestamptz)`, `project_events (id bigserial pk, project_id uuid fk, version integer, actor text, patch jsonb, created_at)`. Migration checked in. The building JSON is validated on write with the same `validateBuilding` as the client (shared through a tsconfig path alias to `../src/geometry`, copied into the image by the compose Dockerfile).
- [x] REST: `POST /projects` creates from a building, `GET /projects/:id` returns building and version, `PUT /projects/:id` takes `{ building, baseVersion }` and applies it in one transaction with `UPDATE ... WHERE version = baseVersion`; zero rows updated returns 409 with the current version and building. `GET /projects` lists id, name, updated_at.
- [x] Tests: concurrent PUTs against a real Postgres in a test container, only one wins, the loser gets 409, the version increases by exactly one per accepted write, the events table has one row per accepted write.
- [x] WebSocket gateway: clients join a project room, every accepted PUT broadcasts `{ version, building, actor }` to the room, presence list of connected actors with a colour.
- [x] Client: `src/sync/` module with a `SyncClient` that loads the project, sends each committed history entry as a PUT with the base version, applies incoming versions from other actors, and on 409 reloads and reapplies the local change on top (last write wins, document why CRDT was not done). Reconnect with backoff, offline queue of one pending write.
- [x] Undo and redo stay local: undo sends the previous building as a new write. Test that undo after a remote change does not undo the remote change (history middleware compares against the snapshot it stored).
- [x] Presence in the UI: coloured dots in the bottom bar with actor names, the remote actor's selection highlighted with their colour in the viewport.
- [x] Project switcher: open, create, rename projects; the URL carries the project id so a link opens the same project in another tab.
- [ ] Manual verification by Adilzhan: two tabs, add an opening in one, see it in the other within a second, drag the same opening in both at once, confirm the 409 path recovers without losing either change. Record what broke in `DECISIONS.md`.
- [x] `docker-compose up` starts Postgres, server and a static client build; README section "Run with the server".
- [x] CI: server tests run in `check.yml` with a Postgres service container.

## 14. Geo placement

Goal: the footprint knows where it is on the earth, in the coordinate systems German planning uses.

- [x] Building gets `origin?: { lat, lon, rotation }` for the footprint origin in WGS84 and the rotation of the local x axis against east, in degrees.
- [x] `src/geometry/geo.ts`: WGS84 to UTM conversion (Krüger series, zone from longitude, EPSG 258xx for ETRS89 UTM, Berlin is EPSG 25833 zone 33) and back. Pure, no library.
- [x] Tests against known points: Brandenburger Tor 52.516275 N 13.377704 E is 33N 389918.04 E 5819699.13 N (reference from pyproj, EPSG:25833, in the test), round trip error under 1 mm, zone boundary at 12 °E handled.
- [x] Footprint to world: every footprint vertex to UTM and to WGS84 using origin and rotation. Wall orientations in section 11 use the true rotation.
- [x] GeoJSON export: a FeatureCollection with the footprint as a Polygon in WGS84 (right hand rule, closed ring), one feature per storey with height properties, the building properties from section 11 if present. Tests: valid GeoJSON structure, ring closed, coordinates in lon lat order.
- [x] Import: read a GeoJSON polygon as a new footprint, project to local metres around its centroid, snap to the grid, reject self-intersecting rings with the existing message.
- [x] IFC: IfcMapConversion and IfcProjectedCRS (EPSG:25833) in the IFC export when an origin is set.
- [x] UI: Location section in Settings with latitude, longitude, rotation inputs, a compass arrow in the viewport, north indicated on the grid.
- [x] i18n: Breitengrad, Längengrad, Ausrichtung, Norden.

## 15. Editor polish for consultants

Only what an energy consultant needs on a site visit. No decoration.

- [x] Dimension lines: length labels on every exterior wall and every interior wall, in the footprint and interior wall tools, in the locale's number format.
- [x] 2D plan view: a toggle that switches to an orthographic top-down camera on the active storey with the other storeys hidden, same tools work. Test the projection math for picking with a unit test on the camera setup.
- [x] Wall construction shown in the viewport: a thin coloured band along the top of each wall keyed to its construction's U-value (cold red to good green), toggle in Settings.
- [x] Room list in the left panel per storey: name, area, zone, click to select and focus the camera.
- [x] Measure tool (key 6): click two points, see the distance; Escape clears. Pure distance, snapped to grid.
- [x] Storey duplication: copy a storey with its openings and walls above itself, useful for repeated floors. Undoable, ids regenerated, tested.
- [x] Photo underlay: drop an image of a floor plan onto the ground plane, scale it by marking a known distance, trace the footprint over it. Image stays local, not exported.
- [x] Print view: a static page with plan per storey, the energy summary and the room table, for the customer meeting. Uses the browser's print to PDF.
- [ ] Performance check after all of the above: the five storey, twenty openings per storey model still above 60 fps on the RTX 5070; measure with the browser's frame counter and write the number here.

## 16. Interface redesign

Goal: the editor stops looking like every generated tool of this year. Light by default with a designed dark option, a drawing office feel, no native form controls anywhere. Every control is its own component in `src/components/`, named `Custom<Name>.tsx`, with a test next to it that drives it with keyboard and pointer and checks the accessible role, the value it reports and the visual states it exposes (hover, focus, disabled, invalid). The old `src/ui/controls/` folder disappears.

- [x] Design tokens in `src/index.css`: paper `#f6f6f2`, panel `#ecece6`, line `#cfd1c9`, ink `#1b1d20`, muted ink `#5b6068`, mark red `#c2431f` for warnings and markup, selection blue `#234d8f`; a dark set with the same roles. Tokens only, no colour literal in a component.
- [x] Theme: `light | dark | system` in the store, persisted in localStorage, applied as `data-theme` on the root element, `prefers-color-scheme` honoured for system. The 3D scene follows: ground, grid and background take their colours from the theme.
- [x] Fonts bundled locally: Archivo (headings, big numbers), IBM Plex Sans (labels, body), IBM Plex Mono (every measurement, tabular digits). Inter and JetBrains Mono removed. No external font request at runtime.
- [x] `CustomButton`: default, primary, quiet and danger variants, optional icon, loading state, keyboard focus ring drawn with the selection colour. Test: role button, click, disabled does not fire, Enter and Space fire.
- [x] `CustomIconButton`: square, tooltip from its label, pressed state for toggles. Test: accessible name from label, aria-pressed when toggle.
- [x] `CustomSlider`: own track, fill and thumb, pointer capture, live value while dragging, arrow keys with Shift for ten steps, Home and End, value bubble while active. Test: role slider with aria-valuenow and min, max; keyboard changes value by step; pointer down and move along the track maps to the value; value is clamped.
- [x] `CustomNumberInput`: mono digits, unit drawn inside, comma and dot accepted, drag on the label scrubs the value (Blender style) with Shift for fine steps, arrow keys step, invalid state in the mark colour. Test: typing commits live within range, blur clamps and snaps, scrub changes value by pixels moved, Escape reverts.
- [x] `CustomSelect`: button showing the value, popover listbox, arrow keys, Home and End, type-ahead, Enter selects, Escape closes, closes on outside click, option can carry a colour dot or a secondary text. Test: role combobox and listbox, keyboard selection, outside click closes, the selected option has aria-selected.
- [x] `CustomCheckbox` and `CustomToggle`: drawn box with a check mark, drawn switch. Test: role checkbox or switch, aria-checked, Space toggles, label click toggles.
- [x] `CustomTextInput`: commit on blur or Enter, Escape reverts, optional leading icon. Test: commit and revert paths.
- [x] `CustomSegmented`: a row of mutually exclusive options (Current / Renovated, tools). Test: role radiogroup, arrow keys move selection.
- [x] `CustomSwatches`: the zone colour picker, radiogroup of coloured circles. Test: arrow keys, aria-checked.
- [x] `CustomDialog`: focus trap, Escape closes, click outside closes, returns focus. Test: focus lands inside, Escape closes, Tab cycles.
- [x] `CustomSection` and `CustomField`: section header with optional action, field with label, hint and error line. Test: label is associated with the control.
- [x] `CustomTabs` for the right panel: Properties and Energy as tabs instead of stacked sections. Test: role tablist, arrow keys, aria-selected.
- [x] Replace every native control in `LeftPanel`, `RightPanel`, `BottomBar`, `EnergyPanel`, `LocationSection`, `UnderlaySection`, `ProjectSwitcher`, `ShortcutSheet`, `States`. No `<select>`, `<input type="range">`, `<input type="checkbox">` or native `<button>` outside the components folder. A test greps the rendered app for those tags.
- [x] Layout: a 56 px tool rail on the far left with icons and key hints, the left panel for storeys, rooms, zones, location, settings, the viewport, the right panel with tabs, and a mono status line at the bottom. Storey list drawn as a stacked section, active storey filled.
- [x] Viewport chrome: room labels, dimension labels, measure labels and the compass use the new tokens and fonts, and read on both grounds.
- [x] Print view and states (empty, WebGL, narrow) restyled with the same tokens.
- [x] `INFO.md` design section rewritten to the new palette and type, `DECISIONS.md` entry for the change of direction.
- [x] `npm run check` green, App tests updated.
- [ ] A screenshot of light and dark for the README, taken by Adilzhan, and a visual pass over every panel in both themes.

## 17. Interface, second pass

Adilzhan's review of the redesign. Every item here overrules or refines section 16.

- [x] Fully rounded elements: buttons, inputs, selects, segments and chips are pills; panels and dialogs have large rounded corners. Radius tokens only, no per-component values.
- [x] Numbers stop using a mono font. Pick a clean geometric sans with tabular figures that is not Inter (Manrope), use it for body text and every measurement. Archivo stays for headings. Fonts bundled locally, old ones removed.
- [x] The tool rail floats centred at the bottom of the viewport like Figma's toolbar: horizontal, pill shaped, shadowed, over the scene.
- [x] Left and right panels float over the scene with a margin, fully rounded corners and a soft shadow. The viewport fills the window behind them.
- [x] Everything in the side panels gets bigger: base type 15 px, controls 40 px tall, wider panels, more padding. Nothing below 13 px.
- [x] No uppercase anywhere. Section titles, tabs and chips read as written: "Zones", not "ZONES". A test checks no element carries the uppercase class.
- [x] Left panel navigation: an icon strip inside the panel switches between Storeys (with rooms), Zones, Location, Underlay and Settings. One section visible at a time, no long scroll. Each icon has a label tooltip and the active one is filled. Keyboard: arrow keys move between sections.
- [x] Custom cursor set drawn as SVG in the Figma style (black arrow with a white outline) and applied through CSS variables: default, pointer for anything clickable, text for inputs, grab and grabbing on the canvas, crosshair for the drawing tools, horizontal resize for label scrubbing and slider thumbs, not-allowed for disabled controls. Hotspots set per cursor. Test: every cursor is valid SVG with a hotspot inside its box, and the canvas cursor changes with the active tool.
- [x] Component tests and App tests updated, `npm run check` green, `DECISIONS.md` entry.

## 18. Print view as a German building document

- [x] The print view drops the interface design entirely: no rounded corners, no shadows, no pills, plain Arial or Helvetica, black rules, A4 page breaks. It follows the visual language of German building documents (Energieausweis, iSFP): numbered grey field boxes, a plain data table, the A+ to H scale with kWh/(m²·a) ticks and a marker.
- [x] It states clearly that it is not an official Energieausweis and that the calculation is simplified.
- [x] German conventions for every number regardless of UI language: comma decimal, point thousands, `dd.mm.yyyy`, 24 hour time `18:04`, units `m²`, `kWh/(m²·a)`, `W/(m²·K)`.
- [x] Sections: Gebäude (data fields), Energetische Kennwerte with current and renovated markers on the scale, Bauteile (U, A, U·A per element type), one plan and room table per storey, footer with method and assumptions.
- [x] Test: the rendered print view contains no rounded classes, shows a 24 hour time and a German date, and one section per storey.

## 19. Map underlay

Goal: when a location is set, the ground shows the real surroundings from OpenStreetMap, at true scale and rotated with the plan, so "place the building on the map" is visible.

- [x] `src/geometry/tiles.ts`, pure: Web Mercator slippy tile maths. Lat/lon to tile x, y at a zoom, tile to its lat/lon corners, metres per pixel at a latitude, and the list of tiles covering a radius around a point. Tests against known tile numbers for Berlin and the equator, round trip, and the covering set size.
- [x] Tile corners are projected into plan coordinates through the existing UTM origin, so the tiles land at true scale and follow the plan rotation. Over a few hundred metres the Mercator to UTM mismatch is below a centimetre; documented in the code.
- [x] `src/scene/MapUnderlay.tsx`: one quad per tile textured with the OSM raster tile, zoom 19, under the grid and the slab, not raycast, faded to the underlay opacity. Tiles load with `crossOrigin` and fail silently.
- [x] Store: `showMap` and `mapOpacity` as UI state, persisted with the other view settings. Default on when a location is set.
- [x] Location section: switch for the map and an opacity slider; the grid switch stays.
- [x] Attribution: "© OpenStreetMap contributors" with a link, drawn in the viewport corner whenever a tile is visible. Required by the OSM tile usage policy.
- [x] `INFO.md`: the external request rule gets its one exception, OSM tiles when the map is on, and the print view never includes tiles.
- [x] Tests: tile maths, App test that the switch appears with a location and the attribution renders when on.

## Phase 3

The roadmap from the Phase 3 artifact, ranked by what it proves. Same rules: every geometry function pure and tested first, one commit per task, human review of the result, `DECISIONS.md` for every overrule. Sections 20 to 23 change what the project is, 24 to 27 deepen what exists, 28 to 31 are polish that gets noticed.

## 20. Wall construction layers

Goal: a wall is no longer one U-value but a stack of layers, the way an energy consultant describes it. Answers building physics and BIM domain knowledge.

- [x] Data model: `Layer { id, name, thickness, conductivity }` in metres and W/(m·K); `Construction` gains `layers?: Layer[]` and keeps `uValue` as the computed result. Presets get real layer stacks: brick wall 1900 (plaster 15 mm, brick 380 mm, plaster 15 mm), 1970s wall (plaster, aerated concrete 240 mm, render), insulated wall (plaster, brick 240 mm, EPS 160 mm, render), and matching roof and floor stacks. Conductivities from DIN 4108-4 values, sourced in a comment.
- [x] `src/geometry/layers.ts`: `uValueFromLayers(layers, rsi, rse)` with R = rsi + Σ d/λ + rse, rsi 0.13 and rse 0.04 for walls, 0.10 and 0.04 for roofs, 0.17 and 0.00 for ground floors. Total thickness. Tests against hand-computed cases: the brick wall preset gives about 1.4, the insulated preset about 0.20, a single layer of 1 m at λ 1 gives 1/(1 + 0.17).
- [x] Migration: a construction without layers keeps its typed U-value; a construction with layers recomputes U on every layer edit. Import validates thickness > 0 and conductivity > 0.
- [x] The exterior wall thickness follows the wall construction's total layer thickness when layers exist; the global thickness setting becomes the fallback for constructions without layers. Rooms and openings adjust, tests for the derived thickness.
- [x] Layer editor in the Energy tab: add, remove, reorder layers, edit name, thickness in mm and conductivity, the U-value updating live. Own components only.
- [x] Cross-section drawing: an SVG of the wall from outside to inside with each layer as a band at true relative thickness, hatched per material class (masonry, insulation, plaster), labelled with thickness and λ. Shown in the layer editor and in the print view under Bauteile.
- [x] IFC: IfcMaterialLayerSet with one IfcMaterialLayer per layer (material name, LayerThickness), IfcMaterialLayerSetUsage on each wall, and IfcMaterial with Pset_MaterialThermal ThermalConductivity. Validated with the IfcOpenShell script; entity counts tested.
- [x] Print view: the Bauteile table lists layers per construction with d, λ, R and the resulting U.
- [x] i18n: Schicht, Dicke, Wärmeleitfähigkeit, Wärmedurchlasswiderstand, Aufbau von außen nach innen.

## 21. Thermal bridges

Goal: the extra heat loss at edges and corners, computed from lengths the geometry already knows. Answers building physics.

- [x] `src/geometry/bridges.ts`, pure: extracts linear thermal bridges per storey: outer corners (footprint vertices), window and door perimeters (2 × (w + h) per opening), floor slab edge on the ground storey (footprint perimeter), roof edge on the top storey (perimeter), intermediate floor edges between storeys (perimeter per joint), interior wall to exterior wall junctions (one per interior wall end touching the footprint). Each with a type, a length and the world segment to draw.
- [x] Psi values per type with a source comment: the DIN 4108 Beiblatt 2 reference values as the "good detail" set (corner 0.05, window 0.04, slab edge 0.10, roof edge 0.10, intermediate floor 0.05, junction 0.03 W/(m·K)) and a "poor detail" set for uninsulated stock (0.15, 0.20, 0.50, 0.30, 0.20, 0.10). The set is a building setting; the renovated scenario switches to the good set.
- [x] Tests: the default rectangle has 4 corners of 3 m, a perimeter of 36 m for slab and roof, and each window adds exactly 2(w + h); a two storey building adds one intermediate floor joint; an interior wall touching two exterior walls adds two junctions; total ΔH_T = Σ ψ × l matches a hand-computed value.
- [x] Energy: H_T gains the bridge term Σ ψ × l, shown as its own line and as a share of the total in the Energy tab and in the print view.
- [x] Scene: bridges drawn as thin red lines on the model when a "Thermal bridges" view switch is on, line width by ψ × l, hover shows type and W/K in a label.
- [x] Bauteile table in the print view gets a Wärmebrücken block with type, length, ψ and ψ × l.
- [x] i18n: Wärmebrücke, längenbezogener Wärmedurchgangskoeffizient, Gebäudeecke, Fensteranschluss, Sockel, Traufe, Geschossdecke.

## 22. Roof shapes

Goal: a house reads as a house, and the roof area feeds the heat loss. Answers element types and geometry.

- [x] Data model: `Roof { kind: "flat" | "gable" | "hip"; pitch: number; overhang: number; ridgeAxis: "x" | "y"; parapet?: number }` on the building; default flat with 0.3 m parapet.
- [x] `src/geometry/roof.ts`, pure, for rectangular and general convex footprints: gable roof as two planes meeting at a ridge along the chosen axis, hip roof as the straight skeleton of the footprint (implement for convex polygons, fall back to gable for concave with a documented limitation), flat roof as a slab with parapet. Output: roof faces as 3D polygons in metres, ridge and eave lines, true surface area, enclosed attic volume.
- [x] Tests: gable on the 10 by 8 rectangle at 40 degrees gives two faces of equal area, surface area equals footprint area divided by cos(pitch) plus overhang strips, eave height equals storey top, ridge height equals half span times tan(pitch); hip roof faces sum to the same area as the gable for a square; flat roof area equals footprint area.
- [x] Scene: roof faces as meshes in a roof colour, underside not rendered, eave overhang visible, opacity follows the top storey. Clicking the roof selects it.
- [x] Properties: kind as segmented control, pitch and overhang as number inputs with live update, ridge axis toggle.
- [x] Energy: roof area in the envelope uses the true sloped area for gable and hip; the attic counts as unheated (no volume added) unless a "heated attic" switch is on.
- [x] IFC: IfcRoof with IfcSlab members of PredefinedType ROOF, one per face, as IfcFacetedBrep or extruded solids; ridge height exported in Pset_RoofCommon (TotalArea, ProjectedArea).
- [x] Print view plan gets the ridge line and the roof kind in the building fields.
- [x] i18n: Flachdach, Satteldach, Walmdach, Dachneigung, Dachüberstand, Firstrichtung, Attika.

## 23. Footprint from a photo

Goal: drop a floor plan scan and get a proposed footprint and interior walls. Answers the computer vision bullet, which has nothing behind it yet.

- [x] Pipeline in `src/geometry/vision/`, pure over pixel arrays so it runs in a worker and in tests: greyscale, adaptive threshold, morphological close, connected components, then wall line detection with a probabilistic Hough transform restricted to horizontal and vertical lines, merging of collinear segments, snapping to a detected grid pitch.
- [x] Outer boundary: the largest closed loop of detected lines becomes the footprint proposal; inner lines that touch the boundary or each other become interior wall proposals. Output is in image pixels with a confidence per segment.
- [x] Scale: the user marks one known distance on the image (reuse the underlay scale flow) or types the paper scale (1:100 at a given DPI); pixels convert to metres and snap to the 0.5 m grid.
- [x] Tests on synthetic plans rendered in the test: a drawn rectangle with two interior lines is recovered within one pixel; a rotated scan (2 degrees) is deskewed first and still recovered; noise speckles do not create walls.
- [x] Worker: the pipeline runs in a Web Worker so the interface stays responsive on a 4000 px scan; progress reported.
- [x] Review step in the interface: proposed lines drawn over the underlay in the selection colour, each toggleable, a confidence filter slider, "Accept" replaces the footprint and interior walls in one undo step.
- [ ] Stretch: a small ONNX segmentation model for walls in the browser through onnxruntime-web, behind a feature flag, compared against the classical pipeline on the test plans. Only if the classical result is not good enough on real scans.
- [x] `DECISIONS.md` entry on classical CV versus a model and what real scans broke.

## 24. HVAC as elements

Goal: the element type the posting lists and the demo left out. Answers "new element types".

- [x] Data model: `Radiator { id, storeyId, wallIndex, offset, width, height, power }`, `HeatPump { position, power, kind: "air" | "ground" }` outside the footprint, `PipeRun { storeyId, points }` on the grid. Stored on the building, validated on import (a radiator stays on its wall and never overlaps an opening).
- [x] Sizing: room heat load from the energy layer (transmission plus ventilation for that room at the design temperature difference, Berlin −12 °C outdoor) suggests a radiator power; the heat pump power suggests itself from the building heat load with a safety factor. Pure functions, tested.
- [x] Scene: radiators as slabs on the inner wall face under windows, heat pump as a box outside, pipes as lines on the floor. Selectable, with properties.
- [x] Tool: an HVAC tool (key 7) that places a radiator on a wall click, a heat pump on a ground click outside the footprint, and pipe runs by clicking grid points.
- [x] Energy tab: heat load per room versus installed radiator power, flagged when under 90 percent.
- [x] IFC: IfcSpaceHeater (radiators), IfcUnitaryEquipment (heat pump), IfcPipeSegment for runs, with Pset_SpaceHeaterTypeCommon OutputCapacity. Validated.
- [x] i18n: Heizkörper, Wärmepumpe, Rohrleitung, Heizlast, Auslegungstemperatur.

## 25. Sun and shading

Goal: a real sun over the georeferenced model and solar gains in the energy balance. Answers physics and 3D.

- [x] `src/geometry/sun.ts`, pure: solar position (azimuth, elevation) from date, time and lat/lon using the NOAA algorithm; tests against published values for Berlin on 21 June noon and 21 December noon, sunrise and sunset within 2 minutes.
- [x] Scene: a directional light follows the sun, shadows on facades and ground, a date and time slider in the View section, a small sun path arc drawn over the model for the chosen day.
- [x] Solar gains: monthly irradiation on vertical surfaces per orientation for Berlin (DIN V 18599-10 table values, sourced), window area by orientation times g-value 0.6 times a frame factor 0.7 times a shading factor 0.9; annual gains subtracted from the heating demand with a utilisation factor of 0.95. Tests: a south window adds more than a north window; the demand never goes below zero.
- [x] Energy tab: gains as a separate line, before and after, and the class recomputed.
- [x] i18n: Sonnenstand, solare Gewinne, Einstrahlung, Uhrzeit.

## 26. IFC import

Goal: read an IFC file from another tool into Bauwerk. Answers export fidelity and reverse engineering.

- [x] `src/geometry/step-parse.ts`: STEP tokenizer and entity parser (ids, types, attributes, typed values, lists, X2 strings), tested on the files the exporter writes and on hand-written edge cases.
- [x] `src/geometry/ifc-import.ts`: walk IfcProject to storeys, read IfcBuildingStorey elevations, walls with IfcExtrudedAreaSolid over polyline profiles, openings via IfcRelVoidsElement, windows and doors via IfcRelFillsElement with OverallWidth and OverallHeight, spaces as rooms, zones via IfcRelAssignsToGroup, Pset ThermalTransmittance into constructions, IfcMapConversion into the origin.
- [x] Reduction to the editor's model: the footprint is the union outline of exterior walls (outer faces), interior walls become centre lines, room polygons are recomputed by the editor rather than trusted. Everything the model cannot hold (curved walls, sloped walls, non-rectangular openings) is listed in an import report shown to the user, not silently dropped.
- [x] Tests: export then import of the two example buildings gives an equal building up to ids; a file with a curved wall imports the rest and reports the wall; a file from another tool (a small sample checked into `docs/`) imports its storeys and walls.
- [x] Import button accepts `.ifc`, shows the report, loads on confirm.
- [x] `DECISIONS.md` entry on what was reduced and why.

## 27. Renovation scenarios as saved variants

Goal: the iSFP roadmap as named variants side by side. Answers product thinking.

- [x] Data model: `Scenario { id, name, constructionOverrides: Record<targetKey, constructionId>, bridgeSet, roof?, cost }` on the building; the current state is the baseline, variants are overrides only, so a change to the baseline flows into every variant.
- [x] Costs: a rough €/m² per construction preset (sourced from a public cost index, named in a comment), so each variant reports an investment; saving per year from the heating demand difference at a set energy price; payback in years.
- [x] Energy: `computeEnergy(building, { scenario })` applies the overrides; tests that the baseline variant equals the current result and that "windows only" changes only window terms.
- [x] Interface: a Scenarios tab with a table of variants (class, demand, saving, investment, payback), add, rename, duplicate, delete, and a per-variant construction picker. The old renovated switch becomes the built-in "full envelope" variant.
- [x] Print view: a Sanierungsfahrplan page with the variants as steps in order of payback, the way the iSFP shows them.
- [x] Export: scenarios in the JSON and, as IfcPropertySets on the building, in the IFC.
- [x] i18n: Sanierungsvariante, Investition, Einsparung pro Jahr, Amortisation, Maßnahmenpaket.

## 28. Section cut

- [x] A clipping plane through the model: a switch in the View section, a slider for the cut height and a segmented control for the cut axis (horizontal, along x, along y); Three.js clipping planes on every material, cap faces drawn in the mark colour so cut walls read as solid.
- [x] Rooms stay labelled in the cut view; the plan view reuses the horizontal cut at eye height.
- [x] Test: the clipping plane constant follows the slider value and the storey elevation.

## 29. Walkthrough camera

- [x] First person mode: a camera at 1.6 m above the active storey floor, WASD and arrow keys to move, mouse look with pointer lock, collision with exterior and interior walls, doors passable, stairs not modelled so PageUp and PageDown teleport between storeys.
- [x] Enter and exit through a View switch and the Escape key; the orbit camera position is restored on exit.
- [x] Test: the collision helper keeps a point inside the footprint and outside interior wall thickness, and lets it through a door span.

## 30. PDF report

- [x] Server endpoint `POST /reports/:projectId` renders the print view to PDF with headless Chromium (Playwright) on the server, vector plans, A4, file name from the building and date. Attribution and disclaimer included.
- [x] Client: a "Download PDF" button next to Print when the server is configured; the browser print path stays for local use.
- [x] Test: the endpoint returns a PDF whose first page contains the building name (checked with pdf-parse).

## 31. Performance page

- [x] A benchmark route `?bench=1` that loads a fifty storey, twenty openings per storey building, shows a frame time graph over ten seconds, draw calls and triangle count from the renderer info, and a paragraph on the memoisation strategy (geometry per element by input hash, merged prisms per wall, throttled hover).
- [ ] Instanced interior walls and merged room fills per storey if the benchmark falls below 60 fps on the RTX 5070 or 30 fps on integrated graphics.
- [ ] The numbers from Adilzhan's machine written into the README.

## 32. Other storeys display

- [x] View setting for storeys above the active one: hidden, outline, ghost (default outline, the Revit halftone underlay / ArchiCAD ghost story idea)
- [x] View setting for storeys below: outline, ghost, solid (default ghost)
- [x] Ghost opacity slider, default 15 % instead of the fixed 25 %
- [x] Outline mode draws wall and slab edges only, no fills, no raycast
- [x] Pure helper `storeyDisplay` with tests, UI strings in both languages
- [x] Roof display switch: hidden, outline, ghost, solid (default outline, a selected roof is always solid)
- [ ] Manual check: two storeys, ground floor active, rooms and windows readable

## 33. Openings in interior walls

- [x] Opening model: `interior` flag makes `wallIndex` point at the storey's interior walls
- [x] Interior walls drawn as prisms with holes, same solids code as exterior walls
- [x] Opening tool on an interior wall adds a door, Shift adds a window
- [x] Validation, JSON round trip, overlap check per wall kind, removal renumbers openings
- [x] Energy, IFC, bridges and HVAC ignore interior openings, walkthrough passes through interior doors
- [x] Opening editor and print plan handle interior openings
- [ ] Manual check: door between two rooms, walk through it

## 34. Formula audit

- [x] Heating period method per DIN V 4108-6: 66 kKh, internal gains 22 kWh/(m²a), 0.95 utilisation
- [x] Temperature correction factors: floor slab 0.6, walls to unheated rooms 0.5, in energy and heat load
- [x] Berlin design outdoor temperature −14 °C after DIN EN 12831 Beiblatt 1
- [x] Preset layer stacks aligned with IWU typology U-values, typed fallbacks match
- [x] Assumption texts and print method text describe what is computed, class caveat added
- [x] Plausibility run: uninsulated house 252 kWh/(m²a), renovated 47, heat load 145 W/m²

## 35. Interview day (picked by the user on 2026-09-06, in this order)

- [x] GEG check: compare every construction with the GEG reference building, pass/fail in Energy panel and report
- [x] Demo project "Altbau Kreuzberg" loadable from examples, plus DEMO.md eight-minute script
- [x] README with numbers, the audit story and how to run
- [x] Energieausweis scale graphic in the Energy panel and the report
- [x] Renovation roadmap in iSFP style: ordered steps, demand after each, cumulative cost, print page
- [x] Keyboard and accessibility pass

## 36. Building placement, creation and naming

- [x] Move tool: drag the full building over the grid, hold Shift to rotate, keep the map origin fixed, show live centre coordinates, and record one undo step per gesture.
- [x] New building dialog: create a named rectangular building from width, depth, storey count, storey height, roof kind and construction era. Keep the existing map origin and make creation one undo step.
- [x] Building properties: edit the name, width and depth when the footprint is rectangular. Preserve the centre and rotation, clamp openings to the resized walls, and recompute rooms.
- [x] Show the building name over the model, allow direct renaming, use it in the Storeys heading and keep the browser tab title current.
- [ ] Manual check: create a building, resize it, move it, rotate it, rename it and undo each operation.

## 37. Complete document language switching

- [x] Translate every known generated and example name when the interface language changes: building, storeys, rooms, zones, constructions, material layers and renovation scenarios.
- [x] Preserve names entered by the user and translate known names in both directions.
- [x] Keep restored, imported, synchronized and undo history snapshots in the active language.
- [x] Test the German print route with the Altbau Kreuzberg example and reject its English model names.
- [ ] Manual check: switch Altbau Kreuzberg to German, open Print and inspect every page.

## 38. Building name chip

- [x] Keep the floating building name on one line and let the chip grow with its text up to a safe maximum width.
- [x] Truncate unusually long custom names inside the chip while keeping the complete accessible name and rename tooltip.
- [x] Test the long German Altbau name against the bounded single-line chip contract.
- [ ] Manual check: load Altbau Kreuzberg in German and inspect the name chip at normal and narrow viewport sizes.

## 39. Readable energy efficiency scale

- [x] Restore the scenario selector after the user's clarification showed it was not the reported problem.
- [x] Give the Energy panel scale its own larger proportions while leaving the print scale unchanged.
- [x] Increase the colored band, class letters, marker label and tick labels together.
- [x] Test the panel view box and band height in both current and renovated views.
- [ ] Manual check: inspect the Energy efficiency class scale at the normal panel width.

## 40. Very large example building

- [x] Add a bilingual large office tower to Load example: 18 storeys, 36 by 24 m, 162 named rooms and 719 openings.
- [x] Give it office and service-core zones, modern constructions, a flat roof and complete energy assignments.
- [x] Refit the camera whenever a different building is loaded so the full tower is visible at once.
- [x] Translate its building, storey, room and zone names when the language changes.
- [x] Validate both languages and test its dimensions, totals and Load example path.
- [ ] Manual check: load the large office tower and inspect orbiting, storey selection and frame rate.
