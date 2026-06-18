#!/usr/bin/env bash
# Rugplay production bootstrap for the mikr.us VPS (1 GB RAM, Debian 12).
# Run as root. Idempotent — safe to re-run.
#
# Usage:
#   bash deploy/bootstrap.sh
#
# Serves the app over HTTP on the public port 20153 (mikr.us intercepts :80 and
# :443/TLS isn't usable for this subdomain). Host nginx reverse-proxies :20153 to
# the app (3000) and websocket (8080) containers.
#
# Expects the repo present at /opt/rugplay with website/.env scp'd in place
# (it is gitignored and never lives in the repo). The bootstrap rewrites the two
# PUBLIC_* URL vars to the prod values.

set -euo pipefail

REPO_DIR="/opt/rugplay"
REPO_URL="https://github.com/blitzprogramer/rugplayblitza.git"
SITE_URL="${SITE_URL:-http://bob153.mikrus.xyz:20153}"
WS_URL="${WS_URL:-ws://bob153.mikrus.xyz:20153/ws}"

echo "==> 1/6  Swap (2G — best-effort; LXC/mikr.us disallows swapon, app runs without)"
if swapon --show | grep -q swapfile; then
	echo "    already present"
elif fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048; then
	chmod 600 /swapfile
	mkswap /swapfile
	if swapon /swapfile 2>/dev/null; then
		grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
		echo "    swap created"
	else
		rm -f /swapfile
		echo "    swapon denied (container) — proceeding without swap"
	fi
else
	echo "    could not allocate swapfile — proceeding without swap"
fi

echo "==> 2/6  Docker + git"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
	systemctl enable --now docker
else
	echo "    docker present"
fi
if ! command -v git >/dev/null 2>&1; then
	apt-get update && apt-get install -y git
else
	echo "    git present"
fi

echo "==> 3/6  Repo"
if [ ! -d "$REPO_DIR/.git" ]; then
	git clone "$REPO_URL" "$REPO_DIR"
else
	git -C "$REPO_DIR" pull --ff-only || true
fi
cd "$REPO_DIR"

echo "==> 4/6  .env (secrets — scp'd in, not from git)"
if [ ! -f website/.env ]; then
	echo "ERROR: website/.env not found. From your machine:"
	echo "  scp -P 10153 website/.env root@bob153.mikrus.xyz:/opt/rugplay/website/.env"
	exit 1
fi
# Rewrite the two PUBLIC URL vars to prod (others — secrets — stay as-is).
sed -i "s|^PUBLIC_BETTER_AUTH_URL=.*|PUBLIC_BETTER_AUTH_URL=${SITE_URL}|" website/.env
sed -i "s|^PUBLIC_WEBSOCKET_URL=.*|PUBLIC_WEBSOCKET_URL=${WS_URL}|" website/.env
echo "    PUBLIC_BETTER_AUTH_URL=${SITE_URL}"
echo "    PUBLIC_WEBSOCKET_URL=${WS_URL}"

echo "==> 5/6  nginx reverse proxy on :20153"
command -v nginx >/dev/null 2>&1 || apt-get install -y nginx
cp "$REPO_DIR/deploy/nginx-rugplay.conf" /etc/nginx/sites-available/rugplay
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/rugplay /etc/nginx/sites-enabled/rugplay
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx
echo "    nginx proxying :20153 -> app(3000) + /ws(8080)"

echo "==> 6/6  Pull images & start stack"
docker compose pull
docker compose up -d

echo ""
echo "==> Done. Container status:"
docker compose ps
echo ""
echo "Site (HTTP): ${SITE_URL}"
echo "Watch startup:  docker compose logs -f app"
