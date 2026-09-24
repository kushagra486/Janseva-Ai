// Per-device storage for deadlines and decoded notices, so they work offline and without
// an account. Every access is guarded: storage can be unavailable (private mode, blocked).
import type { DecodeResponse, Deadline } from "@janseva/shared";

const DEADLINES = "janseva.deadlines.v1";
const NOTICES = "janseva.notices.v1";

export type SavedNotice = { id: string; savedAt: string; decoded: DecodeResponse };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("janseva-storage"));
  } catch {
    // Storage full or blocked: the feature degrades to "not saved on this device".
  }
}

export const localDeadlines = {
  list: () => read<Deadline[]>(DEADLINES, []),
  add(d: Deadline) {
    write(DEADLINES, [...this.list().filter((x) => x.id !== d.id), d]);
  },
  update(id: string, patch: Partial<Deadline>) {
    write(DEADLINES, this.list().map((d) => (d.id === id ? { ...d, ...patch } : d)));
  },
  remove(id: string) {
    write(DEADLINES, this.list().filter((d) => d.id !== id));
  },
};

export const localNotices = {
  list: () => read<SavedNotice[]>(NOTICES, []),
  add(n: SavedNotice) {
    // Keep the 20 most recent to stay well inside storage limits.
    write(NOTICES, [n, ...this.list().filter((x) => x.id !== n.id)].slice(0, 20));
  },
};

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
