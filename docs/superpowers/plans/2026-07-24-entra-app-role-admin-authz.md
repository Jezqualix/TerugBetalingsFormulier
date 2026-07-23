# Entra App-Role Admin Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autoriseer het admin-dashboard op basis van een Entra app-rol `Admin` (gelezen uit de Easy Auth `X-MS-CLIENT-PRINCIPAL`-header), met `ADMIN_TOKEN` als break-glass fallback en een tokenloze admin-UI.

**Architecture:** De auth-middleware krijgt twee paden (geldig bearer-token óf `roles`-claim bevat `Admin`). De admin-frontend laat de token-prompt vallen en leunt op de Easy Auth-sessiecookie. De app-rol wordt op de Entra-registratie gedefinieerd en aan individuele gebruikers toegewezen (geen P1 → geen groep-toewijzing). Deploy via image-rebuild + nieuwe revisie.

**Tech Stack:** Node.js/Express, Jest + supertest, Alpine.js frontend, Azure Container Apps Easy Auth, Entra app-rollen, `az` CLI, Bicep.

## Global Constraints

- App-rol `value` = `Admin`; de middleware leest de `roles`-claim uit `X-MS-CLIENT-PRINCIPAL`; rolnaam configureerbaar via `process.env.ADMIN_ROLE` met default `'Admin'`.
- Break-glass: `Authorization: Bearer <ADMIN_TOKEN>` blijft de adminroutes openen (`crypto.timingSafeEqual`, ongewijzigd).
- **Status-semantiek (bestaande tests moeten groen blijven):** géén `X-MS-CLIENT-PRINCIPAL` én geen geldig token → **401**; `X-MS-CLIENT-PRINCIPAL` aanwezig maar geen `Admin`-rol (en geen geldig token) → **403**.
- `roles`-claim kan verschijnen als typ `roles` óf als schema-URI `http://schemas.microsoft.com/ws/2008/06/identity/claims/role` — beide herkennen.
- Tokenloze UI: geen `Authorization`-header, geen `localStorage`, geen token-prompt; same-origin fetches dragen de Easy Auth-cookie automatisch.
- Admin-routes gebruiken **geen** applicatie-CSRF (alleen de publieke form-POST doet dat). Cookie-gebaseerde admin-mutaties zijn beschermd door Easy Auth's ingebouwde anti-CSRF (referer/origin) + SameSite-cookie — voeg dus **geen** `x-csrf-token` toe aan admin-calls.
- Tests draaien via `npm test` (Jest, `--runInBand`); suite is 57 tests, moet groen blijven.
- Vaste waarden: app-registratie clientId `c32a7ac4-b27e-4292-afc4-6f1dc052a5dd`, service principal objectId `01a21c66-18c2-4d33-ba81-73a1fe905973`, FQDN `terugbetalingsformulier.dockx.be`, RG `RG_AI`, container app `terugbetalingsformulier`.

---

### Task 1: Role-based authorization middleware

**Files:**
- Modify: `src/middleware/auth.js` (rename + dual-path logica)
- Modify: `src/routes/admin.js:3` (import `requireAdmin`)
- Modify: `src/routes/files.js:5` (import `requireAdmin`)
- Test: `__tests__/middleware/auth.test.js` (import bijwerken + scenario's toevoegen)

**Interfaces:**
- Consumes: headers `authorization` (bearer) en `x-ms-client-principal` (base64-JSON claims); env `ADMIN_TOKEN`, `ADMIN_ROLE`.
- Produces: `requireAdmin(req,res,next)` en `rolesFromPrincipalHeader(req)` geëxporteerd uit `src/middleware/auth.js`. `requireAdminToken` bestaat niet meer.

- [ ] **Step 1: Update the test file (rename import + add helper + new scenarios)**

Vervang de inhoud van `__tests__/middleware/auth.test.js` door:

```javascript
// __tests__/middleware/auth.test.js
const request = require('supertest');
const express = require('express');

const { requireAdmin } = require('../../src/middleware/auth');

const app = express();
app.get('/protected', requireAdmin, (req, res) => res.json({ ok: true }));

// Build an Easy-Auth-style X-MS-CLIENT-PRINCIPAL header from role claims.
function principal(roles, typ = 'roles') {
  const json = JSON.stringify({ auth_typ: 'aad', claims: roles.map((r) => ({ typ, val: r })) });
  return Buffer.from(json, 'utf8').toString('base64');
}

describe('requireAdmin', () => {
  it('returns 401 with no auth at all', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 with wrong token and no principal', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed header (no Bearer prefix)', async () => {
    const res = await request(app).get('/protected').set('Authorization', process.env.ADMIN_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token (break-glass)', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${process.env.ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 when principal has the Admin role', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', principal(['Admin']));
    expect(res.status).toBe(200);
  });

  it('returns 200 when Admin role uses the full schema-URI typ', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-ms-client-principal', principal(['Admin'], 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'));
    expect(res.status).toBe(200);
  });

  it('returns 403 when principal is present but lacks the Admin role', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', principal(['SomeOtherRole']));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 403 on malformed principal header with no token', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', 'not-base64-json!!');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/middleware/auth.test.js`
Expected: FAIL — `requireAdmin` bestaat nog niet (module exporteert `requireAdminToken`).

- [ ] **Step 3: Rewrite `src/middleware/auth.js`**

```javascript
const crypto = require('crypto');

function tokenValid(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  if (!process.env.ADMIN_TOKEN) return false;
  const tokenBuf = Buffer.from(authHeader.slice(7));
  const secretBuf = Buffer.from(process.env.ADMIN_TOKEN);
  return tokenBuf.length === secretBuf.length && crypto.timingSafeEqual(tokenBuf, secretBuf);
}

// Roles injected by Azure Container Apps Easy Auth via the (trusted, non-spoofable)
// X-MS-CLIENT-PRINCIPAL header. Returns [] if absent or malformed.
function rolesFromPrincipalHeader(req) {
  const raw = req.headers['x-ms-client-principal'];
  if (!raw) return [];
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const claims = Array.isArray(decoded.claims) ? decoded.claims : [];
    return claims
      .filter((c) => c.typ === 'roles' || c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role')
      .map((c) => c.val);
  } catch {
    return [];
  }
}

function requireAdmin(req, res, next) {
  if (tokenValid(req)) return next(); // break-glass / non-interactive
  const adminRole = process.env.ADMIN_ROLE || 'Admin';
  if (rolesFromPrincipalHeader(req).includes(adminRole)) return next();
  // Authenticated via Easy Auth but missing the role → 403; otherwise unauthenticated → 401.
  if (req.headers['x-ms-client-principal']) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireAdmin, rolesFromPrincipalHeader };
```

- [ ] **Step 4: Update the route imports**

In `src/routes/admin.js` regel 3, vervang:
`const { requireAdminToken } = require('../middleware/auth');`
door:
`const { requireAdmin } = require('../middleware/auth');`
En vervang in dat bestand elk gebruik van `requireAdminToken` door `requireAdmin` (in de `router.get`/`router.patch`-definities).

In `src/routes/files.js` regel 5, vervang idem:
`const { requireAdmin } = require('../middleware/auth');`
en het gebruik in `router.get('/uploads/:filename', requireAdmin, ...)`.

- [ ] **Step 5: Run the middleware test**

Run: `npx jest __tests__/middleware/auth.test.js`
Expected: PASS (8/8).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: alle suites groen (bestaande admin/files-tests gebruiken het bearer-token → blijven 200/401 zoals verwacht).

- [ ] **Step 7: Commit**

```bash
git add src/middleware/auth.js src/routes/admin.js src/routes/files.js __tests__/middleware/auth.test.js
git commit -m "feat: authorize admin via Entra app-role (roles claim) + token break-glass"
```

---

### Task 2: Tokenless admin frontend

**Files:**
- Modify: `public/assets/admin.js` (volledige herschrijving van de component)
- Modify: `public/admin.html` (login-blok weg, denied-state erbij)

**Interfaces:**
- Consumes: de admin-API's, geautoriseerd via de Easy Auth-cookie (geen `Authorization`-header).
- Produces: een `adminApp()` Alpine-component zonder token-state; toont het dashboard direct, of een "geen toegang"-melding bij 403.

- [ ] **Step 1: Rewrite `public/assets/admin.js`**

```javascript
function adminApp() {
  return {
    denied: false,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    filters: { from: '', to: '', status: '' },
    uploadsFor: null,
    uploads: [],
    uploadsLoading: false,

    init() {
      this.loadSubmissions();
    },

    // Same-origin fetch: the Easy Auth session cookie is sent automatically.
    // 401 = Easy Auth session gone -> reload so the platform redirects to login.
    // 403 = authenticated but not in the Admin role -> show the denied message.
    async apiFetch(url, opts) {
      const res = await fetch(url, opts);
      if (res.status === 401) { location.reload(); return null; }
      if (res.status === 403) { this.denied = true; return null; }
      return res;
    },

    async loadSubmissions() {
      this.loading = true;
      const p = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
      if (this.filters.from)   p.set('from', this.filters.from);
      if (this.filters.to)     p.set('to', this.filters.to);
      if (this.filters.status) p.set('status', this.filters.status);
      try {
        const res = await this.apiFetch(`/api/submissions?${p}`);
        if (!res) return;
        const data = await res.json();
        this.rows = data.rows;
        this.total = data.total;
      } catch (e) {
        console.error('Load failed', e);
      } finally {
        this.loading = false;
      }
    },

    prevPage() { if (this.page > 1) { this.page--; this.loadSubmissions(); } },
    nextPage() { this.page++; this.loadSubmissions(); },

    async updateStatus(row) {
      try {
        const res = await this.apiFetch(`/api/submissions/${row.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: row.status }),
        });
        if (!res) return;
        if (!res.ok) { alert('Status wijzigen mislukt'); this.loadSubmissions(); }
      } catch (e) {
        alert('Status wijzigen mislukt');
        this.loadSubmissions();
      }
    },

    async showUploads(row) {
      if (this.uploadsFor && this.uploadsFor.id === row.id) { this.closeUploads(); return; }
      this.uploadsFor = row;
      this.uploads = [];
      this.uploadsLoading = true;
      try {
        const res = await this.apiFetch(`/api/submissions/${row.id}/uploads`);
        if (!res) { this.uploadsFor = null; return; }
        if (!res.ok) { alert('Bijlagen laden mislukt'); this.uploadsFor = null; return; }
        const data = await res.json();
        this.uploads = data.uploads;
      } catch (e) {
        alert('Bijlagen laden mislukt');
        this.uploadsFor = null;
      } finally {
        this.uploadsLoading = false;
      }
    },

    closeUploads() {
      this.uploadsFor = null;
      this.uploads = [];
    },

    async downloadUpload(u) {
      try {
        const res = await this.apiFetch(`/api/uploads/${encodeURIComponent(u.stored_name)}`);
        if (!res) return;
        if (!res.ok) { alert('Download mislukt'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = u.original_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Download mislukt');
      }
    },

    fmtSize(bytes) {
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
      return `${bytes} B`;
    },

    async exportData(format) {
      const p = new URLSearchParams({ format });
      if (this.filters.from)   p.set('from', this.filters.from);
      if (this.filters.to)     p.set('to', this.filters.to);
      if (this.filters.status) p.set('status', this.filters.status);
      try {
        const res = await this.apiFetch(`/api/export?${p}`);
        if (!res) return;
        if (!res.ok) { alert('Export mislukt'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `submissions.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Export mislukt');
      }
    },

    fmtDate(dt) {
      return new Date(dt).toLocaleString('nl-BE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    },
  };
}
```

- [ ] **Step 2: Update `public/admin.html`**

Verwijder het volledige login-blok `<template x-if="!authenticated"> ... </template>` (het hele blok van de login-header t/m de sluitende `</template>`).

Verwijder de `<template x-if="authenticated">` wrapper rond het dashboard en de bijbehorende sluit-`</template>`, zodat het dashboard altijd rendert. Vervang de afmeld-knop `<button class="btn-secondary" @click="logout">Afmelden</button>` door een Easy Auth-logout-link:
```html
<a class="btn-secondary" href="/.auth/logout">Afmelden</a>
```

Voeg boven de `admin-card` (binnen `page-content`) een denied-melding toe, en verberg de kaart als `denied`:
```html
<div class="admin-card" x-show="denied" x-cloak>
  <h1>Geen toegang</h1>
  <p style="color:var(--text-muted);">Je account heeft de Admin-rol niet. Vraag een beheerder om je de rol toe te wijzen.</p>
</div>
```
Wikkel de bestaande `<div class="admin-card">` (met de tabel) in `<template x-if="!denied"> ... </template>` zodat die verdwijnt bij 403.

- [ ] **Step 3: Verify no token/authorization remnants remain**

Run: `grep -nE "Authorization|localStorage|tokenInput|dockx_admin_token|this\\.token|login\\(" public/assets/admin.js public/admin.html`
Expected: **geen** resultaten (alle token/Authorization/localStorage-referenties zijn weg).

- [ ] **Step 4: Verify the full test suite still passes**

Run: `npm test`
Expected: groen (geen frontend-tests in dit project; deze stap bevestigt dat er niets aan de backend brak).

- [ ] **Step 5: Commit**

```bash
git add public/assets/admin.js public/admin.html
git commit -m "feat: tokenless admin UI (Easy Auth session), access-denied state on 403"
```

---

### Task 3: Config & deploy docs

**Files:**
- Modify: `.env.example`
- Modify: `infra/terugbetalingsformulier.bicep` (env-var `ADMIN_ROLE`)
- Modify: `infra/README.md` (app-rol definiëren + gebruikers toewijzen)

**Interfaces:**
- Consumes: niets.
- Produces: `ADMIN_ROLE`-config + operator-instructies voor de app-rol.

- [ ] **Step 1: Add `ADMIN_ROLE` to `.env.example`**

Voeg toe (onder de bestaande admin-sleutels):
```
# Admin-autorisatie
# ADMIN_ROLE: naam van de Entra app-rol die admin-toegang geeft (default: Admin).
ADMIN_ROLE=Admin
# ADMIN_TOKEN: break-glass / niet-interactieve toegang (Authorization: Bearer <token>).
```

- [ ] **Step 2: Add `ADMIN_ROLE` env to the Bicep container env array**

In `infra/terugbetalingsformulier.bicep`, in de `env`-array van de container (naast de andere `{ name: ..., value: ... }`-entries), toevoegen:
```bicep
            { name: 'ADMIN_ROLE', value: 'Admin' }
```

- [ ] **Step 3: Validate the Bicep compiles**

Run: `az bicep build --file infra/terugbetalingsformulier.bicep`
Expected: geen errors (2 bekende benigne `no-hardcoded-env-urls`-warnings mogen blijven). Verwijder daarna de gegenereerde `infra/terugbetalingsformulier.json` (`rm infra/terugbetalingsformulier.json`).

- [ ] **Step 4: Document the app role in `infra/README.md`**

Voeg een sectie toe (na "Admin-dashboard toegang"):
````markdown
## Admin-autorisatie via Entra app-rol
Admin-toegang komt via de app-rol `Admin` op de app-registratie (clientId `c32a7ac4-b27e-4292-afc4-6f1dc052a5dd`).
Het `ADMIN_TOKEN` (KV `tbf-admin-token`) blijft als break-glass/niet-interactieve toegang.

**App-rol eenmalig definiëren:**
```bash
cat > approles.json <<'JSON'
[{"allowedMemberTypes":["User"],"description":"Admins van het terugbetalingsdashboard","displayName":"Admin","id":"<NIEUWE-GUID>","isEnabled":true,"value":"Admin"}]
JSON
az ad app update --id c32a7ac4-b27e-4292-afc4-6f1dc052a5dd --app-roles @approles.json
```
(Genereer een GUID voor `id`, bv. `python -c "import uuid;print(uuid.uuid4())"`.)

**Gebruikers toewijzen** (geen Entra P1 → individuele gebruikers, geen groepen):
Portal: *Entra ID → Enterprise applications → TerugBetalingsFormulier → Users and groups → Add user → rol Admin*.
Of via `az` (haal user- en appRole-id's op):
```bash
SP=01a21c66-18c2-4d33-ba81-73a1fe905973
USER=$(az ad user show --id <upn> --query id -o tsv)
ROLE=$(az ad sp show --id $SP --query "appRoles[?value=='Admin'].id | [0]" -o tsv)
az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$SP/appRoleAssignedTo" \
  --headers "Content-Type=application/json" \
  --body "{\"principalId\":\"$USER\",\"resourceId\":\"$SP\",\"appRoleId\":\"$ROLE\"}"
```
Toewijzingen wijzigen vereist geen redeploy; de gebruiker moet wel opnieuw inloggen om de nieuwe `roles`-claim te krijgen.
````

- [ ] **Step 5: Commit**

```bash
git add .env.example infra/terugbetalingsformulier.bicep infra/README.md
git commit -m "docs+config: ADMIN_ROLE env var and Entra app-role setup guide"
```

---

### Task 4: Deploy & Entra app-role setup (operator, requires Azure access)

> Vereist `az`-login (subscription `df516a90-771f-4cfb-835c-60248fa83f64`) met directory-rechten. Dit is de acceptatie-gate.

**Files:** geen (operationeel).

- [ ] **Step 1: Definieer de app-rol** op de registratie (Task 3 stap 4, `az ad app update --app-roles`). Verifieer: `az ad app show --id c32a7ac4-b27e-4292-afc4-6f1dc052a5dd --query appRoles -o json` toont de `Admin`-rol.

- [ ] **Step 2: Wijs minstens één test-gebruiker de Admin-rol toe** (Task 3 stap 4, `appRoleAssignedTo`).

- [ ] **Step 3: Rebuild + deploy** (nieuwe middleware + frontend + `ADMIN_ROLE`-env):
```bash
az acr build -r dockxaiacr -t terugbetalingsformulier:latest .
az deployment group create -g RG_AI -f infra/terugbetalingsformulier.bicep -p infra/terugbetalingsformulier.bicepparam
```
(Of `az containerapp update ... --image ...:latest --revision-suffix approleN` als je de Bicep-env al hebt uitgerold.)

- [ ] **Step 4: Verifieer de acceptatiecriteria:**
  - Toegewezen gebruiker → opnieuw inloggen → `https://terugbetalingsformulier.dockx.be/admin` toont het dashboard **zonder** token-prompt.
  - Niet-toegewezen ingelogde gebruiker → "Geen toegang"-melding, geen data (403 op de API's).
  - `curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://terugbetalingsformulier.dockx.be/api/submissions?pageSize=1` → 200 (break-glass werkt).
  - Een `roles`-claim aanwezigheid checken kan via de app-logs (403 vs 200 op `/api/submissions`).

---

## Self-Review

**Spec coverage:**
- Beslissing 1 (app-rol, roles-claim) → Task 1 middleware + Task 4 stap 1. ✓
- Beslissing 2 (individuele gebruikers toewijzen) → Task 3 stap 4 + Task 4 stap 2. ✓
- Beslissing 3 (token break-glass, API-side) → Task 1 `tokenValid`-pad; acceptatie Task 4 stap 4. ✓
- Beslissing 4 (tokenloze UI) → Task 2. ✓
- Beslissing 5 (sign-in niet vereist) → onaangeroerd (we zetten geen appRoleAssignmentRequired); niets te doen, expliciet niet geïmplementeerd. ✓
- Middleware helper + 401/403-semantiek → Task 1 (constraint + tests). ✓
- `.env.example` / `ADMIN_ROLE` / Bicep → Task 3. ✓
- Testplan 6 scenario's → Task 1 stap 1 (8 tests dekken de 6 + de 2 bestaande break-glass-varianten). ✓

**Placeholder scan:** `<NIEUWE-GUID>` en `<upn>` in Task 3/4 zijn operator-in-te-vullen waarden (GUID genereren, gebruiker kiezen) — horen niet in code/git en zijn geen plan-gaten. Geen TODO/TBD in code-inhoud.

**Type consistency:** `requireAdmin` en `rolesFromPrincipalHeader` consistent geëxporteerd (Task 1 stap 3) en geïmporteerd (stap 4 in admin.js/files.js, stap 1 in auth.test.js). `ADMIN_ROLE` default `'Admin'` matcht de app-rol `value: 'Admin'` (Task 3/4). Frontend `apiFetch` gebruikt in alle 5 de calls; geen `this.token`/`Authorization` meer (geverifieerd door Task 2 stap 3 grep).
