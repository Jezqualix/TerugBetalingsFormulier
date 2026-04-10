# Deployment: Windows + IIS

## Prerequisites
- Node.js 20 LTS installed
- IIS with ARR (Application Request Routing) and URL Rewrite modules
- NSSM (Non-Sucking Service Manager)

## 1. Application Setup

```cmd
cd C:\inetpub\apps\terugbetalingsformulier
npm install --omit=dev
copy .env.example .env.local
# Fill in .env.local with production values
```

Run the migration:
```
sqlcmd -S <DB_SERVER> -d <DB_DATABASE> -U <DB_USER> -P <DB_PASSWORD> -i migrations\001_initial.sql
```

## 2. NSSM Service

```cmd
nssm install TerugBetalingsFormulier "C:\Program Files\nodejs\node.exe"
nssm set TerugBetalingsFormulier AppDirectory "C:\inetpub\apps\terugbetalingsformulier"
nssm set TerugBetalingsFormulier AppParameters "src\server.js"
nssm set TerugBetalingsFormulier AppEnvironmentExtra "NODE_ENV=production"
nssm set TerugBetalingsFormulier AppStdout "C:\inetpub\logs\terugbetaling-out.log"
nssm set TerugBetalingsFormulier AppStderr "C:\inetpub\logs\terugbetaling-err.log"
nssm set TerugBetalingsFormulier Start SERVICE_AUTO_START
nssm start TerugBetalingsFormulier
```

Environment variables from `.env.local` can be added with additional `nssm set ... AppEnvironmentExtra` calls, or set at the system level.

## 3. IIS ARR Reverse Proxy

Create a new IIS site pointing to an empty folder. Add `web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3004/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

Enable ARR proxy in IIS Manager: Application Request Routing → Server Proxy Settings → Enable proxy.

## 4. HTTPS
Configure an HTTPS binding on the IIS site using a certificate from the Windows Certificate Store (or Let's Encrypt via win-acme).

## 5. Upload Folder
Set `UPLOAD_DIR` in `.env.local` to an absolute path outside the IIS web root, e.g. `C:\data\terugbetaling-uploads`. Ensure the NSSM service account has write access to this folder.
