"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("./lib");

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const OTHER_TREE = "c".repeat(40);
const DEPLOY = "6aede3b442a3dfda60fbbc6c";
const PREVIOUS = "6aea25c16fb1612f4fb7ac90";

const state = (over = {}) => ({
  kind: "release",
  tag: "2.46.0",
  version: "2.46.0",
  commit: SHA,
  tree: TREE,
  draftDeployId: DEPLOY,
  previousDeployId: PREVIOUS,
  siteId: "ecaf0137-9763-432e-8257-59cb5a828116",
  createdAt: "2026-11-09T12:00:00Z",
  ...over,
});

test("classifyHeadRef accepts only strict publish/* and hotfix/* names", () => {
  assert.deepEqual(lib.classifyHeadRef("publish/2.46.0"), { kind: "publish", version: "2.46.0" });
  assert.deepEqual(lib.classifyHeadRef("hotfix/CF-123_fix.login"), { kind: "hotfix" });
  assert.deepEqual(lib.classifyHeadRef("feature/x"), { kind: "other" });
  assert.deepEqual(lib.classifyHeadRef("release/2.45.0"), { kind: "other" });
  assert.deepEqual(lib.classifyHeadRef(undefined), { kind: "other" });
  // Unusual characters: never acted on, but not an error either (the run skips with a note).
  for (const ref of ["hotfix/$(curl evil)", "publish/a;b", "hotfix/a b", "hotfix/ação", "publish/"]) {
    assert.deepEqual(lib.classifyHeadRef(ref), { kind: "other", unusual: true }, ref);
  }
});

test("pickMergedPr matches merge_commit_sha, base master and same-repo head", () => {
  const repo = "closeer-team/closeer-web-empresas";
  const pr = (over = {}) => ({
    number: 7,
    title: "Release 2.46.0",
    merged_at: "2026-11-09T12:00:00Z",
    merge_commit_sha: SHA,
    base: { ref: "master" },
    head: { ref: "publish/2.46.0", sha: "d".repeat(40), repo: { full_name: repo } },
    ...over,
  });
  assert.deepEqual(lib.pickMergedPr([pr()], { sha: SHA, repo }), {
    number: 7,
    headRef: "publish/2.46.0",
    headSha: "d".repeat(40),
    title: "Release 2.46.0",
  });
  assert.equal(lib.pickMergedPr([pr({ merged_at: null })], { sha: SHA, repo }), null);
  assert.equal(lib.pickMergedPr([pr({ merge_commit_sha: "e".repeat(40) })], { sha: SHA, repo }), null);
  assert.equal(lib.pickMergedPr([pr({ base: { ref: "develop" } })], { sha: SHA, repo }), null);
  assert.equal(
    lib.pickMergedPr([pr({ head: { ref: "publish/9", sha: "d".repeat(40), repo: { full_name: "fork/x" } } })], { sha: SHA, repo }),
    null,
  );
  assert.equal(lib.pickMergedPr([], { sha: SHA, repo }), null);
  assert.equal(lib.pickMergedPr(null, { sha: SHA, repo }), null);
});

test("nextPatch and parseSemver", () => {
  assert.equal(lib.nextPatch("2.46.0"), "2.46.1");
  assert.equal(lib.nextPatch("2.46.9"), "2.46.10");
  assert.equal(lib.nextPatch(" 1.0.0\n"), "1.0.1");
  assert.throws(() => lib.nextPatch("2.46"), /MAJOR.MINOR.PATCH/);
  assert.throws(() => lib.nextPatch("2.46.0-rc.1"), /MAJOR.MINOR.PATCH/);
});

test("hotfixPlan: next patch, hotfix tag and plain tag on the previous release", () => {
  const plan = lib.hotfixPlan({ packageVersion: "2.46.0", manifestVersion: "2.46.0", tags: ["2.45.0", "2.46.0", "hotfix-2.45.1"] });
  assert.deepEqual(plan, { current: "2.46.0", next: "2.46.1", hotfixTag: "hotfix-2.46.1", anchorTag: "2.46.0", plainTag: "2.46.1" });
});

test("hotfixPlan: keeps the v prefix of the anchor tag and refuses existing tags", () => {
  const plan = lib.hotfixPlan({ packageVersion: "0.8.1", manifestVersion: "0.8.1", tags: ["v0.8.1"] });
  assert.equal(plan.plainTag, "v0.8.2");
  for (const taken of ["hotfix-2.46.1", "2.46.1", "v2.46.1"]) {
    assert.throws(
      () => lib.hotfixPlan({ packageVersion: "2.46.0", manifestVersion: "2.46.0", tags: ["2.46.0", taken] }),
      /already exists/,
    );
  }
});

test("hotfixPlan fails when the manifest version has no release tag", () => {
  assert.throws(
    () => lib.hotfixPlan({ packageVersion: "2.46.0", manifestVersion: "2.46.0", tags: ["2.45.0"] }),
    /No release tag for manifest version 2.46.0/,
  );
});

test("hotfixTitle renames to hotfix(KEY): ...", () => {
  assert.equal(lib.hotfixTitle("fix(CF-1234): corrige login"), "hotfix(CF-1234): corrige login");
  assert.equal(lib.hotfixTitle("feat(CF-9): x"), "hotfix(CF-9): x");
  assert.equal(lib.hotfixTitle("hotfix(CF-9): x"), "hotfix(CF-9): x");
  assert.equal(lib.hotfixTitle("fix: algo"), "hotfix: algo");
  assert.equal(lib.hotfixTitle("Corrige o login"), "hotfix: Corrige o login");
  assert.equal(lib.hotfixTitle("fix(CF-1):  dois   espaços\n"), "hotfix(CF-1): dois espaços");
});

test("bumpVersionFiles changes only the version lines", () => {
  const packageText = '{\n  "name": "app",\n  "version": "2.46.0",\n  "files": ["a", "b"],\n  "dependencies": { "x": "1.0.0" }\n}\n';
  const out = lib.bumpVersionFiles({ packageText, manifestText: '{\n  ".": "2.46.0"\n}\n', next: "2.46.1" });
  assert.equal(out.packageText, packageText.replace('"2.46.0"', '"2.46.1"'));
  assert.equal(out.manifestText, '{\n  ".": "2.46.1"\n}\n');
  assert.throws(() => lib.bumpVersionFiles({ packageText: "{}", manifestText: "{}", next: "2.46.1" }), /version/);
  assert.throws(() => lib.bumpVersionFiles({ packageText, manifestText: "{}", next: "x" }), /MAJOR.MINOR.PATCH/);
});

test("workflowFiles lists the paths a GITHUB_TOKEN cannot push", () => {
  assert.deepEqual(lib.workflowFiles(["src/a.js", ".github/workflows/x.yml", ".github/scripts/y.sh", " .github/workflows/z.yml\r"]), [
    ".github/workflows/x.yml",
    ".github/workflows/z.yml",
  ]);
  assert.deepEqual(lib.workflowFiles(["src/a.js", ""]), []);
});

test("deploy-state: build and parse round trip", () => {
  const built = lib.buildDeployState({ ...state(), pr: "12" });
  assert.equal(built.pr, 12);
  assert.deepEqual(lib.parseDeployState(JSON.stringify(built)), built);
  assert.equal("pr" in lib.buildDeployState(state()), false);
  assert.equal(lib.buildDeployState({ ...state(), previousDeployId: undefined }).previousDeployId, "");
});

test("deploy-state: rejects broken files", () => {
  assert.throws(() => lib.parseDeployState("not json"), /not valid JSON/);
  assert.throws(() => lib.parseDeployState("[]"), /missing or empty/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ draftDeployId: "null" }))), /draftDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ tree: "abc" }))), /"tree"/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ kind: "other" }))), /unknown kind/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ commit: "" }))), /"commit"/);
});

test("deploy-state: validates the Netlify ids and the site UUID", () => {
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ draftDeployId: "../etc" }))), /draftDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ draftDeployId: DEPLOY.toUpperCase() }))), /draftDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ draftDeployId: DEPLOY + "0" }))), /draftDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ previousDeployId: "nope" }))), /previousDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ previousDeployId: 5 }))), /previousDeployId/);
  assert.throws(() => lib.parseDeployState(JSON.stringify(state({ siteId: "closeer-empresas-production" }))), /siteId/);
  // previousDeployId may be empty (first publish)
  assert.equal(lib.parseDeployState(JSON.stringify(state({ previousDeployId: "" }))).previousDeployId, "");
});

const publishFacts = (over = {}) => ({
  kind: "publish",
  headSha: "d".repeat(40),
  draftTag: "2.46.0",
  state: state(),
  tagCommit: SHA,
  masterTree: TREE,
  tagTree: TREE,
  ...over,
});

test("decidePublish: publish when the draft exists and every tree matches", () => {
  const d = lib.decidePublish(publishFacts());
  assert.equal(d.action, "publish");
  assert.equal(d.tag, "2.46.0");
  assert.equal(d.draftDeployId, DEPLOY);
});

test("decidePublish: skip when the push is not a publish/hotfix merge", () => {
  assert.equal(lib.decidePublish({ kind: "other" }).action, "skip");
});

test("decidePublish: publish/* without a release or without deploy-state fails with the recovery path", () => {
  const noTag = lib.decidePublish(publishFacts({ draftTag: "", state: null }));
  assert.equal(noTag.action, "fail");
  assert.match(noTag.reason, /redo_draft_tag/);
  const noState = lib.decidePublish(publishFacts({ state: null }));
  assert.equal(noState.action, "fail");
  assert.match(noState.reason, /redo_draft_tag/);
  assert.match(noState.reason, /2\.46\.0/);
});

test("decidePublish: a hotfix tag at the head without deploy-state fails", () => {
  const d = lib.decidePublish({ kind: "hotfix", headSha: SHA, draftTag: "hotfix-2.46.1", state: null });
  assert.equal(d.action, "fail");
  assert.match(d.reason, /no deploy-state\.json/);
  assert.match(d.reason, /new hotfix\/\* PR/);
});

test("decidePublish: hotfix/* without a draft is ordinary work (skip)", () => {
  const d = lib.decidePublish({ kind: "hotfix", headSha: SHA, draftTag: "", staleHotfixTag: "" });
  assert.equal(d.action, "skip");
  assert.match(d.reason, /ordinary work/);
});

test("decidePublish: hotfix branch changed after the draft fails and names the stale tag", () => {
  const d = lib.decidePublish({ kind: "hotfix", headSha: "f".repeat(40), draftTag: "", staleHotfixTag: "hotfix-2.46.1" });
  assert.equal(d.action, "fail");
  assert.match(d.reason, /hotfix-2.46.1/);
  assert.match(d.reason, /changed after the draft/);
  // What happened and the path that exists today (the PR is already merged).
  assert.match(d.reason, /master already has the hotfix content and the bumped version, and production does NOT/);
  assert.match(d.reason, /open a new hotfix\/\* PR from master and run hotfix-draft/);
  assert.match(d.reason, /only cleanup/);
  assert.doesNotMatch(d.reason, /run hotfix-draft again/);
});

test("decidePublish: master tree different from the draft tree fails", () => {
  const d = lib.decidePublish(publishFacts({ masterTree: OTHER_TREE }));
  assert.equal(d.action, "fail");
  assert.match(d.reason, /Nothing was published/);
});

test("decidePublish: tag tree different from the draft tree fails", () => {
  assert.equal(lib.decidePublish(publishFacts({ tagTree: OTHER_TREE })).action, "fail");
});

test("decidePublish: state that does not describe the tag found fails", () => {
  assert.equal(lib.decidePublish(publishFacts({ state: state({ tag: "2.45.0" }) })).action, "fail");
  assert.equal(lib.decidePublish(publishFacts({ tagCommit: "e".repeat(40) })).action, "fail");
});

test("decidePublish: hotfix with a draft at the PR head and equal trees publishes", () => {
  const hotfix = state({ kind: "hotfix", tag: "hotfix-2.46.1", version: "2.46.1" });
  const d = lib.decidePublish({
    kind: "hotfix",
    headSha: SHA,
    draftTag: "hotfix-2.46.1",
    state: hotfix,
    tagCommit: SHA,
    masterTree: TREE,
    tagTree: TREE,
  });
  assert.equal(d.action, "publish");
  assert.equal(d.tag, "hotfix-2.46.1");
});

test("pickRollbackTarget: default is the previous deploy of the last recorded publish", () => {
  const deployments = [
    { payload: { deployId: DEPLOY, previousDeployId: PREVIOUS, tag: "2.46.0" } },
    { payload: { deployId: PREVIOUS, previousDeployId: "1".repeat(24), tag: "2.45.0" } },
  ];
  assert.equal(lib.pickRollbackTarget({ currentId: DEPLOY, deployments }), PREVIOUS);
});

test("pickRollbackTarget: alternates after a rollback record", () => {
  const deployments = [
    { payload: { deployId: PREVIOUS, previousDeployId: DEPLOY, tag: "rollback" } },
    { payload: { deployId: DEPLOY, previousDeployId: PREVIOUS, tag: "2.46.0" } },
  ];
  assert.equal(lib.pickRollbackTarget({ currentId: PREVIOUS, deployments }), DEPLOY);
});

test("pickRollbackTarget: explicit input wins and is validated", () => {
  assert.equal(lib.pickRollbackTarget({ input: ` ${PREVIOUS} `, currentId: DEPLOY, deployments: [] }), PREVIOUS);
  assert.throws(() => lib.pickRollbackTarget({ input: DEPLOY, currentId: DEPLOY, deployments: [] }), /already the live deploy/);
  assert.throws(() => lib.pickRollbackTarget({ input: "x; rm -rf", currentId: DEPLOY, deployments: [] }), /deploy id/);
  assert.throws(() => lib.pickRollbackTarget({ currentId: DEPLOY, deployments: [] }), /No recorded publish/);
  assert.throws(() => lib.pickRollbackTarget({ currentId: DEPLOY, deployments: [{ payload: { deployId: DEPLOY, previousDeployId: "" } }] }), /No recorded publish/);
});

test("changelogTypeFromLabels maps feature/bug, anything else or none is chore", () => {
  assert.equal(lib.changelogTypeFromLabels([{ name: "feature" }]), "feat");
  assert.equal(lib.changelogTypeFromLabels([{ name: "bug" }]), "fix");
  assert.equal(lib.changelogTypeFromLabels([{ name: "enhancement" }]), "chore");
  assert.equal(lib.changelogTypeFromLabels([{ name: "dependencies" }, { name: "javascript" }]), "chore");
  assert.equal(lib.changelogTypeFromLabels([]), "chore");
  assert.equal(lib.changelogTypeFromLabels(undefined), "chore");
  // Plain strings are accepted too (some callers pass label names, not label objects).
  assert.equal(lib.changelogTypeFromLabels(["feature"]), "feat");
  // Both present: bug (fix) wins, checked first.
  assert.equal(lib.changelogTypeFromLabels([{ name: "feature" }, { name: "bug" }]), "fix");
});

test("buildCommitOverride: type always comes from the label, scope is kept if the title has one", () => {
  assert.equal(lib.buildCommitOverride("feat", "filtro por unidade"), "feat: filtro por unidade");
  // Title still looks conventional (old habit): its own type is discarded, the scope is kept.
  assert.equal(lib.buildCommitOverride("fix", "feat(jobs): filtro por unidade"), "fix(jobs): filtro por unidade");
  assert.equal(lib.buildCommitOverride("chore", "docs: atualiza o README"), "chore: atualiza o README");
  // Extra colons after the first type/scope prefix stay in the description untouched.
  assert.equal(lib.buildCommitOverride("fix", "fix(auth): trata 401: redireciona pro login"), "fix(auth): trata 401: redireciona pro login");
  // Whitespace (including a trailing newline from the GitHub API) is collapsed.
  assert.equal(lib.buildCommitOverride("feat", "  algo   com   espaços \n"), "feat: algo com espaços");
  assert.equal(lib.buildCommitOverride("chore", ""), "chore: (sem título)");
  // A title that spells out the block delimiters must never break them: defused, not rejected.
  assert.equal(
    lib.buildCommitOverride("chore", "fecha a brecha do BEGIN_COMMIT_OVERRIDE / END_COMMIT_OVERRIDE"),
    "chore: fecha a brecha do BEGINCOMMITOVERRIDE / ENDCOMMITOVERRIDE",
  );
});

test("upsertCommitOverride appends the block, replaces it in place, and never touches the rest of the body", () => {
  const body = "## O quê\n\nAlgo útil.\n\n## Comentários adicionais\n";
  const added = lib.upsertCommitOverride(body, "feat: filtro por unidade");
  assert.equal(added, "## O quê\n\nAlgo útil.\n\n## Comentários adicionais\n\nBEGIN_COMMIT_OVERRIDE\nfeat: filtro por unidade\nEND_COMMIT_OVERRIDE\n");

  const replaced = lib.upsertCommitOverride(added, "fix: filtro por unidade");
  assert.equal(replaced, "## O quê\n\nAlgo útil.\n\n## Comentários adicionais\n\nBEGIN_COMMIT_OVERRIDE\nfix: filtro por unidade\nEND_COMMIT_OVERRIDE\n");

  // Idempotent: re-running with the same line changes nothing.
  assert.equal(lib.upsertCommitOverride(replaced, "fix: filtro por unidade"), replaced);

  assert.equal(lib.upsertCommitOverride("", "chore: x"), "BEGIN_COMMIT_OVERRIDE\nchore: x\nEND_COMMIT_OVERRIDE\n");
  assert.equal(lib.upsertCommitOverride(null, "chore: x"), "BEGIN_COMMIT_OVERRIDE\nchore: x\nEND_COMMIT_OVERRIDE\n");

  // Real shape used by hand on PR #5080: trailing blank lines around the block are normalized away.
  const manual = "Algo.\n\n\nBEGIN_COMMIT_OVERRIDE\nci(netlify): adiciona HSTS e Permissions-Policy (CF-2024)\nEND_COMMIT_OVERRIDE\n\n";
  assert.equal(lib.upsertCommitOverride(manual, "chore: adiciona HSTS e Permissions-Policy (CF-2024)"), "Algo.\n\nBEGIN_COMMIT_OVERRIDE\nchore: adiciona HSTS e Permissions-Policy (CF-2024)\nEND_COMMIT_OVERRIDE\n");
});
