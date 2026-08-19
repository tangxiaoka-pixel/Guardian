#!/usr/bin/env bash
set -euo pipefail

feature="${1:?用法: ./scripts/promote-and-deploy.sh <feature/功能名称>}"
[[ "$feature" == feature/* ]] || feature="feature/$feature"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区有未提交内容，请先提交。" >&2
  exit 1
fi

git fetch origin
git checkout "$feature"
git pull --ff-only origin "$feature"
npm run build

git checkout develop
git pull --ff-only origin develop
git merge --no-ff "$feature" -m "merge: $feature into develop"
git push origin develop

git checkout main
git pull --ff-only origin main
git merge --no-ff develop -m "release: promote develop to main"
git push origin main

"$(dirname "$0")/deploy-cloud-main.sh"
git checkout develop
