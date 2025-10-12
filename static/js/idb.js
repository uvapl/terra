/**
 * Handles IndexedDB operations for the Terra app.
 */

const IDB_VERSION = 2;
const IDB_NAME = 'terra';
const STORE_NAMES = ['lfs'];

/**
 * Opens a request to the IndexedDB.
 *
 * @returns {Promise<IDBRequest>} The IDB request object.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = indexedDBOnUpgradeNeededCallback;

    request.onblocked = (event) => {
      console.error('IDB is blocked', event);
      reject(event.target.error);
    }

    request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Callback function when the IndexedDB version is upgraded.
 *
 * @param {IDBVersionChangeEvent} event
 */
function indexedDBOnUpgradeNeededCallback(event) {
  const db = event.target.result;

  // Create all object stores.
  for (const storeName of STORE_NAMES) {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName);
    }
  }
}

/**
 * Clear all stores inside the app's indexedDB.
 *
 * @returns {Promise<void>}
 */
export function clearStores() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = indexedDBOnUpgradeNeededCallback;

    request.onsuccess = (event) => {
      const db = event.target.result;

      // Check if the database has any object stores
      if (db.objectStoreNames.length > 0) {
        const transaction = db.transaction(db.objectStoreNames, 'readwrite');

        transaction.oncomplete = () => {
          resolve();
        };

        transaction.onerror = () => {
          console.error('Error clearing stores');
          reject(transaction.error);
        };

        // Clear each object store.
        for (const storeName of db.objectStoreNames) {
          const store = transaction.objectStore(storeName);
          store.clear();
        }
      } else {
        // No object stores, resolve immediately.
        resolve();
      }
    };

    request.onerror = () => {
      console.error('Error opening database');
      reject(request.error);
    };
  });
}

/**
 * Save the given handle in the specified IDB store.
 *
 * @async
 * @param {string} storeName - The store name where to save the handle.
 * @param {string} key - The key to save the handle under.
 * @param {*} value - The value to save under the key.
 * @returns {Promise<void>}
 */
export async function saveHandle(storeName, key, value) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, 'readwrite')
      .objectStore(storeName)
      .put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject();
  });
}

/**
 * Retrieve a handle from the specified store by key.
 *
 * @async
 * @param {string} storeName - The store name to retrieve the handle from.
 * @param {string} key - A unique key to identify the handle.
 * @returns {Promise<FileSystemDirectoryHandle|FileSystemFileHandle>}
 */
export async function getHandle(storeName, key) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = (event) => event.target.result ? resolve(event.target.result) : resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}
