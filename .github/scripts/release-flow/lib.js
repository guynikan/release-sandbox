"use strict";
// Pure decision logic of the production flow (block 4). No I/O here: the workflows gather facts
// (git, gh, Netlify) and hand them to cli.js, which calls these functions. Tested by lib.test.js.

const HEAD_REF_RE = /^(publish|hotfix)\/[A-Za-z0-9._-]+$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DEPLOY_ID_RE = /^[0-9a-f]{24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKFLOWS_DIR = ".github/workflows/";

/**
 * Classifies the head branch of the PR that was merged into master.
 * Only a strict pattern is accepted for publish/* and hotfix/*: branch names are attacker-chosen text.
 * @param {string|null|undefined} ref
 * A publish/ or hotfix/ name with unusual characters is never acted on: it is "other" with `unusual: true`
 * (nothing is published either way), so the run can skip with a note instead of failing.
 * @returns {{kind: "publish"|"hotfix"|"other", version?: string, unusual?: boolean}}
 */
function classifyHeadRef(ref) {
  if (typeof ref !== "string" || !/^(publish|hotfix)\//.test(ref)) return { kind: "other" };
  if (!HEAD_REF_RE.test(ref)) return { kind: "other", unusual: true };
  const [kind, rest] = ref.split("/");
  return kind === "publish" ? { kind, version: rest } : { kind };
}

/**
 * Picks, from the PRs GitHub associates with a commit, the one that was merged AS that commit
 * (merge_commit_sha), into master, from a branch of this same repository.
 * @param {Array<object>} prs response of GET /repos/{repo}/commits/{sha}/pulls
 * @param {{sha: string, repo: string}} ctx
 * @returns {{number: number, headRef: string, headSha: string, title: string}|null}
 */
function pickMergedPr(prs, { sha, repo }) {
  const found = (Array.isArray(prs) ? prs : []).find(
    (pr) =>
      pr &&
      pr.merged_at &&
      pr.merge_commit_sha === sha &&
      pr.base?.ref === "master" &&
      pr.head?.repo?.full_name === repo,
  );
  if (!found) return null;
  return { number: found.number, headRef: found.head.ref, headSha: found.head.sha, title: found.title || "" };
}

function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version ?? "").trim());
  if (!m) throw new Error(`Not a MAJOR.MINOR.PATCH version: "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function nextPatch(version) {
  const [maj, min, pat] = parseSemver(version);
  return `${maj}.${min}.${pat + 1}`;
}

/**
 * Version/tag math of a hotfix.
 * - next: patch bump of the version on master.
 * - hotfixTag: `hotfix-NEXT` (deliberately not semver) carrying deploy-state.json.
 * - plainTag: the plain tag NEXT on the previous release commit. Once the bump reaches next-release the
 *   release-please manifest says NEXT; without a tag named NEXT it would not find the last release and
 *   would recount the whole history. It points at the commit the manifest on master cited, not at the hotfix.
 * @param {{packageVersion: string, manifestVersion: string, tags: string[]}} input
 */
function hotfixPlan({ packageVersion, manifestVersion, tags }) {
  const next = nextPatch(packageVersion);
  const existing = new Set(tags);
  const hotfixTag = `hotfix-${next}`;
  for (const t of [hotfixTag, next, `v${next}`]) {
    if (existing.has(t)) throw new Error(`Tag ${t} already exists`);
  }
  parseSemver(manifestVersion);
  const anchorTag = [manifestVersion, `v${manifestVersion}`].find((t) => existing.has(t));
  if (!anchorTag) throw new Error(`No release tag for manifest version ${manifestVersion}`);
  const plainTag = anchorTag.startsWith("v") ? `v${next}` : next;
  return { current: String(packageVersion).trim(), next, hotfixTag, anchorTag, plainTag };
}

/**
 * Title of the squashed hotfix commit and of the renamed PR: `hotfix(KEY): ...`.
 * release-please ignores the `hotfix` type, so the hotfix does not repeat in the next changelog
 * (the PR title becomes the body of the merge commit, which release-please also reads).
 */
function hotfixTitle(title) {
  const clean = String(title ?? "").replace(/\s+/g, " ").trim();
  const renamed = clean.replace(/^[a-zA-Z]+(\(|:)/, "hotfix$1");
  return renamed.startsWith("hotfix") ? renamed : `hotfix: ${clean}`;
}

/**
 * Applies the patch bump to the text of package.json and .release-please-manifest.json.
 * package.json is edited in place (only the version line) so the commit does not reformat the file.
 */
function bumpVersionFiles({ packageText, manifestText, next }) {
  parseSemver(next);
  const re = /^(  "version":\s*")[^"]+(")/m;
  if (!re.test(packageText)) throw new Error('No top-level "version" in package.json');
  const manifest = JSON.parse(manifestText);
  manifest["."] = next;
  return {
    packageText: packageText.replace(re, `$1${next}$2`),
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

/** Paths a GITHUB_TOKEN push cannot create or update. */
function workflowFiles(paths) {
  return paths.map((p) => p.trim()).filter((p) => p.startsWith(WORKFLOWS_DIR));
}

const STATE_FIELDS = ["kind", "tag", "version", "commit", "tree", "draftDeployId", "siteId", "createdAt"];

/** Builds the deploy-state.json stored as an asset of the Release. */
function buildDeployState(f) {
  const state = {
    kind: f.kind,
    tag: f.tag,
    version: f.version,
    commit: f.commit,
    tree: f.tree,
    draftDeployId: f.draftDeployId,
    previousDeployId: f.previousDeployId ?? "",
    siteId: f.siteId,
    createdAt: f.createdAt,
  };
  if (f.pr !== undefined && f.pr !== null && f.pr !== "") state.pr = Number(f.pr);
  return validateDeployState(state);
}

function validateDeployState(state) {
  if (!state || typeof state !== "object") throw new Error("deploy-state.json is not an object");
  for (const key of STATE_FIELDS) {
    if (typeof state[key] !== "string" || state[key] === "" || state[key] === "null") {
      throw new Error(`deploy-state.json: missing or empty "${key}"`);
    }
  }
  if (!["release", "hotfix"].includes(state.kind)) throw new Error(`deploy-state.json: unknown kind "${state.kind}"`);
  if (!SHA_RE.test(state.commit)) throw new Error('deploy-state.json: "commit" is not a full SHA');
  if (!SHA_RE.test(state.tree)) throw new Error('deploy-state.json: "tree" is not a full SHA');
  if (!DEPLOY_ID_RE.test(state.draftDeployId)) throw new Error('deploy-state.json: "draftDeployId" is not a Netlify deploy id');
  if (typeof state.previousDeployId !== "string" || (state.previousDeployId !== "" && !DEPLOY_ID_RE.test(state.previousDeployId))) {
    throw new Error('deploy-state.json: "previousDeployId" must be empty or a Netlify deploy id');
  }
  if (!UUID_RE.test(state.siteId)) throw new Error('deploy-state.json: "siteId" is not a site UUID');
  return state;
}

function parseDeployState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("deploy-state.json is not valid JSON");
  }
  return validateDeployState(parsed);
}

/**
 * Decides what publish.yml does for a push to master. Publishing needs a draft AND an identical tree:
 * - not the merge of a publish/* or hotfix/* PR, or a hotfix/* PR with no hotfix-* tag at its head
 *   (ordinary work) -> skip (green, with a note);
 * - publish/* with no tag/Release or no deploy-state.json, a hotfix tag without deploy-state.json, or a draft
 *   that master/branch does not match (tree, tag commit, changed head) -> fail (red), nothing published.
 * @param {object} f facts gathered by the workflow
 * @param {"publish"|"hotfix"|"other"} f.kind
 * @param {string} [f.headSha] head of the merged PR
 * @param {string} [f.draftTag] release tag (publish) or hotfix-* tag exactly at the PR head (hotfix); "" if none
 * @param {string} [f.staleHotfixTag] hotfix-* tag recorded for this PR but NOT at its head
 * @param {object|null} [f.state] parsed deploy-state.json ("" / null when the Release has none)
 * @param {string} [f.tagCommit] commit of draftTag
 * @param {string} [f.masterTree] tree of the pushed master commit
 * @param {string} [f.tagTree] tree of draftTag
 * @returns {{action: "publish"|"skip"|"fail", reason: string, tag?: string, draftDeployId?: string}}
 */
function decidePublish(f) {
  if (f.kind !== "publish" && f.kind !== "hotfix") {
    return { action: "skip", reason: "this push is not the merge of a publish/* or hotfix/* PR" };
  }
  if (!f.draftTag) {
    if (f.kind === "hotfix") {
      if (f.staleHotfixTag) {
        const plain = f.staleHotfixTag.replace(/^hotfix-/, "");
        return {
          action: "fail",
          reason: `the PR was merged but its head ${String(f.headSha).slice(0, 7)} is not the commit of its hotfix draft (${f.staleHotfixTag}): the branch changed after the draft. master already has the hotfix content and the bumped version, and production does NOT. Nothing was published. The PR is already merged, so it cannot be redone: open a new hotfix/* PR from master and run hotfix-draft (it creates the next patch). Deleting the stale ${f.staleHotfixTag} Release and tags ${f.staleHotfixTag} and ${plain} is only cleanup`,
        };
      }
      return { action: "skip", reason: "this hotfix/* PR has no hotfix draft, so it is treated as ordinary work" };
    }
    return {
      action: "fail",
      reason: `there is no tag/Release for this publish/* branch, so there is no draft. Nothing was published. If the release exists, redo the draft: run release-please.yml with the redo_draft_tag input set to the release tag, then publish again`,
    };
  }
  if (!f.state) {
    return {
      action: "fail",
      reason:
        f.kind === "publish"
          ? `Release ${f.draftTag} has no deploy-state.json, so the draft was not created. Nothing was published. Run release-please.yml with the redo_draft_tag input set to ${f.draftTag}, then publish again`
          : `${f.draftTag} is at the PR head but its Release has no deploy-state.json, so the draft is incomplete. Nothing was published. Open a new hotfix/* PR from master and run hotfix-draft`,
    };
  }
  const { state } = f;
  if (state.tag !== f.draftTag) {
    return { action: "fail", reason: `deploy-state.json says tag ${state.tag}, but the tag found is ${f.draftTag}. Nothing was published` };
  }
  if (f.tagCommit && state.commit !== f.tagCommit) {
    return { action: "fail", reason: `deploy-state.json commit ${state.commit} is not the commit of tag ${f.draftTag} (${f.tagCommit}). Nothing was published` };
  }
  if (f.masterTree !== state.tree || f.tagTree !== state.tree) {
    return {
      action: "fail",
      reason: `refusing to publish ${f.draftTag}: master tree ${f.masterTree} differs from the draft tree ${state.tree} (tag tree ${f.tagTree}). master has content the tested draft does not have. Nothing was published`,
    };
  }
  return { action: "publish", reason: "tree guard ok", tag: f.draftTag, draftDeployId: state.draftDeployId };
}

/**
 * Rollback target: the explicit input, or the deploy that was live before the publish that produced the
 * deploy live now (read from the payload of the recorded GitHub Deployments; it alternates after a rollback).
 * @param {{input?: string, currentId: string, deployments: Array<{payload?: {deployId?: string, previousDeployId?: string}}>}} a
 */
function pickRollbackTarget({ input, currentId, deployments }) {
  let target = (input || "").trim();
  if (!target) {
    const hit = (Array.isArray(deployments) ? deployments : []).find((d) => d?.payload?.deployId === currentId);
    target = hit?.payload?.previousDeployId || "";
    if (!target) throw new Error(`No recorded publish for the live deploy ${currentId}; pass deploy_id explicitly`);
  }
  if (!/^[0-9a-f]{24}$/.test(target)) throw new Error(`"${target}" does not look like a Netlify deploy id`);
  if (target === currentId) throw new Error(`Target ${target} is already the live deploy`);
  return target;
}

module.exports = {
  classifyHeadRef,
  pickMergedPr,
  parseSemver,
  nextPatch,
  hotfixPlan,
  hotfixTitle,
  bumpVersionFiles,
  workflowFiles,
  buildDeployState,
  parseDeployState,
  decidePublish,
  pickRollbackTarget,
};
