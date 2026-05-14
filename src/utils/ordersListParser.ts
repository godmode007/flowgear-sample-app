/**
 * Parses the Result/Table XML format: each <Table> has a <Content> element
 * containing base64-encoded JSON (ReceiptConfirmationPayload).
 * Splits into orders (one payload per Table) and returns them as an array.
 */
import type { ReceiptConfirmationPayload, ReceiptOrderListEntry } from "../models/receiptConfirmation";

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

function isReceiptPayload(value: unknown): value is ReceiptConfirmationPayload {
  return (
    value != null &&
    typeof value === "object" &&
    "Receipt_Confirmation" in value &&
    (value as ReceiptConfirmationPayload).Receipt_Confirmation != null
  );
}

/** Optional metadata siblings under <Table> (besides Content). */
function tableMetaText(table: Element, ...localNames: string[]): string | null {
  const want = new Set(localNames.map((n) => n.toLowerCase()));
  for (const child of Array.from(table.children)) {
    const tag = (child.localName ?? "").toLowerCase();
    if (want.has(tag)) {
      const t = child.textContent?.trim();
      if (t && t.length > 0) return t;
    }
  }
  return null;
}

function looksLikeBase64PayloadContent(s: string): boolean {
  const t = s.replace(/\s/g, "");
  if (t.length < 24) return false;
  if (/^data:[^;]+;base64,/i.test(s.trim())) return true;
  if (t.length % 4 === 1) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(t);
}

/** Source / alternate payload: explicit tags, or Source only when base64-like (not e.g. "KMotion"). */
function tableSourcePayloadBase64Xml(table: Element): string | null {
  const explicit = ["SourceContent", "SourcePayload", "OriginalContent"] as const;
  for (const name of explicit) {
    const t = tableMetaText(table, name);
    if (t) return t;
  }
  const source = tableMetaText(table, "Source");
  if (source != null && looksLikeBase64PayloadContent(source)) return source;
  return null;
}

/**
 * Parses XML string: <Result><Table>...</Table><Table>...</Table></Result>
 * Each Table has <Content> with base64-encoded JSON payload.
 */
export function parseResultTableXml(xmlString: string): ReceiptOrderListEntry[] {
  const trimmed = xmlString.trim();
  if (
    !trimmed.includes("<Table") ||
    (!trimmed.includes("<Content>") && !trimmed.includes("<Content "))
  ) {
    return [];
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "text/xml");
    const tables = doc.querySelectorAll("Table");
    const out: ReceiptOrderListEntry[] = [];
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const contentEl = table.querySelector("Content");
      const raw = contentEl?.textContent?.trim();
      if (!raw) continue;
      try {
        const jsonStr = atob(raw);
        const parsed = safeParseJson(jsonStr);
        if (!isReceiptPayload(parsed)) continue;
        const recordId = tableMetaText(table, "RecordId", "Id", "DashboardRecordId");
        const currentLockUser = tableMetaText(
          table,
          "CurrentUser",
          "LockUser",
          "LockedBy",
          "LockedByUser",
          "LockHolder",
          "LockHolderUser"
        );
        const sourceRaw = tableSourcePayloadBase64Xml(table);
        out.push({
          payload: parsed,
          targetPayloadBase64: null,
          sourcePayloadBase64: sourceRaw,
          recordId: recordId ?? undefined,
          currentLockUser: currentLockUser ?? undefined,
        });
      } catch {
        // skip invalid base64 or JSON
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Returns true if the string looks like Result/Table XML with base64 Content
 * (so we should use parseResultTableXml). Case-insensitive for tag names.
 */
export function isResultTableXml(value: string): boolean {
  const t = value.trim().toLowerCase();
  return (
    (t.includes("<result") || t.includes("<table")) &&
    t.includes("<table") &&
    (t.includes("<content>") || t.includes("<content "))
  );
}

function tableRowMeta(row: Record<string, unknown>): {
  recordId: string | undefined;
  currentLockUser: string | undefined;
} {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return undefined;
  };
  return {
    recordId: pick("RecordId", "recordId", "Id", "id", "DashboardRecordId"),
    currentLockUser: pick(
      "CurrentUser",
      "currentUser",
      "LockUser",
      "lockUser",
      "LockedBy",
      "lockedBy",
      "LockedByUser",
      "lockedByUser",
      "LockHolder",
      "lockHolder",
      "LockHolderUser",
      "lockHolderUser"
    ),
  };
}

function tableRowSourceBase64(row: Record<string, unknown>): string | null {
  const explicitKeys = [
    "SourceContent",
    "sourceContent",
    "SourcePayload",
    "sourcePayload",
    "OriginalContent",
    "originalContent",
  ];
  for (const k of explicitKeys) {
    const v = row[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  const src = row.Source ?? row.source;
  if (typeof src === "string") {
    const t = src.trim();
    if (t.length > 0 && looksLikeBase64PayloadContent(t)) return t;
  }
  return null;
}

/**
 * Parses JSON format: { Result: { Table: [ { Content: "base64...", ... }, ... ] } }
 * or single Table object.
 */
export function parseResultTableJson(jsonString: string): ReceiptOrderListEntry[] {
  const trimmed = jsonString.trim();
  if (!trimmed.startsWith("{")) return [];
  const parsed = safeParseJson(trimmed) as
    | { Result?: { Table?: Array<Record<string, unknown>> | Record<string, unknown> } }
    | undefined;
  const table = parsed?.Result?.Table;
  const rows = Array.isArray(table) ? table : table != null && typeof table === "object" ? [table] : [];
  const out: ReceiptOrderListEntry[] = [];
  for (const row of rows) {
    const content = typeof row?.Content === "string" ? row.Content.trim() : "";
    if (!content) continue;
    try {
      const jsonStr = atob(content);
      const payload = safeParseJson(jsonStr);
      if (!isReceiptPayload(payload)) continue;
      const meta = tableRowMeta(row);
      const sourceB64 = tableRowSourceBase64(row);
      out.push({
        payload,
        targetPayloadBase64: null,
        sourcePayloadBase64: sourceB64,
        recordId: meta.recordId,
        currentLockUser: meta.currentLockUser,
      });
    } catch {
      /* skip invalid base64 or JSON */
    }
  }
  return out;
}

/** Plain JSON array of receipt payloads (no Result/Table wrapper). */
export function parseResultTableJsonRows(jsonString: string): ReceiptOrderListEntry[] {
  const trimmed = jsonString.trim();
  if (!trimmed.startsWith("[")) return [];
  const parsed = safeParseJson(trimmed);
  if (!Array.isArray(parsed)) return [];
  const out: ReceiptOrderListEntry[] = [];
  for (const item of parsed) {
    if (isReceiptPayload(item)) {
      out.push({ payload: item, targetPayloadBase64: null, sourcePayloadBase64: null });
    }
  }
  return out;
}
