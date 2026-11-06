const test = require("node:test");
const assert = require("node:assert");
const { runPr } = require("../pr");
const { fakeRunner } = require("./helpers");

const deps = { readTemplate: () => "tpl", writeBody: () => ({ file: "/tmp/body.md", cleanup() {} }) };
const prCall = (runner) => runner.calls.find((c) => c.startsWith("gh pr create"));

test("uses stored title and base", () => {
  const runner = fakeRunner({
    "git rev-parse --abbrev-ref": { stdout: "feat/sbx-1-x\n" },
    "git config --get branch.feat/sbx-1-x.prTitle": { stdout: "feat(SBX-1): X\n" },
    "git config --get branch.feat/sbx-1-x.prBase": { stdout: "next-release\n" },
    "gh pr create": { stdout: "https://example.test/pull/1\n" },
  });
  const r = runPr({ runner, deps, log() {} });
  assert.strictEqual(r.base, "next-release");
  assert.match(prCall(runner), /--base next-release .*--title feat\(SBX-1\): X/);
});

test("falls back to hotfix/ -> master when no stored base", () => {
  const runner = fakeRunner({
    "git rev-parse --abbrev-ref": { stdout: "hotfix/sbx-2-y\n" },
    "git config --get branch.hotfix/sbx-2-y.prTitle": { stdout: "fix(SBX-2): Y\n" },
    "git config --get branch.hotfix/sbx-2-y.prBase": { code: 1 },
  });
  assert.strictEqual(runPr({ runner, deps, log() {} }).base, "master");
});

test("falls back to release for ordinary branches; --base overrides", () => {
  const mk = () => fakeRunner({
    "git rev-parse --abbrev-ref": { stdout: "chore/sbx-3-z\n" },
    "git config --get branch.chore/sbx-3-z.prTitle": { stdout: "chore(SBX-3): Z\n" },
    "git config --get branch.chore/sbx-3-z.prBase": { code: 1 },
  });
  assert.strictEqual(runPr({ runner: mk(), deps, log() {} }).base, "next-release");
  assert.strictEqual(runPr({ argv: ["--base", "develop"], runner: mk(), deps, log() {} }).base, "develop");
});

test("refuses protected branches and branches without a stored title", () => {
  assert.throws(() => runPr({ runner: fakeRunner({ "git rev-parse --abbrev-ref": { stdout: "next-release\n" } }), deps }), /cannot open a PR/);
  assert.throws(
    () => runPr({ runner: fakeRunner({ "git rev-parse --abbrev-ref": { stdout: "feat/x\n" }, "git config --get": { code: 1 } }), deps }),
    /No stored PR title/
  );
});
