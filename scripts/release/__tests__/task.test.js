const test = require("node:test");
const assert = require("node:assert");
const { runTask, parseArgs } = require("../task");
const { fakeRunner } = require("./helpers");

const remoteMissing = { "git ls-remote": { code: 2 }, "git rev-parse --verify": { code: 1 } };

test("parseArgs reads key, flags and hotfix", () => {
  assert.deepStrictEqual(parseArgs(["SBX-1", "--type", "fix", "--title", "T", "--hotfix"]), {
    key: "SBX-1", type: "fix", title: "T", hotfix: true,
  });
  assert.throws(() => parseArgs(["SBX-1", "--nope"]), /Unknown argument/);
});

test("normal task: branches from origin/release and stores title + base", () => {
  const runner = fakeRunner(remoteMissing);
  const r = runTask({ argv: ["SBX-7", "--type", "feat", "--title", "Add search"], runner, log() {} });
  assert.strictEqual(r.branch, "feat/sbx-7-add-search");
  assert.ok(runner.calls.includes("git checkout --no-track -b feat/sbx-7-add-search origin/release"));
  assert.ok(runner.calls.includes("git config branch.feat/sbx-7-add-search.prTitle feat(SBX-7): Add search"));
  assert.ok(runner.calls.includes("git config branch.feat/sbx-7-add-search.prBase release"));
});

test("hotfix task: branches from origin/master with hotfix/ prefix", () => {
  const runner = fakeRunner(remoteMissing);
  const r = runTask({ argv: ["SBX-8", "--type", "fix", "--title", "Broken link", "--hotfix"], runner, log() {} });
  assert.strictEqual(r.branch, "hotfix/sbx-8-broken-link");
  assert.ok(runner.calls.includes("git checkout --no-track -b hotfix/sbx-8-broken-link origin/master"));
  assert.ok(runner.calls.includes("git config branch.hotfix/sbx-8-broken-link.prBase master"));
});

test("fails on dirty tree, bad key, missing type and existing branch", () => {
  assert.throws(
    () => runTask({ argv: ["SBX-1", "--type", "fix", "--title", "x"], runner: fakeRunner({ "git status": { stdout: " M a" } }) }),
    /uncommitted/
  );
  assert.throws(() => runTask({ argv: ["bad"], runner: fakeRunner() }), /Usage/);
  assert.throws(() => runTask({ argv: ["SBX-1", "--title", "x"], runner: fakeRunner() }), /Missing --type/);
  assert.throws(
    () => runTask({ argv: ["SBX-1", "--type", "fix", "--title", "x"], runner: fakeRunner({ "git rev-parse --verify": { code: 0 } }) }),
    /already exists locally/
  );
});
