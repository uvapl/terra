/**
 * Handles the mechanics of the lab configuration: reading the lab URL from the
 * query params, resolving it to a GitHub org/repo/branch/subdir, fetching and
 * parsing the lab's .cs50.yml and persisting/restoring the config through
 * local storage.
 *
 * Labs are identified by a GitHub URL such as
 *
 *   https://github.com/cs50/labs/tree/2023/x/mario/less
 *
 * where `cs50` is the org, `labs` the repo, `2023/x` the branch and
 * `mario/less` the subdirectory containing the lab. Because branch names may
 * contain slashes, the split between branch and subdirectory is ambiguous and
 * is resolved against the GitHub API (with a raw-file probe as fallback).
 */

import jsyaml from '../vendor/js-yaml-4.1.0.min.js';
import {
  isObject,
  isValidUrl,
  parseQueryParams,
  slugify,
} from '../lib/helpers.js';
import {
  isDefaultLocalStoragePrefix,
  setLocalStorageItem,
  getLocalStorageItem,
  updateLocalStoragePrefix,
} from '../lib/local-storage-manager.js';

/**
 * YAML schema that understands the custom !include/!exclude tags used in the
 * `files` list of a .cs50.yml. Entries are constructed as
 * `{ file, include }` objects. The !require tag (used by check50/submit50
 * configs that share the file) is accepted as well so such files at least
 * parse and produce a clear "not a lab" error instead of a YAML error.
 */
const LAB_YAML_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend([
  new jsyaml.Type('!include', {
    kind: 'scalar',
    construct: (file) => ({ file, include: true }),
  }),
  new jsyaml.Type('!exclude', {
    kind: 'scalar',
    construct: (file) => ({ file, include: false }),
  }),
  new jsyaml.Type('!require', {
    kind: 'scalar',
    construct: (file) => ({ file, include: true }),
  }),
]);

/**
 * Validate whether the given config object is valid.
 *
 * @param {object} config - The config object to validate.
 * @returns {boolean} True when the given object is a valid lab config object.
 */
export function isValidConfig(config) {
  return isObject(config)
    && ['labUrl', 'baseUrl', 'slug'].every((key) => typeof config[key] === 'string')
    && Array.isArray(config.files);
}

/**
 * Get the lab URL from the current URL, either from the hash fragment
 * (`lab.html#https://host/lab/`) or from the `?url=` query param. The hash
 * takes precedence and is the preferred form: it is never sent to the server
 * and can stay in the address bar, keeping the link shareable.
 *
 * @returns {string|null} The lab URL when present and valid, otherwise null.
 */
export function getLabUrlParam() {
  const hashUrl = window.decodeURIComponent(window.location.hash.slice(1));
  if (isValidUrl(hashUrl)) {
    return hashUrl;
  }

  const queryParams = parseQueryParams();
  if (!isObject(queryParams) || !queryParams.url) {
    return null;
  }

  const labUrl = window.decodeURIComponent(queryParams.url);
  if (!isValidUrl(labUrl)) {
    console.error('Invalid lab URL');
    return null;
  }

  return labUrl;
}

/**
 * Parse a GitHub lab URL into its org and repo, plus the remainder of the
 * path which still ambiguously holds the branch and subdirectory.
 *
 * Accepts both `github.com/org/repo/tree/branch/subdir` and the shorthand
 * `github.com/org/repo/branch/subdir` forms.
 *
 * @param {string} labUrl - The GitHub URL identifying the lab.
 * @returns {object|null} An `{ org, repo, rest }` object, or null when the
 * URL is not a GitHub URL.
 */
export function parseGitHubUrl(labUrl) {
  const match = labUrl.trim().match(
    /^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree\/)?(.+?))?\/?$/
  );
  if (!match) return null;

  return { org: match[1], repo: match[2], rest: match[3] || '' };
}

/**
 * Resolve the ambiguous branch/subdir remainder of a lab URL into a branch
 * name and subdirectory.
 *
 * The branch list from the GitHub API is authoritative: the longest branch
 * name that prefixes the remainder wins. When the API is unreachable (or
 * rate-limited), fall back to a single raw.githubusercontent.com probe:
 * raw URLs are simply `{branch}/{path}` concatenated, so the .cs50.yml is
 * served at the same URL no matter where the split lies. The whole remainder
 * is then treated as the branch, which yields identical raw URLs; only the
 * branch/subdir labels differ, and the lab slug is split-agnostic. The probe
 * also yields the YAML text, which is returned to avoid a second fetch.
 *
 * @async
 * @param {string} org - The GitHub organisation or user.
 * @param {string} repo - The repository name.
 * @param {string} rest - The combined branch/subdir remainder.
 * @returns {Promise<object>} A `{ branch, subdir, yamlText }` object where
 * `yamlText` is only set when the probe fallback fetched it already.
 */
export async function resolveBranch(org, repo, rest) {
  if (!rest) {
    const branch = await getDefaultBranch(org, repo);
    return { branch, subdir: '', yamlText: null };
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${org}/${repo}/branches?per_page=100`);
    if (!response.ok) throw new Error(`GitHub API responded with ${response.status}`);
    const branches = await response.json();

    const branch = branches
      .map((branchInfo) => branchInfo.name)
      .filter((name) => rest === name || rest.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0];

    if (branch) {
      return { branch, subdir: rest.slice(branch.length).replace(/^\//, ''), yamlText: null };
    }
  } catch (err) {
    console.warn('GitHub API branch lookup failed, probing raw files instead:', err);
  }

  // Probe fallback: the raw URL is the same for every split point, so one
  // probe with the whole remainder as the branch suffices.
  const yamlText = await fetchYamlText(org, repo, rest, '');
  if (yamlText !== null) {
    return { branch: rest, subdir: '', yamlText };
  }

  throw new Error(`Could not find a lab (.cs50.yml) at ${org}/${repo}/${rest}`);
}

/**
 * Get the default branch of a repository, falling back to probing for the
 * conventional names when the GitHub API is unreachable.
 *
 * @async
 * @param {string} org - The GitHub organisation or user.
 * @param {string} repo - The repository name.
 * @returns {Promise<string>} The default branch name.
 */
async function getDefaultBranch(org, repo) {
  try {
    const response = await fetch(`https://api.github.com/repos/${org}/${repo}`);
    if (response.ok) {
      const repoInfo = await response.json();
      if (repoInfo.default_branch) return repoInfo.default_branch;
    }
  } catch (err) {
    console.warn('GitHub API repo lookup failed:', err);
  }

  for (const branch of ['main', 'master']) {
    if (await fetchYamlText(org, repo, branch, '') !== null) return branch;
  }

  throw new Error(`Could not determine the default branch of ${org}/${repo}`);
}

/**
 * Build a raw.githubusercontent.com URL for a file inside the lab directory.
 */
function makeRawUrl(org, repo, branch, subdir, filename) {
  const dir = subdir ? `${subdir}/` : '';
  return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${dir}${filename}`;
}

/**
 * Fetch the lab's YAML config from the given directory, accepting both the
 * `.cs50.yml` and `.cs50.yaml` spellings.
 *
 * @async
 * @returns {Promise<string|null>} The YAML text, or null when neither file
 * exists.
 */
async function fetchYamlText(org, repo, branch, subdir) {
  for (const filename of ['.cs50.yml', '.cs50.yaml']) {
    const response = await fetch(makeRawUrl(org, repo, branch, subdir, filename));
    if (response.ok) return response.text();
  }

  return null;
}

/**
 * Fetch the lab's .cs50.yml (or .cs50.yaml) and parse it into a normalized
 * lab config object.
 *
 * Two kinds of lab URLs are supported:
 *
 * - A github.com repository URL such as
 *   `https://github.com/org/repo/tree/branch/subdir`, which is resolved to
 *   its raw.githubusercontent.com location.
 * - Any other URL, which is taken to be the directory where the lab is
 *   statically deployed (e.g. `https://org.github.io/repo/lab/`); the config
 *   and README are fetched straight from it, no URL mangling involved.
 *
 * Only literal `!include` entries are supported in the `files` list; glob
 * patterns and `!exclude` entries are parsed but ignored.
 *
 * @async
 * @param {string} labUrl - The URL identifying the lab.
 * @returns {Promise<object>} The normalized lab config: `{ labUrl, baseUrl,
 * linkBaseUrl, name, files, window, cmd }`. `baseUrl` is where the lab files
 * live, `linkBaseUrl` is where relative README links should point.
 */
export async function fetchConfig(labUrl) {
  const parsed = parseGitHubUrl(labUrl);
  const lab = parsed
    ? await resolveGitHubLab(labUrl, parsed)
    : await resolveDirectLab(labUrl);

  const doc = jsyaml.load(lab.yamlText, { schema: LAB_YAML_SCHEMA });
  if (!isObject(doc) || typeof doc.lab50 === 'undefined') {
    throw new Error('The .cs50.yml file is not a lab50 configuration');
  }

  // The minimal form `lab50: true` has no files/window/cmd keys.
  const lab50 = isObject(doc.lab50) ? doc.lab50 : {};

  const files = (Array.isArray(lab50.files) ? lab50.files : [])
    .filter((entry) => isObject(entry) && entry.include && !/[*?[\]]/.test(entry.file))
    .map((entry) => entry.file);

  return {
    labUrl,
    baseUrl: lab.baseUrl,
    linkBaseUrl: lab.linkBaseUrl,
    name: lab.name,
    slug: lab.slug,
    files,
    window: Array.isArray(lab50.window) ? lab50.window : ['editor', 'readme', 'terminal'],
    cmd: lab50.cmd || null,
  };
}

/**
 * Resolve a github.com lab URL: find the branch/subdir split and the raw
 * location of the lab directory.
 *
 * @async
 * @returns {Promise<object>} A `{ baseUrl, linkBaseUrl, name, slug, yamlText }`
 * object.
 */
async function resolveGitHubLab(labUrl, { org, repo, rest }) {
  const { branch, subdir, yamlText } = await resolveBranch(org, repo, rest);

  let text = yamlText;
  if (text === null) {
    text = await fetchYamlText(org, repo, branch, subdir);
    if (text === null) {
      throw new Error(`No .cs50.yml found at ${org}/${repo}/${branch}/${subdir}`);
    }
  }

  const dir = subdir ? `${subdir}/` : '';

  // Joining branch and subdir keeps the slug independent of where the
  // branch/subdir split was resolved, so the GitHub API and probe-fallback
  // paths agree.
  const location = [org, repo, branch, subdir].filter(Boolean).join('/');

  return {
    baseUrl: makeRawUrl(org, repo, branch, subdir, ''),
    linkBaseUrl: `https://github.com/${org}/${repo}/blob/${branch}/${dir}`,
    name: subdir || repo,
    slug: slugify(location),
    yamlText: text,
  };
}

/**
 * Resolve a statically deployed lab: the URL is the lab directory itself,
 * so the config is fetched straight from it.
 *
 * @async
 * @returns {Promise<object>} A `{ baseUrl, linkBaseUrl, name, slug, yamlText }`
 * object.
 */
async function resolveDirectLab(labUrl) {
  const baseUrl = labUrl.endsWith('/') ? labUrl : `${labUrl}/`;

  let yamlText = null;
  for (const filename of ['.cs50.yml', '.cs50.yaml']) {
    const response = await fetch(baseUrl + filename);
    if (response.ok) {
      yamlText = await response.text();
      break;
    }
  }

  if (yamlText === null) {
    throw new Error(`No .cs50.yml found at ${baseUrl}`);
  }

  const { hostname, pathname } = new URL(baseUrl);
  const path = pathname.replace(/^\/|\/$/g, '');

  return {
    baseUrl,
    linkBaseUrl: baseUrl,
    name: path || hostname,
    slug: slugify(`${hostname}/${path}`),
    yamlText,
  };
}

/**
 * Get the slug that identifies a lab, used for the lab-specific local
 * storage prefix and VFS folder. The slug is derived from the lab's resolved
 * location rather than the URL as typed, so equivalent URL forms share their
 * storage. Prefixed with `lab-` so lab storage can never collide with exam
 * storage on the same origin.
 *
 * @param {object} config - The lab config object.
 * @returns {string} The lab slug.
 */
export function labSlug(config) {
  return `lab-${config.slug}`;
}

/**
 * Point local storage at the lab-specific prefix derived from the config
 * and remember that prefix for subsequent visits.
 *
 * @param {object} config - The lab config object.
 */
export function selectConfigStorage(config) {
  const storageKey = labSlug(config);
  setLocalStorageItem('last-used-lab', storageKey);
  updateLocalStoragePrefix(storageKey);
}

/**
 * Persist the given config in local storage.
 *
 * @param {object} config - The config object to store.
 */
export function saveConfig(config) {
  setLocalStorageItem('config', JSON.stringify(config));
}

/**
 * Load the most recently used lab config from local storage, restoring the
 * lab-specific local storage prefix if needed.
 *
 * @returns {object|null} The stored config object, or null when absent.
 */
export function loadStoredConfig() {
  // This should only update the local storage prefix if it's
  // not the default prefix.
  if (isDefaultLocalStoragePrefix()) {
    const storageKey = getLocalStorageItem('last-used-lab');

    if (storageKey) {
      updateLocalStoragePrefix(storageKey);
    }
  }

  return JSON.parse(getLocalStorageItem('config'));
}
