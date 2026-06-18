/**
 * Parses the Result/Table XML format: each <Table> has a <Content> element
 * containing base64-encoded JSON (ReceiptConfirmationPayload).
 * Splits into orders (one payload per Table) and returns them as an array.
 */
import type {
  AdjustmentPayload,
  CaptureState,
  OrderKind,
  ReceiptConfirmationPayload,
  ReceiptOrderListEntry,
} from "../models/receiptConfirmation";
import { adjustmentToReceiptView, isAdjustmentPayload } from "../models/receiptConfirmation";

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

type ResolvedRowPayload = {
  payload: ReceiptConfirmationPayload;
  kind: OrderKind;
  adjustmentPayload: AdjustmentPayload | null;
  targetPayloadBase64: string | null;
  sourcePayloadBase64: string | null;
};

function decodeBase64Json(b64: string | null): unknown {
  if (b64 == null || b64.trim().length === 0) return undefined;
  try {
    return safeParseJson(atob(b64.trim()));
  } catch {
    return undefined;
  }
}

/**
 * Resolves a list row's Content/SourcePayload into an editable Receipt_Confirmation payload.
 * Recognizes both Receipt_Confirmation and Adjustment envelopes. When Content holds a
 * different format (e.g. a SageX3 target payload), the real payload is taken from SourcePayload
 * and the raw Content is kept as the "target payload" for the debug viewer.
 */
function resolveRowPayload(
  contentRaw: string | null,
  sourceRaw: string | null
): ResolvedRowPayload | null {
  const contentDecoded = decodeBase64Json(contentRaw);
  const sourceDecoded = decodeBase64Json(sourceRaw);

  // 1. Content is the primary payload.
  if (isReceiptPayload(contentDecoded)) {
    return {
      payload: contentDecoded,
      kind: "receipt",
      adjustmentPayload: null,
      targetPayloadBase64: null,
      sourcePayloadBase64: sourceRaw,
    };
  }
  if (isAdjustmentPayload(contentDecoded)) {
    return {
      payload: adjustmentToReceiptView(contentDecoded),
      kind: "adjustment",
      adjustmentPayload: contentDecoded,
      targetPayloadBase64: null,
      sourcePayloadBase64: sourceRaw,
    };
  }

  // 2. Content is a different format (e.g. ERP target) — SourcePayload holds the real payload.
  if (isReceiptPayload(sourceDecoded)) {
    return {
      payload: sourceDecoded,
      kind: "receipt",
      adjustmentPayload: null,
      targetPayloadBase64: contentRaw,
      sourcePayloadBase64: null,
    };
  }
  if (isAdjustmentPayload(sourceDecoded)) {
    return {
      payload: adjustmentToReceiptView(sourceDecoded),
      kind: "adjustment",
      adjustmentPayload: sourceDecoded,
      // Keep the source visible so the operator can inspect the original Adjustment JSON.
      targetPayloadBase64: contentRaw,
      sourcePayloadBase64: sourceRaw,
    };
  }

  return null;
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

        // Resolve Content/SourcePayload into an editable Receipt_Confirmation view.
        // Handles Receipt_Confirmation and Adjustment envelopes, in either Content or SourcePayload.
        const resolved = resolveRowPayload(contentRaw, sourceRaw);
        if (resolved == null) continue; // no usable Receipt_Confirmation / Adjustment payload in this row

        out.push({
          payload: resolved.payload,
          targetPayloadBase64: resolved.targetPayloadBase64,
          sourcePayloadBase64: resolved.sourcePayloadBase64,
          kind: resolved.kind,
          adjustmentPayload: resolved.adjustmentPayload,
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

      const resolved = resolveRowPayload(contentRaw.length > 0 ? contentRaw : null, sourceRaw);
      if (resolved == null) continue;

      out.push({
        payload: resolved.payload,
        targetPayloadBase64: resolved.targetPayloadBase64,
        sourcePayloadBase64: resolved.sourcePayloadBase64,
        kind: resolved.kind,
        adjustmentPayload: resolved.adjustmentPayload,
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
        const resolved = resolveRowPayload(row.Content.trim(), tableRowSourceBase64(row));
        if (resolved == null) continue;
        const meta = tableRowMeta(row);
        out.push({
          payload: resolved.payload,
          targetPayloadBase64: resolved.targetPayloadBase64,
          sourcePayloadBase64: resolved.sourcePayloadBase64,
          kind: resolved.kind,
          adjustmentPayload: resolved.adjustmentPayload,
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
          kind: "receipt",
          adjustmentPayload: null,
          recordId: meta.recordId,
          currentLockUser: meta.currentLockUser,
          captureState: meta.captureState,
          lastEditedBy: meta.lastEditedBy,
          pricePayloadBase64: meta.pricePayloadBase64,
        });
      } else if (isAdjustmentPayload(item)) {
        const meta = tableRowMeta(row);
        out.push({
          payload: adjustmentToReceiptView(item),
          targetPayloadBase64: null,
          sourcePayloadBase64: tableRowSourceBase64(row),
          kind: "adjustment",
          adjustmentPayload: item,
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
