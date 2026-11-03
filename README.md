# release-sandbox

Fictional sandbox that reproduces a release-please based release flow. Nothing here is real product code.

| Branch | Role |
| --- | --- |
| `master` | production; only moves by the `Publish` workflow (fast-forward to a tag) |
| `release` | next version, fixed, never deleted; PR-only; release-please runs here |
| `develop` | optional integration; receives `release` on every push |

Developer scripts: `yarn task <KEY> --type feat|fix|chore --title "..." [--hotfix]`, then `yarn pr [--base <branch>]`.

## Workflows

`ci`, `preview`, `cleanup-previews`, `prerelease`, `sync-develop`, `release-please`, `production-draft`,
`publish`, `rollback`, `hotfix`, `sync-master-to-release`. Netlify jobs skip until `vars.NETLIFY_ENABLED == 'true'`
(each has a `simulated-*` twin that writes a job summary instead).

## Repository settings that matter

- Merge methods: squash + merge commit allowed, rebase disabled. Squash commit title = PR title
  (`squash_merge_commit_title=PR_TITLE`), otherwise a single-commit PR uses the commit message, not the PR title.
  Merge commits are required by the master -> release sync (a squash would not record master as a parent).
  The methods are repo-wide (and per ruleset, per branch), not per PR type: `release` receives both feature PRs
  (squash) and sync PRs (merge), so squash-only for features is a convention, not an enforced rule.
- Actions > "Allow GitHub Actions to create and approve pull requests" must be on (release-please, sync PR).
- `vars.DISPATCH_CHAIN == 'true'`: events created with `GITHUB_TOKEN` do not trigger workflows, so the chain
  (publish -> sync -> prerelease/sync-develop/release-please; release-please -> production-draft; hotfix -> production-draft)
  uses `gh workflow run` (`workflow_dispatch` is the documented exception). Dispatchable workflows must exist on the default branch.
- Rulesets: `release-via-pr-only` (PR required, 0 approvals, no deletion, no force push, merge methods squash+merge);
  `master-publish-only` (no deletion, no force push; the `update` rule is removed in this sandbox because `GITHUB_TOKEN`
  cannot be a bypass actor in a personal repo).
- release-please: hotfix tags are `hotfix-X.Y.Z` (not `vX.Y.Z`) and hotfix commits are typed `hotfix(...)`; see `hotfix.yml`.
