#!/usr/bin/env bash
# Usage: sync-pr.sh <base> <head> <pr-title>
# Skips when <base> already contains <head> or when merging would change no content.
# Opens (or reuses) a PR head -> base and merges it with a real merge commit.
# When the automatic merge is refused (conflict, or a restriction such as the one GITHUB_TOKEN has
# on workflow files), the PR stays open, a comment explains why and that a person must merge it,
# and the script exits 1 so the run fails visibly. A human merge triggers downstream workflows.
# Needs GH_TOKEN and GITHUB_REPOSITORY. Sets `merged=true` in GITHUB_OUTPUT on success.
set -euo pipefail

BASE="$1"
HEAD="$2"
TITLE="$3"
OUT="${GITHUB_OUTPUT:-/dev/null}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# No network git here: the workflow checks out with fetch-depth 0 and persist-credentials false,
# which already brings every origin/* ref. Everything else goes through gh (API).
if git merge-base --is-ancestor "origin/$HEAD" "origin/$BASE"; then
  echo "$BASE already contains $HEAD" | tee -a "$SUMMARY"
  exit 0
fi
# Skip when merging HEAD into BASE would change no content (e.g. the empty merge commit left on
# master by each release PR). merge-tree exits non-zero on conflict; then we go on and let the PR flag it.
if MERGED_TREE=$(git merge-tree --write-tree "origin/$BASE" "origin/$HEAD" 2>/dev/null | head -n1) \
  && [ "$MERGED_TREE" = "$(git rev-parse "origin/$BASE^{tree}")" ]; then
  echo "Merging $HEAD into $BASE would change no content; nothing to sync" | tee -a "$SUMMARY"
  exit 0
fi
HEAD_SHA=$(git rev-parse "origin/$HEAD")

# Only a same-repo PR whose head branch is exactly $HEAD is reused (never a fork's branch).
N=$(gh pr list --base "$BASE" --head "$HEAD" --state open --json number,isCrossRepository,headRefName \
  --jq "[.[] | select(.isCrossRepository == false and .headRefName == \"$HEAD\")][0].number // empty")
if [ -z "$N" ]; then
  N=$(gh pr create --base "$BASE" --head "$HEAD" --title "$TITLE" \
    --body "Automatic sync of $HEAD into $BASE. Merged with a real merge commit (never squash)." | sed 's#.*/##')
fi

# Comment once per kind of failure, so repeated runs do not spam the PR.
comment_once() {
  local marker="$1" body="$2"
  local existing
  existing=$(gh pr view "$N" --json comments --jq '.comments[].body')
  if ! grep -qF "<!-- $marker -->" <<<"$existing"; then
    gh pr comment "$N" --body "<!-- $marker -->
$body"
  fi
}

STATE=UNKNOWN
for _ in $(seq 1 15); do
  STATE=$(gh pr view "$N" --json mergeable --jq .mergeable)
  [ "$STATE" != "UNKNOWN" ] && break
  sleep 4
done
echo "PR #$N mergeable=$STATE"

if [ "$STATE" = "CONFLICTING" ]; then
  comment_once "sync-conflict" "Automatic merge not possible: there is a conflict between \`$HEAD\` and \`$BASE\`. A person must resolve it (merge \`$BASE\` into a branch from \`$HEAD\`, or resolve it locally) and merge with a merge commit, never squash. This PR is left open on purpose."
  echo "::error::PR #$N ($HEAD -> $BASE) has conflicts; left open for a person to merge."
  exit 1
fi

if ! ERR=$(gh pr merge "$N" --merge --match-head-commit "$HEAD_SHA" --subject "Merge $HEAD into $BASE (sync #$N)" 2>&1); then
  echo "$ERR"
  comment_once "sync-refused" "Automatic merge was refused: \`$ERR\`

A person must merge this PR with a merge commit (not squash). This is expected when the diff changes \`.github/workflows\` and the token lacks the \`workflows\` permission, or when a branch rule blocks the bot. A merge by a person also triggers the downstream workflows. This PR is left open on purpose."
  echo "::error::Automatic merge of PR #$N ($HEAD -> $BASE) was refused: ${ERR%%$'\n'*}. Left open for a person to merge."
  exit 1
fi
echo "merged=true" >> "$OUT"
echo "PR #$N merged ($HEAD -> $BASE)" >> "$SUMMARY"
