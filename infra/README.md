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
