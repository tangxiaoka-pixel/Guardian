#!/usr/bin/env bash
set -euo pipefail

name="${1:?用法: ./scripts/start-feature.sh <功能名称>}"
branch="feature/${name#feature/}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区有未提交内容，请先提交或暂存。" >&2
  exit 1
fi

git checkout develop
git pull --ff-only origin develop
git checkout -b "$branch" 2>/dev/null || git checkout "$branch"
echo "已进入 $branch"
