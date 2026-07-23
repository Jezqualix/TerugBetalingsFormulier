# Entra-groep-autorisatie voor admin-dashboard — design

**Datum:** 2026-07-24
**Status:** Ready for user review
**Scope:** Admin-toegang tot het dashboard (`/admin` + `/api`-adminroutes) baseren op Microsoft Entra security-groep-lidmaatschap, met het bestaande `ADMIN_TOKEN` als break-glass fallback. De app draait al volledig achter Azure Container Apps Easy Auth.

## Context

De app is een Express-monolith achter ACA Easy Auth (Microsoft Entra). Elke geauthenticeerde request draagt de identiteit mee via door Easy Auth geïnjecteerde headers:

- `X-MS-CLIENT-PRINCIPAL` — base64-encoded JSON: `{ "auth_typ": "...", "claims": [ { "typ": "...", "val": "..." }, ... ] }`. Bevat o.a. `groups`-claims (object-ID's) als de app-registratie dat emit.
- `X-MS-CLIENT-PRINCIPAL-NAME` — UPN van de gebruiker.

Deze headers worden door Easy Auth gezet nadat de gebruiker is ingelogd; Easy Auth **strípt** client-aangeleverde varianten, dus ze zijn niet te spoofen zolang de app uitsluitend achter Easy Auth draait (wat het geval is — de container is niet los bereikbaar).

Vandaag beschermt `src/middleware/auth.js` de adminroutes met een bearer-token (`ADMIN_TOKEN`, `crypto.timingSafeEqual`). De frontend (`public/assets/admin.js` + `admin.html`) vraagt dat token en bewaart het in `localStorage`.

## Beslissingen

| # | Onderwerp | Beslissing |
|---|---|---|
| 1 | Autorisatiemechanisme | **Entra security-groep-lidmaatschap** via de `groups`-claim uit `X-MS-CLIENT-PRINCIPAL` |
| 2 | Toegestane groepen | **Lijst** (meerdere): `zBoekhouding-SG` (`d7cdea20-4540-4739-b31b-7ff0c6f168d7`) en `zIT` (`f0a05564-728b-47a3-bcb7-eac2de9dd0a6`). Lidmaatschap van **één** volstaat. |
| 3 | Bestaand token | **Behouden als break-glass fallback** — blijft functioneel aan de API-kant (curl/Postman/lokale dev), maar verdwijnt uit de UI |
| 4 | Groups-claim overage (>200 groepen) | **Buiten scope** — Graph-fallback niet nu; gedocumenteerd als toekomstige optie |
| 5 | Frontend | **Tokenloze admin-UI** — geen token-prompt/localStorage meer; leunt op de Easy Auth-sessiecookie |

## Autorisatiemodel

`requireAdminToken` (hernoemd/uitgebreid) laat een request door als **één** van beide klopt:

1. **Entra-groep (normale weg):** decodeer `X-MS-CLIENT-PRINCIPAL`, verzamel alle `groups`-claimwaarden, en check of er een snijvlak is met de toegestane groep-ID's uit `ADMIN_GROUP_IDS`. Zo ja → toegang.
2. **Break-glass token:** de bestaande `Authorization: Bearer <ADMIN_TOKEN>`-check (`timingSafeEqual`) blijft ongewijzigd. Dekt noodtoegang én lokale dev (geen Easy Auth-headers).

Geen match → `403` (niet 401 — de gebruiker is wél geauthenticeerd, maar niet geautoriseerd).

### Header-parsing (kern)

```js
function groupsFromPrincipalHeader(req) {
  const raw = req.headers['x-ms-client-principal'];
  if (!raw) return [];
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const claims = Array.isArray(decoded.claims) ? decoded.claims : [];
    return claims
      .filter((c) => c.typ === 'groups' || c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups')
      .map((c) => c.val);
  } catch {
    return [];
  }
}
```

De `groups`-claim kan als korte typ (`groups`) of als volledige schema-URI verschijnen afhankelijk van de token-versie; beide worden herkend.

## App-registratie: groups-claim aanzetten

De app-registratie moet de `groups`-claim emitten, anders bevat `X-MS-CLIENT-PRINCIPAL` geen groepen. Eenmalig:

```bash
az ad app update --id c32a7ac4-b27e-4292-afc4-6f1dc052a5dd \
  --set groupMembershipClaims=SecurityGroup
```

`SecurityGroup` zet alle security-groep-object-ID's van de gebruiker in het token (id- én access-token). Easy Auth geeft ze door in de principal-header.

> Na deze wijziging moeten bestaande sessies opnieuw inloggen om de nieuwe claim in hun token te krijgen (of een nieuwe revisie forceren is niet nodig — het is een token-claim, geen app-config).

## Codewijzigingen

### `src/middleware/auth.js`
- Nieuwe helper `groupsFromPrincipalHeader(req)` (zie boven).
- `requireAdminToken` uitbreiden: eerst groeps-check, dan token-check (of andersom — token eerst is goedkoper). Toegang bij één match, anders 403.
- Toegestane groepen uit `process.env.ADMIN_GROUP_IDS` (comma-separated) → `Set`. Lege/ontbrekende env → alleen token-pad actief (veilige default).

### `public/assets/admin.js` + `public/admin.html`
- Token-invoerscherm, `login()`, `localStorage`-opslag en de `Authorization`-header verwijderen.
- Adminfetches (`/api/submissions`, `/api/export`, `/api/submissions/:id/status`, `/api/submissions/:id/uploads`, `/api/uploads/:file`) sturen geen `Authorization`-header meer; de Easy Auth-sessiecookie gaat automatisch mee (same-origin).
- **CSRF blijft**: state-changing calls (`PATCH .../status`) blijven de `x-csrf-token`-header sturen (double-submit), los van de autorisatie.
- Op `403` → toon een nette melding: "Geen toegang — je account zit niet in een geautoriseerde groep (Boekhouding of IT)."
- Op `401` → Easy Auth-sessie verlopen; herlaad de pagina zodat Easy Auth opnieuw redirect naar login.

### `.env.example`
- `ADMIN_GROUP_IDS=` documenteren (comma-separated Entra security-groep object-ID's).
- `ADMIN_TOKEN` toelichten als break-glass/niet-interactief pad.

## Config / infra

- Nieuwe env-var in Bicep (`infra/terugbetalingsformulier.bicep`), plaintext (geen secret):
  `ADMIN_GROUP_IDS = d7cdea20-4540-4739-b31b-7ff0c6f168d7,f0a05564-728b-47a3-bcb7-eac2de9dd0a6`
- `ADMIN_TOKEN` blijft een KV-secret (`tbf-admin-token`), ongewijzigd.
- Deploy: rebuild image + nieuwe revisie (Bicep redeploy of `az containerapp update`).

## Lokale dev

Lokaal is er geen Easy Auth, dus geen `X-MS-CLIENT-PRINCIPAL`. De ontwikkelaar gebruikt het break-glass token-pad (bestaande flow met `Authorization: Bearer`). Alternatief: een `X-MS-CLIENT-PRINCIPAL` handmatig meesturen met een `groups`-claim voor tests. De tokenloze UI werkt lokaal niet zonder Easy Auth — dat is acceptabel (dev gebruikt token of unit tests).

## Security

- `X-MS-CLIENT-PRINCIPAL` wordt door Easy Auth gezet en client-aangeleverde varianten worden gestript → niet spoofbaar zolang de app enkel achter Easy Auth draait. De container is niet los van de ingress bereikbaar.
- Break-glass token blijft `timingSafeEqual`-vergeleken; enige weg als de Entra/groep-config faalt of voor niet-interactieve toegang.
- 403 (niet 401) bij ontbrekende groep — correcte semantiek (geauthenticeerd, niet geautoriseerd).

## Testplan

Unit (Jest + supertest, DB gemockt), in `__tests__/routes/admin.test.js` / `__tests__/middleware/auth.test.js`:
1. Geen header, geen token → 401/403 zoals nu.
2. Geldig `ADMIN_TOKEN` bearer → 200 (break-glass blijft werken).
3. `X-MS-CLIENT-PRINCIPAL` met een `groups`-claim die een toegestane groep-ID bevat → 200.
4. `X-MS-CLIENT-PRINCIPAL` met alleen niet-toegestane groepen → 403.
5. Malformed/niet-base64 `X-MS-CLIENT-PRINCIPAL` → geen crash, val terug op token-pad → 403 zonder token.
6. `groups`-claim als volledige schema-URI (i.p.v. `groups`) → herkend.

Handmatig na deploy: een `zBoekhouding-SG`- of `zIT`-lid opent `/admin` → dashboard laadt zonder token-prompt; een niet-lid krijgt de "geen toegang"-melding.

## Buiten scope

- Graph-fallback voor de >200-groepen overage.
- Rol-differentiatie binnen admin (alles-of-niets blijft).
- Verwijderen van het break-glass token (blijft bestaan).
- App-rollen i.p.v. groepen (bewust groep gekozen).

## Acceptatiecriteria

1. Een lid van `zBoekhouding-SG` of `zIT` opent `https://terugbetalingsformulier.dockx.be/admin` na Entra-login en ziet het dashboard **zonder** token-prompt.
2. Een ingelogde gebruiker die in geen van beide groepen zit, krijgt een duidelijke "geen toegang"-melding en geen data.
3. `Authorization: Bearer <ADMIN_TOKEN>` blijft de adminroutes openen (break-glass), verifieerbaar met curl.
4. De groeps-check leest uitsluitend `X-MS-CLIENT-PRINCIPAL` (geen client-instelbare bron).
5. Alle bestaande tests blijven groen; nieuwe tests dekken de 6 scenario's hierboven.
