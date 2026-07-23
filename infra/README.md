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

## Admin-dashboard toegang
Het admin-dashboard (`/admin`) is beveiligd met een bearer-token (bovenop de Entra-login).
Het token staat **uitsluitend** in Key Vault als secret `tbf-admin-token` — niet in git.
Ophalen (vereist rol Key Vault Secrets User/Officer op `kv-dockx-ai`):
```bash
az keyvault secret show --vault-name kv-dockx-ai -n tbf-admin-token --query value -o tsv
```
Roteren: `az keyvault secret set --vault-name kv-dockx-ai -n tbf-admin-token --value "$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"`
gevolgd door een nieuwe revisie (`az containerapp update -n terugbetalingsformulier -g RG_AI --revision-suffix rotN`) zodat de app het nieuwe token oppikt.

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
