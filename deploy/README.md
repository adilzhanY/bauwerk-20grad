# Deploying Bauwerk

One small server runs everything except the Supabase database and SAM 3 (TODO Part 5).
Four containers from `deploy/docker-compose.yml`:

| Service    | What                                                     | Reachable                   |
| ---------- | -------------------------------------------------------- | --------------------------- |
| `web`      | Caddy: HTTPS, the built app, and the reverse proxy below | ports 80 and 443            |
| `lod2-api` | LoD2 tiles, building detail, search (`/api`)             | only through `web`          |
| `server`   | collaboration server, REST and Socket.IO (`/collab`)     | only through `web`          |
| `postgis`  | LoD2 data, and the projects until they move to Supabase  | only on the compose network |

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
   `POSTGRES_PASSWORD` (`openssl rand -hex 24`), then `chmod 600 deploy/.env`.
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
   Keep `lod2.dump`: it is the backup of this data.
7. **Check** from the phone on mobile data: `https://<domain>`, a building search, the building
   page, the editor, Share, and a second device opening the link and editing live.

## Every update

```bash
cd /srv/bauwerk && git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

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
