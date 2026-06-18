#!/usr/bin/env bash
# Rugplay production bootstrap for a small (1 GB) mikr.us VPS.
# Run as root. Idempotent — safe to re-run.
#
# Usage:
#   DOMAIN=srvXXXX.mikr.us bash deploy/bootstrap.sh
#
# Expects the repo present at /opt/rugplay with website/.env in place.
# (This script clones the repo if missing, but .env must be scp'd separately —
#  it is gitignored and never lives in the repo.)

set -euo pipefail

REPO_DIR="/opt/rugplay"
REPO_URL="https://github.com/blitzprogramer/rugplayblitza.git"

echo "==> 1/5  Swap (2G, so the image pull / runtime never OOMs on 1G RAM)"
if ! swapon --show | grep -q swapfile; then
	fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
	echo "    swap created"
else
	echo "    already present"
fi

echo "==> 2/5  Docker"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
	systemctl enable --now docker
else
	echo "    already installed"
fi

echo "==> 3/5  Repo"
if [ ! -d "$REPO_DIR/.git" ]; then
	git clone "$REPO_URL" "$REPO_DIR"
else
	git -C "$REPO_DIR" pull --ff-only || true
fi
cd "$REPO_DIR"

echo "==> 4/5  .env (secrets — must be scp'd here, not from git)"
if [ ! -f website/.env ]; then
	echo "ERROR: website/.env not found. scp it from your machine first:"
	echo "  scp website/.env root@<vps>:/opt/rugplay/website/.env"
	exit 1
fi

echo "==> 5/5  Pull images & start stack"
: "${DOMAIN:?DOMAIN is required, e.g. DOMAIN=srvXXXX.mikr.us bash deploy/bootstrap.sh}"
echo "    domain: $DOMAIN"
docker compose pull
DOMAIN="$DOMAIN" docker compose up -d

echo ""
echo "==> Done. Container status:"
docker compose ps
echo ""
echo "Watch the app start:"
echo "  docker compose logs -f app"
