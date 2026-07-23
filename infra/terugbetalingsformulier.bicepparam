using './terugbetalingsformulier.bicep'

param environmentId = '/subscriptions/df516a90-771f-4cfb-835c-60248fa83f64/resourceGroups/RG_AI/providers/Microsoft.App/managedEnvironments/cae-ai'
param acrName = 'dockxaiacr'
param acrLoginServer = 'dockxaiacr.azurecr.io'
param keyVaultName = 'kv-dockx-ai'
param image = 'dockxaiacr.azurecr.io/terugbetalingsformulier:latest'

// Vul in na aanmaken van de Entra app-registratie (Task 7):
param entraClientId = '<entra-app-client-id>'
param tenantId = '<entra-tenant-id>'
