# TODOS

Open punten voor TerugBetalingsFormulier. De inhoudelijke uitleg per punt staat
hieronder; `CLAUDE.md` blijft de plek voor hoe de code werkt.

## Uploads

### Geen magic-byte-controle op bijlagen

**What:** Valideer de eerste bytes van een upload tegen het opgegeven mimetype in plaats van alleen extensie + `Content-Type` te vertrouwen.

**Why:** Nu wordt een Windows-binary (`MZ`-header) die `factuur.png` heet en zich als `image/png` aandient, aanvaard. De beheerder downloadt hem later met de originele naam.

**Context:** `src/middleware/upload.js` doet een dubbele allowlist op extensie én opgegeven mimetype, en dat is precies zo bedoeld — maar de client bepaalt beide waarden. De blootstelling is beperkt: `uploads/` is niet web-bereikbaar, downloads lopen via `/api/uploads/:file` achter `requireAdmin`, en de share zit niet in een pad dat iets uitvoert. Startpunt: `file-type` (npm) of een handmatige signature-check op de eerste 12 bytes in de multer `fileFilter`, plus een test per toegestaan type in `__tests__/middleware/upload.test.js`.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Rate limiting

### Rate-limitteller staat per proces

**What:** Zet de rate-limitteller in een gedeelde store zodat de limiet klopt over replica's heen.

**Why:** `maxReplicas` staat op 3, dus in het slechtste geval geldt de limiet drie keer los naast elkaar (75 i.p.v. 25 per 15 minuten), en elke deploy zet alle tellers terug op nul.

**Context:** `src/middleware/rateLimiter.js` gebruikt de `MemoryStore` van `express-rate-limit`. Dat is bewust zo gelaten toen de sleutel van IP naar Easy-Auth-UPN ging: eerst het echte probleem oplossen (kantoor-NAT deelde één teller), de store daarna. Een gedeelde store vraagt Redis of een SQL-tabel; er is nu geen Redis in `RG_AI`, dus de goedkoopste variant is een tabel in `tbf` met een store-adapter. Alleen zinvol als de limiet strikt moet zijn — vandaag remt hij misbruik voldoende af.

**Effort:** M
**Priority:** P3
**Depends on:** None

## Data

### Testrijen staan nog in productie

**What:** Verwijder de testinzendingen uit `tbf.submissions` op DockxDB.

**Why:** Ze verschijnen in het beheerscherm en in elke CSV/XLSX-export, dus iedereen die exporteert moet ze er handmatig uit filteren.

**Context:** Rijen `id 4` t/m `15`, herkenbaar aan `TEST-` in `naam_aanvrager` en `naam_terugstorting`. Let op bij verwijderen: `tbf.uploads` heeft `ON DELETE CASCADE` op `submission_id`, dus de upload-records gaan mee, maar de bestanden zelf blijven als wezen achter op de Azure Files-share (`/app/uploads`). Ruim die in dezelfde beweging op, of zet de rijen op een status die de export overslaat.

**Effort:** S
**Priority:** P2
**Depends on:** None

## Completed

### Rate limit per gebruiker in plaats van per kantoor-IP

**What:** `express-rate-limit` een `keyGenerator` geven op de Easy-Auth-UPN, met `req.ip` als terugval.

**Why:** Zonder `keyGenerator` viel de limiter terug op `req.ip`, en achter de Container Apps-ingress is dat het NAT-adres van het kantoor: het hele gebouw deelde één teller van 10 per 15 minuten.

**Context:** Sleutel is `x-ms-client-principal-name` in kleine letters (Entra is hoofdletterongevoelig). `skipFailedRequests` staat aan zodat een reeks tikfouten het quotum niet opeet, en de limiet ging van 10 naar 25. `WINDOW_MS` en `MAX_SUBMISSIONS` worden geëxporteerd zodat de tests hun aantallen daaruit halen.

**Effort:** S
**Priority:** P1
**Completed:** 2026-08-14 (`src/middleware/rateLimiter.js`, 12 tests in `__tests__/middleware/rateLimiter.test.js`)

### IBAN in canoniek formaat opslaan

**What:** IBAN wegschrijven zonder scheidingstekens en in hoofdletters.

**Why:** Hetzelfde rekeningnummer stond op twee manieren in de database (`BE68 5390 0754 7034` naast `BE07789589900666`), dus matchen op IBAN werkte niet en exports waren inconsistent.

**Context:** `normalizeIban()` in `src/routes/submissions.js` is autoritatief; het formulier doet hetzelfde op blur. `migrations/005_normalize_iban.sql` heeft de bestaande rijen opgeschoond.

**Effort:** S
**Priority:** P1
**Completed:** 2026-08-13 (`src/routes/submissions.js`, `migrations/005_normalize_iban.sql`)

### `/health` buiten Easy Auth

**What:** `/health` toevoegen aan de Easy Auth `excludedPaths` van de container app.

**Why:** De health-endpoint gaf 302 naar de Entra-login, dus externe monitoring kon niet zien of de app leefde.

**Context:** Gezet met `az containerapp auth update --excluded-paths "/health"`. Valkuil: zonder `MSYS_NO_PATHCONV=1` herschrijft Git Bash `/health` naar een Windows-pad en doet de setting stil niets.

**Effort:** S
**Priority:** P2
**Completed:** 2026-08-13 (live container app, stond al in de Bicep)
