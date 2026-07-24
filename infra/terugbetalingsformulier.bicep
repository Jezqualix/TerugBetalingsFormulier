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
@description('Custom domain bound to the ingress (managed TLS).')
param customDomain string = 'terugbetalingsformulier.dockx.be'
@description('Name of the env-level managed certificate for the custom domain.')
param managedCertName string = 'mc-cae-ai-terugbetalingsfo-1891'

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
// Managed TLS cert for the custom domain (created out-of-band via `az containerapp
// hostname bind`). Referenced here so Bicep deploys preserve the custom-domain
// binding instead of stripping it from the ingress.
resource customCert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' existing = {
  parent: env
  name: managedCertName
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
      shareName: uploadsShare.name
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
  dependsOn: [ acrPullRole, kvSecretsUserRole, envStorage ]
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3004
        transport: 'auto'
        allowInsecure: false
        customDomains: [
          {
            name: customDomain
            bindingType: 'SniEnabled'
            certificateId: customCert.id
          }
        ]
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
            { name: 'ADMIN_ROLE', value: 'Admin' }
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
          allowedAudiences: [ 'api://${entraClientId}', entraClientId ]
        }
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
