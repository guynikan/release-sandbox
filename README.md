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
- GitHub App (`vars.APP_ID`, secret `APP_PRIVATE_KEY`, installed on this repo): `publish`, `sync-master-to-release`,
  `release-please` and `hotfix` mint a short-lived token with `actions/create-github-app-token` and use it instead of
  `GITHUB_TOKEN`. Events created by an App token trigger workflows normally, so nothing needs to be dispatched by hand:
  push to master -> sync; sync merge -> prerelease/sync-develop/release-please; release published -> production-draft;
  bot PRs run their checks. Minimum permissions used: Contents write, Pull requests write (+ Metadata read);
  Workflows write only if a push (not a PR merge) may carry changes to `.github/workflows/*`.
  `vars.DISPATCH_CHAIN` (default `false`) keeps the old `gh workflow run` chain for setups without an App; it is unused here.
- Rulesets: `release-via-pr-only` (PR required, 0 approvals, no deletion, no force push, merge methods squash+merge);
  `master-publish-only` (no deletion, no force push, `update` blocked for everyone; the App is the ONLY bypass actor, so
  only `publish` can move master). A normal user push or `GITHUB_TOKEN` push to master is rejected.
- release-please: hotfix tags are `hotfix-X.Y.Z` (not `vX.Y.Z`) and hotfix commits are typed `hotfix(...)`; see `hotfix.yml`.

d3 extra line that the tested draft does not have
<!-- ordinary hotfix/* work -->
