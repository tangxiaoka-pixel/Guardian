#!/usr/bin/env bash
set -euo pipefail

cloud_host="${GUARDIAN_CLOUD_HOST:-root@122.51.227.54}"
cloud_dir="/root/Guardian/cloud/admin"
web_dir="/var/www/guardian/admin"

if [[ "$(git symbolic-ref --quiet --short HEAD)" != "main" ]]; then
  echo "只能从本地 main 触发生产发布。" >&2
  exit 1
fi

git pull --ff-only origin main

ssh "$cloud_host" "
  set -euo pipefail
  git config --global --add safe.directory '$cloud_dir'
  cd '$cloud_dir'
  if [ ! -d .git ]; then
    git init
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin git@github.com:tangxiaoka-pixel/Guardian.git
  fi
  export GIT_SSH_COMMAND='ssh -i /root/.ssh/guardian_github_deploy -o IdentitiesOnly=yes'
  git fetch origin main
  git checkout -B main origin/main
  npm ci
  npm run build
  rsync -rc --delete --exclude='.DS_Store' dist/ '$web_dir/'
  systemctl restart guardian-cloud-api.service
  systemctl is-active guardian-cloud-api.service
"

echo "腾讯云已从 GitHub main 完成部署。"
