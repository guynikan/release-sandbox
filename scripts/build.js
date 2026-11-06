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

// Stand-in for the craco Bugsnag plugin: only when REACT_APP_RELEASE_STAGE=production (no real call).
function uploadSourcemaps({ out, version, env, root }) {
  if (env.REACT_APP_RELEASE_STAGE !== "production") return null;
  const maps = fs.readdirSync(path.join(out, "static")).filter((f) => f.endsWith(".map"));
  const record = { stage: "production", appVersion: version, maps, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, "sourcemap-upload.json"), JSON.stringify(record, null, 2));
  console.log(`[bugsnag-stand-in] would upload ${maps.length} sourcemap(s) for appVersion ${version}`);
  return record;
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
  // Real CRA builds emit static/*.js and static/*.js.map; emulate it so postbuild has something to delete.
  fs.mkdirSync(path.join(out, "static"), { recursive: true });
  fs.writeFileSync(path.join(out, "static", "main.js"), `console.log("${pkg.version}");\n//# sourceMappingURL=main.js.map\n`);
  fs.writeFileSync(path.join(out, "static", "main.js.map"), JSON.stringify({ version: 3, sources: ["src/index.html"] }));
  const upload = uploadSourcemaps({ out, version: pkg.version, env, root });
  return { out, html, upload };
}

if (require.main === module) {
  const { out } = build();
  console.log(`Built ${out}`);
}

module.exports = { build, render, resolveCommit, uploadSourcemaps };
