#!/usr/bin/env bash
# Prepares the hotfix branch locally (no push, no token): updates it with origin/master when behind (conflict
# aborts), squashes it into ONE commit `<NEW_TITLE> (#PR)` and adds the patch bump commit.
# Idempotent: a re-run after a first run pushed the squashed branch and failed later finds the bump already in
# the tree, so the bump commit is skipped instead of failing with "nothing to commit".
# Env: HEAD_REF, NEXT, NEW_TITLE, PR, CLI (path of release-flow/cli.js). Run inside the repository.
set -euo pipefail

git checkout -q -B "$HEAD_REF" "origin/$HEAD_REF"
if ! git merge-base --is-ancestor origin/master HEAD; then
  echo "Branch is behind master: merging master into it first"
  if ! git merge --no-edit origin/master >/dev/null; then
    git merge --abort
    echo "::error::Conflict between $HEAD_REF and master; resolve it on the branch and run again."
    exit 1
  fi
fi
# One commit typed hotfix(...): release-please ignores unknown types.
git reset -q --soft origin/master
MSG=$(mktemp)
printf '%s (#%s)\n' "$NEW_TITLE" "$PR" > "$MSG"
git commit -q -F "$MSG"
rm -f "$MSG"
node "$CLI" bump-version
git add package.json .release-please-manifest.json
if git diff --cached --quiet; then
  echo "Version is already $NEXT in the branch (re-run): no bump commit"
else
  git commit -q -m "Release $NEXT (hotfix)"
fi
