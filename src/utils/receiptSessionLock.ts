/**
 * Advisory lock so two browser tabs on the same machine don't edit the same receipt at once.
 * Org-wide locking needs a Flowgear workflow.
 *
 * Flowgear (and some sandboxes) may load the app in an iframe where `localStorage` is blocked
 * (e.g. sandbox without allow-same-origin). In that case all lock helpers degrade gracefully:
 * no cross-tab exclusion, editing still works.
 */
const PREFIX = "cch-pc-receipt-lock:";
const STALE_MS = 120_000;
export const RECEIPT_LOCK_HEARTBEAT_MS = 15_000;

type LockEntry = { tabId: string; ts: number };

let tabId: string | null = null;

/** Cached after first probe: `null` when storage is unavailable (sandbox, private mode, etc.). */
let storageCache: Storage | null | undefined;

function getReceiptLockStorage(): Storage | null {
  if (storageCache !== undefined) return storageCache;
  try {
    if (typeof window === "undefined") {
      storageCache = null;
      return null;
    }
    const ls = window.localStorage;
    const probe = "__cch-pc-receipt-lock-probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    storageCache = ls;
    return ls;
  } catch {
    storageCache = null;
    return null;
  }
}

export function getReceiptLockTabId(): string {
  if (tabId == null) {
    tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Math.random().toString(36).slice(2)}`;
  }
  return tabId;
}

export function receiptLockStorageKey(lockKey: string): string {
  return PREFIX + encodeURIComponent(lockKey);
}

export function tryAcquireReceiptLock(lockKey: string): boolean {
  const storage = getReceiptLockStorage();
  if (!storage) return true;
  const key = receiptLockStorageKey(lockKey);
  const mine = getReceiptLockTabId();
  const now = Date.now();
  const raw = storage.getItem(key);
  if (raw) {
    try {
      const entry = JSON.parse(raw) as LockEntry;
      if (entry.tabId !== mine && now - entry.ts < STALE_MS) {
        return false;
      }
    } catch {
      /* replace invalid entry */
    }
  }
  storage.setItem(key, JSON.stringify({ tabId: mine, ts: now }));
  return true;
}

export function releaseReceiptLock(lockKey: string): void {
  const storage = getReceiptLockStorage();
  if (!storage) return;
  const key = receiptLockStorageKey(lockKey);
  const raw = storage.getItem(key);
  if (!raw) return;
  try {
    const entry = JSON.parse(raw) as LockEntry;
    if (entry.tabId === getReceiptLockTabId()) {
      storage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function isReceiptLockHeldByOther(lockKey: string): boolean {
  const storage = getReceiptLockStorage();
  if (!storage) return false;
  const raw = storage.getItem(receiptLockStorageKey(lockKey));
  if (!raw) return false;
  try {
    const entry = JSON.parse(raw) as LockEntry;
    const now = Date.now();
    return entry.tabId !== getReceiptLockTabId() && now - entry.ts < STALE_MS;
  } catch {
    return false;
  }
}
