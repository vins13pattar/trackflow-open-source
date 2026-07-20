/**
 * Small key/value storage abstraction so the offline queue can be tested
 * without React Native. The production binding lazily imports
 * `@react-native-async-storage/async-storage` so the same file is safe to
 * load from a node test runner (where the RN module isn't available).
 */

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory fallback / fake — used by tests and as a safety net at startup. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

let cached: KeyValueStorage | null = null;

/**
 * Returns AsyncStorage on a React Native runtime; falls back to in-memory
 * when the module is unavailable (so tests and CI imports work).
 */
export async function defaultStorage(): Promise<KeyValueStorage> {
  if (cached) return cached;
  try {
    const mod = (await import('@react-native-async-storage/async-storage')) as {
      default: KeyValueStorage;
    };
    cached = mod.default;
  } catch {
    cached = new MemoryStorage();
  }
  return cached;
}

/** Test hook: lets the queue tests inject a fake storage. */
export function __setStorageForTests(s: KeyValueStorage | null): void {
  cached = s;
}
