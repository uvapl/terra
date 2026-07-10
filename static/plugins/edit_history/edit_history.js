import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import { createModal, hideModal, showModal } from '../../js/ui/components/modal.js';
import { seconds } from '../../js/lib/helpers.js';
import { IS_IDE } from '../../js/constants.js';
import Terra from '../../js/terra.js';
import {
  HISTORY_FILE_PATTERN,
  MAX_TRACKED_FILE_SIZE,
  commitRevision,
  clearCache,
  flushAll,
  forgetPath,
  getContentAt,
  isHistoryFilePath,
  loadHistory,
  moveHistory,
} from './history_store.js';

// A pause in typing longer than this closes the current revision, so the
// history reads as separate dated bursts of activity.
const REVISION_IDLE_MS = seconds(30);

// Interval between steps when playing through revisions in the overlay.
const PLAY_INTERVAL_MS = 300;

// Ace command names mapped to revision tags. Any other named command that
// produces a document change (indent, moveLinesUp, ...) counts as typing.
const COMMAND_TAGS = {
  insertstring: 'typing',
  backspace: 'typing',
  del: 'typing',
  paste: 'clipboard',
  cut: 'clipboard',
  undo: 'undo',
  redo: 'redo',
};

// Tags that form one revision per editor command instead of accumulating.
const ONE_SHOT_TAGS = ['clipboard', 'undo', 'redo'];

/**
 * Records a persistent edit history for every file into a hidden sibling
 * file (`foo.py` -> `.foo.py.history`), swap-file style, and offers an
 * in-editor overlay (IDE only) to scrub through, replay and revert
 * revisions. Recording is disabled while the git storage backend is
 * active; OPFS and LFS are recorded.
 */
export default class EditHistoryPlugin extends TerraPlugin {
  name = 'edit-history';

  css = ['static/plugins/edit_history/edit_history.css'];

  /**
   * Per-editor recording state, keyed by editor component.
   * @type {Map<EditorTab, object>}
   */
  trackers = new Map();

  /**
   * The active storage backend name ('local', 'lfs' or 'git'). Terra boots
   * on OPFS; backend switches arrive via onStorageChange.
   * @type {string}
   */
  storageName = 'local';

  /**
   * Set while the plugin itself writes to an editor (revision preview,
   * revert) so those programmatic changes are not recorded as edits.
   * @type {boolean}
   */
  _suppress = false;

  /**
   * Set between onEditorBeforeReload and onEditorContentChanged, while the app
   * programmatically reloads a file (VFS/LFS). The synchronous burst of change
   * events this produces must not be recorded as user edits; the reloaded
   * state is instead captured once, in onEditorContentChanged.
   * @type {boolean}
   */
  _reloading = false;

  /**
   * Overlay state when revision mode is active, null otherwise.
   * @type {object|null}
   */
  overlay = null;

  _menuRegistered = false;
  _globalEventsBound = false;

  // ---------------------------------------------------------------------
  // Plugin lifecycle hooks
  // ---------------------------------------------------------------------

  onLayoutLoaded = () => {
    this._registerMenuItem();

    if (this._globalEventsBound) return;
    this._globalEventsBound = true;

    // Hide history siblings from the file tree, downloads and run sandbox.
    // The VFS keeps them on disk (and still submits them on exams), it just
    // filters them out of listings. The naming convention stays owned here.
    Terra.app.vfs.registerHidePattern(HISTORY_FILE_PATTERN.source);

    // Move a file's history along when the file itself is moved/renamed.
    Terra.app.vfs.addEventListener('fileMoved', (e) => {
      const { oldPath, file } = e.detail;
      if (!isHistoryFilePath(oldPath)) {
        moveHistory(oldPath, file.path);
      }
    });

    // Forget the cached history when a file is deleted, so a new file
    // created later at the same path does not continue on stale state.
    Terra.app.vfs.addEventListener('fileDeleted', (e) => {
      forgetPath(e.detail.file.path);
    });

    // Best-effort flush when the page closes mid-revision.
    window.addEventListener('beforeunload', () => {
      this.flush();
    });
  }

  onSwitchToEditorTab = (editorComponent) => {
    if (this.overlay && this.overlay.comp !== editorComponent) {
      this.closeOverlay();
    }
    this._attach(editorComponent);
  }

  onEditorHide = (editorComponent) => {
    this._closeOverlayFor(editorComponent);
    this._commitOpenRevision(editorComponent);
  }

  onEditorDestroy = (editorComponent) => {
    this._closeOverlayFor(editorComponent);
    this._commitOpenRevision(editorComponent);
    this._detach(editorComponent);
  }

  _closeOverlayFor = (editorComponent) => {
    if (this.overlay && this.overlay.comp === editorComponent) {
      this.closeOverlay();
    }
  }

  onEditorBeforeReload = (editorComponent) => {
    // A programmatic reload is about to replace the document, firing a burst
    // of change events. Finalise whatever the user had open (it is still
    // valid against the pre-reload content) and mark the burst so _onDelta
    // ignores it; onEditorContentChanged closes this and snapshots the result.
    this._commitOpenRevision(editorComponent);
    this._reloading = true;
  }

  onEditorContentChanged = (editorComponent) => {
    // Fires once after any programmatic reload (LFS poll, tab switch, ...).
    // Always close the reload window first, so a subsequent early return
    // cannot leave _reloading stuck on and silently drop future edits.
    this._reloading = false;

    if (this._suppress) return;

    const tracker = this.trackers.get(editorComponent);
    const path = editorComponent.getPath();
    if (!tracker || !path || isHistoryFilePath(path) || !this._recordingEnabled()) return;

    // Most reloads (e.g. a tab switch) load the same bytes the editor already
    // had; only record when the content actually changed. Without a known
    // previous state (no edits yet this session) there is nothing to diff
    // against, so just adopt the current content.
    const content = editorComponent.getContent();
    if (tracker.lastContent === null || tracker.lastContent === content) {
      tracker.lastContent = content;
      return;
    }

    tracker.openRev = null;
    tracker.lastContent = content;
    this._enqueueCommit(tracker, path, 'external', null, content);
  }

  onStorageChange = (storageName) => {
    // This event fires after the backend has already switched, so anything
    // still open or pending belongs to the previous file system and cannot
    // be committed anymore: drop it all and start fresh.
    clearCache();
    for (const tracker of this.trackers.values()) {
      tracker.openRev = null;
      tracker.lastContent = null;
      tracker.chain = Promise.resolve();
    }
    this.storageName = storageName;

    if (this.overlay) {
      this.closeOverlay();
    }
  }

  // ---------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------

  _recordingEnabled = () => this.storageName !== 'git';

  /**
   * Start recording an editor component (idempotent).
   *
   * @param {EditorTab} editorComponent - The editor tab component.
   */
  _attach = (editorComponent) => {
    if (this.trackers.has(editorComponent) || !editorComponent.editor) return;

    const tracker = {
      pendingOrigin: null,
      openRev: null,
      lastContent: null,
      chain: Promise.resolve(),
    };

    tracker.onExec = (e) => {
      tracker.pendingOrigin = e.command.name;
    };

    tracker.onAfterExec = () => {
      const rev = tracker.openRev;
      if (rev && ONE_SHOT_TAGS.includes(rev.tag)) {
        this._commitOpenRevision(editorComponent);
      }
      tracker.pendingOrigin = null;
    };

    tracker.onChange = (delta) => {
      try {
        this._onDelta(editorComponent, tracker, delta);
      } catch (err) {
        console.warn('edit-history: failed to process editor change', err);
        tracker.openRev = null;
        tracker.lastContent = editorComponent.getContent();
      }
    };

    editorComponent.editor.commands.on('exec', tracker.onExec);
    editorComponent.editor.commands.on('afterExec', tracker.onAfterExec);
    editorComponent.editor.on('change', tracker.onChange);

    this.trackers.set(editorComponent, tracker);
  }

  _detach = (editorComponent) => {
    const tracker = this.trackers.get(editorComponent);
    if (!tracker) return;

    editorComponent.editor.commands.off('exec', tracker.onExec);
    editorComponent.editor.commands.off('afterExec', tracker.onAfterExec);
    editorComponent.editor.off('change', tracker.onChange);
    this.trackers.delete(editorComponent);
  }

  /**
   * Handle one Ace change delta: resolve its revision tag, decide whether
   * it extends the open revision or starts a new one, and accumulate it.
   *
   * @param {EditorTab} comp - The editor component.
   * @param {object} tracker - The recording state for this editor.
   * @param {object} delta - Ace delta {action, start, end, lines}.
   */
  _onDelta = (comp, tracker, delta) => {
    if (
      this._suppress
      // Programmatic reloads (VFS/LFS) fire change deltas that are not user
      // edits; they are handled as a unit around the burst by
      // onEditorBeforeReload / onEditorContentChanged.
      || this._reloading
      || comp.firstTimeLoadingContent
      || !this._recordingEnabled()
      || (this.overlay && this.overlay.comp === comp)
    ) return;

    const path = comp.getPath();
    if (!path || isHistoryFilePath(path)) return;

    const contentAfter = comp.getContent();

    // Fast local size gate; the store performs the authoritative check.
    if (contentAfter.length > MAX_TRACKED_FILE_SIZE) {
      tracker.openRev = null;
      tracker.lastContent = contentAfter;
      return;
    }

    const text = delta.lines.join('\n');
    const offset = comp.editor.session.doc.positionToIndex(delta.start);
    const tag = this._resolveTag(tracker.pendingOrigin, delta, text);
    const now = Date.now();

    // The content before this delta: normally tracked, otherwise derived
    // by inverting the delta on the current content.
    const contentBefore = tracker.lastContent
      ?? this._invertDelta(contentAfter, delta, text, offset);

    let rev = tracker.openRev;

    if (rev && (rev.tag !== tag || now - rev.lastEditAt > REVISION_IDLE_MS)) {
      this._commitOpenRevision(comp);
      rev = null;
    }

    if (!rev) {
      rev = this._openRevision(tracker, tag, path, contentBefore, now);
    }

    if (!this._mergeDelta(rev, delta.action, offset, text)) {
      if (ONE_SHOT_TAGS.includes(tag) && tracker.pendingOrigin) {
        // Multiple scattered deltas from a single command (e.g. one undo
        // step): keep them in one revision, stored as a snapshot.
        rev.forceSnap = true;
      } else {
        this._commitOpenRevision(comp);
        rev = this._openRevision(tracker, tag, path, contentBefore, now);
        this._mergeDelta(rev, delta.action, offset, text);
      }
    }

    rev.lastEditAt = now;
    rev.contentAfter = contentAfter;
    tracker.lastContent = contentAfter;

    // A change without a command behind it (e.g. menu paste through
    // editor.insert) gets no afterExec, so close one-shot tags here.
    if (ONE_SHOT_TAGS.includes(tag) && !tracker.pendingOrigin) {
      this._commitOpenRevision(comp);
    }
  }

  /**
   * Map a pending Ace command name (or the delta itself when no command
   * is involved) to a revision tag.
   */
  _resolveTag = (pendingOrigin, delta, text) => {
    if (pendingOrigin) {
      return COMMAND_TAGS[pendingOrigin] || 'typing';
    }

    // No command: programmatic insert. Multi-character inserts are pastes
    // in disguise (the app's own clipboard menu uses editor.insert).
    if (delta.action === 'insert' && text.length > 1) {
      return 'clipboard';
    }

    return 'typing';
  }

  /**
   * Reconstruct the content as it was before a delta was applied.
   */
  _invertDelta = (contentAfter, delta, text, offset) => {
    if (delta.action === 'insert') {
      return contentAfter.slice(0, offset) + contentAfter.slice(offset + text.length);
    }
    return contentAfter.slice(0, offset) + text + contentAfter.slice(offset);
  }

  _openRevision = (tracker, tag, path, contentBefore, now) => {
    tracker.openRev = {
      tag,
      path,
      baseContent: contentBefore,
      contentAfter: contentBefore,
      pos: null,
      removed: '',
      inserted: '',
      forceSnap: false,
      lastEditAt: now,
    };
    return tracker.openRev;
  }

  /**
   * Try to fold a delta into the open revision's single splice region
   * `{pos, removed, inserted}` (in offsets relative to the revision's base
   * content). Returns false when the delta is not contiguous with the
   * region, which signals a revision boundary.
   *
   * @returns {boolean} True if merged.
   */
  _mergeDelta = (rev, action, offset, text) => {
    if (rev.forceSnap) return true; // region tracking already abandoned

    if (rev.pos === null) {
      // First delta of the revision defines the region.
      if (action === 'insert') {
        rev.pos = offset;
        rev.inserted = text;
      } else {
        rev.pos = offset;
        rev.removed = text;
      }
      return true;
    }

    const insStart = rev.pos;
    const insEnd = rev.pos + rev.inserted.length;

    if (action === 'insert') {
      // Insert anywhere within the region (covers auto-closed brackets).
      if (offset < insStart || offset > insEnd) return false;
      const at = offset - insStart;
      rev.inserted = rev.inserted.slice(0, at) + text + rev.inserted.slice(at);
      return true;
    }

    // Removal must touch the region to stay contiguous.
    const end = offset + text.length;
    if (offset > insEnd || end < insStart) return false;

    // Part removed before the region is base text: extend `removed` at the
    // front. Part inside the region cuts `inserted`. Part after the region
    // is base text again: extend `removed` at the back.
    const beforeLen = Math.max(0, insStart - offset);
    const afterLen = Math.max(0, end - insEnd);
    const cutFrom = Math.max(0, offset - insStart);
    const cutTo = Math.min(rev.inserted.length, end - insStart);

    rev.removed = text.slice(0, beforeLen) + rev.removed + (afterLen ? text.slice(text.length - afterLen) : '');
    rev.inserted = rev.inserted.slice(0, cutFrom) + rev.inserted.slice(cutTo);
    rev.pos = Math.min(insStart, offset);
    return true;
  }

  /**
   * Commit the open revision of an editor (if any) to the history store.
   *
   * @param {EditorTab} editorComponent - The editor component.
   */
  _commitOpenRevision = (editorComponent) => {
    const tracker = this.trackers.get(editorComponent);
    if (!tracker || !tracker.openRev) return;

    const rev = tracker.openRev;
    tracker.openRev = null;

    if (!rev.forceSnap && rev.removed === '' && rev.inserted === '') return;

    const patch = rev.forceSnap ? null : [rev.pos, rev.removed, rev.inserted];
    this._enqueueCommit(tracker, rev.path, rev.tag, patch, rev.contentAfter, rev.baseContent);
  }

  /**
   * Queue a commit on the tracker's promise chain so revisions of one file
   * are stored in order. Seeds an "initial" snapshot of the pre-edit
   * content when this is the file's very first recorded revision, and
   * self-heals when the stored history's last content does not match the
   * base this patch was recorded against (e.g. the file changed outside
   * any tracked editor): a patch must only ever be appended onto the exact
   * content it applies to, or reconstruction breaks silently.
   */
  _enqueueCommit = (tracker, path, tag, patch, content, baseContent = null) => {
    tracker.chain = tracker.chain.then(async () => {
      const history = await loadHistory(path);

      if (history.revs.length === 0 && baseContent !== null) {
        await commitRevision(path, 'initial', null, baseContent);
      } else if (
        patch !== null
        && baseContent !== null
        && history.revs.length > 0
        && getContentAt(history, history.revs.length - 1) !== baseContent
      ) {
        await commitRevision(path, 'external', null, baseContent);
      }

      await commitRevision(path, tag, patch, content);
    }).catch((err) => {
      console.warn(`edit-history: failed to store revision for ${path}`, err);
    });
  }

  /**
   * Commit all open revisions and write every pending history to the VFS.
   * Called before exam submission and on page unload.
   *
   * @returns {Promise<void>} Resolves when everything is on disk.
   */
  flush = async () => {
    for (const comp of this.trackers.keys()) {
      this._commitOpenRevision(comp);
    }
    await Promise.all([...this.trackers.values()].map((t) => t.chain));
    await flushAll();
  }

  /**
   * Lifecycle hook fired (and awaited) by the app before an exam submission.
   * Writing every pending history to the VFS means the app can submit them
   * as ordinary files without knowing this plugin exists.
   *
   * @returns {Promise<void>} Resolves when everything is on disk.
   */
  onBeforeSubmit = () => this.flush();

  // ---------------------------------------------------------------------
  // Overlay UI (IDE only)
  // ---------------------------------------------------------------------

  _registerMenuItem = () => {
    // Only the IDE variant has a menubar; skip all UI elsewhere (exam).
    if (this._menuRegistered || !IS_IDE) return;
    this._menuRegistered = true;

    Terra.app.commands.register([{
      name: 'showEditHistory',
      scope: 'global',
      menuItem: { path: 'File/Show Edit History...', position: 340 },
      isAvailable: ({ app }) => (
        !!app.view.getActiveEditor() && this._recordingEnabled() && !this.overlay
      ),
      exec: () => this.openOverlay(),
    }]);
    Terra.app.view.refreshMenu();
    Terra.app.view.layout?.addActiveStates?.();
  }

  /**
   * Enter revision mode on the active editor: lock it, load its history
   * and show the scrubber overlay.
   */
  openOverlay = async () => {
    if (this.overlay) return;

    const comp = Terra.app.view.getActiveEditor();
    const path = comp?.getPath();
    if (!comp || !path || isHistoryFilePath(path)) return;

    // Make sure everything typed so far is part of the history.
    this._commitOpenRevision(comp);
    const tracker = this.trackers.get(comp);
    if (tracker) await tracker.chain;

    const history = await loadHistory(path);
    if (history.revs.length === 0) {
      // Never edited before: seed the current content so there is
      // something to show.
      await commitRevision(path, 'initial', null, comp.getContent());
    }

    this._suppress = true;
    comp.lock();

    this.overlay = {
      comp,
      path,
      history,
      index: history.revs.length - 1,
      originalSession: comp.editor.session,
      // A single detached session is reused for all previews; mutating it
      // while detached keeps the editor's change pipeline (autosave, this
      // recorder) blind to preview content.
      previewSession: ace.createEditSession('', comp.editor.session.getMode()),
      playTimer: null,
      el: this._buildOverlayElement(history),
    };

    const host = comp.editor.container.parentNode;
    host.classList.add('edit-history-active');
    host.appendChild(this.overlay.el);

    this._onKeyDown = (e) => {
      // Ignore Escape while the revert confirmation modal is up; the modal
      // handles its own Escape.
      if (
        e.key === 'Escape'
        && this.overlay
        && !document.getElementById('edit-history-revert-modal')
      ) {
        this.closeOverlay();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);

    this._updateOverlay();
  }

  /**
   * Leave revision mode: restore the editor's real session (which still
   * holds the latest content and undo stack) and unlock it.
   */
  closeOverlay = () => {
    if (!this.overlay) return;

    const { comp, originalSession, el, playTimer } = this.overlay;
    clearInterval(playTimer);
    document.removeEventListener('keydown', this._onKeyDown);

    comp.editor.setSession(originalSession);
    comp.unlock();

    el.parentNode?.classList.remove('edit-history-active');
    el.remove();

    this.overlay = null;
    this._suppress = false;
    Terra.app.view.invalidateActions?.();
  }

  _buildOverlayElement = (history) => {
    const el = document.createElement('div');
    el.className = 'edit-history-overlay';
    el.innerHTML = `
      <div class="edit-history-label"></div>
      <div class="edit-history-controls">
        <button class="button edit-history-play" title="Play through revisions">&#9654;</button>
        <input type="range" class="edit-history-slider" min="0" step="1">
        <button class="button edit-history-revert">Revert</button>
        <button class="button edit-history-close" title="Close">&#10005;</button>
      </div>
      <div class="edit-history-badge"></div>
    `;

    el.querySelector('.edit-history-slider').addEventListener('input', (e) => {
      this._stopPlaying();
      this.overlay.index = Number(e.target.value);
      this._updateOverlay();
    });

    el.querySelector('.edit-history-play').addEventListener('click', () => {
      if (this.overlay.playTimer) {
        this._stopPlaying();
      } else {
        this._startPlaying();
      }
    });

    el.querySelector('.edit-history-revert').addEventListener('click', () => {
      this._stopPlaying();
      this._confirmRevert();
    });

    el.querySelector('.edit-history-close').addEventListener('click', () => {
      this.closeOverlay();
    });

    return el;
  }

  _startPlaying = () => {
    const overlay = this.overlay;
    if (overlay.index >= overlay.history.revs.length - 1) {
      overlay.index = 0;
      this._updateOverlay();
    }

    overlay.el.querySelector('.edit-history-play').innerHTML = '&#10074;&#10074;';
    overlay.playTimer = setInterval(() => {
      if (overlay.index >= overlay.history.revs.length - 1) {
        this._stopPlaying();
        return;
      }
      overlay.index++;
      this._updateOverlay();
    }, PLAY_INTERVAL_MS);
  }

  _stopPlaying = () => {
    if (!this.overlay || !this.overlay.playTimer) return;
    clearInterval(this.overlay.playTimer);
    this.overlay.playTimer = null;
    this.overlay.el.querySelector('.edit-history-play').innerHTML = '&#9654;';
  }

  /**
   * Show the currently selected revision in the editor and refresh the
   * overlay's label and controls. The content is rendered in a detached
   * throwaway session so the editor's change pipeline (autosave, this
   * recorder) never sees preview content.
   */
  _updateOverlay = () => {
    const overlay = this.overlay;
    const { comp, history, index, el } = overlay;
    const count = history.revs.length;

    const slider = el.querySelector('.edit-history-slider');
    slider.max = String(count - 1);
    slider.value = String(index);
    slider.disabled = count <= 1;

    const rev = history.revs[index];
    const date = new Date(rev.t).toLocaleString();
    el.querySelector('.edit-history-label').textContent =
      `Revision ${index + 1} / ${count} — ${rev.tag} — ${date}`;

    el.querySelector('.edit-history-revert').disabled = index >= count - 1;

    const badge = el.querySelector('.edit-history-badge');
    badge.textContent = history.big
      ? 'Recording paused: file exceeds 100KB'
      : '';

    // Update the reusable preview session while it is detached (no change
    // events reach the editor pipeline that way), then attach it. Both
    // steps are synchronous, so no intermediate state is ever painted.
    const content = getContentAt(history, index);
    if (comp.editor.session === overlay.previewSession) {
      comp.editor.setSession(overlay.originalSession);
    }
    overlay.previewSession.setValue(content);
    comp.editor.setSession(overlay.previewSession);
  }

  _confirmRevert = () => {
    const overlay = this.overlay;
    const { index, history } = overlay;
    if (index >= history.revs.length - 1) return;

    const $modal = createModal({
      title: 'Revert to this revision?',
      body: `
        <p>The editor will be restored to revision ${index + 1}.
        Your current content stays in the history, so nothing is lost.</p>
      `,
      footer: `
        <button type="button" class="button cancel-btn">Cancel</button>
        <button type="button" class="button primary-btn danger-btn">Revert</button>
      `,
      attrs: { id: 'edit-history-revert-modal', class: 'modal-width-small' },
    });

    $modal.find('.cancel-btn').click(() => {
      hideModal($modal);
    });

    $modal.find('.primary-btn').click(async () => {
      hideModal($modal);
      await this._revert();
    });

    showModal($modal);
  }

  /**
   * Append a new latest revision that copies the selected one, and make it
   * the editor's real content. Earlier revisions are never deleted.
   */
  _revert = async () => {
    const overlay = this.overlay;
    const { comp, path, history, index } = overlay;

    const content = getContentAt(history, index);
    await commitRevision(path, 'revert', null, content);

    // Write the restored content through the normal pipeline (VFS
    // autosave included) while _suppress keeps the recorder quiet. The
    // editor must be back on its real session for that; setValue is not
    // blocked by the readOnly lock.
    comp.editor.setSession(overlay.originalSession);
    comp.setContent(content);

    overlay.index = history.revs.length - 1;
    this._updateOverlay();
  }
}
