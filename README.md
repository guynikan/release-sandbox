# release-sandbox

Fictional sandbox that reproduces a release-please based release flow (branches `master` = production,
`release` = next version, `develop` = optional integration). Nothing here is real product code.

Workflows live in `.github/workflows/`; Netlify-related jobs skip until `vars.NETLIFY_ENABLED == 'true'`.
Developer scripts: `yarn task <KEY> --type feat|fix|chore --title "..." [--hotfix]` and `yarn pr [--base <branch>]`.

Findings and the run log are kept outside this repo by the sandbox owner.

