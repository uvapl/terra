import { getPartsFromPath } from '../../js/lib/helpers.js';
import { createScheduler } from '../../js/lib/scheduler.js';
import { FileNotFoundError } from '../../js/fs/vfs.js';
import Terra from '../../js/terra.js';

// The naming convention for hidden history siblings (`foo.py` yields
// `.foo.py.history`). Exported so the plugin can register it with the
// VFS as an ignore pattern (see edit-history.js).
export const HISTORY_FILE_PATTERN = /^\..+\.history$/;

// Source files larger than this no longer get history recorded.
export const MAX_TRACKED_FILE_SIZE = 100 * 1024;

// A full snapshot is stored every KEYFRAME_INTERVAL revisions so that
// reconstructing any revision is based on a limited number of patches.
const KEYFRAME_INTERVAL = 20;

// Per-file history bounds. OPFS space is plentiful, but exam submissions
// upload these files over HTTP, so keep them bounded.
const MAX_REVISIONS = 1000;
const MAX_SERIALIZED_SIZE = 1024 * 1024;

// How long to wait after a commit before writing to the VFS, so rapid
// commits combine into one write.
const PERSIST_DELAY_MS = 300;

// In-memory cache: maps source file path to a history object, plus the
// scheduler holding the pending writes, keyed by that same path.
const cache = new Map();
const writes = createScheduler();

/**
 * Build the path of the hidden history sibling for a source file,
 * `src/foo.py` has the history file `src/.foo.py.history`.
 *
 * @param {string} path - The source file path.
 * @returns {string} The history file path.
 */
export function historyFilePath(path) {
  const { name, parentPath } = getPartsFromPath(path);
  const filename = `.${name}.history`;
  return parentPath ? `${parentPath}/${filename}` : filename;
}

/**
 * Check whether a path is itself a history file.
 *
 * @param {string} path - Any file path.
 * @returns {boolean} True if the path points to a history sibling.
 */
export function isHistoryFilePath(path) {
  const { name } = getPartsFromPath(path);
  return HISTORY_FILE_PATTERN.test(name);
}

/**
 * Load the history for a source file, from cache or from the VFS.
 * A missing or unparsable history file yields a fresh empty history.
 *
 * @param {string} path - The source file path.
 * @returns {Promise<object>} The history object `{ v, big, revs }`.
 */
export async function loadHistory(path) {
  if (cache.has(path)) {
    return cache.get(path);
  }

  let history = null;
  try {
    const content = await Terra.app.vfs.readFile(historyFilePath(path));
    if (typeof content === 'string' && content.length > 0) {
      history = JSON.parse(content);
    }
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) {
      console.warn(`edit-history: failed to load history for ${path}`, err);
    }
  }

  if (!history || history.v !== 1 || !Array.isArray(history.revs)) {
    history = { v: 1, big: false, revs: [] };
  }

  cache.set(path, history);
  return history;
}

/**
 * Append a revision to a file's history and persist it. Handles the
 * big-file cutoff, keyframe cadence and pruning. Never throws.
 *
 * @param {string} path - The source file path.
 * @param {string} tag - Revision tag ("typing", "clipboard", "undo", ...).
 * @param {array|null} patch - Forward patch `[pos, removed, inserted]`
 * transforming the previous revision into this one, or null to force a
 * full snapshot.
 * @param {string} content - The full file content after this revision.
 * @returns {Promise<object|null>} The updated history, or null if skipped.
 */
export async function commitRevision(path, tag, patch, content) {
  try {
    const history = await loadHistory(path);

    // Big-file cutoff: stop recording, but keep what is already there.
    // Resume with a fresh snapshot when the file shrinks below the limit,
    // since intermediate changes were not recorded.
    if (new Blob([content]).size > MAX_TRACKED_FILE_SIZE) {
      if (!history.big) {
        history.big = true;
        schedulePersist(path);
      }
      return null;
    }

    const resuming = history.big;
    history.big = false;

    const rev = { t: Date.now(), tag };
    const needsKeyframe = (
      resuming
      || patch === null
      || history.revs.length % KEYFRAME_INTERVAL === 0
      || ['external', 'revert'].includes(tag)
    );

    if (needsKeyframe) {
      rev.snap = content;
    } else {
      rev.p = patch;
    }

    history.revs.push(rev);
    schedulePersist(path);
    return history;
  } catch (err) {
    console.warn(`edit-history: failed to record revision for ${path}`, err);
    return null;
  }
}

/**
 * Reconstruct the full file content at a given revision index by applying
 * forward patches from the nearest preceding keyframe.
 *
 * @param {object} history - The history object.
 * @param {number} index - The revision index to reconstruct.
 * @returns {string} The file content at that revision.
 */
export function getContentAt(history, index) {
  let start = index;
  while (start > 0 && history.revs[start].snap === undefined) {
    start--;
  }

  let content = history.revs[start].snap ?? '';
  for (let i = start + 1; i <= index; i++) {
    const [pos, removed, inserted] = history.revs[i].p;
    content = content.slice(0, pos) + inserted + content.slice(pos + removed.length);
  }

  return content;
}

/**
 * Prune older revisions to keep history size within limits.
 *
 * @param {object} history - The history object to prune.
 * @returns {string} The serialized history, within the size cap.
 */
export function pruneToCaps(history) {
  while (history.revs.length > MAX_REVISIONS) {
    pruneOldest(history);
  }

  let json = JSON.stringify(history);
  while (history.revs.length > 1 && json.length > MAX_SERIALIZED_SIZE) {
    pruneOldest(history);
    json = JSON.stringify(history);
  }

  return json;
}

/**
 * Drop the oldest revisions of a history in place, while making sure that
 * history always starts at a keyframe (a full snapshot).
 *
 * @param {object} history - The history object to prune.
 */
function pruneOldest(history) {
  let cut = 1;
  while (cut < history.revs.length && history.revs[cut].snap === undefined) {
    cut++;
  }

  if (cut >= history.revs.length) {
    // No keyframe after the head: materialize the last revision covered
    // by the cut into a snapshot so the tail stays reconstructible.
    cut = Math.max(1, history.revs.length - 1);
    const snap = getContentAt(history, cut);
    const rev = history.revs[cut];
    delete rev.p;
    rev.snap = snap;
  }

  history.revs.splice(0, cut);
}

/**
 * Schedule a write of a file's cached history, after a short delay so that
 * rapid commits end up as one write.
 *
 * @param {string} path - The source file path.
 */
function schedulePersist(path) {
  writes.schedule(path, PERSIST_DELAY_MS, () => persist(path).catch((err) => {
    console.warn(`edit-history: failed to persist history for ${path}`, err);
  }));
}

/**
 * Write a file's cached history to its hidden VFS file right now.
 * `isUserInvoked=false` avoids file-tree refreshes and git auto-commits.
 *
 * @param {string} path - The source file path.
 */
async function persist(path) {
  const history = cache.get(path);
  if (!history) return;

  const json = pruneToCaps(history);

  // updateFile upserts, writing to the exact path (no collision rename), so it
  // both creates the history file on first write and overwrites it thereafter
  await Terra.app.vfs.updateFile(historyFilePath(path), json, false);
}

/**
 * Write every scheduled history to the VFS right now. Used before exam
 * submission and on page unload.
 *
 * @returns {Promise<void>} Resolves when all writes have completed.
 */
export async function writeAllNow() {
  await writes.runAllNow();
}

/**
 * Move a file's history along with the file itself (rename/move).
 *
 * @param {string} oldPath - The previous source file path.
 * @param {string} newPath - The new source file path.
 */
export async function moveHistory(oldPath, newPath) {
  try {
    // A pending write against the old path would recreate an orphaned
    // history file after the move; retarget it to the new path instead.
    const hadPendingWrite = writes.cancel(oldPath);

    const oldFilePath = historyFilePath(oldPath);
    if (await Terra.app.vfs.pathExists(oldFilePath)) {
      await Terra.app.vfs.moveFile(oldFilePath, historyFilePath(newPath));
    }

    if (cache.has(oldPath)) {
      cache.set(newPath, cache.get(oldPath));
      cache.delete(oldPath);
    }

    if (hadPendingWrite) {
      schedulePersist(newPath);
    }
  } catch (err) {
    console.warn(`edit-history: failed to move history of ${oldPath}`, err);
  }
}

/**
 * Forget everything cached about a source file, for example when the file is
 * deleted.
 *
 * @param {string} path - The source file path.
 */
export function forgetPath(path) {
  writes.cancel(path);
  cache.delete(path);
}

/**
 * Clear all cached histories and cancel pending writes, for example when the
 * storage backend changes.
 */
export function clearCache() {
  writes.cancelAll();
  cache.clear();
}
