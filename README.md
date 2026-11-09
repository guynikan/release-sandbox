# release-sandbox

Fictional sandbox that reproduces a release-please based release flow. Nothing here is real product code.
Phase D design (rerun in phase E with the PR 5198 files): no GitHub App; master advances only through a PR merged by a person.

| Branch | Role |
| --- | --- |
| `master` | production; PR-only (merge commit); a push that merges `publish/*` or `hotfix/*` triggers `Publish` |
| `next-release` | next version, fixed, never deleted; PR-only; release-please runs here (`release/x.y.z` branches may coexist) |
| `develop` | optional integration; receives `next-release` on every push |
| `publish/X.Y.Z` | created at the release tag by `Release Please`; PR `publish/X.Y.Z -> master` titled `Release X.Y.Z` |

## Workflows (gated by `vars.RELEASE_FLOW_ENABLED == 'true'`)

`release-please` (+ job `production-draft`), `publish`, `rollback`, `hotfix-draft`, `sync-master-to-next-release`,
`sync-develop`, plus ports of the real repo triggers (`conviso_cli`, `pr-preview*`, `staging`, `reset_staging`) and
`ci`, `prerelease`. Everything uses `GITHUB_TOKEN`; the person who merges is the guardian.

## Settings

- Merge methods: squash + merge commit, rebase off. `master` ruleset: deletion, non_fast_forward, pull_request (merge commit only), no bypass.
- `next-release` ruleset: PR required, no deletion, no force push.
- Actions > "Allow GitHub Actions to create and approve pull requests" on.
- Unused leftovers from phase C: `vars.APP_ID`, `vars.DISPATCH_CHAIN`, secret `APP_PRIVATE_KEY`.
extra content not in the draft
