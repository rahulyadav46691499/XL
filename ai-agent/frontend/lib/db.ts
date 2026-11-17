"use client";

const DB_NAME = "exl_talent_agent_db";
const DB_VERSION = 1;
const STORE_NAME = "file_blobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeFileBlob(key: string, file: File): Promise<void> {
  try {
    if (!file || typeof file.arrayBuffer !== "function") {
      console.error("[db] storeFileBlob: invalid file object, skipping key=", key, file);
      return;
    }

    console.log("[db] storeFileBlob: storing key=", key, "name=", file.name, "size=", file.size, "type=", file.type);

    const arrayBuffer = await file.arrayBuffer();
    console.log("[db] storeFileBlob: converted to ArrayBuffer, byteLength=", arrayBuffer.byteLength);

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({
        key: key,
        arrayBuffer: arrayBuffer,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      tx.oncomplete = () => {
        console.log("[db] storeFileBlob: write transaction complete for key=", key);
        resolve();
      };
      tx.onerror = () => {
        console.error("[db] storeFileBlob: write transaction failed for key=", key, tx.error);
        reject(tx.error);
      };
    });
  } catch (err) {
    console.error("[db] storeFileBlob failed for key=", key, err);
  }
}

export async function getFileBlob(key: string): Promise<File | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        console.log("[db] getFileBlob: raw result for key=", key, "->", result ? "found" : "NOT FOUND");

        if (!result) {
          resolve(null);
          return;
        }

        if (!result.arrayBuffer) {
          console.error("[db] getFileBlob: stored record has no arrayBuffer field, cannot rebuild file");
          resolve(null);
          return;
        }

        const file = new File([result.arrayBuffer], result.name, { type: result.type });
        console.log("[db] getFileBlob: rebuilt File -> instanceof File:", file instanceof File, "size:", file.size, "name:", file.name);

        resolve(file);
      };
      request.onerror = () => {
        console.error("[db] getFileBlob: read failed for key=", key, request.error);
        reject(request.error);
      };
    });
  } catch (err) {
    console.error("[db] getFileBlob failed for key=", key, err);
    return null;
  }
}

export async function deleteFileBlob(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[db] deleteFileBlob failed for key=", key, err);
  }
}