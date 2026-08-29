#!/usr/bin/env bash

set -euo pipefail

github_user="${GH_USER:-johanvaneck}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname -- "$script_dir")"

if ! command -v gh >/dev/null 2>&1; then
  printf 'Error: GitHub CLI (gh) is required.\n' >&2
  exit 1
fi

token="$(gh auth token --user "$github_user")"
auth="$(printf 'x-access-token:%s' "$token" | base64)"

cd "$repo_root"

if (( $# )); then
  git -c credential.helper= -c http.extraHeader="Authorization: Basic $auth" push "$@"
else
  git -c credential.helper= -c http.extraHeader="Authorization: Basic $auth" push origin master
fi
