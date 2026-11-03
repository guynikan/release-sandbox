const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRunner, mustRun } = require("./exec");
const { baseFromBranch } = require("./naming");

const PROTECTED_BRANCHES = ["master", "release", "develop"];
const TEMPLATE_PATH = ".github/pull_request_template.md";

function parseArgs(argv) {
  const flags = { base: undefined, draft: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--draft") flags.draft = true;
    else if (arg === "--base") flags.base = argv[++i];
    else throw new Error(`Unknown argument: ${arg}. Usage: yarn pr [--base <branch>] [--draft]`);
  }
  return flags;
}

const defaultDeps = {
  readTemplate: () => (fs.existsSync(TEMPLATE_PATH) ? fs.readFileSync(TEMPLATE_PATH, "utf8") : ""),
  writeBody(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yarn-pr-"));
    const file = path.join(dir, "body.md");
    fs.writeFileSync(file, content);
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  },
};

function readBranchConfig(runner, branch, name) {
  const result = runner.run("git", ["config", "--get", `branch.${branch}.${name}`]);
  return result.code === 0 ? result.stdout.trim() : "";
}

function runPr({ argv = [], runner, log = console.log, deps = defaultDeps }) {
  const { base: baseOverride, draft } = parseArgs(argv);

  const branch = mustRun(runner, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD" || PROTECTED_BRANCHES.includes(branch)) {
    throw new Error(`Current branch (${branch || "detached HEAD"}) cannot open a PR. Use a branch created by yarn task.`);
  }

  const title = readBranchConfig(runner, branch, "prTitle");
  if (!title) {
    throw new Error(`No stored PR title for ${branch}. Create the branch with yarn task.`);
  }
  const base = baseOverride || readBranchConfig(runner, branch, "prBase") || baseFromBranch(branch);

  mustRun(runner, "git", ["push", "-u", "origin", branch], { inherit: true });

  const bodyFile = deps.writeBody(deps.readTemplate());
  try {
    const args = ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile.file];
    if (draft) args.push("--draft");
    const url = mustRun(runner, "gh", args);
    log(url);
    return { branch, title, base, url };
  } finally {
    bodyFile.cleanup();
  }
}

if (require.main === module) {
  try {
    runPr({ argv: process.argv.slice(2), runner: createRunner() });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { runPr, parseArgs };
