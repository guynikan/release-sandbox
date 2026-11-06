// Pure naming helpers shared by `yarn task` and `yarn pr`. No I/O in this file.

const TYPES = Object.freeze(["feat", "fix", "chore"]);

const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "with", "is", "are",
]);

// Netlify branch preview: https://<branch with "/" -> "-">--<site>.netlify.app
// and a DNS label holds at most 63 characters.
const PREVIEW_SITE = "sandbox-preview";
const MAX_DNS_LABEL = 63;
const PREVIEW_SEPARATOR = "--";

const toPreviewLabel = (branch) => branch.replace(/\//g, "-");

const branchFitsPreview = (branch) =>
  toPreviewLabel(branch).length + PREVIEW_SEPARATOR.length + PREVIEW_SITE.length <= MAX_DNS_LABEL;

const previewUrl = (branch) =>
  `https://${toPreviewLabel(branch)}${PREVIEW_SEPARATOR}${PREVIEW_SITE}.netlify.app`;

function assertType(type) {
  if (!TYPES.includes(type)) {
    throw new Error(`Unsupported type: "${type}". Supported types: ${TYPES.join(", ")}.`);
  }
  return type;
}

function slugWords(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word));
}

// Words are appended in order while they fit; a word that would overflow is
// skipped (never truncated) and the next one is tried. Prefix and key are always kept.
function buildBranchName({ prefix, key, title }) {
  let branch = `${prefix}/${key.toLowerCase()}`;
  for (const word of slugWords(title)) {
    const candidate = `${branch}-${word}`;
    if (branchFitsPreview(candidate)) branch = candidate;
  }
  return branch;
}

const buildPrTitle = ({ type, key, title }) => `${type}(${key.toUpperCase()}): ${title}`;

// Hotfixes branch from master and use the `hotfix/` prefix; everything else
// branches from release and uses the Conventional Commits type as prefix.
function buildNames({ key, type, title, hotfix = false }) {
  assertType(type);
  const trimmed = String(title || "").trim();
  if (!trimmed) throw new Error("Missing --title.");
  const prefix = hotfix ? "hotfix" : type;
  return {
    base: hotfix ? "master" : "next-release",
    branch: buildBranchName({ prefix, key, title: trimmed }),
    title: buildPrTitle({ type, key, title: trimmed }),
  };
}

// Fallback used by `yarn pr` when the branch has no stored base.
const baseFromBranch = (branch) => (String(branch).startsWith("hotfix/") ? "master" : "next-release");

module.exports = {
  TYPES,
  assertType,
  slugWords,
  branchFitsPreview,
  previewUrl,
  buildBranchName,
  buildPrTitle,
  buildNames,
  baseFromBranch,
};
