/**
 * Parses the Result/Table XML format: each <Table> has a <Content> element
 * containing base64-encoded JSON (ReceiptConfirmationPayload).
 * Splits into orders (one payload per Table) and returns them as an array.
 */
import type { CaptureState, ReceiptConfirmationPayload, ReceiptOrderListEntry } from "../models/receiptConfirmation";

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

function isReceiptPayload(value: unknown): value is ReceiptConfirmationPayload {
  // Accept any object that has a Receipt_Confirmation key — extra/unknown fields are ignored.
  if (value == null || typeof value !== "object") return false;
  const rc = (value as Record<string, unknown>).Receipt_Confirmation;
  return rc != null && typeof rc === "object";
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

function parseCaptureState(value: string | null | undefined): CaptureState | null {
  const v = (value ?? "").trim();
  if (v === "Edited" || v === "ReadyToPost" || v === "Posted") return v;
  // Accept legacy "Partial" from older records
  if (v === "Partial") return "Edited";
  return null;
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
      const table = tables[i]!;
      try {
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
        const captureStateRaw = tableMetaText(table, "CaptureState", "PriceCaptureState");
        const lastEditedBy = tableMetaText(table, "LastEditedBy", "LastEditedUser", "CaptureUser");
        const pricePayloadBase64 = tableMetaText(table, "PricePayload", "PriceContent", "CapturePayload");

        const contentRaw = table.querySelector("Content")?.textContent?.trim() ?? null;
        const sourceRaw = tableSourcePayloadBase64Xml(table);

        // Try Content first as the Receipt_Confirmation payload.
        // Some workflows store a different format in Content (e.g. purchaseReceipt for SageX3)
        // and the Receipt_Confirmation payload in SourcePayload — handle both arrangements.
        let payload: ReceiptConfirmationPayload | null = null;
        let targetPayloadBase64: string | null = null;
        let sourcePayloadBase64: string | null = sourceRaw;

        if (contentRaw) {
          try {
            const decoded = safeParseJson(atob(contentRaw));
            if (isReceiptPayload(decoded)) {
              payload = decoded;
              targetPayloadBase64 = null;
            } else {
              // Content is a different format (e.g. ERP target payload) — try SourcePayload instead.
              targetPayloadBase64 = contentRaw;
              sourcePayloadBase64 = null; // SourcePayload becomes the main payload below
              if (sourceRaw) {
                try {
                  const srcDecoded = safeParseJson(atob(sourceRaw));
                  if (isReceiptPayload(srcDecoded)) payload = srcDecoded;
                } catch { /* not decodeable */ }
              }
            }
          } catch { /* invalid base64 — try SourcePayload */ }
        }

        // Last resort: try SourcePayload as main payload if Content didn't yield one.
        if (payload == null && sourceRaw && sourcePayloadBase64 !== null) {
          try {
            const srcDecoded = safeParseJson(atob(sourceRaw));
            if (isReceiptPayload(srcDecoded)) {
              payload = srcDecoded;
              sourcePayloadBase64 = null;
            }
          } catch { /* not decodeable */ }
        }

        if (payload == null) continue; // no usable Receipt_Confirmation payload in this row

        out.push({
          payload,
          targetPayloadBase64,
          sourcePayloadBase64,
          recordId: recordId ?? undefined,
          currentLockUser: currentLockUser ?? undefined,
          captureState: parseCaptureState(captureStateRaw),
          lastEditedBy: lastEditedBy ?? undefined,
          pricePayloadBase64: pricePayloadBase64 ?? undefined,
        });
      } catch {
        // skip any row that throws unexpectedly
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
  captureState: CaptureState | null;
  lastEditedBy: string | undefined;
  pricePayloadBase64: string | undefined;
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
    captureState: parseCaptureState(pick("CaptureState", "PriceCaptureState")),
    lastEditedBy: pick("LastEditedBy", "LastEditedUser", "CaptureUser"),
    pricePayloadBase64: pick("PricePayload", "PriceContent", "CapturePayload"),
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
    try {
      const contentRaw = typeof row?.Content === "string" ? row.Content.trim() : "";
      const meta = tableRowMeta(row);
      const sourceRaw = tableRowSourceBase64(row);

      let payload: ReceiptConfirmationPayload | null = null;
      let targetPayloadBase64: string | null = null;
      let sourcePayloadBase64: string | null = sourceRaw;

      if (contentRaw) {
        try {
          const decoded = safeParseJson(atob(contentRaw));
          if (isReceiptPayload(decoded)) {
            payload = decoded;
          } else {
            // Content is a non-Receipt_Confirmation format — treat as target payload, use SourcePayload instead.
            targetPayloadBase64 = contentRaw;
            sourcePayloadBase64 = null;
            if (sourceRaw) {
              try {
                const srcDecoded = safeParseJson(atob(sourceRaw));
                if (isReceiptPayload(srcDecoded)) payload = srcDecoded;
              } catch { /* not decodeable */ }
            }
          }
        } catch { /* invalid base64 */ }
      }

      if (payload == null && sourceRaw && sourcePayloadBase64 !== null) {
        try {
          const srcDecoded = safeParseJson(atob(sourceRaw));
          if (isReceiptPayload(srcDecoded)) {
            payload = srcDecoded;
            sourcePayloadBase64 = null;
          }
        } catch { /* not decodeable */ }
      }

      if (payload == null) continue;

      out.push({
        payload,
        targetPayloadBase64,
        sourcePayloadBase64,
        recordId: meta.recordId,
        currentLockUser: meta.currentLockUser,
        captureState: meta.captureState,
        lastEditedBy: meta.lastEditedBy,
        pricePayloadBase64: meta.pricePayloadBase64,
      });
    } catch {
      /* skip any row that throws unexpectedly */
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
    try {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      // Support both bare payload arrays and row-wrapper arrays with a Content field.
      if (typeof row.Content === "string" && row.Content.trim().length > 0) {
        const jsonStr = atob(row.Content.trim());
        const payload = safeParseJson(jsonStr);
        if (!isReceiptPayload(payload)) continue;
        const meta = tableRowMeta(row);
        out.push({
          payload,
          targetPayloadBase64: null,
          sourcePayloadBase64: tableRowSourceBase64(row),
          recordId: meta.recordId,
          currentLockUser: meta.currentLockUser,
          captureState: meta.captureState,
          lastEditedBy: meta.lastEditedBy,
          pricePayloadBase64: meta.pricePayloadBase64,
        });
      } else if (isReceiptPayload(item)) {
        const meta = tableRowMeta(row);
        out.push({
          payload: item,
          targetPayloadBase64: null,
          sourcePayloadBase64: tableRowSourceBase64(row),
          recordId: meta.recordId,
          currentLockUser: meta.currentLockUser,
          captureState: meta.captureState,
          lastEditedBy: meta.lastEditedBy,
          pricePayloadBase64: meta.pricePayloadBase64,
        });
      }
    } catch {
      /* skip unparseable rows */
    }
  }
  return out;
}
