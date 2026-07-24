export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryStoragePort implements StoragePort {
  private readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  remove(key: string): void { this.values.delete(key); }
  keys(): string[] { return [...this.values.keys()]; }
}

export class BrowserStoragePort implements StoragePort {
  constructor(private readonly storage: Storage = window.localStorage) {}
  get(key: string): string | null { return this.storage.getItem(key); }
  set(key: string, value: string): void { this.storage.setItem(key, value); }
  remove(key: string): void { this.storage.removeItem(key); }
  keys(): string[] { return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index)).filter((key): key is string => key !== null); }
}

export class JsonRepository<T> {
  constructor(private readonly port: StoragePort, private readonly key: string) {}
  read(fallback: T): T {
    try {
      const raw = this.port.get(this.key);
      return raw ? JSON.parse(raw) as T : fallback;
    } catch {
      this.port.remove(this.key);
      return fallback;
    }
  }
  write(value: T): void { this.port.set(this.key, JSON.stringify(value)); }
  clear(): void { this.port.remove(this.key); }
}
