# Deployment: Debian + Nginx

## Prerequisites
- Node.js 20 LTS (`curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`)
- Nginx
- A non-root service user (e.g. `terugbetaling`)

## 1. Application Setup

```bash
mkdir -p /opt/terugbetalingsformulier
cd /opt/terugbetalingsformulier
# Copy application files here
npm install --omit=dev
cp .env.example .env.local
# Edit .env.local with production values
chmod 600 .env.local
```

Run the migration (using sqlcmd or Azure Data Studio):
```bash
sqlcmd -S $DB_SERVER -d $DB_DATABASE -U $DB_USER -P $DB_PASSWORD -i migrations/001_initial.sql
```

## 2. systemd Unit

Create `/etc/systemd/system/terugbetaling.service`:

```ini
[Unit]
Description=TerugBetalingsFormulier
After=network.target

[Service]
Type=simple
User=terugbetaling
WorkingDirectory=/opt/terugbetalingsformulier
EnvironmentFile=/opt/terugbetalingsformulier/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable terugbetaling
systemctl start terugbetaling
systemctl status terugbetaling
```

## 3. Nginx Reverse Proxy

`/etc/nginx/sites-available/terugbetaling`:

```nginx
server {
    listen 80;
    server_name forms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name forms.example.com;

    ssl_certificate     /etc/letsencrypt/live/forms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forms.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Upload size limit (must be >= 2MB per file × max files)
    client_max_body_size 25M;

    location / {
        proxy_pass         http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/terugbetaling /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 4. HTTPS via Let's Encrypt
```bash
apt-get install certbot python3-certbot-nginx
certbot --nginx -d forms.example.com
```

## 5. Upload Folder
Set `UPLOAD_DIR=/var/data/terugbetaling-uploads` in `.env.local`. Ensure the `terugbetaling` user owns it:
```bash
mkdir -p /var/data/terugbetaling-uploads
chown terugbetaling:terugbetaling /var/data/terugbetaling-uploads
chmod 750 /var/data/terugbetaling-uploads
```
