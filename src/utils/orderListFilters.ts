import type { ReceiptOrderListEntry } from "../models/receiptConfirmation";
import { getReceiptDetailDateForFilter } from "../models/receiptConfirmation";

export type OrderListFilters = {
  company: string;
  probill: string;
  receiptNo: string;
  dateFrom: string;
  dateTo: string;
};

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
  f: OrderListFilters
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
    return true;
  });
}
