/**
 * THE MULTIVERSE PORTAL - OFFLINE MESH DB
 * IndexedDB storage for envelopes, seen deduplication caches, and file chunks
 */

const DB_NAME = 'MultiverseMeshDB';
const DB_VERSION = 1;

export class MeshStore {
  constructor() {
    this.db = null;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('envelopes')) {
          const store = db.createObjectStore('envelopes', { keyPath: 'id' });
          store.createIndex('recipientId', 'recipientId', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('seen_cache')) {
          db.createObjectStore('seen_cache', { keyPath: 'envelopeId' });
        }
        if (!db.objectStoreNames.contains('file_chunks')) {
          const chunkStore = db.createObjectStore('file_chunks', { keyPath: 'chunkId' });
          chunkStore.createIndex('fileId', 'fileId', { unique: false });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveEnvelope(envelope) {
    const tx = this.db.transaction(['envelopes', 'seen_cache'], 'readwrite');
    tx.objectStore('envelopes').put(envelope);
    tx.objectStore('seen_cache').put({ envelopeId: envelope.id, timestamp: Date.now() });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async hasSeenEnvelope(envelopeId) {
    const tx = this.db.transaction('seen_cache', 'readonly');
    const req = tx.objectStore('seen_cache').get(envelopeId);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  }

  async getPendingEnvelopes(limit = 100) {
    const tx = this.db.transaction('envelopes', 'readonly');
    const store = tx.objectStore('envelopes');
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const all = req.result || [];
        const now = Date.now();
        const valid = all.filter(env => !env.expiresAt || env.expiresAt > now);
        valid.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
        resolve(valid.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async removeEnvelope(envelopeId) {
    const tx = this.db.transaction('envelopes', 'readwrite');
    tx.objectStore('envelopes').delete(envelopeId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async saveFileChunk(fileId, chunkIndex, totalChunks, dataArrayBuffer, chunkHash) {
    const chunkId = `${fileId}_${chunkIndex}`;
    const tx = this.db.transaction('file_chunks', 'readwrite');
    tx.objectStore('file_chunks').put({
      chunkId,
      fileId,
      chunkIndex,
      totalChunks,
      data: dataArrayBuffer,
      hash: chunkHash,
      savedAt: Date.now()
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getStoredChunks(fileId) {
    const tx = this.db.transaction('file_chunks', 'readonly');
    const index = tx.objectStore('file_chunks').index('fileId');
    const req = index.getAll(fileId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async purgeExpired() {
    const tx = this.db.transaction('envelopes', 'readwrite');
    const store = tx.objectStore('envelopes');
    const req = store.getAll();
    req.onsuccess = () => {
      const now = Date.now();
      for (const env of req.result) {
        if (env.expiresAt && env.expiresAt <= now) {
          store.delete(env.id);
        }
      }
    };
  }
}
