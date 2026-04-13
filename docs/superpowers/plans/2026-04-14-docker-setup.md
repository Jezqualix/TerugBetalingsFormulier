# Docker deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containeriseer de bestaande Node.js Express applicatie zodat deze op een Linux Docker host te starten is via `docker compose up -d`, zonder ingrepen in de applicatiecode behalve een minimale `/health` liveness endpoint.

**Architecture:** Single-service `docker compose` stack gebouwd uit een `node:20-alpine` image. SQL Server en SMTP relay blijven extern; secrets via `env_file: .env.local`; uploads via bind mount naar `/opt/terugbetalingsformulier/uploads`; hostname-naar-IP mapping voor de DB volledig via env-var substitution zodat `docker-compose.yml` niet per host gewijzigd hoeft te worden.

**Tech Stack:** Docker Engine ≥ 24, Docker Compose v2, `node:20-alpine`, bestaande Express app, Jest + supertest voor de `/health` test.

**Spec:** `docs/superpowers/specs/2026-04-14-docker-setup-design.md`

---

## File Structure

Nieuwe bestanden:

| Pad | Verantwoordelijkheid |
|---|---|
| `__tests__/routes/health.test.js` | Unit test voor `/health` endpoint (supertest) |
| `Dockerfile` | Build-recept voor de image (single-stage, non-root) |
| `.dockerignore` | Build-context uitsluitingen (secrets, tests, docs, node_modules) |
| `docker-compose.yml` | Service-definitie (ports, env_file, volumes, healthcheck, extra_hosts) |
| `docs/deploy-docker.md` | Deployment guide analoog aan `deploy-iis.md` / `deploy-nginx.md` |

Wijzigingen aan bestaande bestanden:

| Pad | Wijziging |
|---|---|
| `src/server.js` | `/health` route toevoegen vóór statische files en API routers |
| `.env.example` | Nieuwe optionele vars `DB_HOSTNAME`, `DB_HOST_IP` + toelichting |
| `CLAUDE.md` | Docker als derde deployment-optie vermelden in de Deployment-sectie |

---

## Task 1: `/health` endpoint met TDD

**Files:**
- Create: `__tests__/routes/health.test.js`
- Modify: `src/server.js` (nieuwe route toevoegen na regel 37, vóór `/api/csrf-token` op regel 40)

- [ ] **Step 1.1: Schrijf de falende test**

Maak `__tests__/routes/health.test.js`:

```js
// __tests__/routes/health.test.js
const request = require('supertest');
const app = require('../../src/server');

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not require authentication', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('responds to plain HTTP with no CSRF token', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
```

Deze test heeft **geen** `jest.mock()` van `../../src/config/db` nodig: `db.js` gebruikt een lazy `getPool()` die pas connecteert bij de eerste aanroep. Het `/health` endpoint raakt de DB niet, dus simpelweg `require('../../src/server')` triggert geen connectie.

- [ ] **Step 1.2: Run de test en verifieer dat hij faalt**

Run:
```bash
npx jest __tests__/routes/health.test.js
```

Expected: **FAIL** — drie tests falen met status `404` (route bestaat nog niet).

- [ ] **Step 1.3: Voeg de `/health` route toe aan `src/server.js`**

Open `src/server.js`. Zoek de regel:

```js
app.use(express.urlencoded({ extended: false }));
```

Voeg direct daarna, vóór de `/api/csrf-token` handler, deze regel toe:

```js
// Health check for Docker / monitoring — pure liveness, no DB ping
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
```

Het resultaat van regels 35-42 moet er dan zo uitzien:

```js
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check for Docker / monitoring — pure liveness, no DB ping
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// CSRF token endpoint (must come before static files so it's served as API)
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});
```

**Waarom deze plek:** vóór de statische files (anders zou Express proberen `public/health` te serveren), vóór de API routers (anders zou een rate limiter of CSRF middleware van een router de health check kunnen raken), en na de body parsers (niet strikt nodig maar consistent met bestaande stijl).

- [ ] **Step 1.4: Run de test en verifieer dat hij slaagt**

Run:
```bash
npx jest __tests__/routes/health.test.js
```

Expected: **PASS** — 3 tests passed.

- [ ] **Step 1.5: Run de volledige test suite om regressies uit te sluiten**

Run:
```bash
npm test
```

Expected: **PASS** — 47 tests passed, 9 suites. (Bestaand: 44 tests / 8 suites, plus 3 nieuwe tests in de nieuwe suite.)

- [ ] **Step 1.6: Commit**

```bash
git add __tests__/routes/health.test.js src/server.js
git commit -m "feat: add /health liveness endpoint for Docker healthcheck"
```

---

## Task 2: `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 2.1: Maak `.dockerignore` in de repo root**

Inhoud:

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

**Waarom elke regel:**

- `node_modules` — image installeert vers via `npm ci`, host-modules zijn voor andere architectuur en formaat.
- `.git`, `.gitignore` — versiehistorie hoort niet in een runtime image.
- `.env`, `.env.local`, `.env.*.local` — secrets. **Kritisch** — deze regel is de reden dat we geen credentials in de image hebben. Secrets komen runtime via `env_file:` in compose.
- `uploads` — host-specifieke runtime data, wordt via bind mount gemount.
- `__tests__`, `coverage` — tests en coverage rapporten draaien op dev machines, niet in productie.
- `docs`, `*.md` — documentatie hoort niet in een runtime image.
- `scripts` — dev/ops scripts zoals `scripts/mail-test.js` bevatten mogelijk referenties naar interne infrastructuur.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` — build context artefacten, irrelevant binnen de image zelf.

- [ ] **Step 2.2: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore excluding secrets and test artifacts"
```

---

## Task 3: `Dockerfile`

**Files:**
- Create: `Dockerfile`

- [ ] **Step 3.1: Maak `Dockerfile` in de repo root**

Inhoud:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install prod dependencies first (separate layer for caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src ./src
COPY public ./public
COPY migrations ./migrations

# Uploads dir exists in image (bind mount overrides it at runtime)
RUN mkdir -p /app/uploads && chown -R node:node /app

# Drop root privileges — node user has uid 1000 in the official image
USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "src/server.js"]
```

**Opmerkingen per regel-blok:**

- `FROM node:20-alpine` — engines veld in package.json vereist `>=20.0.0`. Alpine omdat alle deps pure JS zijn.
- `COPY package.json package-lock.json* ./` — trailing `*` zodat de build niet faalt als `package-lock.json` ooit (nog) niet bestaat, maar de bestaande lock-file wordt wel degelijk meegenomen.
- `npm ci --omit=dev` — gebruikt exact de lock-file, skipt devDependencies (jest, nodemon, supertest).
- `npm cache clean --force` — spaart ~60MB in de image.
- `COPY src ./src` etc. — alleen nodig voor runtime. Let op: géén `COPY . .` — dat zou ondanks `.dockerignore` nog steeds `.env.local` risicovol maken als `.dockerignore` ooit kapotgaat. Expliciete `COPY` per directory is defensiever.
- `mkdir -p /app/uploads` — de Express app faalt bij startup als deze map ontbreekt (`fs.mkdirSync` in `src/routes/submissions.js` vangt dat nu weliswaar op, maar een container die direct klaar staat is sneller dan eentje die eerst een map moet maken).
- `chown -R node:node /app` — zonder dit kan de `node` user geen files in `/app/uploads` schrijven bij starts waar er géén bind mount overheen zit.
- `USER node` — drops root. Alle volgende commando's en de runtime process draaien als uid 1000.
- `ENV NODE_ENV=production` — Express + de meeste libs schakelen dev-features uit.
- `ENV PORT=3004` — expliciet, ook al staat dit ook in `.env.local`. Zorgt dat de image stand-alone start (bv. voor `docker run` zonder compose).
- `EXPOSE 3004` — puur documentatie, Docker opent hierdoor geen poort. De echte mapping gebeurt in `docker-compose.yml`.
- `CMD ["node", "src/server.js"]` — exec form (array), niet shell form. Voordeel: signals (SIGTERM van `docker stop`) komen direct bij node aan en de app kan gracefully shutdown.

- [ ] **Step 3.2: Commit**

```bash
git add Dockerfile
git commit -m "build: add Dockerfile using node:20-alpine as non-root"
```

---

## Task 4: Update `.env.example` met nieuwe vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 4.1: Werk `.env.example` bij**

Huidige inhoud van `.env.example`:

```
PORT=3004

# MS SQL Server
DB_SERVER=
DB_DATABASE=
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=true
# Set to true only for local development with self-signed certificates
DB_TRUST_CERT=false

# SMTP (IP-authenticated — no credentials needed)
SMTP_HOST=
SMTP_PORT=25
SMTP_FROM=
ADMIN_EMAIL=

# Admin dashboard
ADMIN_TOKEN=

# Security (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CSRF_SECRET=
COOKIE_SECRET=

# Storage
UPLOAD_DIR=./uploads
```

Vervang het MS SQL Server blok (regels 3-10) door:

```
# MS SQL Server
DB_SERVER=
DB_DATABASE=
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=true
# Set to true only for local development with self-signed certificates
DB_TRUST_CERT=false

# Optional: hostname → IP mapping for Docker container /etc/hosts.
# Only needed when DB_SERVER is a hostname the container cannot resolve via DNS.
# Leave both empty when DB_SERVER is already an IP or is DNS-resolvable from
# inside the container. See docs/deploy-docker.md for details.
DB_HOSTNAME=
DB_HOST_IP=
```

De rest van het bestand (SMTP, ADMIN_TOKEN, CSRF_SECRET, COOKIE_SECRET, UPLOAD_DIR) blijft onveranderd.

- [ ] **Step 4.2: Commit**

```bash
git add .env.example
git commit -m "config: document DB_HOSTNAME and DB_HOST_IP for Docker extra_hosts"
```

---

## Task 5: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 5.1: Maak `docker-compose.yml` in de repo root**

Inhoud:

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
    extra_hosts:
      - "${DB_HOSTNAME:-sqlserver.invalid}:${DB_HOST_IP:-127.0.0.1}"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3004/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**Opmerkingen per directive:**

- `build: .` — Compose bouwt de image vanuit de huidige directory (gebruikt `Dockerfile`).
- `image: terugbetalingsformulier:latest` — expliciete tag zodat `docker images` een herkenbare naam toont en je later makkelijk een `docker save` / `docker load` kunt doen.
- `container_name: terugbetalingsformulier` — vaste naam in plaats van de compose-auto-naam (`<project>-app-1`). Handiger voor scripts en `docker logs <naam>`.
- `restart: unless-stopped` — container start automatisch bij host reboot én bij crash, maar niet als de gebruiker hem expliciet stopt met `docker stop`.
- `env_file: - .env.local` — compose leest de secrets runtime en injecteert ze als env-vars in de container. Secrets staan dus op disk in `.env.local`, nooit in het image.
- `ports: "127.0.0.1:3004:3004"` — bind aan localhost. Reverse proxy op de host doet TLS-terminatie en forwardt naar `localhost:3004`. Wil je de container direct op het netwerk exposeren, wijzig naar `"3004:3004"`.
- `volumes: /opt/terugbetalingsformulier/uploads:/app/uploads` — bind mount. Host-map moet bestaan en hoort uid 1000 (de `node` user in het image) als eigenaar te hebben.
- `extra_hosts: ${DB_HOSTNAME:-sqlserver.invalid}:${DB_HOST_IP:-127.0.0.1}` — dit is de kern van de variabele SQL Server configuratie. Drie scenario's:
  1. `DB_SERVER` is een IP → `DB_HOSTNAME` en `DB_HOST_IP` leeg → extra_hosts entry resolvet naar `sqlserver.invalid → 127.0.0.1` maar wordt nooit opgevraagd omdat de app rechtstreeks op IP connecteert.
  2. `DB_SERVER` is een FQDN die via interne DNS resolvet → `DB_HOSTNAME` en `DB_HOST_IP` leeg → idem, extra_hosts entry dummy.
  3. `DB_SERVER` is een hostname die alleen via Windows DNS bekend is → vul `DB_HOSTNAME=<zelfde hostname>` en `DB_HOST_IP=<IP>` in → compose injecteert de regel in `/etc/hosts` van de container.
  Het `.invalid` TLD is RFC 2606 gereserveerd en resolvet gegarandeerd nooit naar iets echts.
- `healthcheck.test: wget -qO-` — `wget` zit standaard in `node:20-alpine`, `curl` niet. `-q` stil, `-O-` naar stdout. Exit code bepaalt health.
- `healthcheck.interval 30s` — elke 30 seconden een check.
- `healthcheck.timeout 5s` — na 5 seconden geen response is de check gefaald.
- `healthcheck.retries 3` — pas na 3 opeenvolgende failures wordt de status `unhealthy`.
- `healthcheck.start_period 10s` — de eerste 10 seconden worden failures niet meegeteld (opstart-periode waarin node + Express nog aan het initialiseren zijn).

- [ ] **Step 5.2: Commit**

```bash
git add docker-compose.yml
git commit -m "build: add docker-compose.yml with env-var driven extra_hosts"
```

---

## Task 6: Functionele verificatie op een Docker host

**Files:** Geen wijzigingen — dit is een verificatietaak. Geen commit.

Uit te voeren op een Linux host met Docker Engine ≥ 24 en Docker Compose v2. Als je geen Linux Docker host bij de hand hebt, mag deze taak verschoven worden naar het moment van eerste deployment (in dat geval leveren de stappen van `docs/deploy-docker.md` in Task 7 de verificatie).

- [ ] **Step 6.1: Zorg voor een geldig `.env.local` en host-directory**

```bash
cd /opt/terugbetalingsformulier   # of waar je de repo clonet
test -f .env.local || cp .env.example .env.local
# Vul in .env.local alle DB_*, SMTP_*, ADMIN_TOKEN, CSRF_SECRET, COOKIE_SECRET
sudo mkdir -p /opt/terugbetalingsformulier/uploads
sudo chown 1000:1000 /opt/terugbetalingsformulier/uploads
```

- [ ] **Step 6.2: Build de image**

```bash
docker compose build
```

Expected: laatste regel `=> => naming to docker.io/library/terugbetalingsformulier:latest`, geen errors.

- [ ] **Step 6.3: Start de container**

```bash
docker compose up -d
```

Expected: `✔ Container terugbetalingsformulier  Started`.

- [ ] **Step 6.4: Verifieer health endpoint direct bereikbaar**

Wacht ~15 seconden (de `start_period` in healthcheck) en run:

```bash
curl -s http://127.0.0.1:3004/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 6.5: Verifieer Docker-healthcheck status**

```bash
docker compose ps
```

Expected: kolom `STATUS` toont `Up X seconds (healthy)`. Het kan ~40 seconden duren (één interval na `start_period`) voor `(healthy)` verschijnt.

Als de status `(unhealthy)` toont:
```bash
docker inspect terugbetalingsformulier --format '{{json .State.Health}}' | jq
```

- [ ] **Step 6.6: Verifieer container draait als non-root**

```bash
docker compose exec app id
```

Expected: `uid=1000(node) gid=1000(node) groups=1000(node)`.

- [ ] **Step 6.7: Verifieer `.env.local` NIET in de image**

```bash
docker run --rm --entrypoint sh terugbetalingsformulier:latest -c 'ls -la /app/.env* 2>/dev/null || echo "no env files"'
```

Expected: `no env files`.

- [ ] **Step 6.8: Verifieer uploads bind mount werkt**

```bash
docker compose exec app touch /app/uploads/test.txt
ls -la /opt/terugbetalingsformulier/uploads/test.txt
```

Expected: het bestand is zichtbaar op de host, met owner uid 1000.

```bash
rm /opt/terugbetalingsformulier/uploads/test.txt
```

- [ ] **Step 6.9: Verifieer DB connectiviteit (end-to-end)**

Vul een echte submission in via `http://127.0.0.1:3004` (of via reverse proxy) en check of record + upload persistent blijven na:

```bash
docker compose down
docker compose up -d
```

Record moet nog in SQL Server staan, upload moet nog in `/opt/terugbetalingsformulier/uploads/`.

- [ ] **Step 6.10: Rond functionele verificatie af**

Als alle checks slagen: klaar voor Task 7. Als er issues zijn, documenteer ze en los op voor je verder gaat — Task 7's deployment guide moet reëel werkende stappen bevatten.

---

## Task 7: Deployment guide `docs/deploy-docker.md`

**Files:**
- Create: `docs/deploy-docker.md`

- [ ] **Step 7.1: Maak `docs/deploy-docker.md`**

Inhoud (analoog aan de stijl van `docs/deploy-nginx.md`):

````markdown
# Deployment: Linux + Docker

Deze guide beschrijft hoe je de TerugBetalingsFormulier applicatie deployt op een Linux Docker host via `docker compose`.

## Prerequisites

- Linux host (Debian, Ubuntu, RHEL, of vergelijkbaar)
- Docker Engine ≥ 24 (`docker --version`)
- Docker Compose plugin v2 (`docker compose version`)
- Netwerktoegang vanaf de host naar:
  - De MS SQL Server (TCP 1433 of jullie ingestelde poort)
  - De SMTP relay (TCP 25 of jullie ingestelde poort)
- Een werkende MS SQL Server database (niet gecontaineriseerd door deze stack) met de migrations al uitgevoerd — zie `migrations/001_initial.sql` t/m `003_onkosten_proplanner.sql`

## 1. Eenmalige setup

```bash
# Clone de repo
sudo git clone <repo-url> /opt/terugbetalingsformulier
cd /opt/terugbetalingsformulier

# Maak de uploads directory aan met de juiste owner
sudo mkdir -p /opt/terugbetalingsformulier/uploads
sudo chown 1000:1000 /opt/terugbetalingsformulier/uploads

# Maak de env file
sudo cp .env.example .env.local
sudo chmod 600 .env.local
sudo vi .env.local
```

Vul in `.env.local` minimaal in:

```
PORT=3004

DB_SERVER=<IP of hostname van SQL Server>
DB_DATABASE=<database naam>
DB_USER=<SQL user>
DB_PASSWORD=<SQL password>
DB_ENCRYPT=true
DB_TRUST_CERT=true

# Alleen invullen als DB_SERVER een hostname is die de container niet kan resolven:
DB_HOSTNAME=
DB_HOST_IP=

SMTP_HOST=<SMTP relay IP of hostname>
SMTP_PORT=25
SMTP_FROM=<from adres>
ADMIN_EMAIL=<ontvanger admin notificaties>

ADMIN_TOKEN=<genereer met: openssl rand -hex 32>
CSRF_SECRET=<genereer met: openssl rand -hex 32>
COOKIE_SECRET=<genereer met: openssl rand -hex 32>

UPLOAD_DIR=./uploads
```

## 2. DB_SERVER hostname resolution

De container draait op een eigen network namespace en erft niet automatisch `/etc/hosts` van de host. Drie scenario's:

**Scenario A — `DB_SERVER` is een IP-adres:**
```
DB_SERVER=10.20.30.40
DB_HOSTNAME=
DB_HOST_IP=
```
Werkt direct, geen verdere actie nodig.

**Scenario B — `DB_SERVER` is een FQDN die via interne DNS resolveert:**
```
DB_SERVER=sql.internal.dockx.be
DB_HOSTNAME=
DB_HOST_IP=
```
Werkt als de Docker host een DNS resolver heeft die de FQDN kent (meestal het geval voor hosts die al in jullie AD/DNS zitten).

**Scenario C — `DB_SERVER` is een korte hostname die alleen via WINS/NetBIOS bekend is:**
```
DB_SERVER=vw-2025-dev-1
DB_HOSTNAME=vw-2025-dev-1
DB_HOST_IP=10.20.30.40
```
De compose file injecteert dit als `/etc/hosts` regel in de container.

## 3. Build en start

```bash
cd /opt/terugbetalingsformulier
docker compose up -d --build
docker compose logs -f app
```

## 4. Verifiëren

```bash
# Container draait en is healthy
docker compose ps

# Health endpoint reageert
curl -s http://127.0.0.1:3004/health
# → {"status":"ok"}

# Applicatie is bereikbaar
curl -I http://127.0.0.1:3004/
# → HTTP/1.1 200 OK
```

## 5. Reverse proxy (optioneel)

De compose file bindt aan `127.0.0.1:3004`. Voor publieke toegang moet een reverse proxy op dezelfde host TLS doen en forwarden. Nginx voorbeeld:

```nginx
server {
    listen 443 ssl http2;
    server_name terugbetalingsformulier.example.com;

    ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3004;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Zie `docs/deploy-nginx.md` voor de volledige Nginx configuratie — de reverse proxy kant is identiek.

## 6. Updates uitvoeren

```bash
cd /opt/terugbetalingsformulier
git pull
docker compose up -d --build
```

De `--build` flag zorgt dat code-wijzigingen in een nieuwe image terechtkomen. De container wordt automatisch opnieuw aangemaakt met de nieuwe image.

## 7. Database migrations

De Docker container voert **geen** migrations uit. Nieuwe migraties draai je handmatig via SSMS of `sqlcmd` vanaf de Windows kant, of vanaf een Linux host met `sqlcmd` geïnstalleerd:

```bash
sqlcmd -S $DB_SERVER -d $DB_DATABASE -U $DB_USER -P $DB_PASSWORD \
  -i migrations/004_jouw_migration.sql
```

## 8. Logs & diagnose

```bash
# Live tail logs
docker compose logs -f app

# Laatste 200 regels
docker compose logs --tail=200 app

# Health check details
docker inspect terugbetalingsformulier --format '{{json .State.Health}}'

# Shell in de container
docker compose exec app sh

# Check welke user draait
docker compose exec app id
# → uid=1000(node) gid=1000(node)

# Check env vars binnen de container (secrets zichtbaar — pas op)
docker compose exec app env
```

## 9. Backup

**Uploads:**
```bash
tar -czf uploads-$(date +%Y%m%d).tar.gz /opt/terugbetalingsformulier/uploads
```

**Database:** via SQL Server's eigen backup mechanismen, niet via deze compose stack.

**Env/config:**
```bash
cp /opt/terugbetalingsformulier/.env.local /secure/location/env-backup-$(date +%Y%m%d)
```

## 10. Troubleshooting

**Container start maar `curl /health` geeft `Connection refused`:**
- Check `docker compose logs app` voor Node startup errors.
- Controleer of `PORT=3004` in `.env.local` staat en niet overschreven is.

**Container is `unhealthy`:**
```bash
docker inspect terugbetalingsformulier --format '{{json .State.Health}}' | jq
```
De `Log` array toont de laatste healthcheck outputs.

**DB connect error `ConnectionError: Login failed for user`:**
- Als `DB_TRUST_CERT=false` staat en de SQL Server een self-signed cert heeft, faalt de TLS-handshake met een misleidende "Login failed" error. Zet `DB_TRUST_CERT=true`.
- Als `DB_SERVER` een hostname is, check of de container hem kan resolven:
  ```bash
  docker compose exec app nslookup $DB_SERVER
  ```
  Zo niet: vul `DB_HOSTNAME` + `DB_HOST_IP` in (zie sectie 2) en `docker compose up -d` opnieuw.

**Permission denied op `/app/uploads`:**
- De host-map `/opt/terugbetalingsformulier/uploads` moet owner `1000:1000` hebben (matcht de `node` user in het image):
  ```bash
  sudo chown -R 1000:1000 /opt/terugbetalingsformulier/uploads
  ```

**Mails komen niet aan:**
- Zie `scripts/mail-test.js` als stand-alone SMTP test (draai vanaf de host, niet vanuit de container).
- Controleer firewall / routing vanaf de Docker host naar de SMTP relay.

**CSP errors in browser console (`Refused to load ...`):**
- Zie de CSP notities in `CLAUDE.md`. De bestaande `src/server.js` heeft `upgradeInsecureRequests: null` en `'unsafe-eval'` in scriptSrc om Alpine.js en HTTP-achter-reverse-proxy te ondersteunen.

## 11. Verwijderen

```bash
cd /opt/terugbetalingsformulier
docker compose down                 # stop en verwijder container (uploads/env blijven)
docker image rm terugbetalingsformulier:latest
sudo rm -rf /opt/terugbetalingsformulier
```
````

- [ ] **Step 7.2: Commit**

```bash
git add docs/deploy-docker.md
git commit -m "docs: deployment guide for Docker on Linux"
```

---

## Task 8: Update `CLAUDE.md` met Docker als derde deployment optie

**Files:**
- Modify: `CLAUDE.md` (Deployment sectie)

- [ ] **Step 8.1: Zoek de Deployment sectie in `CLAUDE.md`**

Huidige inhoud:

```markdown
## Deployment
- Windows/IIS: NSSM service + IIS ARR reverse proxy. See `docs/deploy-iis.md`.
- Debian/Nginx: systemd unit + Nginx reverse proxy. See `docs/deploy-nginx.md`.
- App runs on port 3004, binds to all interfaces (0.0.0.0).
```

- [ ] **Step 8.2: Vervang de Deployment sectie door:**

```markdown
## Deployment
- Windows/IIS: NSSM service + IIS ARR reverse proxy. See `docs/deploy-iis.md`.
- Debian/Nginx: systemd unit + Nginx reverse proxy. See `docs/deploy-nginx.md`.
- Linux/Docker: `docker compose up -d` using `Dockerfile` + `docker-compose.yml`. See `docs/deploy-docker.md`.
- App runs on port 3004, binds to all interfaces (0.0.0.0).
```

- [ ] **Step 8.3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reference Docker deployment in CLAUDE.md"
```

---

## Self-review checklist

Na afronding van alle taken, verifieer:

- [ ] `npm test` → alle suites groen (44 bestaande + 3 nieuwe = 47 tests).
- [ ] `git log --oneline -8` toont 7 nieuwe commits (task 1 t/m 5, 7, 8 — task 6 heeft geen commit).
- [ ] `.env.local` komt nergens in git voor (`git ls-files | grep env` geeft alleen `.env.example`).
- [ ] Geen hardcoded hostnames of IP-adressen in `Dockerfile` of `docker-compose.yml`.
- [ ] `docs/deploy-docker.md` bestaat en linkt terug naar `CLAUDE.md` en andere deploy docs.
- [ ] Als Task 6 uitgevoerd werd: alle acht verificatie-stappen (6.2–6.9) slagen.

## Acceptance criteria traceability

Per het spec document (`docs/superpowers/specs/2026-04-14-docker-setup-design.md` sectie "Acceptatie criteria"):

| # | Criterium | Verificatie |
|---|---|---|
| 1 | `docker compose up -d --build` start zonder interactieve input | Task 6, Step 6.2 + 6.3 |
| 2 | `curl http://localhost:3004/health` geeft `{"status":"ok"}` | Task 1 (unit test) + Task 6, Step 6.4 |
| 3 | Form submission persisteert + file op host | Task 6, Step 6.9 |
| 4 | `down && up` behoudt uploads en DB state | Task 6, Step 6.9 |
| 5 | `docker compose ps` toont `healthy` na ≥30 sec | Task 6, Step 6.5 |
| 6 | `docker image inspect` toont geen `.env.local` | Task 2 (`.dockerignore`) + Task 6, Step 6.7 |
| 7 | Container draait als uid 1000 | Task 3 (`USER node`) + Task 6, Step 6.6 |
| 8 | `docs/deploy-docker.md` volgt stijl van andere deploy docs | Task 7 |
