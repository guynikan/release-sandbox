"use strict";
// Runs squash-hotfix.sh against a throwaway git repository, including the re-run after a failed first run.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "squash-hotfix.sh");
const CLI = path.join(__dirname, "cli.js");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squash-"));
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  git(dir, "init", "-q", "--bare", "-b", "master", origin);
  git(dir, "clone", "-q", origin, work);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.test"], ["commit.gpgsign", "false"]]) git(work, "config", k, v);
  fs.writeFileSync(path.join(work, "package.json"), '{\n  "name": "app",\n  "version": "2.46.0"\n}\n');
  fs.writeFileSync(path.join(work, ".release-please-manifest.json"), '{\n  ".": "2.46.0"\n}\n');
  fs.writeFileSync(path.join(work, "a.txt"), "base\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "base");
  git(work, "push", "-q", "origin", "HEAD:master");
  git(work, "checkout", "-q", "-b", "hotfix/CF-1-x");
  fs.writeFileSync(path.join(work, "a.txt"), "fixed\n");
  git(work, "commit", "-qam", "fix(CF-1): one");
  fs.writeFileSync(path.join(work, "b.txt"), "more\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "wip");
  git(work, "push", "-q", "origin", "hotfix/CF-1-x");
  return { work };
}

function squash(work) {
  const r = spawnSync("bash", [SCRIPT], {
    cwd: work,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HEAD_REF: "hotfix/CF-1-x", NEXT: "2.46.1", NEW_TITLE: "hotfix(CF-1): one", PR: "9", CLI },
  });
  return r;
}

const subjects = (work) => git(work, "log", "--format=%s", "origin/master..HEAD").split("\n");

test("squashes into one hotfix commit plus the bump commit", () => {
  const { work } = setup();
  const r = squash(work);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(subjects(work), ["Release 2.46.1 (hotfix)", "hotfix(CF-1): one (#9)"]);
  assert.match(fs.readFileSync(path.join(work, "package.json"), "utf8"), /"version": "2.46.1"/);
  assert.equal(fs.readFileSync(path.join(work, "b.txt"), "utf8"), "more\n");
});

test("re-run after the squashed branch was pushed: no 'nothing to commit' failure, same content", () => {
  const { work } = setup();
  assert.equal(squash(work).status, 0);
  const firstTree = git(work, "rev-parse", "HEAD^{tree}");
  // First run pushed the squashed branch (then failed later, e.g. in the build).
  git(work, "push", "-q", "-f", "origin", "HEAD:refs/heads/hotfix/CF-1-x");
  git(work, "checkout", "-q", "--detach");
  const r = squash(work);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /already 2\.46\.1/);
  assert.deepEqual(subjects(work), ["hotfix(CF-1): one (#9)"]);
  assert.equal(git(work, "rev-parse", "HEAD^{tree}"), firstTree);
});

test("a branch behind master is updated first; a conflict aborts with a message", () => {
  const { work } = setup();
  git(work, "checkout", "-q", "master");
  fs.writeFileSync(path.join(work, "c.txt"), "master moved\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "master change");
  git(work, "push", "-q", "origin", "master");
  assert.equal(squash(work).status, 0);
  assert.equal(fs.readFileSync(path.join(work, "c.txt"), "utf8"), "master moved\n");
  assert.deepEqual(subjects(work), ["Release 2.46.1 (hotfix)", "hotfix(CF-1): one (#9)"]);

  git(work, "checkout", "-q", "master");
  fs.writeFileSync(path.join(work, "a.txt"), "conflicting\n");
  git(work, "commit", "-qam", "master conflicts");
  git(work, "push", "-q", "origin", "master");
  const r = squash(work);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Conflict between hotfix\/CF-1-x and master/);
});
