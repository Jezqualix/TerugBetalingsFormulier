# Azure Container Apps deployment voor TerugBetalingsFormulier — design

**Datum:** 2026-07-23
**Status:** Ready for user review
**Scope:** De bestaande Node.js Express web-applicatie deployen als een langlopende **Azure Container App** op het gedeelde `RG_AI`-platform, achter Microsoft Entra-authenticatie, met Azure SQL als database, Azure Files voor uploads en smtp2go voor e-mail. Deployment gebeurt handmatig via `az` CLI + Bicep, analoog aan het `fuel_automation`-project.

## Context

`TerugBetalingsFormulier` is een Express-monolith (port 3004) die een formulierpagina (NL/FR) en een admin-dashboard serveert, plus een REST-API. De app schrijft geüploade bijlagen naar disk (`multer.diskStorage` → `uploads/`), verstuurt e-mail via een SMTP-relay, en gebruikt MS SQL Server via de `mssql`-driver.

Het `fuel_automation`-project draait al op een gedeeld Azure-platform in resourcegroup **`RG_AI`** (West Europe):

- **`dockxaiacr`** — Azure Container Registry (SKU Basic, `adminUserEnabled: false`, pulls via managed identity)
- **`cae-ai`** — Container Apps managed environment (Consumption, logs → Log Analytics), **geen VNet**
- **`kv-dockx-ai`** — Key Vault (RBAC-authorized)
- **`log-ai`** — Log Analytics workspace
- **`dockxazsql1.database.windows.net`** — Azure SQL server (in aparte RG `RG_Databases`, met firewallregel `AllowAllWindowsAzureIps` aan)
- Subscription: `df516a90-771f-4cfb-835c-60248fa83f64`

Dit ontwerp **hergebruikt** dat platform; er wordt niets van opnieuw aangemaakt.

### Verschillen met fuel_automation

| Aspect | fuel_automation | TerugBetalingsFormulier |
|---|---|---|
| Type | Container Apps **Job** (scheduled, run-to-completion) | Container **App** (langlopende web-service) |
| Netwerk | geen ingress | externe ingress :3004 + TLS |
| Toegang | n.v.t. | **Microsoft Entra Easy Auth** vóór de hele app |
| Opslag | geen | **Azure Files** mount voor uploads |
| Database | Azure SQL (bestaand) | Azure SQL (nieuwe database, zelfde server) |

## Beslissingen

| # | Onderwerp | Beslissing | Reden |
|---|---|---|---|
| 1 | Database | **Azure SQL** op `dockxazsql1`, nieuwe database `TerugBetalingsFormulierDB`, SQL-auth met user `TerugBetalingsFormulier_RW`, wachtwoord uit Key Vault | On-prem `vw-2025-dev-1\SQLEXPRESS` is niet bereikbaar vanuit Azure zonder VNet+VPN. `AllowAllWindowsAzureIps` staat al aan → geen netwerkwerk nodig. Matcht fuel_automation. |
| 2 | Uploads-persistentie | **Azure Files** share gemount op `/app/uploads` | Container Apps-filesystem is ephemeer. Azure Files overleeft restarts en is gedeeld over replicas → minimale codewijziging (multer/files-route blijven diskgebaseerd). |
| 3 | E-mail | **smtp2go met credentials** (`SMTP_USER`/`SMTP_PASS`, wachtwoord uit KV) | Huidige relay `81.246.69.24` is IP-geauthenticeerd; Azure egress-IP is niet gewhitelist en niet stabiel. smtp2go werkt vanaf elke IP. Matcht fuel_automation. |
| 4 | Toegangscontrole | **Entra Easy Auth** (Container Apps built-in auth) vóór de hele app, op `cae-ai` | Formulier mag niet open op publiek internet. Geen codewijziging; werkt op de bestaande consumption-env; ook voor thuiswerkers (i.t.t. VNet-only). |
| 5 | Admin-toegang | **Bestaand `ADMIN_TOKEN`** behouden (uit KV) | Defense-in-depth bovenop Entra; geen extra rol-mapping nodig. |
| 6 | Deploy-mechanisme | **Handmatig** `az acr build` + `az deployment group create` (Bicep) | Geen pipeline-onderhoud; identiek aan fuel_automation. CI/CD kan later. |
| 7 | Managed identity | **User-assigned** (`uai-terugbetalingsformulier`), AcrPull + KV Secrets User vooraf toegekend | System-assigned geeft een provisioning-deadlock (app heeft KV/ACR nodig om te provisionen, maar role assignments kunnen pas ná creatie). Kritisch patroon van fuel_automation. |
| 8 | Base image | **`node:22-alpine`** | Matcht fuel_automation; alle deps zijn pure JS. |
| 9 | Scaling | `minReplicas: 1`, `maxReplicas: 3` | min 1 vermijdt cold-start voor een interactief formulier; Azure Files is gedeeld → multi-replica veilig. |

## Architectuur

```
Dockx-gebruiker (Entra-account)
   │  HTTPS
   ▼
Container Apps ingress (extern, external: true, targetPort 3004, transport auto)
   │  ── Entra Easy Auth: RedirectToLoginPage, /health uitgesloten
   ▼
Container App "terugbetalingsformulier"  (managed env cae-ai, RG_AI)
   ├── image: dockxaiacr.azurecr.io/terugbetalingsformulier:latest
   ├── identity: user-assigned uai-terugbetalingsformulier
   │      ├── AcrPull   (scope = dockxaiacr)
   │      └── Key Vault Secrets User  (scope = kv-dockx-ai)
   ├── secrets (secretRef → kv-dockx-ai via keyVaultUrl + UAI)
   ├── volume: Azure Files share "uploads" → /app/uploads
   ├── scale: min 1 / max 3
   └── resources: 0.5 CPU / 1Gi
        │                                   │
        ▼                                   ▼
   Azure SQL dockxazsql1               smtp2go (mail-eu.smtp2go.com:2525, auth)
   database: TerugBetalingsFormulierDB
   user: TerugBetalingsFormulier_RW
```

## Nieuwe bestanden

| Pad | Doel |
|---|---|
| `Dockerfile` | Build-recept image |
| `.dockerignore` | Uitsluitingen build-context (secrets, tests, docs, node_modules) |
| `infra/terugbetalingsformulier.bicep` | Container App + UAI + role assignments + Azure Files storage-koppeling + Easy Auth authConfig |
| `infra/terugbetalingsformulier.bicepparam` | Parameters die verwijzen naar bestaande platform-resources |
| `infra/README.md` | Deploy-recept (stap-voor-stap) |
| `infra/HANDLEIDING.md` | NL beginnersgids, analoog aan fuel_automation |

## Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Brussels

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY migrations ./migrations

# Non-root: web-service, dus wél een user (i.t.t. de fuel_automation job).
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "src/server.js"]
```

**Opmerkingen:**
- Single-stage — geen transpile-stap in deze codebase.
- Layer-caching: `package*.json` apart gekopieerd vóór `src/`.
- `/app/uploads` wordt aangemaakt zodat een eerste start niet faalt vóór de Azure Files mount actief is; in productie overschrijft de mount dit pad.
- User `node` (uid 1000) — non-root.

## .dockerignore

```
node_modules
.git
.gitignore
.gitattributes
.env
.env.*
*.env
uploads
__tests__
coverage
docs
scripts
deploy
scratchpad
.claude
.remember
*.md
Dockerfile
.dockerignore
```

`.env*` expliciet uitgesloten — secrets komen nooit in de image.

## Codewijzigingen

### 1. `/health` endpoint (`src/server.js`)

Toevoegen vóór de API-routers en static files, zodat rate limiter / CSRF het niet raken:

```js
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
```

Pure liveness (proces leeft, event loop reageert) — **geen DB-ping**, zodat een korte SQL-hik de container niet omlaag haalt. Dit pad wordt in de Easy Auth-config uitgesloten van authenticatie.

### 2. `mailService.js` — smtp2go met auth

Transport wijzigen van IP-auth naar credential-auth:

```js
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '2525', 10),
  secure: false,               // 2525/587 → STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
```

`ignoreTLS` verdwijnt. Nieuwe env-vars: `SMTP_USER`, `SMTP_PASS`. De rest van `mailService.js` (templates, `replyTo`, non-blocking gedrag) blijft ongewijzigd.

### 3. `.env.example` bijwerken

Toevoegen: `SMTP_USER`, `SMTP_PASS`. `DB_ENCRYPT`/`DB_TRUST_CERT` documenteren voor Azure SQL (`true`/`false`). Bestaande waarden voor lokale dev blijven werken.

### Géén wijziging

- **Auth-code** — Easy Auth zit vóór de app; `app.set('trust proxy', 1)` staat al goed voor de ingress.
- **Admin-token** — ongewijzigd, blijft de admin-route beschermen.
- **CSP** — de bestaande helmet-config (met `upgradeInsecureRequests: null`) blijft; assets zijn same-origin over HTTPS en de toegestane CDN's (jsdelivr, Google Fonts) laden over HTTPS.

## Secrets in Key Vault (`kv-dockx-ai`)

Prefix `tbf-` om botsing met fuel_automation-secrets (`db-password`, `mail-pass`, …) te vermijden:

| Secret | Inhoud |
|---|---|
| `tbf-db-password` | wachtwoord van `TerugBetalingsFormulier_RW` |
| `tbf-admin-token` | admin-dashboard token |
| `tbf-csrf-secret` | CSRF-secret (32+ bytes) |
| `tbf-cookie-secret` | cookie-secret (32+ bytes) |
| `tbf-entra-client-secret` | client-secret van de Entra app-registratie (voor Easy Auth) |

Handmatig gezet met `az keyvault secret set`. De deployer heeft de RBAC-rol **Key Vault Secrets Officer** op de vault nodig (RG Owner alleen volstaat niet).

**smtp2go-wachtwoord wordt hergebruikt:** dezelfde smtp2go-account als fuel_automation, dus het bestaande KV-secret **`mail-pass`** wordt gereferenceerd — géén nieuw `tbf-smtp-pass`.

## Env-vars (plaintext, in Bicep `env[]`)

| Var | Waarde |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3004` |
| `TZ` | `Europe/Brussels` |
| `DB_SERVER` | `dockxazsql1.database.windows.net` |
| `DB_DATABASE` | `TerugBetalingsFormulierDB` |
| `DB_USER` | `TerugBetalingsFormulier_RW` |
| `DB_ENCRYPT` | `true` |
| `DB_TRUST_CERT` | `false` |
| `SMTP_HOST` | `mail-eu.smtp2go.com` |
| `SMTP_PORT` | `2525` |
| `SMTP_USER` | `dockxazure` |
| `SMTP_FROM` | `terugbetalingsformulier@dockx.be` |
| `ADMIN_EMAIL` | `dabi@dockx.be` |
| `UPLOAD_DIR` | `/app/uploads` |

Secrets via `secretRef`: `DB_PASSWORD`→`tbf-db-password`, `SMTP_PASS`→`mail-pass` (gedeeld met fuel_automation), `ADMIN_TOKEN`→`tbf-admin-token`, `CSRF_SECRET`→`tbf-csrf-secret`, `COOKIE_SECRET`→`tbf-cookie-secret`.

## Azure Files voor uploads

- **Storage account** (nieuw, in `RG_AI`, bv. `sttbfuploads<suffix>`, Standard LRS) met een **file share** `uploads`.
- Gekoppeld aan de managed environment als named storage (`Microsoft.App/managedEnvironments/storages`, child van `cae-ai`) — additief, raakt fuel_automation niet.
- In de Container App gemount als volume op `/app/uploads` (`storageType: AzureFile`).
- Beheerders kunnen bij de files via de Azure File share (portal, Storage Explorer, of `az storage file`).

## Entra Easy Auth

**Prereq (eenmalig, handmatig):**
1. Entra **app-registratie** aanmaken (bv. `TerugBetalingsFormulier`), redirect-URI `https://<app-fqdn>/.auth/login/aad/callback`.
2. Client-secret genereren → opslaan als KV-secret `tbf-entra-client-secret`.
3. Client-ID en tenant-ID noteren voor de Bicep-params.

Omdat de app-FQDN pas bekend is ná de eerste Container App-deploy, is de volgorde: (a) Container App deployen, (b) FQDN opvragen, (c) app-registratie met die redirect-URI aanmaken/bijwerken, (d) authConfig deployen/activeren.

**authConfig** (Bicep `Microsoft.App/containerApps/authConfigs@2024-03-01`, naam `current`):
- `globalValidation.unauthenticatedClientAction: 'RedirectToLoginPage'`
- `globalValidation.excludedPaths: ['/health']`
- `identityProviders.azureActiveDirectory` met client-ID, `openIdIssuer` (tenant), en de client-secret via `secretRef`.
- `platform.enabled: true`

Alleen accounts uit de Dockx-tenant komen binnen.

## Database-migraties

De 3 bestaande DDL-bestanden één keer tegen Azure SQL draaien:
- `migrations/001_initial.sql`
- `migrations/002_type_specific_fields.sql`
- `migrations/003_onkosten_proplanner.sql`

Uitvoeren via `sqlcmd -S dockxazsql1.database.windows.net -d TerugBetalingsFormulierDB -U TerugBetalingsFormulier_RW -P <pw> -i migrations/00X_*.sql` of via de Azure Portal Query Editor. Eenmalig ook de SQL-user `TerugBetalingsFormulier_RW` aanmaken met lees/schrijfrechten op de database. Gedocumenteerd in `infra/README.md`.

## Deploy-volgorde (handmatig, `az` CLI)

```bash
# 0. Login
az login
az account set -s df516a90-771f-4cfb-835c-60248fa83f64

# 1. Azure SQL: database + RW-user + migraties
#    - create database TerugBetalingsFormulierDB op dockxazsql1
#    - create user TerugBetalingsFormulier_RW (SQL-auth) + db_datareader/db_datawriter
#    - migrations/001,002,003 draaien via sqlcmd of Query Editor

# 2. Secrets in Key Vault (deployer heeft KV Secrets Officer nodig)
# NB: tbf-smtp-pass NIET nodig — smtp2go-wachtwoord staat al in KV als 'mail-pass' (gedeeld).
az keyvault secret set --vault-name kv-dockx-ai -n tbf-db-password    --value '<db pw>'
az keyvault secret set --vault-name kv-dockx-ai -n tbf-admin-token    --value '<admin token>'
az keyvault secret set --vault-name kv-dockx-ai -n tbf-csrf-secret    --value '<csrf>'
az keyvault secret set --vault-name kv-dockx-ai -n tbf-cookie-secret  --value '<cookie>'

# 3. Image bouwen + pushen (ACR Tasks bouwt in de cloud, geen lokale Docker)
az acr build -r dockxaiacr -t terugbetalingsformulier:latest .

# 4. Storage + Container App deployen (idempotent — herhaal bij role-propagation lag)
az deployment group create -g RG_AI \
  -f infra/terugbetalingsformulier.bicep \
  -p infra/terugbetalingsformulier.bicepparam

# 5. FQDN opvragen
az containerapp show -n terugbetalingsformulier -g RG_AI \
  --query properties.configuration.ingress.fqdn -o tsv

# 6. Entra app-registratie met redirect-URI https://<fqdn>/.auth/login/aad/callback
#    client-secret → tbf-entra-client-secret in KV
#    daarna authConfig deployen/activeren (via bicep-param of az containerapp auth)

# 7. Test: open de FQDN → Entra-login → formulier indienen met bijlage
#    controleer: rij in Azure SQL, file op Azure Files share, mail via smtp2go
```

**Logs uitlezen** (Log Analytics, 1-3 min lag):

```bash
WS=$(az containerapp env show -n cae-ai -g RG_AI \
     --query properties.appLogsConfiguration.logAnalyticsConfiguration.customerId -o tsv)
az monitor log-analytics query -w "$WS" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'terugbetalingsformulier' | project TimeGenerated, Log_s | order by TimeGenerated asc"
```

**Code-wijziging shippen:** rebuild + redeploy (de app draait de image, niet de working tree):

```bash
az acr build -r dockxaiacr -t terugbetalingsformulier:latest .
az containerapp update -n terugbetalingsformulier -g RG_AI \
  --image dockxaiacr.azurecr.io/terugbetalingsformulier:latest
```

## Buiten scope

- CI/CD-pipeline (GitHub Actions) — kan later.
- VNet / private endpoint — niet nodig door `AllowAllWindowsAzureIps`.
- Custom domain — de standaard `…azurecontainerapps.io` FQDN volstaat eerst; later toe te voegen.
- Azure Blob Storage voor uploads — Azure Files gekozen.
- SQL Server containeriseren.
- Automatische migratie-runner in de image — migraties blijven handmatig.
- Admin beperken tot Entra-groep — token-aanpak behouden.

## Acceptatiecriteria

1. `az acr build` en `az deployment group create` slagen zonder interactieve input.
2. De app-FQDN opent een **Entra-login**; onauthenticeerde requests worden geredirect.
3. `GET https://<fqdn>/health` geeft `{"status":"ok"}` **zonder** login (excluded path).
4. Na login: een formulier-submit met bijlage persisteert een rij in `TerugBetalingsFormulierDB` én de file staat op de Azure Files share `uploads`.
5. Een container-restart / tweede replica behoudt de uploads (gedeelde Azure Files mount).
6. Bevestigings- en admin-mail worden verstuurd via smtp2go (zichtbaar in smtp2go-activity + Log Analytics).
7. `az containerapp show` toont de app als `Running`; `docker`-image bevat géén `.env`/secrets.
8. De container draait als user `node` (uid 1000), niet als root.
9. Het admin-dashboard blijft enkel bereikbaar met een geldig `ADMIN_TOKEN` (bovenop de Entra-login).
