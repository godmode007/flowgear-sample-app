import type { ReceiptOrderListEntry } from "../models/receiptConfirmation";
import { getReceiptDetailDateForFilter, getReceiptLockRecordId, lockUsersMatch } from "../models/receiptConfirmation";

/** Sentinel value for “Mine” in `lockUserSelections` (matches signed-in user via context). */
export const LOCK_USER_FILTER_MINE = "__FG_MINE__";

export type OrderListFilters = {
  company: string;
  probill: string;
  receiptNo: string;
  dateFrom: string;
  dateTo: string;
  /**
   * Filter by left-column “Current user”. Empty = no filter.
   * Include LOCK_USER_FILTER_MINE for your locks; other entries are display names from the list.
   */
  lockUserSelections: string[];
};

export type OrderListFilterContext = {
  lockUserOverrideByRecordId: Record<string, string>;
  /** Normalized label from getReceiptLockUsernameForRequest / context (empty until resolved). */
  currentUserLockLabel: string;
};

/** Options for the current-user multiselect: Mine first, then distinct locker labels from the loaded list. */
export function buildLockUserPickerOptions(
  orders: ReceiptOrderListEntry[],
  lockUserOverrideByRecordId: Record<string, string>
): { value: string; label: string }[] {
  const seen = new Set<string>();
  const users: string[] = [];
  for (const order of orders) {
    const rid = getReceiptLockRecordId(order);
    const fromList = (order.currentLockUser ?? "").trim();
    const fromOverride = (lockUserOverrideByRecordId[rid] ?? "").trim();
    const display = fromList.length > 0 ? fromList : fromOverride;
    if (display.length === 0) continue;
    if (seen.has(display)) continue;
    seen.add(display);
    users.push(display);
  }
  users.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [{ value: LOCK_USER_FILTER_MINE, label: "Mine" }, ...users.map((u) => ({ value: u, label: u }))];
}

export function ordersListEntryKey(entry: ReceiptOrderListEntry): string {
  const rc = entry.payload.Receipt_Confirmation;
  return `${rc.Inbound_Reference_No ?? ""}|${rc.Inbound_Receipt_No ?? ""}`;
}

/** UTC midnight timestamp for calendar day (date-only compare). */
function utcDayFromIsoTimestamp(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcDayFromFilterInput(yyyyMmDd: string): number | null {
  const t = yyyyMmDd.trim();
  if (!t) return null;
  const parts = t.split("-");
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  return Date.UTC(y, m - 1, day);
}

export function filterReceiptOrders(
  orders: ReceiptOrderListEntry[],
  f: OrderListFilters,
  context?: OrderListFilterContext
): ReceiptOrderListEntry[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const fc = norm(f.company);
  const fp = norm(f.probill);
  const fr = norm(f.receiptNo);
  const fromDay = utcDayFromFilterInput(f.dateFrom);
  const toDay = utcDayFromFilterInput(f.dateTo);

  return orders.filter((order) => {
    const rc = order.payload.Receipt_Confirmation;
    if (fc && !(rc.Company ?? "").toLowerCase().includes(fc)) return false;
    if (fp && !(rc.Probill_Number ?? "").toLowerCase().includes(fp)) return false;
    if (fr && !(rc.Inbound_Receipt_No ?? "").toLowerCase().includes(fr)) return false;

    const dateRaw = getReceiptDetailDateForFilter(order.payload);
    const orderDay = dateRaw != null ? utcDayFromIsoTimestamp(dateRaw) : null;
    if (fromDay != null) {
      if (orderDay == null) return true;
      if (orderDay < fromDay) return false;
    }
    if (toDay != null) {
      if (orderDay == null) return true;
      if (orderDay > toDay) return false;
    }

    const selections = f.lockUserSelections;
    if (selections.length > 0 && context != null) {
      const me = context.currentUserLockLabel.trim();
      const onlyMineWhileUnresolved =
        me.length === 0 &&
        selections.length === 1 &&
        selections[0] === LOCK_USER_FILTER_MINE;
      if (!onlyMineWhileUnresolved) {
        const rid = getReceiptLockRecordId(order);
        const fromList = (order.currentLockUser ?? "").trim();
        const fromOverride = (context.lockUserOverrideByRecordId[rid] ?? "").trim();
        const labels = [fromList, fromOverride].filter((s) => s.length > 0);

        let rowMatch = false;
        for (const sel of selections) {
          if (sel === LOCK_USER_FILTER_MINE) {
            if (me.length > 0 && labels.some((c) => lockUsersMatch(me, c))) {
              rowMatch = true;
              break;
            }
          } else if (labels.some((c) => lockUsersMatch(sel, c))) {
            rowMatch = true;
            break;
          }
        }
        if (!rowMatch) return false;
      }
    }

    return true;
  });
}
