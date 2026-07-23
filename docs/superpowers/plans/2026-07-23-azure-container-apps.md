# Azure Container Apps Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De bestaande Express-app deployen als langlopende Azure Container App op het gedeelde `RG_AI`-platform, achter Entra Easy Auth, met Azure SQL, Azure Files voor uploads en smtp2go voor e-mail.

**Architecture:** Codewijzigingen (health-endpoint, smtp2go-auth) eerst via TDD in de bestaande Jest-suite. Daarna deploy-artefacten: `Dockerfile` + `.dockerignore`, Bicep IaC in `infra/` (Container App + user-assigned identity + role assignments + Azure Files storage + Easy Auth authConfig), en deploy-documentatie. Deploy gebeurt handmatig via `az acr build` + `az deployment group create`, analoog aan het bestaande `fuel_automation`-project.

**Tech Stack:** Node.js 22 (alpine), Express, nodemailer, mssql, Jest + supertest, Docker, Azure Container Apps, Azure Container Registry (`dockxaiacr`), Azure Key Vault (`kv-dockx-ai`), Azure SQL (`dockxazsql1`), Azure Files, Bicep, `az` CLI.

## Global Constraints

- Node.js ≥ 20 (image gebruikt `node:22-alpine`).
- Secrets komen **nooit** in de image of in git — runtime via Container App secrets die naar `kv-dockx-ai` verwijzen.
- Container draait als non-root user `node` (uid 1000).
- Gedeeld platform hergebruiken — **niets** van `cae-ai`, `dockxaiacr`, `kv-dockx-ai`, `log-ai` opnieuw aanmaken.
- User-assigned managed identity (géén system-assigned) met AcrPull + Key Vault Secrets User vooraf toegekend.
- KV-secretnamen gebruiken prefix `tbf-`, behalve het gedeelde `mail-pass` (hergebruikt van fuel_automation).
- Alle tests draaien met `npm test` (Jest, `--runInBand`). Bestaande suite: 55 tests groen — moet groen blijven.
- Subscription: `df516a90-771f-4cfb-835c-60248fa83f64`; resourcegroup `RG_AI`; regio West Europe.
- Concrete waarden: `DB_SERVER=dockxazsql1.database.windows.net`, `DB_DATABASE=TerugBetalingsFormulier_DB`, `DB_USER=TerugBetalingsFormulier_RW`, `SMTP_HOST=mail-eu.smtp2go.com`, `SMTP_PORT=2525`, `SMTP_USER=dockxazure`, `SMTP_FROM=terugbetalingsformulier@dockx.be`, `ADMIN_EMAIL=dabi@dockx.be`, `UPLOAD_DIR=/app/uploads`.

---

### Task 1: `/health` liveness endpoint

**Files:**
- Modify: `src/server.js` (voeg route toe vóór de API-routers en static files)
- Test: `__tests__/routes/health.test.js` (nieuw)

**Interfaces:**
- Consumes: het bestaande Express `app` (geëxporteerd uit `src/server.js`).
- Produces: `GET /health` → `200 {"status":"ok"}`, zonder auth/CSRF/rate-limiting. Wordt geconsumeerd door de Container Apps health-probe en door de Easy Auth `excludedPaths`.

- [ ] **Step 1: Write the failing test**

Maak `__tests__/routes/health.test.js`:

```javascript
// __tests__/routes/health.test.js
jest.mock('../../src/config/db');

const request = require('supertest');
const app = require('../../src/server');

describe('GET /health', () => {
  it('returns 200 with status ok and no auth required', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/routes/health.test.js`
Expected: FAIL — `/health` bestaat nog niet, dus static/SPA-fallback geeft 404 (of de test krijgt geen `{status:'ok'}`).

- [ ] **Step 3: Add the endpoint**

In `src/server.js`, direct ná `app.use(express.urlencoded(...))` en vóór de CSRF-token-route / API-routers, toevoegen:

```javascript
// Liveness probe — no DB ping, so a brief SQL hiccup does not kill the container.
// Excluded from Easy Auth so the Container Apps health probe can reach it.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/routes/health.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: alle suites groen (56 tests: 55 bestaande + 1 nieuwe).

- [ ] **Step 6: Commit**

```bash
git add src/server.js __tests__/routes/health.test.js
git commit -m "feat: add /health liveness endpoint for Azure Container Apps"
```

---

### Task 2: smtp2go authentication in mailService

**Files:**
- Modify: `src/services/mailService.js:3-9` (de `createTransport`-config)
- Test: `__tests__/services/mailService.test.js` (uitbreiden)

**Interfaces:**
- Consumes: env-vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- Produces: een nodemailer-transport dat authenticeert met `auth: { user, pass }` (géén `ignoreTLS` meer). `sendAdminNotification` / `sendUserConfirmation` signatures blijven ongewijzigd.

- [ ] **Step 1: Add SMTP_USER/SMTP_PASS to the test setup**

In `__tests__/setup.js`, toevoegen ná de bestaande `SMTP_*` regels:

```javascript
process.env.SMTP_USER = 'test-smtp-user';
process.env.SMTP_PASS = 'test-smtp-pass';
```

- [ ] **Step 2: Write the failing test**

In `__tests__/services/mailService.test.js`, ná de bestaande `jest.mock`/require-regels (de module wordt bij require één keer geladen, dus `createTransport` is dan al aangeroepen), een nieuw describe-blok toevoegen:

```javascript
describe('transport configuration', () => {
  it('configures smtp2go auth from env and does not set ignoreTLS', () => {
    const config = nodemailer.createTransport.mock.calls[0][0];
    expect(config.host).toBe(process.env.SMTP_HOST);
    expect(config.port).toBe(parseInt(process.env.SMTP_PORT, 10));
    expect(config.auth).toEqual({
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    });
    expect(config.ignoreTLS).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/services/mailService.test.js`
Expected: FAIL — de huidige config heeft `ignoreTLS: true` en geen `auth`.

- [ ] **Step 4: Update the transport config**

Vervang in `src/services/mailService.js` het `createTransport`-blok (regels 3-9) door:

```javascript
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '2525', 10),
  secure: false, // 2525/587 → STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/services/mailService.test.js`
Expected: PASS (inclusief de bestaande template- en send-tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: alle suites groen.

- [ ] **Step 7: Commit**

```bash
git add src/services/mailService.js __tests__/services/mailService.test.js __tests__/setup.js
git commit -m "feat: authenticate SMTP via smtp2go credentials instead of IP auth"
```

---

### Task 3: Update `.env.example`

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: niets.
- Produces: gedocumenteerde env-vars die in Task 2 (`SMTP_USER`/`SMTP_PASS`) en bij Azure-deploy (Azure SQL `DB_ENCRYPT`/`DB_TRUST_CERT`) gebruikt worden. Puur documentatie; geen automatische test.

- [ ] **Step 1: Read the current file**

Run: `cat .env.example`
Noteer de bestaande sleutelnamen zodat je niets dupliceert.

- [ ] **Step 2: Add/adjust the SMTP + Azure SQL keys**

Zorg dat `.env.example` deze sleutels bevat (voeg toe wat ontbreekt, laat waarden leeg of met commentaar):

```
# SMTP — smtp2go (authenticated). STARTTLS op poort 2525/587.
SMTP_HOST=mail-eu.smtp2go.com
SMTP_PORT=2525
SMTP_USER=
SMTP_PASS=
SMTP_FROM=terugbetalingsformulier@dockx.be
ADMIN_EMAIL=dabi@dockx.be

# Database
# Lokaal (SQL Server/SQLEXPRESS): DB_ENCRYPT=false, DB_TRUST_CERT=true
# Azure SQL: DB_ENCRYPT=true, DB_TRUST_CERT=false
DB_ENCRYPT=false
DB_TRUST_CERT=true

# Storage — pad waar uploads landen (in de container gemount op /app/uploads)
UPLOAD_DIR=./uploads
```

- [ ] **Step 3: Verify no secret values were committed**

Run: `git diff .env.example`
Expected: alleen sleutelnamen en commentaar, **geen** echte wachtwoorden/tokens.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: document smtp2go and Azure SQL env vars in .env.example"
```

---

### Task 4: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `package.json`, `package-lock.json`, `src/`, `public/`, `migrations/`.
- Produces: een image die `node src/server.js` draait als user `node`, poort 3004, met `/app/uploads` aangemaakt (overschreven door de Azure Files mount in productie). Geconsumeerd door Task 5 (`image`-param) en de `az acr build`-stap in Task 7.

- [ ] **Step 1: Create the Dockerfile**

Maak `Dockerfile`:

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

# Non-root: web-service, dus wél een user.
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Create .dockerignore**

Maak `.dockerignore`:

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

- [ ] **Step 3: Verify a lockfile exists (required by `npm ci`)**

Run: `test -f package-lock.json && echo OK || echo MISSING`
Expected: `OK`. Als `MISSING`: run `npm install` om `package-lock.json` te genereren en commit die apart.

- [ ] **Step 4: Verify the image builds (if Docker is available locally)**

Run: `docker build -t tbf-test . && echo BUILD_OK`
Expected: `BUILD_OK`. Als Docker lokaal niet beschikbaar is op deze host, sla deze stap over — de image wordt in de cloud gebouwd via `az acr build` in Task 7 (dat is de echte build-verificatie).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: containerize app for Azure Container Apps (node:22-alpine, non-root)"
```

---

### Task 5: Bicep infra — Container App, identity, storage, auth

**Files:**
- Create: `infra/terugbetalingsformulier.bicep`
- Create: `infra/terugbetalingsformulier.bicepparam`

**Interfaces:**
- Consumes: bestaande platform-resources `cae-ai` (managed env), `dockxaiacr` (ACR), `kv-dockx-ai` (Key Vault). Params: `environmentId`, `acrName`, `acrLoginServer`, `keyVaultName`, `image`, `tenantId`, `entraClientId`, plus de plaintext env-waarden.
- Produces: resource `Microsoft.App/containerApps@2024-03-01` genaamd `terugbetalingsformulier` met externe ingress op poort 3004, een Azure Files volume op `/app/uploads`, KV-secret-referenties, en een `authConfigs` child voor Entra Easy Auth. Geconsumeerd door de deploy-stap in Task 7.

- [ ] **Step 1: Create the Bicep template**

Maak `infra/terugbetalingsformulier.bicep`:

```bicep
// Container App for TerugBetalingsFormulier on the shared RG_AI platform.
// Web service (not a job): ingress + scale + Azure Files uploads + Entra Easy Auth.

@description('Resource ID of the shared managed environment cae-ai')
param environmentId string
@description('ACR name, e.g. dockxaiacr')
param acrName string
@description('ACR login server, e.g. dockxaiacr.azurecr.io')
param acrLoginServer string
@description('Key Vault name, e.g. kv-dockx-ai')
param keyVaultName string
@description('Full image reference, e.g. dockxaiacr.azurecr.io/terugbetalingsformulier:latest')
param image string
@description('Entra tenant ID (GUID) for Easy Auth issuer')
param tenantId string
@description('Entra app registration client ID (GUID) for Easy Auth')
param entraClientId string

param location string = resourceGroup().location
param dbServer string = 'dockxazsql1.database.windows.net'
param dbDatabase string = 'TerugBetalingsFormulier_DB'
param dbUser string = 'TerugBetalingsFormulier_RW'
param smtpHost string = 'mail-eu.smtp2go.com'
param smtpPort string = '2525'
param smtpUser string = 'dockxazure'
param smtpFrom string = 'terugbetalingsformulier@dockx.be'
param adminEmail string = 'dabi@dockx.be'

var appName = 'terugbetalingsformulier'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'       // AcrPull
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

// --- Existing shared resources (referenced, not created) ---
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}
resource env 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: 'cae-ai'
}

// --- Storage account + file share for uploads ---
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sttbf${uniqueString(resourceGroup().id)}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}
resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-01-01' = {
  parent: storage
  name: 'default'
}
resource uploadsShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: fileService
  name: 'uploads'
  properties: { shareQuota: 100 }
}

// --- Wire the share into the managed environment ---
resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: 'tbf-uploads'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: 'uploads'
      accessMode: 'ReadWrite'
    }
  }
}

// --- User-assigned identity + role assignments (granted BEFORE the app) ---
resource uai 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'uai-${appName}'
  location: location
}
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uai.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uai.id, kvSecretsUserRoleId)
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: uai.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Container App ---
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${uai.id}': {} }
  }
  dependsOn: [ acrPullRole, kvSecretsUserRole ]
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3004
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        { server: acrLoginServer, identity: uai.id }
      ]
      secrets: [
        { name: 'db-password',           keyVaultUrl: '${kv.properties.vaultUri}secrets/tbf-db-password',      identity: uai.id }
        { name: 'smtp-pass',             keyVaultUrl: '${kv.properties.vaultUri}secrets/mail-pass',            identity: uai.id }
        { name: 'admin-token',           keyVaultUrl: '${kv.properties.vaultUri}secrets/tbf-admin-token',      identity: uai.id }
        { name: 'csrf-secret',           keyVaultUrl: '${kv.properties.vaultUri}secrets/tbf-csrf-secret',      identity: uai.id }
        { name: 'cookie-secret',         keyVaultUrl: '${kv.properties.vaultUri}secrets/tbf-cookie-secret',    identity: uai.id }
        { name: 'entra-client-secret',   keyVaultUrl: '${kv.properties.vaultUri}secrets/tbf-entra-client-secret', identity: uai.id }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          volumeMounts: [
            { volumeName: 'uploads-vol', mountPath: '/app/uploads' }
          ]
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3004' }
            { name: 'TZ', value: 'Europe/Brussels' }
            { name: 'DB_SERVER', value: dbServer }
            { name: 'DB_DATABASE', value: dbDatabase }
            { name: 'DB_USER', value: dbUser }
            { name: 'DB_PASSWORD', secretRef: 'db-password' }
            { name: 'DB_ENCRYPT', value: 'true' }
            { name: 'DB_TRUST_CERT', value: 'false' }
            { name: 'SMTP_HOST', value: smtpHost }
            { name: 'SMTP_PORT', value: smtpPort }
            { name: 'SMTP_USER', value: smtpUser }
            { name: 'SMTP_PASS', secretRef: 'smtp-pass' }
            { name: 'SMTP_FROM', value: smtpFrom }
            { name: 'ADMIN_EMAIL', value: adminEmail }
            { name: 'ADMIN_TOKEN', secretRef: 'admin-token' }
            { name: 'CSRF_SECRET', secretRef: 'csrf-secret' }
            { name: 'COOKIE_SECRET', secretRef: 'cookie-secret' }
            { name: 'UPLOAD_DIR', value: '/app/uploads' }
          ]
        }
      ]
      volumes: [
        { name: 'uploads-vol', storageType: 'AzureFile', storageName: 'tbf-uploads' }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// --- Entra Easy Auth ---
// Requires the Entra app registration (entraClientId) and the client secret in
// KV as tbf-entra-client-secret. The app's redirect URI is set on the Entra side
// once the FQDN is known (see infra/README.md).
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: app
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: [ '/health' ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'entra-client-secret'
          openIdIssuer: 'https://login.microsoftonline.com/${tenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [ 'api://${entraClientId}' ]
        }
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
```

- [ ] **Step 2: Create the bicepparam file**

Maak `infra/terugbetalingsformulier.bicepparam`. Vul `entraClientId` en `tenantId` in nadat de Entra app-registratie bestaat (Task 7, stap 1):

```bicep
using './terugbetalingsformulier.bicep'

param environmentId = '/subscriptions/df516a90-771f-4cfb-835c-60248fa83f64/resourceGroups/RG_AI/providers/Microsoft.App/managedEnvironments/cae-ai'
param acrName = 'dockxaiacr'
param acrLoginServer = 'dockxaiacr.azurecr.io'
param keyVaultName = 'kv-dockx-ai'
param image = 'dockxaiacr.azurecr.io/terugbetalingsformulier:latest'

// Vul in na aanmaken van de Entra app-registratie (Task 7):
param entraClientId = '<entra-app-client-id>'
param tenantId = '<entra-tenant-id>'
```

- [ ] **Step 3: Validate the Bicep compiles**

Run: `az bicep build --file infra/terugbetalingsformulier.bicep`
Expected: geen fouten; er verschijnt een `infra/terugbetalingsformulier.json`. Verwijder die gegenereerde JSON weer (`rm infra/terugbetalingsformulier.json`) — enkel de `.bicep`/`.bicepparam` gaan in git.

> Als `az` of de bicep-CLI niet op deze host staat: installeer via `az bicep install`, of sla deze stap over en laat de validatie gebeuren tijdens `az deployment group create` in Task 7 (die valideert het template server-side vóór uitrol).

- [ ] **Step 4: Commit**

```bash
git add infra/terugbetalingsformulier.bicep infra/terugbetalingsformulier.bicepparam
git commit -m "feat: Bicep infra for Azure Container Apps deployment"
```

---

### Task 6: Deploy documentation

**Files:**
- Create: `infra/README.md`
- Create: `infra/HANDLEIDING.md`
- Modify: `CLAUDE.md` (korte "Deployment (Azure)"-sectie + verwijzing)

**Interfaces:**
- Consumes: de bestanden en commando's uit Tasks 1-5.
- Produces: het canonieke deploy-recept dat een operator in Task 7 volgt.

- [ ] **Step 1: Write `infra/README.md`**

Maak `infra/README.md` met exact deze stappen (kort, operationeel):

````markdown
# Deploy — TerugBetalingsFormulier → Azure Container Apps

Hergebruikt het gedeelde platform in `RG_AI` (`cae-ai`, `dockxaiacr`, `kv-dockx-ai`, `log-ai`).
Niets daarvan wordt hier opnieuw aangemaakt.

## 0. Login
```bash
az login
az account set -s df516a90-771f-4cfb-835c-60248fa83f64
```

## 1. Azure SQL: database + user + migraties
- Maak database `TerugBetalingsFormulier_DB` op `dockxazsql1`.
- Maak SQL-user `TerugBetalingsFormulier_RW` met `db_datareader` + `db_datawriter`.
- Draai de migraties:
```bash
for f in migrations/001_initial.sql migrations/002_type_specific_fields.sql migrations/003_onkosten_proplanner.sql; do
  sqlcmd -S dockxazsql1.database.windows.net -d TerugBetalingsFormulier_DB \
    -U TerugBetalingsFormulier_RW -P '<db pw>' -i "$f"
done
```

## 2. Entra app-registratie (Easy Auth)
- Maak een app-registratie (bv. naam `TerugBetalingsFormulier`).
- Noteer **client ID** en **tenant ID** → vul in `infra/terugbetalingsformulier.bicepparam`.
- Maak een client-secret → zet in Key Vault als `tbf-entra-client-secret`.
- De redirect-URI wordt in stap 6 gezet (FQDN is dan pas bekend).

## 3. Secrets in Key Vault (deployer heeft rol *Key Vault Secrets Officer*)
```bash
az keyvault secret set --vault-name kv-dockx-ai -n tbf-db-password        --value '<db pw>'
az keyvault secret set --vault-name kv-dockx-ai -n tbf-admin-token        --value '<admin token>'
az keyvault secret set --vault-name kv-dockx-ai -n tbf-csrf-secret        --value "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
az keyvault secret set --vault-name kv-dockx-ai -n tbf-cookie-secret      --value "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
az keyvault secret set --vault-name kv-dockx-ai -n tbf-entra-client-secret --value '<entra client secret>'
# NB: smtp2go-wachtwoord = bestaand gedeeld secret 'mail-pass' (niet opnieuw zetten).
```

## 4. Image bouwen (ACR Tasks bouwt in de cloud, geen lokale Docker)
```bash
az acr build -r dockxaiacr -t terugbetalingsformulier:latest .
```

## 5. Container App deployen (idempotent; herhaal bij role-propagation lag)
```bash
az deployment group create -g RG_AI \
  -f infra/terugbetalingsformulier.bicep \
  -p infra/terugbetalingsformulier.bicepparam
```

## 6. FQDN + Entra redirect-URI
```bash
FQDN=$(az containerapp show -n terugbetalingsformulier -g RG_AI \
       --query properties.configuration.ingress.fqdn -o tsv)
echo "https://$FQDN/.auth/login/aad/callback"
```
Zet die callback-URL als **Redirect URI (Web)** op de Entra app-registratie.
Redeploy stap 5 als je `entraClientId`/`tenantId` net hebt ingevuld.

## 7. Test
- Open `https://$FQDN` → Entra-login verschijnt.
- `curl https://$FQDN/health` → `{"status":"ok"}` (zonder login).
- Dien een formulier in met bijlage → controleer rij in Azure SQL + file op de `uploads` share + mail via smtp2go.

## Logs (Log Analytics, 1-3 min lag)
```bash
WS=$(az containerapp env show -n cae-ai -g RG_AI \
     --query properties.appLogsConfiguration.logAnalyticsConfiguration.customerId -o tsv)
az monitor log-analytics query -w "$WS" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'terugbetalingsformulier' | project TimeGenerated, Log_s | order by TimeGenerated asc"
```

## Code-wijziging shippen
```bash
az acr build -r dockxaiacr -t terugbetalingsformulier:latest .
az containerapp update -n terugbetalingsformulier -g RG_AI \
  --image dockxaiacr.azurecr.io/terugbetalingsformulier:latest
```
````

- [ ] **Step 2: Write `infra/HANDLEIDING.md`**

Maak `infra/HANDLEIDING.md` — een NL beginnersgids die dezelfde stappen uitlegt met een woordenlijst (container image, ACR, Container App vs Job, Key Vault, managed identity, RBAC, Easy Auth) en een troubleshooting-tabel:

```markdown
# Handleiding — TerugBetalingsFormulier naar Azure (voor beginners)

## Woordenlijst
- **Container image**: ingepakte app + Node.js runtime, gebouwd uit de `Dockerfile`.
- **ACR (dockxaiacr)**: Azure Container Registry — de opslagplaats voor images.
- **Container App**: een langlopende webservice in Azure (i.t.t. een Job, die 1x draait en stopt).
- **Key Vault (kv-dockx-ai)**: kluis voor wachtwoorden/secrets. De app leest ze runtime, ze staan nooit in de code.
- **Managed identity (uai-...)**: een Azure-identiteit voor de app zodat die zonder wachtwoord bij ACR en Key Vault kan.
- **RBAC-rollen**: AcrPull (image ophalen) + Key Vault Secrets User (secrets lezen).
- **Easy Auth**: ingebouwde Entra-login vóór de app; alleen Dockx-accounts komen binnen.

## Volgorde in het kort
1. Database + SQL-user + migraties (stap 1 in README).
2. Entra app-registratie + client-secret in Key Vault (stap 2-3).
3. Overige secrets in Key Vault (stap 3).
4. Image bouwen met `az acr build` (stap 4).
5. Deployen met `az deployment group create` (stap 5).
6. FQDN opvragen, redirect-URI op Entra zetten, opnieuw deployen (stap 6).
7. Testen: login, /health, formulier + bijlage + mail (stap 7).

## Troubleshooting
| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| Deploy faalt op role assignment | RBAC-propagatie loopt achter | Herhaal `az deployment group create` (idempotent). |
| App start maar kan KV-secret niet lezen | UAI mist Key Vault Secrets User | Controleer de role assignment in de Bicep; herdeploy. |
| Login-lus / redirect-fout | Redirect-URI op Entra klopt niet met FQDN | Zet `https://<fqdn>/.auth/login/aad/callback` als Web-redirect. |
| `Login failed for user` op SQL | Verkeerd wachtwoord of user ontbreekt | Controleer `tbf-db-password` + dat de RW-user bestaat op de DB. |
| Uploads verdwijnen na restart | Azure Files mount ontbreekt | Controleer `envStorage` + volume/volumeMount in de Bicep. |
| Mail komt niet aan | smtp2go-auth faalt | Controleer `SMTP_USER=dockxazure` + secret `mail-pass`. |

## Conventies
- Eén ACR, meerdere projecten. Geen admin-account op ACR (pull via managed identity).
- Alles in Bicep, in git. Regio = West Europe.
- Secrets alleen in Key Vault, nooit in git of image.
```

- [ ] **Step 3: Add a short Azure section to `CLAUDE.md`**

Voeg onderaan `CLAUDE.md` toe:

```markdown
## Deployment (Azure Container Apps)
Web-service op het gedeelde RG_AI-platform (cae-ai/dockxaiacr/kv-dockx-ai), achter Entra Easy Auth,
met Azure SQL (dockxazsql1 → TerugBetalingsFormulier_DB), Azure Files voor uploads en smtp2go voor mail.
Handmatige deploy via `az acr build` + `az deployment group create`. Zie `infra/README.md` (recept) en
`infra/HANDLEIDING.md` (NL gids). Ontwerp: `docs/superpowers/specs/2026-07-23-azure-container-apps-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add infra/README.md infra/HANDLEIDING.md CLAUDE.md
git commit -m "docs: Azure Container Apps deploy guide (README + HANDLEIDING)"
```

---

### Task 7: Deploy & verify (operator-run, requires Azure credentials)

> **Niet automatiseerbaar door een subagent** — vereist echte Azure-login, de productiewachtwoorden, en een Entra-app-registratie. Een mens voert dit uit door `infra/README.md` te volgen. Deze taak is de acceptatie-gate.

**Files:** geen (operationeel).

- [ ] **Step 1: Volg `infra/README.md` stappen 0-6** (DB + migraties, Entra app-registratie, secrets, `az acr build`, `az deployment group create`, FQDN + redirect-URI).

- [ ] **Step 2: Verifieer de acceptatiecriteria uit de spec:**
  - `az acr build` en `az deployment group create` slagen zonder interactieve input.
  - De FQDN opent een Entra-login; onauthenticeerde requests worden geredirect.
  - `curl https://<fqdn>/health` → `{"status":"ok"}` zonder login.
  - Formulier-submit met bijlage → rij in `TerugBetalingsFormulier_DB` én file op de Azure Files share `uploads`.
  - Restart / 2e replica behoudt de uploads (gedeelde mount).
  - Bevestigings- + admin-mail via smtp2go (smtp2go-activity + Log Analytics).
  - `az containerapp show` toont `Running`; image bevat geen secrets.
  - Container draait als user `node` (uid 1000): `az containerapp exec -n terugbetalingsformulier -g RG_AI --command "id"`.
  - Admin-dashboard enkel bereikbaar met geldig `ADMIN_TOKEN` (bovenop Entra-login).

---

## Self-Review

**Spec coverage:**
- Beslissing 1 (Azure SQL) → Task 5 env + Task 6 README stap 1 (DB/user/migraties). ✓
- Beslissing 2 (Azure Files) → Task 5 storage + envStorage + volume/volumeMount. ✓
- Beslissing 3 (smtp2go) → Task 2 (code) + Task 5 env (`mail-pass` secretRef). ✓
- Beslissing 4 (Entra Easy Auth) → Task 5 authConfig + Task 6 redirect-URI stap. ✓
- Beslissing 5 (admin-token) → ongewijzigd; Task 5 `admin-token` secretRef; acceptatie in Task 7. ✓
- Beslissing 6 (handmatige deploy) → Task 6 README + Task 7. ✓
- Beslissing 7 (user-assigned identity + roles vooraf) → Task 5 uai + acrPullRole + kvSecretsUserRole + `dependsOn`. ✓
- Beslissing 8 (node:22-alpine) → Task 4 Dockerfile. ✓
- Beslissing 9 (scale min1/max3) → Task 5 scale-blok. ✓
- Codewijziging `/health` → Task 1. ✓
- Codewijziging `mailService` → Task 2. ✓
- `.env.example` → Task 3. ✓
- 6 KV-secrets (waarvan `mail-pass` gedeeld) → Task 5 secrets + Task 6 README stap 3. ✓

**Placeholder scan:** De enige `<...>`-plaatsvervangers zijn echte, per-deploy in te vullen geheimen/ID's (db-wachtwoord, admin-token, entra client-id/secret/tenant) — die horen niet in git en worden in Task 7 door de operator ingevuld. Geen TODO/TBD in code- of Bicep-inhoud.

**Type consistency:** storageName `tbf-uploads` (envStorage-naam) == volume `storageName`. Volume `uploads-vol` == container `volumeMounts.volumeName`. Secret-namen (`db-password`, `smtp-pass`, `admin-token`, `csrf-secret`, `cookie-secret`, `entra-client-secret`) matchen 1-op-1 met de `secretRef`-waarden in `env`. `clientSecretSettingName: 'entra-client-secret'` == secret-naam. Env-varnamen matchen wat de app leest (`src/config/db.js`, `src/services/mailService.js`, `src/middleware/auth.js`, `src/middleware/csrf.js`).
