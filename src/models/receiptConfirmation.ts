/** Receipt Confirmation payload and line item types for ERP inbound. */

export interface ReceiptConfirmationDate {
  Date_Identifier: string;
  Date: string;
}

export interface ReceiptConfirmationAddress {
  Address_Type: string;
  Address_Code: string;
  Name: string;
  Address_Line_01: string | null;
  Address_Line_02: string | null;
  Address_Line_03: string | null;
  Suburb: string | null;
  City: string | null;
  Country: string | null;
  Zip_Code: string | null;
  Telephone_No: string | null;
  Mobile_No: string | null;
  Email_Address: string | null;
  Contact_Name: string | null;
}

export interface ReceiptConfirmationReference {
  Reference_Type: string;
  Reference_Description: string | null;
  Reference_Value: string | null;
}

export interface LineStockDetail {
  From_Site: string | null;
  From_Inventory_L3: string | null;
  From_Hold_Code: string | null;
  From_Location_Type: string | null;
  From_Shippable_Indicator: string | null;
  From_Weight_UOM: string | null;
  From_Net_Weight_Received: string | null;
  To_Site: string;
  To_Inventory_L3: string;
  To_Hold_Code: string | null;
  To_Location_Type: string;
  To_Shippable_Indicator: string;
  To_Weight_UOM: string;
  To_Net_Weight_Received: string;
}

export interface ReceiptConfirmationItem {
  Line_No: string;
  Item_Code: string;
  Item_Description?: string | null;
  Alternate_Identifier: string | null;
  Inventory_Level2: string;
  Inventory_Level3?: string | null;
  Inventory_Level4: string;
  Attribute_1: string | null;
  Attribute_2: string | null;
  Attribute_3: string | null;
  Attribute_4: string | null;
  Expiry_Date: string;
  Base_UOM: string;
  Unit_Of_Measure: string;
  Quantity: number;
  Weight_Unit_Of_Measure: string;
  Net_Weight_Shipped: number;
  Gross_Price?: number | null;
  Order_Price: number | null;
  Remarks: string | null;
  Reason_Code: string;
  GUID: string;
  Hold_Code: string;
  Line_Stock_Details: LineStockDetail[];
}

export interface ReceiptConfirmationTotals {
  Total_No_Of_Lines: number;
  Total_Quantity: number;
}

export interface ReceiptConfirmationBody {
  Trading_Partner: string;
  Company: string;
  Warehouse_Code: string;
  Inbound_Reference_No: string;
  Purchase_Order_No: string | null;
  Probill_Number: string;
  Inbound_Receipt_No: string;
  Order_Type: string;
  Service_Type: string | null;
  Action: string;
  Comments: string | null;
  Supplier: string;
  Customer_Reference: string | null;
  Customer_Alternate_Reference: string | null;
  Delivery_Number: string | null;
  Currency: string | null;
  Date_Details: { Dates: ReceiptConfirmationDate[] };
  Address_Details: { Address: ReceiptConfirmationAddress[] };
  Additional_References: { Reference: ReceiptConfirmationReference[] };
  Shipping_Instructions: { Instructions: string | null };
  Items: ReceiptConfirmationItem[];
  Totals: ReceiptConfirmationTotals;
}

export interface ReceiptConfirmationPayload {
  Receipt_Confirmation: ReceiptConfirmationBody;
}

/** One row from GET list: payload plus optional base64 copies from workflow. */
export interface ReceiptOrderListEntry {
  payload: ReceiptConfirmationPayload;
  targetPayloadBase64: string | null;
  sourcePayloadBase64: string | null;
  /** Optional row id from workflow (Table metadata); falls back to composite receipt key for locking. */
  recordId?: string | null;
  /** Optional display name of user holding server-side lock (from list workflow). */
  currentLockUser?: string | null;
}

/**
 * Workflow target payloads may merge sub-lines with pipe-separated values (e.g. Attribute_1 "150526|150526").
 * For grouping/display, use the first segment when all segments match; otherwise the first segment.
 */
export function normalizeReceiptMergedField(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  if (!t.includes("|")) return t;
  const parts = t
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const upper0 = parts[0]!.toUpperCase();
  if (parts.every((p) => p.toUpperCase() === upper0)) return parts[0]!;
  return parts[0]!;
}

export function getItemHoldCodeForGrouping(item: ReceiptConfirmationItem): string {
  const h =
    normalizeReceiptMergedField(item.Hold_Code) ||
    normalizeReceiptMergedField(item.Line_Stock_Details?.[0]?.To_Hold_Code);
  return h.toUpperCase();
}

/** Pack / destination L3 (pack size on receipt). */
export function getItemPackKeyForGrouping(item: ReceiptConfirmationItem): string {
  const toL3 = normalizeReceiptMergedField(item.Line_Stock_Details?.[0]?.To_Inventory_L3);
  const invL3 = normalizeReceiptMergedField(item.Inventory_Level3);
  const attr4 = normalizeReceiptMergedField(item.Attribute_4);
  const raw = toL3.length > 0 ? toL3 : invL3.length > 0 ? invL3 : attr4;
  return raw.toUpperCase();
}

/**
 * Lot key for UI consolidation (stock item + this value).
 * Uses pack/L3 shown in "Pack Size / Lot" so lines with the same item and pack merge even when
 * Attribute_1 is missing on some workflow lines (avoids 150526||12.00KG vs 12.00KG splits).
 */
export function getItemLotKeyForGrouping(item: ReceiptConfirmationItem): string {
  const packLot = getItemPackKeyForGrouping(item);
  if (packLot.length > 0) return packLot;
  const batchLot = normalizeReceiptMergedField(item.Attribute_1);
  return batchLot.length > 0 ? batchLot.toUpperCase() : "—";
}

/** Pack size / lot label for the receipt table. */
export function getItemPackLotDisplay(item: ReceiptConfirmationItem): string {
  const l3 =
    normalizeReceiptMergedField(item.Line_Stock_Details?.[0]?.To_Inventory_L3) ||
    normalizeReceiptMergedField(item.Inventory_Level3) ||
    normalizeReceiptMergedField(item.Attribute_4);
  if (l3.length > 0) return l3;
  const batch = normalizeReceiptMergedField(item.Attribute_1);
  return batch.length > 0 ? batch : "—";
}

export function getItemHoldCodeDisplay(item: ReceiptConfirmationItem): string {
  return (
    normalizeReceiptMergedField(item.Hold_Code) ||
    normalizeReceiptMergedField(item.Line_Stock_Details?.[0]?.To_Hold_Code)
  );
}

/** Group key for consolidated receipt lines: stock item + lot; optional hold when expanding hold details. */
export function getReceiptLineConsolidationKey(
  item: ReceiptConfirmationItem,
  options: { includeHoldCode: boolean }
): string {
  const itemKey = normalizeReceiptMergedField(item.Item_Code).toUpperCase();
  const lotKey = getItemLotKeyForGrouping(item);
  if (!options.includeHoldCode) {
    return `${itemKey}||${lotKey}`;
  }
  return `${itemKey}||${lotKey}||${getItemHoldCodeForGrouping(item)}`;
}

/** True when the same stock item + lot appears on multiple lines with different hold codes. */
export function hasDistinctHoldCodesPerItemLot(items: ReceiptConfirmationItem[]): boolean {
  const holdsByItemLot = new Map<string, Set<string>>();
  for (const item of items) {
    if (isZeroOutLine(item)) continue;
    const key = getReceiptLineConsolidationKey(item, { includeHoldCode: false });
    let holds = holdsByItemLot.get(key);
    if (holds == null) {
      holds = new Set();
      holdsByItemLot.set(key, holds);
    }
    holds.add(getItemHoldCodeForGrouping(item));
  }
  return [...holdsByItemLot.values()].some((holds) => holds.size > 1);
}

/** Group receipt lines for display; merges qty/weight/rate within each group. */
export function groupReceiptItemsForDisplay(
  items: ReceiptConfirmationItem[],
  options: { includeHoldCode: boolean }
): ReceiptConfirmationItem[][] {
  const groups = new Map<string, ReceiptConfirmationItem[]>();
  for (const item of items) {
    const gkey = getReceiptLineConsolidationKey(item, options);
    const existing = groups.get(gkey);
    if (existing == null) groups.set(gkey, [item]);
    else existing.push(item);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.sort((a, b) => compareReceiptLineNoAsc(a.Line_No, b.Line_No));
  }
  result.sort((a, b) => compareReceiptLineNoAsc(a[0]!.Line_No, b[0]!.Line_No));
  return result;
}

/** Stable id for ReceiptNoPriceLock: workflow RecordId if present, else Company|Receipt|Reference. */
export function getReceiptLockRecordId(entry: ReceiptOrderListEntry): string {
  const rid = entry.recordId != null ? String(entry.recordId).trim() : "";
  if (rid.length > 0) return rid;
  const rc = entry.payload.Receipt_Confirmation;
  return [rc.Company, rc.Inbound_Receipt_No, rc.Inbound_Reference_No].map((x) => (x ?? "").trim()).join("|");
}

/** Normalize Flowgear / directory username for lock comparison. */
export function normalizeLockUserLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, "/");
}

/** True if two lock-holder labels refer to the same principal (case-insensitive). */
export function lockUsersMatch(a: string, b: string): boolean {
  const x = normalizeLockUserLabel(a);
  const y = normalizeLockUserLabel(b);
  if (x.length === 0 || y.length === 0) return false;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** Item code that is never shown in the UI (hidden from table and totals). */
export const ZERO_OUT_LINE_ITEM_CODE = "ZERO-OUT-LINE";

export function isZeroOutLine(item: ReceiptConfirmationItem): boolean {
  return item.Item_Code === ZERO_OUT_LINE_ITEM_CODE;
}

/** True if payload has at least one visible line with Order_Price null (needs editing). ZERO-OUT-LINE items are ignored. */
export function hasMissingOrderPrice(payload: ReceiptConfirmationPayload): boolean {
  const items = payload.Receipt_Confirmation.Items ?? [];
  return items.some(
    (item) => !isZeroOutLine(item) && item.Order_Price == null
  );
}

export function hasInvalidOrderPrice(payload: ReceiptConfirmationPayload): boolean {
  const items = payload.Receipt_Confirmation.Items ?? [];
  return items.some(
    (item) => !isZeroOutLine(item) && item.Order_Price != null && item.Order_Price <= 0
  );
}

/**
 * UOM shown per line: Base_UOM Y or BSKG → KG; Base_UOM BSCS → Unit_Of_Measure; otherwise Unit_Of_Measure or Base_UOM.
 */
export function displayLineUom(item: ReceiptConfirmationItem): string {
  const base = (item.Base_UOM ?? "").trim().toUpperCase();
  if (base === "Y" || base === "BSKG") return "KG";
  if (base === "BSCS") return (item.Unit_Of_Measure ?? "").trim();
  const uom = (item.Unit_Of_Measure ?? "").trim();
  return uom || (item.Base_UOM ?? "").trim();
}

/** When true, line order total = Net weight × rate; otherwise Quantity × rate. */
export function lineUsesWeightForOrderPrice(item: ReceiptConfirmationItem): boolean {
  return displayLineUom(item).trim().toUpperCase() === "KG";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compareReceiptLineNoAsc(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Primary receipt date for list filtering: prefers Date_Identifier RD, otherwise first Dates entry.
 */
export function getReceiptDetailDateForFilter(payload: ReceiptConfirmationPayload): string | null {
  const dates = payload.Receipt_Confirmation.Date_Details?.Dates ?? [];
  const rd = dates.find((d) => (d.Date_Identifier ?? "").trim().toUpperCase() === "RD");
  const chosen = rd ?? dates[0];
  const raw = chosen?.Date?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function receiptDetailDateSortKey(payload: ReceiptConfirmationPayload): number {
  const raw = getReceiptDetailDateForFilter(payload);
  if (raw == null || raw.length === 0) return Number.POSITIVE_INFINITY;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return Number.POSITIVE_INFINITY;
}

/** Sort orders by receipt detail date (RD or first date), ascending; missing dates last. */
export function compareReceiptOrdersByDetailDateAsc(a: ReceiptOrderListEntry, b: ReceiptOrderListEntry): number {
  const ka = receiptDetailDateSortKey(a.payload);
  const kb = receiptDetailDateSortKey(b.payload);
  if (ka !== kb) return ka - kb;
  const refA = (a.payload.Receipt_Confirmation.Inbound_Reference_No ?? "").trim();
  const refB = (b.payload.Receipt_Confirmation.Inbound_Reference_No ?? "").trim();
  const refCmp = refA.localeCompare(refB, undefined, { numeric: true, sensitivity: "base" });
  if (refCmp !== 0) return refCmp;
  return getReceiptLockRecordId(a).localeCompare(getReceiptLockRecordId(b));
}

/** Same date key as ascending, but `desc` is newest first; rows with no date stay last. */
export function compareReceiptOrdersByDetailDate(
  a: ReceiptOrderListEntry,
  b: ReceiptOrderListEntry,
  direction: "asc" | "desc"
): number {
  const ka = receiptDetailDateSortKey(a.payload);
  const kb = receiptDetailDateSortKey(b.payload);
  const inf = Number.POSITIVE_INFINITY;
  const aMiss = ka === inf;
  const bMiss = kb === inf;
  if (aMiss && bMiss) return compareReceiptOrdersByDetailDateAsc(a, b);
  if (aMiss) return 1;
  if (bMiss) return -1;
  if (ka !== kb) {
    return direction === "asc" ? ka - kb : kb - ka;
  }
  const refA = (a.payload.Receipt_Confirmation.Inbound_Reference_No ?? "").trim();
  const refB = (b.payload.Receipt_Confirmation.Inbound_Reference_No ?? "").trim();
  const refCmp = refA.localeCompare(refB, undefined, { numeric: true, sensitivity: "base" });
  if (refCmp !== 0) return refCmp;
  return getReceiptLockRecordId(a).localeCompare(getReceiptLockRecordId(b));
}

/**
 * Normalizes list entry: derive rate (R/UOM) from Gross_Price or Order_Price when those represent line totals.
 */
export function normalizePayloadOrderPriceToRate(entry: ReceiptOrderListEntry): ReceiptOrderListEntry {
  const payload = entry.payload;
  return {
    ...entry,
    payload: {
      ...payload,
      Receipt_Confirmation: {
        ...payload.Receipt_Confirmation,
        Items: payload.Receipt_Confirmation.Items.map((item) => {
          const gross = item.Gross_Price;
          const total = item.Order_Price;
          const net = item.Net_Weight_Shipped;
          const qty = item.Quantity;
          const byWeight = lineUsesWeightForOrderPrice(item);
          let rate: number | null = null;
          if (gross != null && gross > 0) {
            if (byWeight && net > 0) rate = round2(gross / net);
            else if (!byWeight && qty > 0) rate = round2(gross / qty);
          } else if (total != null && total > 0) {
            if (byWeight && net > 0) rate = round2(total / net);
            else if (!byWeight && qty > 0) rate = round2(total / qty);
          }
          return { ...item, Order_Price: rate };
        }),
      },
    },
  };
}
