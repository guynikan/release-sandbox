const test = require("node:test");
const assert = require("node:assert");
const naming = require("../naming");

test("buildNames: normal task branches from release with type prefix", () => {
  const r = naming.buildNames({ key: "SBX-12", type: "feat", title: "Add dark mode toggle" });
  assert.strictEqual(r.base, "release");
  assert.strictEqual(r.branch, "feat/sbx-12-add-dark-mode-toggle");
  assert.strictEqual(r.title, "feat(SBX-12): Add dark mode toggle");
});

test("buildNames: hotfix branches from master with hotfix/ prefix", () => {
  const r = naming.buildNames({ key: "SBX-99", type: "fix", title: "Crash on login", hotfix: true });
  assert.strictEqual(r.base, "master");
  assert.strictEqual(r.branch, "hotfix/sbx-99-crash-login");
  assert.strictEqual(r.title, "fix(SBX-99): Crash on login");
});

test("buildNames: rejects unknown type and empty title", () => {
  assert.throws(() => naming.buildNames({ key: "SBX-1", type: "docs", title: "x" }), /Unsupported type/);
  assert.throws(() => naming.buildNames({ key: "SBX-1", type: "fix", title: "  " }), /Missing --title/);
});

test("buildBranchName keeps the preview URL label within 63 chars", () => {
  const branch = naming.buildBranchName({
    prefix: "feat",
    key: "SBX-1",
    title: "Extremely long title with many many words that overflow the DNS label limit for previews",
  });
  assert.ok(naming.branchFitsPreview(branch));
  assert.ok(branch.startsWith("feat/sbx-1"));
});

test("slugWords strips accents and stopwords", () => {
  assert.deepStrictEqual(naming.slugWords("Fix the Ação of Users"), ["fix", "acao", "users"]);
});

test("baseFromBranch: hotfix/ -> master, else release", () => {
  assert.strictEqual(naming.baseFromBranch("hotfix/sbx-1-x"), "master");
  assert.strictEqual(naming.baseFromBranch("feat/sbx-1-x"), "release");
});
