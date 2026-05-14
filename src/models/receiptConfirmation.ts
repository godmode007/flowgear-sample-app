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
