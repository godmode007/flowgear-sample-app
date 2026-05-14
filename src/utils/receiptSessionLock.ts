/**
 * Advisory lock so two browser tabs on the same machine don't edit the same receipt at once.
 * Org-wide locking needs a Flowgear workflow.
 */
const PREFIX = "cch-pc-receipt-lock:";
const STALE_MS = 120_000;
export const RECEIPT_LOCK_HEARTBEAT_MS = 15_000;

type LockEntry = { tabId: string; ts: number };

let tabId: string | null = null;

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
  const key = receiptLockStorageKey(lockKey);
  const mine = getReceiptLockTabId();
  const now = Date.now();
  const raw = localStorage.getItem(key);
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
  localStorage.setItem(key, JSON.stringify({ tabId: mine, ts: now }));
  return true;
}

export function releaseReceiptLock(lockKey: string): void {
  const key = receiptLockStorageKey(lockKey);
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const entry = JSON.parse(raw) as LockEntry;
    if (entry.tabId === getReceiptLockTabId()) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function isReceiptLockHeldByOther(lockKey: string): boolean {
  const raw = localStorage.getItem(receiptLockStorageKey(lockKey));
  if (!raw) return false;
  try {
    const entry = JSON.parse(raw) as LockEntry;
    const now = Date.now();
    return entry.tabId !== getReceiptLockTabId() && now - entry.ts < STALE_MS;
  } catch {
    return false;
  }
}
