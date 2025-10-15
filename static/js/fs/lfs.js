import * as idb from '../idb.js';
import {
  setLocalStorageItem,
  getLocalStorageItem,
} from '../local-storage-manager.js';

/**
 * Check whether LFS is available in the browser.
 *
 * @returns {boolean} True if LFS is available.
 */
export function available() {
  // Check browser support for Local Filesystem API.
  return 'showOpenFilePicker' in window;
}

/**
 * Whether the user loaded an LFS folder.
 *
 * @returns {boolean} True if an LFS project is loaded.
 */
export function hasProjectLoaded() {
  return (
    available() && getLocalStorageItem('use-lfs', false)
  );
}

/**
 * Opens the Local File System (LFS) by showing the directory picker.
 *
 * @returns {Promise<FileSystemDirectoryHandle|void>} The root folder handle or void if the user aborted.
 */
export async function choose() {
  let rootFolderHandle;
  try {
    rootFolderHandle = await window.showDirectoryPicker();
  } catch (err) {
    // User most likely aborted.
    console.log('LFS directory pick canceled.');
    return;
  }
  await _verifyLFSHandlePermission(rootFolderHandle, true);
  setLocalStorageItem('use-lfs', true);
  await idb.saveHandle('lfs', 'root', rootFolderHandle);
  return rootFolderHandle;
}

/**
 * Reopens the Local File System (LFS). This is called when the application is
 * loaded and a LFS folder was open from last time.
 *
 * The handle may become invalid, in which case the open() function should be
 * used to let the user open the folder again.
 *
 * @returns {Promise<FileSystemDirectoryHandle>} The root folder handle if permission is granted.
 */
export async function reopen() {
  const rootFolderHandle = await idb.getHandle('lfs', 'root');
  if (await _verifyLFSHandlePermission(rootFolderHandle)) {
    return rootFolderHandle;
  } else {
    this.close();
  }
}

/**
 * Retrieves the name of the root folder in the Local File System (LFS).
 *
 * @returns {Promise<string>} The name of the root folder handle.
 */
export async function getBaseFolderName() {
  const rootFolderHandle = await idb.getHandle('lfs', 'root');
  return rootFolderHandle.name;
}

/**
 * Closes the Local File System (LFS) by clearing the stored handles and
 * updating the local storage.
 *
 * @returns {Promise<void>}
 */
export async function close() {
  setLocalStorageItem('use-lfs', false);
  await idb.clearStores();
}

/**
 * Verify and renew existing permission for a given LFS handle.
 *
 * If the action was initiated by the user (e.g. clicking a menu), we can also
 * newly request the permission. This is a browser security limitation. The
 * implication is that we can't initiate a new permission dialog when first
 * loading the app.
 *
 * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle - The handle to verify permission for.
 * @param {boolean} isUserInvoked - Whether the action was initiated by the user.
 * @returns {Promise<boolean>} True if permission is granted, false otherwise.
 */
async function _verifyLFSHandlePermission(handle, isUserInvoked = false) {
  const opts = { mode: 'readwrite' };

  return new Promise(async (resolve) => {
    // Check if we already have permission.
    if ((await handle.queryPermission(opts)) === 'granted') {
      return resolve(true);
    }

    // Otherwise, request permission to the handle.
    if (isUserInvoked && (await handle.requestPermission(opts)) === 'granted') {
      return resolve(true);
    }

    // The user did not grant permission.
    return resolve(false);
  });
}
