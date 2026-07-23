# Entra app-rol-autorisatie voor admin-dashboard — design

**Datum:** 2026-07-24
**Status:** Ready for user review
**Scope:** Admin-toegang tot het dashboard (`/admin` + `/api`-adminroutes) baseren op een Microsoft Entra **app-rol** ("Admin") die in de portal aan gebruikers/groepen wordt toegewezen, met het bestaande `ADMIN_TOKEN` als break-glass fallback. De app draait al volledig achter Azure Container Apps Easy Auth.

> Dit ontwerp vervangt een eerder groep-ID-gebaseerd idee: app-rollen laten toe dat het **volledige** toegangsbeheer (welke groepen/gebruikers admin zijn) in de Entra-portal gebeurt, zonder app-config of revisie.

## Context

De app is een Express-monolith achter ACA Easy Auth (Microsoft Entra). Elke geauthenticeerde request draagt de identiteit mee via door Easy Auth geïnjecteerde headers:

- `X-MS-CLIENT-PRINCIPAL` — base64-encoded JSON: `{ "auth_typ": "...", "claims": [ { "typ": "...", "val": "..." }, ... ] }`. Bevat een `roles`-claim per toegewezen app-rol.
- `X-MS-CLIENT-PRINCIPAL-NAME` — UPN van de gebruiker.

Easy Auth zet deze headers na login en **strípt** client-aangeleverde varianten → niet spoofbaar zolang de app enkel achter Easy Auth draait (de container is niet los bereikbaar).

Vandaag beschermt `src/middleware/auth.js` de adminroutes met een bearer-token (`ADMIN_TOKEN`, `crypto.timingSafeEqual`). De frontend (`public/assets/admin.js` + `admin.html`) vraagt dat token en bewaart het in `localStorage`.

## Waarom app-rollen (i.p.v. groep-ID's in config)

| | App-rol (gekozen) | Groep-ID's in env-var |
|---|---|---|
| Leden beheren | Portal (groep-lidmaatschap) | Portal |
| Welke groepen/gebruikers admin zijn | **Portal** (Enterprise App → Users and groups) | App-config wijzigen + revisie |
| App-config bij wijziging | Nooit | `ADMIN_GROUP_IDS` + revisie |
| Token-config | Geen extra (roles-claim komt automatisch) | `groupMembershipClaims` nodig |
| Overage (>200 groepen) | Niet van toepassing | Risico |

App-rollen zijn Entra-native RBAC: de "Admin"-rol is één keer gedefinieerd; toewijzen/intrekken gebeurt volledig in de portal.

## Beslissingen

| # | Onderwerp | Beslissing |
|---|---|---|
| 1 | Mechanisme | Entra **app-rol** `Admin` op de app-registratie; de app checkt de `roles`-claim uit `X-MS-CLIENT-PRINCIPAL` |
| 2 | Toewijzing | Via *Enterprise App → Users and groups*: **individuele gebruikers** krijgen de rol `Admin` (geen groep-toewijzing — die vereist Entra ID P1, niet aanwezig) |
| 3 | Bestaand token | **Behouden als break-glass fallback** — functioneel aan de API-kant (curl/Postman/lokale dev), weg uit de UI |
| 4 | Frontend | **Tokenloze admin-UI** — geen token-prompt/localStorage meer; leunt op de Easy Auth-sessiecookie |
| 5 | App-toegang (sign-in) | **Assignment NIET vereist** voor sign-in — iedereen in de tenant mag inloggen en het formulier gebruiken; de rol bepaalt enkel admin |

## Autorisatiemodel

`requireAdmin` (uitbreiding van de huidige `requireAdminToken`) laat een request door als **één** van beide klopt:

1. **App-rol (normale weg):** decodeer `X-MS-CLIENT-PRINCIPAL`, verzamel de `roles`-claimwaarden, en check of `Admin` (of de via env geconfigureerde rolnaam) erbij zit. Zo ja → toegang.
2. **Break-glass token:** de bestaande `Authorization: Bearer <ADMIN_TOKEN>`-check (`timingSafeEqual`) blijft ongewijzigd. Dekt noodtoegang én lokale dev (geen Easy Auth-headers).

Geen match → `403` (niet 401 — de gebruiker is wél geauthenticeerd, maar niet geautoriseerd).

### Header-parsing (kern)

```js
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
```

De rol-claim kan als korte typ (`roles`) of als volledige schema-URI (`.../claims/role`) verschijnen afhankelijk van de token-versie; beide worden herkend.

## App-registratie: app-rol definiëren

Eenmalig een app-rol `Admin` toevoegen aan de app-registratie (clientId `c32a7ac4-b27e-4292-afc4-6f1dc052a5dd`). Via een JSON-manifest en `az`:

```jsonc
// app-role definitie
{
  "allowedMemberTypes": ["User"],   // "User" dekt ook groep-toewijzingen
  "description": "Admins van het terugbetalingsdashboard",
  "displayName": "Admin",
  "id": "<nieuwe GUID>",
  "isEnabled": true,
  "value": "Admin"                  // dit is wat in de roles-claim komt
}
```

```bash
az ad app update --id c32a7ac4-b27e-4292-afc4-6f1dc052a5dd --app-roles @approles.json
```

De `roles`-claim verschijnt automatisch in het token zodra een gebruiker de rol heeft — **geen** `groupMembershipClaims` of andere token-config nodig.

## Toewijzen in de portal (of via az)

*Entra ID → Enterprise applications → TerugBetalingsFormulier → Users and groups → Add user/group* → selecteer de **individuele gebruikers** die admin moeten zijn → rol **Admin**.

> **Geen groep-toewijzing:** de tenant heeft geen Entra ID P1, en een groep aan een app-rol toewijzen vereist P1. Daarom wijzen we gebruikers rechtstreeks toe. Gevolg: een nieuwe admin moet apart aan de rol worden toegevoegd (niet automatisch via groep-lidmaatschap).

Toewijzen kan ook via `az`:
```bash
# objectId van de gebruiker + van de service principal + de appRole id
az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/<sp-objectId>/appRoleAssignedTo" \
  --headers "Content-Type=application/json" \
  --body '{"principalId":"<user-objectId>","resourceId":"<sp-objectId>","appRoleId":"<admin-appRole-GUID>"}'
```

Toewijzen/intrekken hierna is volledig portal-beheerd; geen app-config of revisie.

## Codewijzigingen

### `src/middleware/auth.js`
- Nieuwe helper `rolesFromPrincipalHeader(req)` (zie boven).
- `requireAdmin`: eerst de goedkope token-check (bestaand), anders de rol-check; toegang bij één match, anders 403.
- Rolnaam uit `process.env.ADMIN_ROLE` met default `'Admin'`.
- Naam `requireAdminToken` → `requireAdmin` (export bijwerken in `src/routes/admin.js` en `src/routes/files.js`).

### `public/assets/admin.js` + `public/admin.html`
- Token-invoerscherm, `login()`, `localStorage`-opslag en de `Authorization`-header verwijderen.
- Adminfetches (`/api/submissions`, `/api/export`, `/api/submissions/:id/status`, `/api/submissions/:id/uploads`, `/api/uploads/:file`) sturen geen `Authorization`-header meer; de Easy Auth-sessiecookie gaat automatisch mee (same-origin).
- **CSRF blijft**: `PATCH .../status` blijft de `x-csrf-token`-header sturen (double-submit), los van de autorisatie.
- Op `403` → melding: "Geen toegang — je account heeft de Admin-rol niet."
- Op `401` → Easy Auth-sessie verlopen; herlaad de pagina zodat Easy Auth opnieuw naar login redirect.

### `.env.example`
- `ADMIN_ROLE=Admin` documenteren (optioneel; default `Admin`).
- `ADMIN_TOKEN` toelichten als break-glass/niet-interactief pad.

## Config / infra

- Optionele env-var in Bicep (`infra/terugbetalingsformulier.bicep`), plaintext: `ADMIN_ROLE = Admin`. (Weglaten kan ook — default is `Admin`.)
- **Geen** `ADMIN_GROUP_IDS` meer nodig.
- `ADMIN_TOKEN` blijft een KV-secret (`tbf-admin-token`), ongewijzigd.
- Deploy: rebuild image + nieuwe revisie.

## Lokale dev

Lokaal is er geen Easy Auth, dus geen `X-MS-CLIENT-PRINCIPAL`. De ontwikkelaar gebruikt het break-glass token-pad (`Authorization: Bearer`). De tokenloze UI werkt lokaal niet zonder Easy Auth — acceptabel (dev gebruikt token of unit tests).

## Security

- `X-MS-CLIENT-PRINCIPAL` wordt door Easy Auth gezet en client-aangeleverde varianten gestript → niet spoofbaar zolang de app enkel achter Easy Auth draait.
- Break-glass token blijft `timingSafeEqual`-vergeleken; enige weg als de Entra-config faalt of voor niet-interactieve toegang.
- 403 (niet 401) bij ontbrekende rol — correcte semantiek.

## Testplan

Unit (Jest + supertest, DB gemockt), in `__tests__/routes/admin.test.js` / `__tests__/middleware/auth.test.js`:
1. Geen header, geen token → 401/403 zoals nu.
2. Geldig `ADMIN_TOKEN` bearer → 200 (break-glass blijft werken).
3. `X-MS-CLIENT-PRINCIPAL` met een `roles`-claim `Admin` → 200.
4. `X-MS-CLIENT-PRINCIPAL` met andere rollen maar niet `Admin` → 403.
5. Malformed/niet-base64 `X-MS-CLIENT-PRINCIPAL` → geen crash, val terug op token-pad → 403 zonder token.
6. `roles`-claim als volledige schema-URI (i.p.v. `roles`) → herkend.

Handmatig na deploy: een gebruiker met de Admin-rol (individueel toegewezen) opent `/admin` → dashboard laadt zonder token-prompt; iemand zonder de rol krijgt de "geen toegang"-melding.

## Buiten scope

- Meerdere admin-niveaus/rollen (alles-of-niets blijft).
- Verwijderen van het break-glass token (blijft bestaan).
- Groep-ID-model (bewust app-rollen gekozen).

## Acceptatiecriteria

1. Een gebruiker met de Entra-rol `Admin` (individueel toegewezen) opent `https://terugbetalingsformulier.dockx.be/admin` na login en ziet het dashboard **zonder** token-prompt.
2. Een ingelogde gebruiker zonder de `Admin`-rol krijgt een duidelijke "geen toegang"-melding en geen data.
3. `Authorization: Bearer <ADMIN_TOKEN>` blijft de adminroutes openen (break-glass), verifieerbaar met curl.
4. De rol-check leest uitsluitend `X-MS-CLIENT-PRINCIPAL` (geen client-instelbare bron).
5. Toewijzen/intrekken van de rol in de portal wijzigt de toegang zonder app-config of redeploy.
6. Alle bestaande tests blijven groen; nieuwe tests dekken de 6 scenario's hierboven.
