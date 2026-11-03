const test = require("node:test");
const assert = require("node:assert");
const { render } = require("./build");

test("render injects version, commit, API_URL and context", () => {
  const html = render("v=__VERSION__ c=__COMMIT_SHA__ a=__API_URL__ x=__CONTEXT__", {
    version: "1.2.3",
    commit: "abc1234",
    apiUrl: "https://api.example.test",
    context: "production",
  });
  assert.strictEqual(html, "v=1.2.3 c=abc1234 a=https://api.example.test x=production");
});
