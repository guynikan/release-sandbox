const { spawnSync } = require("node:child_process");

// A runner is `{ run(cmd, args, { inherit }) -> { code, stdout, stderr } }`.
// Scripts receive it as a dependency so tests can swap in a fake.
function createRunner({ cwd } = {}) {
  return {
    run(cmd, args = [], { inherit = false } = {}) {
      const result = spawnSync(cmd, args, {
        cwd,
        encoding: "utf8",
        stdio: inherit ? "inherit" : "pipe",
      });
      if (result.error) {
        return { code: 127, stdout: "", stderr: result.error.message };
      }
      return {
        code: result.status === null ? 1 : result.status,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    },
  };
}

// Runs a command and returns trimmed stdout; throws with the command's stderr on failure.
function mustRun(runner, cmd, args, options) {
  const result = runner.run(cmd, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (code ${result.code}): ${detail}`);
  }
  return result.stdout.trim();
}

module.exports = { createRunner, mustRun };
