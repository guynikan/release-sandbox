"use strict";
// Smoke tests of the command line: what the workflows actually run.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "cli.js");

function run(command, { env = {}, input = "", cwd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-flow-"));
  const out = path.join(dir, "output");
  const sum = path.join(dir, "summary");
  fs.writeFileSync(out, "");
  fs.writeFileSync(sum, "");
  const r = spawnSync(process.execPath, [CLI, command], {
    input,
    cwd: cwd || dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, ...env },
  });
  const outputs = Object.fromEntries(
    fs.readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { status: r.status, stdout: r.stdout, outputs, summary: fs.readFileSync(sum, "utf8"), dir };
}

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const repo = "closeer-team/closeer-web-empresas";
const pr = (ref) => [
  { number: 3, title: "t", merged_at: "x", merge_commit_sha: SHA, base: { ref: "master" }, head: { ref, sha: "d".repeat(40), repo: { full_name: repo } } },
];

test("detect-pr acts on publish/* and skips ordinary pushes", () => {
  const env = { GITHUB_SHA: SHA, GITHUB_REPOSITORY: repo };
  const hit = run("detect-pr", { env, input: JSON.stringify(pr("publish/2.46.0")) });
  assert.equal(hit.status, 0);
  assert.deepEqual(hit.outputs, { kind: "publish", act: "true", number: "3", head_ref: "publish/2.46.0", head_sha: "d".repeat(40), version: "2.46.0" });
  const miss = run("detect-pr", { env, input: JSON.stringify(pr("feature/x")) });
  assert.equal(miss.outputs.act, "false");
  assert.match(miss.summary, /Publish skipped/);
  assert.equal(run("detect-pr", { env, input: "[]" }).outputs.act, "false");
});

test("detect-pr skips (green) with a note on an unusual branch name", () => {
  const r = run("detect-pr", { env: { GITHUB_SHA: SHA, GITHUB_REPOSITORY: repo }, input: JSON.stringify(pr("hotfix/$(id)")) });
  assert.equal(r.status, 0);
  assert.equal(r.outputs.act, "false");
  assert.match(r.summary, /unusual characters/);
  assert.match(r.summary, /Nothing was published/);
  assert.doesNotMatch(r.summary, /\$\(id\)/);
});

test("decide-publish exits non-zero only when it refuses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
  const file = path.join(dir, "deploy-state.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ kind: "release", tag: "2.46.0", version: "2.46.0", commit: SHA, tree: TREE, draftDeployId: "6aede3b442a3dfda60fbbc6c", previousDeployId: "", siteId: "ecaf0137-9763-432e-8257-59cb5a828116", createdAt: "x" }),
  );
  const base = { KIND: "publish", PR_NUMBER: "3", HEAD_REF: "publish/2.46.0", DRAFT_TAG: "2.46.0", STATE_FILE: file, TAG_COMMIT: SHA, MASTER_TREE: TREE, TAG_TREE: TREE };
  const ok = run("decide-publish", { env: base });
  assert.equal(ok.status, 0);
  assert.equal(ok.outputs.action, "publish");
  assert.equal(ok.outputs.draft, "6aede3b442a3dfda60fbbc6c");
  const bad = run("decide-publish", { env: { ...base, MASTER_TREE: "c".repeat(40) } });
  assert.equal(bad.status, 1);
  assert.equal(bad.outputs.action, "fail");
  assert.match(bad.summary, /REFUSED/);
  const noRelease = run("decide-publish", { env: { ...base, DRAFT_TAG: "", STATE_FILE: "" } });
  assert.equal(noRelease.status, 1);
  assert.equal(noRelease.outputs.action, "fail");
  const ordinary = run("decide-publish", { env: { ...base, KIND: "hotfix", HEAD_REF: "hotfix/x", DRAFT_TAG: "", STATE_FILE: "" } });
  assert.equal(ordinary.status, 0);
  assert.equal(ordinary.outputs.action, "skip");
});

test("hotfix-plan outputs the tags and the renamed title", () => {
  const r = run("hotfix-plan", {
    env: { PACKAGE_VERSION: "2.46.0", MANIFEST_VERSION: "2.46.0", TAGS: "2.45.0\n2.46.0\n", PR_TITLE: "fix(CF-77): login" },
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.outputs, { current: "2.46.0", next: "2.46.1", tag: "hotfix-2.46.1", anchor_tag: "2.46.0", plain_tag: "2.46.1", new_title: "hotfix(CF-77): login" });
});

test("bump-version and deploy-state write their files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bump-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{\n  "name": "a",\n  "version": "2.46.0"\n}\n');
  fs.writeFileSync(path.join(dir, ".release-please-manifest.json"), '{\n  ".": "2.46.0"\n}\n');
  assert.equal(run("bump-version", { env: { NEXT: "2.46.1" }, cwd: dir }).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "package.json"), "utf8"), /"version": "2.46.1"/);
  assert.match(fs.readFileSync(path.join(dir, ".release-please-manifest.json"), "utf8"), /"\.": "2\.46\.1"/);
  const r = run("deploy-state", {
    cwd: dir,
    env: { KIND: "hotfix", TAG: "hotfix-2.46.1", VERSION: "2.46.1", COMMIT: SHA, TREE, DRAFT_DEPLOY_ID: "6aede3b442a3dfda60fbbc6c", PREVIOUS_DEPLOY_ID: "6aea25c16fb1612f4fb7ac90", SITE_ID: "ecaf0137-9763-432e-8257-59cb5a828116", PR: "5" },
  });
  assert.equal(r.status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "deploy-state.json"), "utf8"));
  assert.equal(state.pr, 5);
  assert.equal(state.draftDeployId, "6aede3b442a3dfda60fbbc6c");
});

test("workflow-files fails with a message for the guardian", () => {
  const bad = run("workflow-files", { input: "src/a.js\n.github/workflows/ci.yml\n" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /merge it by hand/);
  assert.equal(run("workflow-files", { input: "src/a.js\n" }).status, 0);
});

test("rollback-target", () => {
  const cur = "6aede3b442a3dfda60fbbc6c";
  const prev = "6aea25c16fb1612f4fb7ac90";
  const r = run("rollback-target", { env: { CURRENT_DEPLOY: cur }, input: JSON.stringify([{ payload: { deployId: cur, previousDeployId: prev } }]) });
  assert.equal(r.outputs.target, prev);
  assert.equal(run("rollback-target", { env: { CURRENT_DEPLOY: cur }, input: "[]" }).status, 1);
});
