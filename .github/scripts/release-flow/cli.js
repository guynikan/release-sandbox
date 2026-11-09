#!/usr/bin/env node
"use strict";
// Thin command line over lib.js for the production-flow workflows (no dependencies, plain Node).
// Inputs come from environment variables and stdin, never from shell-interpolated text.
// Results go to $GITHUB_OUTPUT (single-line values only) and $GITHUB_STEP_SUMMARY.
//
// Usage: node .github/scripts/release-flow/cli.js <command>
//   detect-pr         stdin: GET /commits/{sha}/pulls JSON; env GITHUB_SHA, GITHUB_REPOSITORY
//   decide-publish    env KIND PR_NUMBER HEAD_REF HEAD_SHA DRAFT_TAG STALE_TAG STATE_FILE TAG_COMMIT MASTER_TREE TAG_TREE
//   hotfix-plan       env PACKAGE_VERSION MANIFEST_VERSION TAGS (one per line) PR_TITLE
//   bump-version      env NEXT; rewrites package.json and .release-please-manifest.json in the cwd
//   deploy-state      env KIND TAG VERSION COMMIT TREE DRAFT_DEPLOY_ID PREVIOUS_DEPLOY_ID SITE_ID [PR]; writes deploy-state.json
//   rollback-target   stdin: GET /deployments JSON; env INPUT_DEPLOY CURRENT_DEPLOY
//   workflow-files    stdin: changed file paths, one per line; exit 1 when any is under .github/workflows/

const fs = require("node:fs");
const lib = require("./lib");

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function requireEnv(name) {
  const v = env(name);
  if (v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

function setOutput(key, value) {
  const v = String(value ?? "");
  if (/[\r\n]/.test(v)) throw new Error(`Output ${key} has a newline`);
  const file = env("GITHUB_OUTPUT");
  if (file) fs.appendFileSync(file, `${key}=${v}\n`);
  else console.log(`${key}=${v}`);
}

function summary(markdown) {
  const file = env("GITHUB_STEP_SUMMARY");
  if (file) fs.appendFileSync(file, `${markdown}\n`);
  console.log(markdown);
}

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

const commands = {
  "detect-pr"() {
    const sha = requireEnv("GITHUB_SHA");
    const repo = requireEnv("GITHUB_REPOSITORY");
    const raw = readStdin().trim();
    const pr = lib.pickMergedPr(raw ? JSON.parse(raw) : [], { sha, repo });
    const { kind, version, unusual } = lib.classifyHeadRef(pr?.headRef);
    setOutput("kind", kind);
    if (kind === "other") {
      setOutput("act", "false");
      const shown = pr ? pr.headRef.replace(/[^A-Za-z0-9._/-]/g, "?") : "none";
      const note = unusual ? " The branch name has unusual characters, so it is never treated as a publish or hotfix branch." : "";
      summary(
        `### Publish skipped\nPush \`${sha.slice(0, 7)}\` to master is not the merge of a \`publish/*\` or \`hotfix/*\` PR (PR head: \`${shown}\`).${note} Nothing was published.`,
      );
      return;
    }
    setOutput("act", "true");
    setOutput("number", pr.number);
    setOutput("head_ref", pr.headRef);
    setOutput("head_sha", pr.headSha);
    if (version) setOutput("version", version);
  },

  "decide-publish"() {
    const stateFile = env("STATE_FILE");
    const state = stateFile && fs.existsSync(stateFile) ? lib.parseDeployState(fs.readFileSync(stateFile, "utf8")) : null;
    const decision = lib.decidePublish({
      kind: env("KIND"),
      headSha: env("HEAD_SHA"),
      draftTag: env("DRAFT_TAG"),
      staleHotfixTag: env("STALE_TAG"),
      state,
      tagCommit: env("TAG_COMMIT"),
      masterTree: env("MASTER_TREE"),
      tagTree: env("TAG_TREE"),
    });
    setOutput("action", decision.action);
    if (decision.action === "skip") {
      summary(`### Publish skipped\nPR #${env("PR_NUMBER")} (\`${env("HEAD_REF")}\`): ${decision.reason}. Nothing was published.`);
    } else if (decision.action === "fail") {
      summary(`### Publish REFUSED\nPR #${env("PR_NUMBER")} (\`${env("HEAD_REF")}\`): ${decision.reason}.`);
      console.log(`::error::${decision.reason}`);
      process.exitCode = 1;
    } else {
      setOutput("tag", decision.tag);
      setOutput("draft", decision.draftDeployId);
      summary(`Tree guard ok: master tree \`${env("MASTER_TREE")}\` equals the draft tree of ${decision.tag}.`);
    }
  },

  "hotfix-plan"() {
    const plan = lib.hotfixPlan({
      packageVersion: requireEnv("PACKAGE_VERSION"),
      manifestVersion: requireEnv("MANIFEST_VERSION"),
      tags: env("TAGS").split("\n").map((t) => t.trim()).filter(Boolean),
    });
    setOutput("current", plan.current);
    setOutput("next", plan.next);
    setOutput("tag", plan.hotfixTag);
    setOutput("anchor_tag", plan.anchorTag);
    setOutput("plain_tag", plan.plainTag);
    setOutput("new_title", lib.hotfixTitle(requireEnv("PR_TITLE")));
    console.log(`Next patch: ${plan.current} -> ${plan.next} (tags ${plan.hotfixTag} + ${plan.plainTag} on the commit of ${plan.anchorTag})`);
  },

  "bump-version"() {
    const out = lib.bumpVersionFiles({
      packageText: fs.readFileSync("package.json", "utf8"),
      manifestText: fs.readFileSync(".release-please-manifest.json", "utf8"),
      next: requireEnv("NEXT"),
    });
    fs.writeFileSync("package.json", out.packageText);
    fs.writeFileSync(".release-please-manifest.json", out.manifestText);
  },

  "deploy-state"() {
    const state = lib.buildDeployState({
      kind: requireEnv("KIND"),
      tag: requireEnv("TAG"),
      version: requireEnv("VERSION"),
      commit: requireEnv("COMMIT"),
      tree: requireEnv("TREE"),
      draftDeployId: requireEnv("DRAFT_DEPLOY_ID"),
      previousDeployId: env("PREVIOUS_DEPLOY_ID"),
      siteId: requireEnv("SITE_ID"),
      pr: env("PR"),
      createdAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    });
    fs.writeFileSync("deploy-state.json", `${JSON.stringify(state, null, 2)}\n`);
  },

  "rollback-target"() {
    const raw = readStdin().trim();
    const target = lib.pickRollbackTarget({
      input: env("INPUT_DEPLOY"),
      currentId: requireEnv("CURRENT_DEPLOY"),
      deployments: raw ? JSON.parse(raw) : [],
    });
    setOutput("target", target);
  },

  "workflow-files"() {
    const hits = lib.workflowFiles(readStdin().split("\n"));
    if (hits.length === 0) return;
    console.log(
      `::error::This PR changes ${hits.join(", ")}. The GITHUB_TOKEN cannot push commits that change .github/workflows/*, so hotfix-draft cannot prepare this PR. The guardian must merge it by hand (no automatic draft or publish).`,
    );
    process.exitCode = 1;
  },
};

const name = process.argv[2];
if (!commands[name]) {
  console.error(`Unknown command "${name}". Known: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
try {
  commands[name]();
} catch (error) {
  console.log(`::error::${String(error.message).replace(/[\r\n]+/g, " ")}`);
  process.exit(1);
}
