# Deploying Bauwerk

One small server runs everything except the Supabase database and SAM 3 (TODO Parts 5 and 20).
Four containers from `deploy/docker-compose.yml`:

| Service    | What                                                       | Reachable                   |
| ---------- | ---------------------------------------------------------- | --------------------------- |
| `web`      | Caddy: HTTPS, the built app, and the reverse proxy below   | ports 80 and 443            |
| `lod2-api` | LoD2 tiles, building detail, search (`/api`)               | only through `web`          |
| `server`   | collaboration server, REST and Socket.IO (`/collab`)       | only through `web`          |
| `postgis`  | LoD2 data, and the app database until it moves to Supabase | only on the compose network |

Secrets live in `deploy/.env` on the server (ignored by git). `deploy/.env.example` lists every
variable.

## First time

1. **Server.** In the Hetzner console: a CX22 with Ubuntu 24.04, IPv4 and IPv6, your SSH key.
   Paste `deploy/cloud-init.yaml` into "Cloud config" after putting your public key into it
   (`cat ~/.ssh/id_ed25519.pub`). After a few minutes: `ssh deploy@<ipv4>`, and `docker ps`
   works without sudo. Check `sudo ufw status` shows 22, 80 and 443 only.
2. **Domain.** At the registrar: an `A` record for the domain to the server's IPv4 and an `AAAA`
   record to its IPv6, TTL 300. Wait until `dig +short <domain>` on your PC shows the IPv4.
3. **Code.** On the server, a read-only deploy key for the private repository:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/github -N "" && cat ~/.ssh/github.pub
   # GitHub, bauwerk-20grad, Settings, Deploy keys, Add, paste, leave "write" off
   printf 'Host github.com\n  IdentityFile ~/.ssh/github\n' >> ~/.ssh/config
   git clone git@github.com:adilzhanY/bauwerk-20grad.git /srv/bauwerk
   ```
4. **Settings.** `cp deploy/.env.example deploy/.env`, fill in `DOMAIN` and
   `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and `AUTH_SECRET` (`openssl rand -base64 48`),
   then `chmod 600 deploy/.env`. Without `AUTH_SECRET` the server refuses to start unless
   `ACCOUNTS=off` says to run without accounts.
5. **Start.**
   ```bash
   cd /srv/bauwerk
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
   The first build takes a few minutes. `lod2-api` restarts until step 6 has loaded its data;
   that is expected.
6. **LoD2 data.** On your PC, dump the local database and copy it over:
   ```bash
   docker exec lod2-challenge-postgis pg_dump -U lod2 -d lod2 -Fc -f /tmp/lod2.dump
   docker cp lod2-challenge-postgis:/tmp/lod2.dump ./lod2.dump      # about 170 MB
   scp lod2.dump deploy@<ipv4>:/srv/bauwerk/
   ```
   On the server:
   ```bash
   cd /srv/bauwerk
   C=$(docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps -q postgis)
   docker cp lod2.dump $C:/tmp/lod2.dump
   docker exec $C pg_restore -U lod2 -d lod2 --no-owner --exit-on-error /tmp/lod2.dump
   docker exec $C psql -U lod2 -d lod2 -tAc "select count(*) from building"   # same as on the PC
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env restart lod2-api
   ```
   Delete `lod2.dump` from the server afterwards; the backups below keep this data.
7. **Check** from the phone on mobile data: `https://<domain>`, a building search, the building
   page, the editor, Share, and a second device opening the link and editing live.

## The database and accounts on Supabase

Supabase is only the Postgres database. Accounts are Bauwerk's own (username and password,
checked by the `server` container), so nothing in Supabase Auth is used or needs setting up,
and the browser never talks to Supabase. Everything lives in the schema `app`: users, projects,
their history, members and pictures, and each user's settings, bookmarks, notes and surveys.
The server creates and updates the tables itself on start (`server/migrations/`).

1. **Project.** supabase.com, New project, the free plan, region Frankfurt (`eu-central-1`).
   Generate a long database password and keep it in the password manager. A free project
   pauses after a week without use: open the dashboard the day before a demo.
2. **Connection string.** Connect (top of the dashboard), "Session pooler" (it works over IPv4,
   port 5432; the "Direct connection" host `db.<ref>.supabase.co` has only an IPv6 address on
   the free plan and cannot be reached from a network without IPv6). Take the host exactly as
   the dialog shows it: projects live on `aws-0-...` or `aws-1-...` poolers. Copy the URI, it looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
   and put the database password in place of `[YOUR-PASSWORD]` (characters such as `@`, `:`
   or `/` in it must be written `%40`, `%3A`, `%2F`). That is `BAUWERK_DATABASE_URL`.
3. **Certificate.** Database, Settings, SSL Configuration, "Download certificate". Its whole
   text goes into `DATABASE_CA_CERT` (in double quotes, line breaks as `\n`), or, on this PC,
   the path to the file. The server then checks Supabase's certificate instead of trusting it.
4. **Keep the tables private.** Project Settings, Data API: `app` must not be among the exposed
   schemas (by default only `public` and `graphql_public` are). The migrations also revoke
   every right of Supabase's `anon` and `authenticated` roles and turn on row level security
   without policies, so the public API key reaches nothing.
5. **Secret.** `AUTH_SECRET`, at least 32 characters: `openssl rand -base64 48`. Changing it
   later signs everybody out.
6. **Start.** In `deploy/.env`: `BAUWERK_DATABASE_URL`, `DATABASE_CA_CERT`, `AUTH_SECRET`, and
   no `ACCOUNTS=off`. Then `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d server`.
   `docker compose logs -f server` shows the migrations running once.
7. **Check.** In the Supabase Table Editor choose the schema `app`: `users`, `projects`,
   `project_events`, `project_members`, `project_photos`, `user_settings`, `user_bookmarks`,
   `user_buildings`, `schema_migrations`. Create an account in the app: its row in `users` has
   the names and a `scrypt$...` hash, never the password.

The same database from this PC, before deploying:

```bash
BAUWERK_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' \
DATABASE_CA_CERT=/path/to/prod-ca-2021.crt npm run dev
```

## Every update

```bash
cd /srv/bauwerk && git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker builder prune -f --filter until=168h && docker image prune -f
```

The last line drops the build cache older than a week and the images the new build replaced;
without it every deploy leaves a few hundred MB behind (5.8 GB after 11 days).

This restarts the collaboration server whenever the app's code changed (its image carries the
shared code), which takes about 15 seconds; saves in that time are tried again for about 17
seconds. A change to the app only can keep the server running:
`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --no-deps web`.

## Backups

This PC pulls them from the server every night, so a copy lives off the server
(`deploy/pc/backup.sh`, run by `bauwerk-backup.timer`):

- the app database (schema `app`: accounts, projects, their history) every night, with
  `pg_dump -Fc -n app` from the postgis container against `BAUWERK_DATABASE_URL` of the server's
  `deploy/.env` (or the local `bauwerk` database when that is empty). The address is never
  printed. The last 7 are kept.
- the LoD2 database (about 3.6 GB in Postgres) once its newest copy is a week old, with
  `pg_dump -Fc` in the postgis container. The last 4 are kept.

They land in `~/backups/bauwerk/` as `app-<date>-<time>.dump` and `lod2-<date>-<time>.dump`,
readable by this user only. A dump is written to a `.part` name and renamed only when it
succeeded; a failed one leaves the older copies alone and fails the unit
(`systemctl --user status bauwerk-backup`, `journalctl --user -u bauwerk-backup`). It needs
`ssh deploy@138.199.213.29` to work without a password prompt (the key `~/.ssh/id_ed25519`).

Install once on this PC:

```bash
systemctl --user link ~/dev/bauwerk/deploy/pc/bauwerk-backup.service
systemctl --user enable --now ~/dev/bauwerk/deploy/pc/bauwerk-backup.timer
systemctl --user start bauwerk-backup     # the first run now: both dumps, a few minutes
ls -lh ~/backups/bauwerk/
```

`deploy/pc/backup.sh app` or `deploy/pc/backup.sh lod2` makes one of them right away.

Restore. Look inside a dump first with `pg_restore -l <file>`. The app database, into Supabase
(or any Postgres; the server's own migrations are part of the dump):

```bash
pg_restore --no-owner --no-acl --clean --if-exists -n app -d "$BAUWERK_DATABASE_URL" app-<date>-<time>.dump
```

The LoD2 database, on the server, as in step 6 of "First time":

```bash
scp ~/backups/bauwerk/lod2-<date>-<time>.dump deploy@138.199.213.29:/srv/bauwerk/lod2.dump
# on the server
cd /srv/bauwerk
C=$(docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps -q postgis)
docker cp lod2.dump $C:/tmp/lod2.dump
docker exec $C pg_restore -U lod2 -d lod2 --no-owner --clean --if-exists /tmp/lod2.dump
docker exec $C rm /tmp/lod2.dump && rm lod2.dump
docker compose -f deploy/docker-compose.yml --env-file deploy/.env restart lod2-api
```

`/srv/bauwerk/lod2.dump` from the first load is still on the server and out of date; once the
first LoD2 backup is here it can be deleted (`rm /srv/bauwerk/lod2.dump`).

## When something is wrong

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps        # health of each
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f server
curl -s https://<domain>/api/health; curl -s https://<domain>/collab/health
```

No certificate: the DNS records do not point at the server yet, or ports 80 and 443 are closed.
Caddy retries by itself once they do.

## Trying it on a laptop first

The same stack runs locally over plain HTTP. In `deploy/.env` set `DOMAIN=:80`,
`HTTP_PORT=8088`, `HTTPS_PORT=8448`, start it as above, restore the dump as in step 6, and open
`http://localhost:8088`. This is how the setup was tested before the first deploy.

## SAM 3 on a rented graphics card (presentation day)

The server has no graphics card. For the rehearsal and the presentation, rent one by the hour
(for example a community RTX 3090 or 4090 on RunPod or Vast.ai), and stop it afterwards.

1. Start an instance with CUDA 12.8 (a PyTorch template), at least 8 GB of graphics memory, and
   expose HTTP port 8790. Note the https address the provider gives that port.
2. On the instance, as in `lod2/lod2-vision/README.md`:
   ```bash
   # from your PC first: scp -r -P <port> lod2/lod2-vision root@<instance>:~/lod2-vision
   cd ~/lod2-vision   # only this folder is needed; the private repository stays private
   uv venv --python 3.12 .venv
   uv pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128
   git clone https://github.com/facebookresearch/sam3.git .sam3 && git -C .sam3 checkout 660a5e9
   uv pip install ./.sam3 && uv pip install -r requirements.txt
   export HF_TOKEN=<your token> VISION_KEY=$(openssl rand -hex 24) LOD2_VISION_HOST=0.0.0.0
   .venv/bin/python server.py      # the first start downloads the model, about 3.4 GB
   ```
   Keep the printed `VISION_KEY`. Without it the service refuses to listen beyond the instance.
3. On the server, in `deploy/.env`: `VISION_URL=https://<the provider's address>` and the same
   `VISION_KEY`, then `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d web`.
4. Check: `curl -s https://<domain>/vision/health` answers, and the photo editor shows "Detect
   openings". Stop the instance after the presentation; the button hides itself again.

Start it an hour before: installing and the first model download take a while.

## From this PC (no server, no rented card)

The whole site can run on the development PC and reach the internet through a Cloudflare
Tunnel: an outgoing connection, so no open ports, no router settings, and the home address
stays hidden. The PC has to stay on.

- `deploy/.env.pc` (ignored by git) overrides `deploy/.env`: Caddy on port 8088 over plain HTTP
  (Cloudflare does the HTTPS), `VISION_URL=https://vision.bauwerk-demo.xyz` and its `VISION_KEY`.
- The tunnel carries `bauwerk-demo.xyz` to `http://localhost:8088` and `vision.bauwerk-demo.xyz`
  to `http://localhost:8790`. The vision service stays on loopback; the key keeps the public
  vision address closed to everyone but the site's proxy.
- Two user services, linked from `deploy/pc/`: `bauwerk-vision` (SAM 3, about 3.5 GB of
  graphics memory) and `bauwerk-tunnel` (cloudflared, settings in `~/.config/bauwerk/tunnel.yml`
  as in the next section, with one more hostname: `<domain>` to `http://localhost:8088`).
  While the tunnel runs, the PC does not suspend when idle. `npm run dev` uses the running
  vision service instead of starting a second one.

Start or update the site, then the services:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --env-file deploy/.env.pc up -d --build
systemctl --user enable --now bauwerk-vision bauwerk-tunnel
```

The containers and both services come back by themselves after a restart. Check:
`curl -s https://bauwerk-demo.xyz/vision/health`. Stop hosting with
`systemctl --user disable --now bauwerk-tunnel bauwerk-vision`.

## Website on a server, AI on this PC

The site stays up day and night on the small server (everything above), while SAM 3 and the
floor plan reading run on this PC's graphics card and reach the server through a Cloudflare
Tunnel. When the PC is off, the site keeps working and every AI button says so: "The AI runs on
Adil's PC, which is turned off right now."

1. The tunnel, from this PC: `cloudflared tunnel login` (pick the domain in the browser), then

   ```bash
   cloudflared tunnel create bauwerk-pc
   cloudflared tunnel route dns bauwerk-pc vision.<domain>
   cloudflared tunnel route dns bauwerk-pc plans.<domain>
   ```

   and `~/.config/bauwerk/tunnel.yml` with the tunnel's id, its credentials file and the two
   hostnames: `vision.<domain>` to `http://127.0.0.1:8790`, `plans.<domain>` to
   `http://127.0.0.1:8791`, anything else `http_status:404`.

2. `deploy/.env.pc` on this PC (ignored by git): `VISION_KEY=<a long random string>`. Both
   services refuse every request without it, so the public tunnel addresses are closed to all
   but the server.
3. On the server, `deploy/.env`: `VISION_URL=https://vision.<domain>`,
   `FLOORPLAN_URL=https://plans.<domain>`, the same `VISION_KEY`, and `AI_HOST=Adil's PC`, then
   `docker compose -f deploy/docker-compose.yml up -d --build` (the name is baked into the app).
4. On this PC, once:

```bash
ln -s ~/dev/bauwerk/deploy/pc/bauwerk-{vision,floorplan,tunnel}.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bauwerk-vision bauwerk-floorplan bauwerk-tunnel
```

Only signed in people reach the AI: Caddy asks the collaboration server about the request's
token before it passes anything on (`signed_in` in the Caddyfile).

One AI job at a time: both services take turns on the card in one line (`gpu_queue.py`, a folder
of ticket files both read), first come first served, so a plan waits behind someone's photo and
the other way round, and the waiting person sees how many jobs are ahead. An upload returns at
once (202) and the browser asks every second for its place and collects the answer when it is
done, so no request waits in line: Cloudflare cuts any request after 100 seconds. A job whose
browser stopped asking is dropped when its turn comes; more than 12 waiting jobs and new ones are
turned away.
