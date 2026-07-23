using './terugbetalingsformulier.bicep'

param environmentId = '/subscriptions/df516a90-771f-4cfb-835c-60248fa83f64/resourceGroups/RG_AI/providers/Microsoft.App/managedEnvironments/cae-ai'
param acrName = 'dockxaiacr'
param acrLoginServer = 'dockxaiacr.azurecr.io'
param keyVaultName = 'kv-dockx-ai'
param image = 'dockxaiacr.azurecr.io/terugbetalingsformulier:latest'

// Entra app-registratie "TerugBetalingsFormulier" (aangemaakt 2026-07-23):
param entraClientId = 'c32a7ac4-b27e-4292-afc4-6f1dc052a5dd'
param tenantId = '7678be7f-0fd1-4982-85af-962f7d6403b9'
