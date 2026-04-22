# Public Health Journal – Production Deployment Guide

## Quick Start

Your journal is now ready for production. When you get a domain, follow these steps:

### 1. Server Setup

Get a cloud server (AWS, DigitalOcean, Linode, etc.) with:
- Ubuntu 20.04 or later
- 2GB+ RAM
- 20GB+ storage

```bash
# SSH into your server
ssh root@your-server-ip
```

### 2. Clone & Install

```bash
# Install system dependencies
apt-get update
apt-get install python3 python3-pip python3-venv git

# Clone your repository (or copy files)
cd /opt
git clone <your-repo-url> public-health-journal
cd public-health-journal

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Environment Setup

```bash
# Copy and customize environment file
cp .env.example .env

# Edit .env with your settings
nano .env

# Set proper permissions
chmod 640 .env
```

### 4. Database Setup

```bash
# Initialize database
python -c "from web_app import init_web_tables; init_web_tables()"
```

### 5. Run with Production Server

```bash
# Make startup script executable
chmod +x start_production.sh

# Run with Gunicorn
./start_production.sh

# Or manually:
gunicorn \
    --workers 4 \
    --bind 127.0.0.1:5000 \
    --timeout 30 \
    wsgi:app
```

### 6. Reverse Proxy (Nginx) Setup

```bash
# Install Nginx
apt-get install nginx

# Create config
cat > /etc/nginx/sites-available/health-journal << 'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static {
        alias /opt/public-health-journal/static;
        expires 30d;
    }

    location /uploads {
        alias /opt/public-health-journal/uploads;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/health-journal /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 7. SSL/HTTPS (Let's Encrypt)

```bash
# Install Certbot
apt-get install certbot python3-certbot-nginx

# Generate certificate
certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal should activate automatically
```

### 8. Background Service (Systemd)

```bash
# Create service file
cat > /etc/systemd/system/health-journal.service << 'EOF'
[Unit]
Description=Public Health Journal
After=network.target

[Service]
Type=notify
User=www-data
WorkingDirectory=/opt/public-health-journal
Environment="PATH=/opt/public-health-journal/.venv/bin"
ExecStart=/opt/public-health-journal/.venv/bin/gunicorn \
    --workers 4 \
    --bind 127.0.0.1:5000 \
    --timeout 30 \
    wsgi:app

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable health-journal
systemctl start health-journal
systemctl status health-journal
```

### 9. Backup Strategy

```bash
# Backup database regularly
0 2 * * * cp /opt/public-health-journal/processed_items.db /backups/journal_$(date +\%Y\%m\%d).db
```

### 10. Monitor & Logs

```bash
# View logs
journalctl -u health-journal -f

# Check nginx access
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## DNS Setup

Once you have your domain and server:

1. Point your domain's DNS A record to your server IP
2. Wait 24-48 hours for DNS to propagate
3. Access http://your-domain.com (will upgrade to HTTPS)

## File Structure on Server

```
/opt/public-health-journal/
├── web_app.py           # Main Flask app
├── wsgi.py              # Production entry point
├── requirements.txt     # Python dependencies
├── .env                 # Environment variables (private)
├── processed_items.db   # SQLite database
├── templates/           # HTML templates
├── static/              # CSS, JS, images
└── uploads/             # User uploaded files
```

## Troubleshooting

**Port already in use?**
```bash
lsof -i :5000
kill -9 <PID>
```

**Database locked?**
```bash
# Restart service
systemctl restart health-journal
```

**Nginx not proxying?**
```bash
# Check config
nginx -t

# Restart
systemctl restart nginx
```

You're ready to deploy to production! 🚀
