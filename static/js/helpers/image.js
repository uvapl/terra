/**
 * Convert a Uint8Array to a base64 string.
 *
 * @param {Uint8array} uint8Array - The data to be converted.
 * @returns {string} base64 encoded string.
 */
export function uint8ToBase64(uint8Array) {
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Converts an ArrayBuffer (or Uint8Array) to a base64 string.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string} Base64-encoded string
 */
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check whether a given filename has an image extension.
 *
 * @param {string} filename - The filename to check.
 * @returns {boolean} True if the filename has an image extension, false otherwise.
 */
export function isImageExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext);
}
