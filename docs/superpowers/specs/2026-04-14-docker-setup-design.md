# Docker deployment voor TerugBetalingsFormulier — design

**Datum:** 2026-04-14
**Status:** Approved, ready for implementation plan
**Scope:** Containeriseren van de bestaande Node.js Express applicatie zodat deze op een Linux Docker host gestart en beheerd kan worden via `docker compose`.

## Context

De TerugBetalingsFormulier applicatie is een Node.js Express monolith (port 3004) die momenteel draait op Windows via IIS + NSSM (zie `docs/deploy-iis.md`) of op Debian via systemd + Nginx (zie `docs/deploy-nginx.md`). De gebruiker wil een derde deployment-optie: containerized op een Linux Docker host.

Externe afhankelijkheden blijven ongewijzigd:

- **MS SQL Server** draait op een Windows host (`vw-2025-dev-1\SQLEXPRESS`) en is bereikbaar over het netwerk. De container verbindt er als externe service mee. SQL Server zelf wordt **niet** gecontaineriseerd.
- **SMTP relay** `81.246.69.24:2525`, plain SMTP, IP-authenticated (`ignoreTLS: true` in `src/services/mailService.js`).
- **Reverse proxy** (TLS-terminatie) wordt geacht op de host zelf te draaien of elders, en valt buiten de scope van deze spec.

## Requirements

1. Eén command start de applicatie: `docker compose up -d`.
2. Secrets komen **niet** in de image — ze worden runtime ingelezen uit `.env.local`.
3. Uploaded files overleven container restarts, rebuilds en image updates.
4. Container draait als non-root gebruiker.
5. `docker ps` en `docker compose ps` tonen daadwerkelijke health, niet alleen process-liveness.
6. Deployment workflow gedocumenteerd in `docs/deploy-docker.md` analoog aan de bestaande IIS/Nginx guides.
7. Geen CI/CD, geen image registry push, geen multi-arch — alleen Linux/amd64 build op de Docker host zelf.

## Architectuur

```
Linux Docker host
  └── docker compose stack "terugbetalingsformulier"
        └── service "app"
              ├── image: gebouwd uit ./Dockerfile (node:20-alpine)
              ├── port: 127.0.0.1:3004 → container:3004
              ├── env_file: .env.local
              ├── volume (bind): /opt/terugbetalingsformulier/uploads → /app/uploads
              ├── restart: unless-stopped
              └── healthcheck: wget http://localhost:3004/health

Externe afhankelijkheden (géén containers)
  ├── MS SQL Server op Windows host vw-2025-dev-1\SQLEXPRESS
  ├── SMTP relay 81.246.69.24:2525
  └── Reverse proxy op dezelfde host (optioneel, bv. Nginx/Traefik → 127.0.0.1:3004)
```

## Design decisions

| # | Keuze | Beslissing | Reden |
|---|---|---|---|
| 1 | SQL Server in/uit container | **Uit** — externe Windows host | Bestaande installatie; geen wens om te migreren |
| 2 | Uploads persistentie | **Bind mount** naar `/opt/terugbetalingsformulier/uploads` | Admins moeten via host-tools bij de files kunnen (backup, forensisch, cleanup) |
| 3 | Dockerfile only vs compose | **Compose** | Past bij bestaande deploy-stijl (systemd/NSSM units); declaratief; makkelijk uit te breiden |
| 4 | Base image | **`node:20-alpine`** | Alle dependencies zijn pure JS → geen musl libc issues. Image is ~130 MB i.p.v. ~240 MB slim. |
| 5 | Healthcheck | **`/health` endpoint + compose healthcheck** | Docker ziet crashes na opstart; herbruikbaar voor externe monitoring |

## Nieuwe bestanden

| Pad | Doel |
|---|---|
| `Dockerfile` | Build-recept voor de image |
| `.dockerignore` | Uitsluitingen uit de build context |
| `docker-compose.yml` | Service-definitie |
| `docs/deploy-docker.md` | Deployment handleiding |

## Codewijziging: `/health` endpoint

Toevoegen aan `src/server.js`, vóór de statische files en vóór de API routers zodat rate limiters / CSRF middleware het niet raken:

```js
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
```

**Bewuste keuze: geen DB-ping.** Een healthcheck die de DB raakt, zou de container omlaag halen als SQL Server kort hikt — terwijl de app zelf prima nog requests kan afhandelen zodra de DB terug is. Deze check is dus pure liveness ("proces leeft, event loop reageert"), niet readiness.

## Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY migrations ./migrations

RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "src/server.js"]
```

**Opmerkingen:**

- Single-stage — er is geen build/transpile stap in deze codebase, multi-stage zou complexiteit zonder winst toevoegen.
- Layer-caching: `package*.json` apart gekopieerd vóór `src/` zodat een code-wijziging zonder dependency-wijziging géén `npm ci` opnieuw triggert.
- `wget` zit standaard in `node:20-alpine`, dus de healthcheck werkt zonder extra install.
- De map `/app/uploads` wordt in de image aangemaakt zodat de container bij een eerste start niet faalt als er (nog) geen bind mount is, maar wordt in productie altijd overschreven door de bind mount.
- De ingebouwde `node` user in het officiële image heeft uid 1000, matcht één-op-één met de standaard eerste Linux user — permissies op de host-kant van de bind mount kunnen simpel gezet worden met `chown 1000:1000`.

## .dockerignore

```
node_modules
.git
.gitignore
.env
.env.local
.env.*.local
uploads
__tests__
coverage
docs
scripts
*.md
Dockerfile
docker-compose.yml
.dockerignore
```

**Kritisch:** `.env.local` is expliciet uitgesloten — secrets komen nooit in de image. Ze worden runtime ingelezen via de `env_file:` directive in compose.

## docker-compose.yml

```yaml
services:
  app:
    build: .
    image: terugbetalingsformulier:latest
    container_name: terugbetalingsformulier
    restart: unless-stopped
    env_file:
      - .env.local
    ports:
      - "127.0.0.1:3004:3004"
    volumes:
      - /opt/terugbetalingsformulier/uploads:/app/uploads
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3004/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**Aandachtspunten:**

- **Port binding `127.0.0.1:3004`** — de container is alleen bereikbaar vanaf de host zelf, bedoeld voor een reverse proxy op dezelfde host die TLS-terminatie doet. Wil je de container direct op het netwerk exposeren (geen reverse proxy), wijzig dit naar `"3004:3004"`.
- **`UPLOAD_DIR` in `.env.local`** moet `./uploads` (default) blijven of niet gezet zijn — dat pad resolved binnen de container naar `/app/uploads`, waar de bind mount op komt.
- **`DB_SERVER` resolveren**: de Windows host heet in `.env.local` nu `vw-2025-dev-1`. Vanuit een Linux container resolvet die naam alleen als er een interne DNS is die hem kent, of als `/etc/hosts` van de host wordt geërfd (niet standaard). Twee oplossingen:
  1. Zet `DB_SERVER` in `.env.local` op het **IP-adres** van de Windows host.
  2. Voeg een `extra_hosts:` blok toe aan compose: `extra_hosts: ["vw-2025-dev-1:192.168.x.x"]`.
- **`DB_TRUST_CERT=true`** blijft nodig (self-signed cert op SQLEXPRESS).
- **SMTP** werkt out-of-the-box — de host `81.246.69.24` is een extern IP.

## Deployment workflow

Nieuwe host:

```bash
git clone <repo-url> /opt/terugbetalingsformulier
cd /opt/terugbetalingsformulier
mkdir -p /opt/terugbetalingsformulier/uploads
chown 1000:1000 /opt/terugbetalingsformulier/uploads
cp .env.example .env.local
vi .env.local        # vul DB_*, SMTP_*, ADMIN_TOKEN, CSRF_SECRET, COOKIE_SECRET

docker compose up -d --build
docker compose logs -f app
```

Update bestaande installatie:

```bash
cd /opt/terugbetalingsformulier
git pull
docker compose up -d --build
```

Stoppen / diagnose:

```bash
docker compose ps               # status + health
docker compose logs -f app      # volg live logs
docker compose down             # stop + verwijder container (uploads/env blijven)
docker compose restart app      # zachte restart
```

## docs/deploy-docker.md — inhoud

Analoog aan `docs/deploy-iis.md` en `docs/deploy-nginx.md`, secties:

1. **Voorwaarden** — Linux host, Docker Engine ≥ 24, Docker Compose plugin, netwerk-toegang tot SQL Server en SMTP relay.
2. **Eenmalige setup** — clone, host-directory, `.env.local` aanmaken, eerste build.
3. **Starten/stoppen** — compose commando's.
4. **Updates** — git pull + rebuild.
5. **Logs & diagnose** — `docker compose logs`, `docker compose exec`, healthcheck uitlezen.
6. **Backup** — uploads directory op host + DB dump via de SQL Server (buiten compose).
7. **Troubleshooting** — `DB_SERVER` resolution, permission errors op uploads bind mount, CSP/proxy gotchas (verwijzen naar bestaande notities).
8. **Verwijderen** — `docker compose down`, image pruning, host-directory cleanup.

## Out of scope

- SQL Server containeriseren (expliciete beslissing, vraag 1).
- Reverse proxy in compose stack (aangenomen extern).
- CI/CD pipeline, image registry, automatische builds.
- Multi-architecture builds (`buildx`) — alleen linux/amd64 volstaat.
- Tests draaien tijdens image build — tests blijven op dev machines via `npm test`.
- Docker secrets / Docker Swarm / Kubernetes — de host is een enkele Docker Engine instance.
- Migratie tool in de image — migrations blijven handmatig via SSMS of `sqlcmd` (zoals nu).

## Acceptatie criteria

1. `docker compose up -d --build` start de applicatie zonder interactieve input.
2. `curl http://localhost:3004/health` geeft `{"status":"ok"}`.
3. Een form submission met bijlage persisteert in SQL Server én de file staat op de host in `/opt/terugbetalingsformulier/uploads/`.
4. `docker compose down && docker compose up -d` behoudt alle uploads en de database-state.
5. `docker compose ps` toont de service als `healthy` na ≥30 seconden.
6. `docker image inspect terugbetalingsformulier:latest` toont géén `.env.local` in de layers.
7. Container draait als user `node` (uid 1000), niet als root — verifieerbaar met `docker compose exec app id`.
8. `docs/deploy-docker.md` bestaat en volgt de stijl van `docs/deploy-iis.md` / `docs/deploy-nginx.md`.
