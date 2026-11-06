// Static "build": copies src/index.html to build/ and injects build-time values,
// simulating REACT_APP_* variables baked into a CRA bundle.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function resolveCommit(env) {
  if (env.REACT_APP_COMMIT_SHA) return env.REACT_APP_COMMIT_SHA;
  if (env.COMMIT_REF) return env.COMMIT_REF; // set by Netlify builds
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function render(template, values) {
  return template
    .replace(/__VERSION__/g, values.version)
    .replace(/__COMMIT_SHA__/g, values.commit)
    .replace(/__API_URL__/g, values.apiUrl)
    .replace(/__CONTEXT__/g, values.context);
}

function build({ root = process.cwd(), env = process.env } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const template = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
  const html = render(template, {
    version: pkg.version,
    commit: resolveCommit(env),
    apiUrl: env.REACT_APP_API_URL || "http://localhost:3000",
    context: env.REACT_APP_CONTEXT || env.CONTEXT || "local",
  });
  const out = path.join(root, "build");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html);
  return { out, html };
}

if (require.main === module) {
  const { out } = build();
  console.log(`Built ${out}`);
}

module.exports = { build, render, resolveCommit };
