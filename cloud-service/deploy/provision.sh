#!/bin/sh
set -eu
stage=/home/vps/.codesnap-mail-staging
project=/home/vps/projects/CodeSnap-Mail
if ! id codesnap-mail >/dev/null 2>&1; then useradd --system --home-dir /var/lib/codesnap-mail --shell /usr/sbin/nologin codesnap-mail; fi
install -d -m 700 -o codesnap-mail -g codesnap-mail /var/lib/codesnap-mail
install -d -m 700 /etc/codesnap-mail
if [ ! -f /etc/codesnap-mail/service.env ]; then
  umask 077
  printf 'VAULT_KEY=' > /etc/codesnap-mail/service.env
  openssl rand -base64 32 >> /etc/codesnap-mail/service.env
  printf 'DATA_DIR=/var/lib/codesnap-mail\nPORT=8787\nEXTENSION_ORIGINS=chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak\nYANDEX_CLIENT_ID=5b0ca6a9756e42c284b7222a483c53f2\n' >> /etc/codesnap-mail/service.env
fi
if ! grep -q '^YANDEX_CLIENT_SECRET=' /etc/codesnap-mail/service.env; then cat "$stage/yandex.env" >> /etc/codesnap-mail/service.env; fi
chmod 600 /etc/codesnap-mail/service.env
rm "$stage/yandex.env"
install -m 644 "$project/deploy/codesnap-mail.service" /etc/systemd/system/codesnap-mail.service
backup=/etc/nginx/sites-available/codesnap.before-cloud-$(date +%Y%m%d-%H%M%S)
cp /etc/nginx/sites-available/codesnap "$backup"
node "$project/deploy/nginx-config.cjs"
nginx -t
systemctl daemon-reload
systemctl enable --now codesnap-mail
systemctl reload nginx
systemctl is-active codesnap-mail
systemctl show codesnap-mail -p NRestarts -p User -p MainPID
stat -c '%a %U %n' /etc/codesnap-mail/service.env /var/lib/codesnap-mail
