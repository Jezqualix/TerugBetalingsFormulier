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
