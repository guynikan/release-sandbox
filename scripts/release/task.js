const { createRunner, mustRun } = require("./exec");
const { buildNames, previewUrl } = require("./naming");

const KEY_REGEX = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

function parseArgs(argv) {
  const args = { key: undefined, type: undefined, title: undefined, hotfix: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hotfix") args.hotfix = true;
    else if (arg === "--type") args.type = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else if (!args.key) args.key = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

const USAGE = 'Usage: yarn task <KEY> --type feat|fix|chore --title "..." [--hotfix]';

function assertCleanTree(runner) {
  if (mustRun(runner, "git", ["status", "--porcelain"])) {
    throw new Error("Working tree has uncommitted changes. Commit or discard them first.");
  }
}

function assertBranchIsNew(runner, branch) {
  if (runner.run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0) {
    throw new Error(`Branch ${branch} already exists locally.`);
  }
  // ls-remote --exit-code: 0 = found, 2 = no match, anything else = real failure.
  const remote = runner.run("git", ["ls-remote", "--exit-code", "--heads", "origin", branch]);
  if (remote.code === 0) throw new Error(`Branch ${branch} already exists on the remote.`);
  if (remote.code !== 2) {
    throw new Error(`Could not query the remote: ${(remote.stderr || remote.stdout).trim()}`);
  }
}

function runTask({ argv = [], runner, log = console.log }) {
  const { key, type, title, hotfix } = parseArgs(argv);
  if (!key || !KEY_REGEX.test(key)) throw new Error(USAGE);
  if (!type) throw new Error(`Missing --type. ${USAGE}`);

  assertCleanTree(runner);
  const names = buildNames({ key, type, title, hotfix });
  assertBranchIsNew(runner, names.branch);

  mustRun(runner, "git", ["fetch", "origin", names.base]);
  mustRun(runner, "git", ["checkout", "--no-track", "-b", names.branch, `origin/${names.base}`]);
  mustRun(runner, "git", ["config", `branch.${names.branch}.prTitle`, names.title]);
  mustRun(runner, "git", ["config", `branch.${names.branch}.prBase`, names.base]);

  log(`Branch:  ${names.branch}`);
  log(`Base:    ${names.base}`);
  log(`Title:   ${names.title}`);
  log(`Preview: ${previewUrl(names.branch)}`);
  return { ...names, url: previewUrl(names.branch) };
}

if (require.main === module) {
  try {
    runTask({ argv: process.argv.slice(2), runner: createRunner() });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { runTask, parseArgs, KEY_REGEX };
