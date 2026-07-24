export interface BlobStore {
  put(data: Uint8Array): Promise<string>;
  get(hash: string): Promise<Uint8Array | null>;
  delete(hash: string): Promise<void>;
  has(hash: string): Promise<boolean>;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Compute SHA-256 in the browser via SubtleCrypto. Falls back to a simple
 *  length-based fingerprint in environments without crypto. */
export async function computeSha256(data: Uint8Array): Promise<string> {
  try {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `blob-${data.byteLength}-${Date.now().toString(36)}`;
  }
}

export class StoragePortBlobStore implements BlobStore {
  private readonly prefix: string;
  constructor(
    private readonly storage: Storage = window.localStorage,
    namespace = "paperwitha.blob",
  ) {
    this.prefix = `${namespace}:`;
  }

  private key(hash: string): string {
    return `${this.prefix}${hash}`;
  }

  async put(data: Uint8Array): Promise<string> {
    const hash = await computeSha256(data);
    if (!this.storage.getItem(this.key(hash))) {
      this.storage.setItem(this.key(hash), bytesToBase64(data));
    }
    return hash;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const raw = this.storage.getItem(this.key(hash));
    if (!raw) return null;
    return base64ToBytes(raw);
  }

  async delete(hash: string): Promise<void> {
    this.storage.removeItem(this.key(hash));
  }

  async has(hash: string): Promise<boolean> {
    return this.storage.getItem(this.key(hash)) !== null;
  }
}
