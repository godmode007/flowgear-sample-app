import { Flowgear } from "flowgear-webapp";
import type {
  ReceiptConfirmationPayload,
  ReceiptOrderListEntry,
} from "../models/receiptConfirmation";
import {
  parseResultTableXml,
  parseResultTableJson,
  parseResultTableJsonRows,
} from "../utils/ordersListParser";

/** Thrown when the Flowgear request fails due to not being signed in or session expired. */
export class AuthError extends Error {
  constructor(message = "Not signed in or session expired.") {
    super(message);
    this.name = "AuthError";
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/** Thrown when invoke returns no response (app not in Console or Console not responding). */
export class ConnectionError extends Error {
  constructor(message = "No response from Flowgear. Open this app from the Flowgear Console and try again.") {
    super(message);
    this.name = "ConnectionError";
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

function isAuthFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("403") || lower.includes("forbidden")) return true;
  if (lower.includes("authentication") || lower.includes("sign in") || lower.includes("login") || lower.includes("session expired")) return true;
  return false;
}

function responseIndicatesAuthFailure(response: unknown): boolean {
  if (response == null || typeof response !== "object") return false;
  const r = response as Record<string, unknown>;
  const code = r.FgResponseCode ?? r.responseCode ?? r.statusCode ?? r.code;
  const num = typeof code === "number" ? code : typeof code === "string" ? parseInt(code, 10) : NaN;
  return num === 401 || num === 403;
}

/** When set (e.g. Azure backend URL), app runs standalone and calls this API instead of Flowgear.Sdk.invoke. */
const STANDALONE_API_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_STANDALONE_API_URL) ||
  "";

/** Relative GET URL for per-receipt lock (DashboardId, RecordId, Username). */
const RECEIPT_LOCK_PATH = "/v2/ReceiptNoPriceLock";

/** Relative path for posting receipt confirmation to Procurement & Inbound (ERP). */
const POST_PROCUREMENT_INBOUND_PATH = "/v2/ProcurementInbound";

/** Max wait for Post to ERP (workflow can be slow). */
const POST_TIMEOUT_MS = 120_000;

/** Max wait for GET orders list (Console must respond to invoke). */
const GET_ORDERS_TIMEOUT_MS = 45_000;

export function isStandaloneMode(): boolean {
  return STANDALONE_API_URL.length > 0;
}

/** True if the app can reach the API: standalone mode or running inside the Flowgear Console iframe. */
export function isEmbeddedInConsole(): boolean {
  if (isStandaloneMode()) return true;
  if (typeof window === "undefined") return false;
  return window.self !== window.top;
}

/**
 * Optional: relative path for a workflow that returns a pending receipt payload to edit.
 * Add an HTTP binding (e.g. GET) in Flowgear and set this to match (e.g. "/api/receipt-confirmation/pending").
 */
const GET_PENDING_RECEIPT_PATH: string | null = null;

/**
 * Relative path for the workflow that returns the orders list (Result/Table XML with base64 Content per order).
 * Flowgear path: GET /v2/ReceiptNoPrice.
 * Override with env: VITE_GET_ORDERS_LIST_PATH. If set to /v2/SupportIntegrationList (no query), FromDate/ToDate/Records are appended.
 */
const DEFAULT_ORDERS_LIST_PATH = "/v2/ReceiptNoPrice";

const viteEnv =
  typeof import.meta !== "undefined" ? ((import.meta as ImportMeta).env as Record<string, string | undefined>) : {};

const GET_ORDERS_LIST_PATH_OVERRIDE = (viteEnv.VITE_GET_ORDERS_LIST_PATH ?? "").trim();

const DEFAULT_ORDERS_LIST_RECORDS = Math.max(
  1,
  Number.parseInt(String(viteEnv.VITE_ORDERS_LIST_RECORDS ?? "1000"), 10) || 1000
);

const DEFAULT_ORDERS_LIST_DAYS_BACK = Math.max(
  1,
  Number.parseInt(String(viteEnv.VITE_ORDERS_LIST_DAYS_BACK ?? "365"), 10) || 365
);

function toDateOnlyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDefaultOrdersListDateRange(): { fromDate: string; toDate: string } {
  const fixedFrom = (viteEnv.VITE_ORDERS_LIST_FROM_DATE ?? "").trim();
  const fixedTo = (viteEnv.VITE_ORDERS_LIST_TO_DATE ?? "").trim();
  if (fixedFrom.length > 0 && fixedTo.length > 0) {
    return { fromDate: fixedFrom, toDate: fixedTo };
  }
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - DEFAULT_ORDERS_LIST_DAYS_BACK);
  return { fromDate: toDateOnlyUtc(from), toDate: toDateOnlyUtc(to) };
}

/** Relative GET URL for the orders list (no query for ReceiptNoPrice; query added only for SupportIntegrationList). */
export function getOrdersListRequestPath(): string {
  const base =
    GET_ORDERS_LIST_PATH_OVERRIDE.length > 0 ? GET_ORDERS_LIST_PATH_OVERRIDE : DEFAULT_ORDERS_LIST_PATH;
  if (base.includes("?")) return base;
  const isSupportList = base === "/v2/SupportIntegrationList" || base.endsWith("/SupportIntegrationList");
  if (isSupportList) {
    const { fromDate, toDate } = getDefaultOrdersListDateRange();
    const params = new URLSearchParams({
      FromDate: fromDate,
      ToDate: toDate,
      Records: String(DEFAULT_ORDERS_LIST_RECORDS),
    });
    return `${base}?${params.toString()}`;
  }
  return base;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}

const RAW_LOG_MAX_LENGTH = 2000;

function rawResponseToLog(value: unknown): string {
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";
  if (typeof value === "string") {
    return value.length <= RAW_LOG_MAX_LENGTH
      ? value
      : value.slice(0, RAW_LOG_MAX_LENGTH) + `… [truncated, total ${value.length} chars]`;
  }
  try {
    const s = JSON.stringify(value);
    return s.length <= RAW_LOG_MAX_LENGTH
      ? s
      : s.slice(0, RAW_LOG_MAX_LENGTH) + `… [truncated, total ${s.length} chars]`;
  } catch {
    return String(value);
  }
}

export type PostToErpStatusCallback = (message: string) => void;

export type PostToErpResult = {
  ok: boolean;
  statusCode?: string;
  body?: unknown;
  rawKeys?: string[];
  errorDetail?: string;
};

type ProcurementInboundPostBody = ReceiptConfirmationPayload;

function buildProcurementInboundPostBody(payload: ReceiptConfirmationPayload): ProcurementInboundPostBody {
  return payload;
}

function extractWorkflowErrorMessage(data: Record<string, unknown>, bodyStr: string | undefined): string | undefined {
  const stringCandidates: unknown[] = [
    data.FgResponseBody,
    data.responseMessage,
    data.message,
    data.Message,
    data.error,
    data.Error,
    data.detail,
    data.Description,
    typeof data.body === "string" ? data.body : undefined,
  ];
  for (const v of stringCandidates) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0 && t.toLowerCase() !== "success") return t;
    }
  }
  if (bodyStr == null) return undefined;
  const trimmed = bodyStr.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = safeParseJson(trimmed);
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    for (const k of ["message", "Message", "error", "Error", "detail", "title"]) {
      const x = o[k];
      if (typeof x === "string" && x.trim().length > 0) return x.trim();
    }
  }
  if (parsed === undefined) {
    return trimmed;
  }
  return undefined;
}

export async function postToErp(
  payload: ReceiptConfirmationPayload,
  onStatus?: PostToErpStatusCallback
): Promise<PostToErpResult> {
  const log = (msg: string) => onStatus?.(msg);
  const requestBody = buildProcurementInboundPostBody(payload);

  if (isStandaloneMode()) {
    const apiUrl = STANDALONE_API_URL.replace(/\/$/, "");
    const postUrl = `${apiUrl}/api/post-receipt`;
    log(`Standalone mode: POST to ${postUrl}…`);
    log(`Waiting for response (timeout ${POST_TIMEOUT_MS / 1000}s)…`);
    let res: Response;
    try {
      res = await withTimeout(
        fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
        POST_TIMEOUT_MS,
        "Post to ERP timed out. Check your Azure backend and Flowgear."
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`Error: ${errMsg}`);
      throw e;
    }
    const text = await res.text();
    log(`Response type: response (${res.status})`);
    log(`Raw response: ${text.length <= RAW_LOG_MAX_LENGTH ? text : text.slice(0, RAW_LOG_MAX_LENGTH) + "…"}`);
    let data: Record<string, unknown> | null = null;
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      data = safeParseJson(text) as Record<string, unknown> | null;
    }
    if (data == null) {
      data = res.ok ? { responseCode: "200", responseMessage: "Success" } : { responseCode: String(res.status), responseMessage: text || res.statusText };
    }
    const code = data?.responseCode != null ? String(data.responseCode) : data?.FgResponseCode != null ? String(data.FgResponseCode) : String(res.status);
    const bodyRaw = data?.responseMessage ?? data?.FgResponseBody ?? data?.body;
    const bodyStr = typeof bodyRaw === "string" ? bodyRaw : bodyRaw != null ? JSON.stringify(bodyRaw) : undefined;
    const ok = res.ok || code === "200" || data?.success === true || Object.keys(data).length === 0;
    log(ok ? `Status: ${code} (success)` : `Status: ${code} (non-OK)`);
    const parsedBody = bodyStr != null ? safeParseJson(bodyStr) : undefined;
    const errorDetail = ok ? undefined : extractWorkflowErrorMessage(data, bodyStr);
    if (!ok && errorDetail != null) {
      log(`Workflow error: ${errorDetail.length <= 500 ? errorDetail : errorDetail.slice(0, 500) + "…"}`);
    }
    return { ok, statusCode: code, body: parsedBody, rawKeys: Object.keys(data), errorDetail };
  }

  log(`Sending POST to ${POST_PROCUREMENT_INBOUND_PATH} (auth via Console cookie)…`);
  log(`Waiting for Flowgear response (timeout ${POST_TIMEOUT_MS / 1000}s)…`);

  let response: unknown;
  try {
    response = await withTimeout(
      Flowgear.Sdk.invoke("POST", POST_PROCUREMENT_INBOUND_PATH, requestBody),
      POST_TIMEOUT_MS,
      "Post to ERP timed out. The workflow may still be running; check Flowgear activity log."
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`Error: ${errMsg}`);
    throw e;
  }

  log(`Response type: ${response === null ? "null" : typeof response}`);
  log(`Raw Flowgear response: ${rawResponseToLog(response)}`);

  let data: Record<string, unknown> | null = null;

  if (typeof response === "string") {
    log(`Response is string, length ${response.length}`);
    const trimmed = response.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      const parsed = safeParseJson(response) as Record<string, unknown> | null;
      data = parsed && typeof parsed === "object" ? parsed : null;
      if (data != null) {
        log(`Parsed JSON keys: ${Object.keys(data).join(", ")}`);
      }
    } else if (trimmed === "Success" || trimmed.toLowerCase() === "success") {
      data = {
        FgResponseCode: 200,
        FgResponseBody: "Success",
        status: true,
      };
    }
  } else if (typeof response === "object" && response !== null) {
    const raw = response as Record<string, unknown>;
    const rawKeys = Object.keys(raw);
    log(`Response keys: ${rawKeys.length ? rawKeys.join(", ") : "(none)"}`);
    data =
      raw?.response != null && typeof raw.response === "object"
        ? (raw.response as Record<string, unknown>)
        : raw?.result != null && typeof raw.result === "object"
          ? (raw.result as Record<string, unknown>)
          : raw?.data != null && typeof raw.data === "object"
            ? (raw.data as Record<string, unknown>)
            : raw;
  }

  if (data == null) {
    log("Could not resolve response object; treating as non-OK.");
    return {
      ok: false,
      statusCode: undefined,
      body: undefined,
      rawKeys: [],
      errorDetail: typeof response === "string" ? response.trim() || undefined : undefined,
    };
  }

  const code =
    data.FgResponseCode != null
      ? String(data.FgResponseCode)
      : data.responseCode != null
        ? String(data.responseCode)
        : data.statusCode != null
          ? String(data.statusCode)
          : undefined;
  const bodyRaw =
    data.FgResponseBody ??
    data.responseMessage ??
    data.body;
  const bodyStr =
    typeof bodyRaw === "string"
      ? bodyRaw
      : bodyRaw != null
        ? JSON.stringify(bodyRaw)
        : undefined;
  const statusTrue =
    data.success === true ||
    data.success === "True" ||
    data.status === true ||
    data.status === "True";
  const isEmptyObject = Object.keys(data).length === 0;
  const ok =
    isEmptyObject ||
    statusTrue ||
    code === "200" ||
    String(code) === "200";

  if (isEmptyObject) {
    log("Empty response {} treated as success.");
  }
  log(
    ok
      ? `Status: ${code ?? (isEmptyObject ? "200" : "unknown")} (success)`
      : `Status: ${code ?? "unknown"} (non-OK)`
  );
  if (bodyStr != null && bodyStr.length > 0) {
    log(`Body length: ${bodyStr.length} chars`);
  }

  const parsedBody = bodyStr != null ? safeParseJson(bodyStr) : undefined;
  const errorDetail = ok ? undefined : extractWorkflowErrorMessage(data, bodyStr);
  if (!ok && errorDetail != null) {
    log(`Workflow error: ${errorDetail.length <= 500 ? errorDetail : errorDetail.slice(0, 500) + "…"}`);
  }

  return {
    ok,
    statusCode: code,
    body: parsedBody,
    rawKeys: Object.keys(data),
    errorDetail,
  };
}

export async function getPendingReceipt(): Promise<ReceiptConfirmationPayload | null> {
  if (GET_PENDING_RECEIPT_PATH == null || GET_PENDING_RECEIPT_PATH === "") {
    return null;
  }
  try {
    const response = await Flowgear.Sdk.invoke("GET", GET_PENDING_RECEIPT_PATH);
    const body = (response as { FgResponseBody?: string })?.FgResponseBody;
    if (body == null) return null;
    const parsed = safeParseJson(body) as ReceiptConfirmationPayload | null;
    return parsed?.Receipt_Confirmation != null ? parsed : null;
  } catch {
    return null;
  }
}

/** Base path for the default orders-list workflow (before query string). */
export const ORDERS_LIST_PATH = DEFAULT_ORDERS_LIST_PATH;

export function getReceiptLockDashboardId(): string {
  const v =
    typeof import.meta !== "undefined"
      ? ((import.meta as ImportMeta).env as Record<string, string | undefined>).VITE_RECEIPT_LOCK_DASHBOARD_ID
      : undefined;
  return (v ?? "").trim();
}

/** Console user for lock API; override with VITE_RECEIPT_LOCK_USERNAME when SDK user is unavailable. */
export function getReceiptLockUsernameForRequest(): string {
  const viteEnv =
    typeof import.meta !== "undefined" ? ((import.meta as ImportMeta).env as Record<string, string | undefined>) : {};
  const fromEnv = (viteEnv.VITE_RECEIPT_LOCK_USERNAME ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;
  try {
    const Sdk = Flowgear.Sdk as unknown as {
      getUser?: () => { name?: string; userName?: string; userNameDisplay?: string; email?: string };
    };
    const u = Sdk.getUser?.();
    const cand = [u?.userName, u?.userNameDisplay, u?.name, u?.email].find(
      (x) => typeof x === "string" && x.trim().length > 0
    );
    if (cand) return cand.trim();
  } catch {
    /* not embedded */
  }
  return "";
}

/**
 * Declares server-side lock for a receipt row. Pass username null (sent as query null) to release/unlock.
 */
export async function setReceiptNoPriceLock(params: {
  dashboardId: string;
  recordId: string;
  username: string | null;
}): Promise<void> {
  const { dashboardId, recordId, username } = params;
  if (dashboardId.trim().length === 0 || recordId.trim().length === 0) return;
  const qs = new URLSearchParams();
  qs.set("DashboardId", dashboardId.trim());
  qs.set("RecordId", recordId.trim());
  if (username != null && username.trim().length > 0) {
    qs.set("Username", username.trim());
  } else {
    qs.set("Username", "null");
  }
  await Flowgear.Sdk.invoke("GET", `${RECEIPT_LOCK_PATH}?${qs.toString()}`);
}

export async function getOrdersList(
  onStatus?: (message: string) => void
): Promise<ReceiptOrderListEntry[]> {
  const path = getOrdersListRequestPath();
  if (path === "") {
    if (import.meta.env.DEV && onStatus) onStatus("Orders list path not configured.");
    return [];
  }
  const log = (import.meta.env.DEV && onStatus) ? (msg: string) => onStatus(msg) : () => {};
  log(`GET ${path} …`);
  try {
    const response = await withTimeout(
      Flowgear.Sdk.invoke("GET", path) as Promise<unknown>,
      GET_ORDERS_TIMEOUT_MS,
      "Request timed out. Ensure you're signed in and opened this app from the Flowgear Console."
    );
    if (response === undefined || response === null) {
      throw new ConnectionError(
        "No response from Flowgear. Open this app from the Flowgear Console (debug or published) and try again."
      );
    }
    if (typeof response === "object" && response !== null && Object.keys(response).length === 0) {
      throw new ConnectionError(
        "Flowgear returned an empty response. Check Site settings → Allowed Origins and that you're signed in."
      );
    }
    if (responseIndicatesAuthFailure(response)) {
      throw new AuthError("Not signed in or session expired. Sign in to the Flowgear Console and try again.");
    }
    log(`GET ${path} response type: ${response === null ? "null" : typeof response}`);
    if (typeof response === "object" && response !== null) {
      const keys = Object.keys(response);
      const allNames = Object.getOwnPropertyNames(response);
      log(`GET ${path} response keys: ${keys.length ? keys.join(", ") : "(none)"}`);
      if (allNames.length > 0 && allNames.length <= 20) {
        log(`GET ${path} own property names: ${allNames.join(", ")}`);
      }
    }
    let rawBody: string | undefined;
    if (typeof response === "string") {
      rawBody = response;
      log(`GET ${path} raw body (string) length: ${rawBody.length}`);
      log(`GET ${path} raw body preview: ${rawBody.slice(0, 400)}${rawBody.length > 400 ? "…" : ""}`);
    } else if (typeof response === "object" && response != null) {
      const obj = response as Record<string, unknown>;
      const fgBody = (response as { FgResponseBody?: string }).FgResponseBody;
      const receiptNoPrice = (response as { ReceiptNoPrice?: string }).ReceiptNoPrice;
      if (typeof receiptNoPrice === "string" && receiptNoPrice.length > 0) {
        rawBody = receiptNoPrice;
        log(`GET ${path} body from ReceiptNoPrice length: ${rawBody.length}`);
        log(`GET ${path} preview: ${rawBody.slice(0, 400)}${rawBody.length > 400 ? "…" : ""}`);
      } else if (typeof fgBody === "string" && fgBody.length > 0) {
        rawBody = fgBody;
        log(`GET ${path} body from FgResponseBody length: ${rawBody.length}`);
        log(`GET ${path} preview: ${rawBody.slice(0, 400)}${rawBody.length > 400 ? "…" : ""}`);
      }
      if (rawBody == null && typeof (response as Record<string, unknown>).response === "object") {
        const inner = (response as { response?: unknown }).response as Record<string, unknown> | undefined;
        const innerBody = inner && typeof inner.FgResponseBody === "string" ? inner.FgResponseBody : undefined;
        if (typeof innerBody === "string" && innerBody.length > 0) {
          rawBody = innerBody;
          log(`GET ${path} body from .response.FgResponseBody length: ${rawBody.length}`);
        }
      }
      if (rawBody == null) {
        const possibleKeys = [
        "ReceiptNoPrice",
        "FgResponse",
        "ResponseBody",
        "response",
        "body",
        "data",
        "result",
        "value",
        "Content",
        "content",
      ];
        for (const key of possibleKeys) {
          const v = obj[key];
          if (typeof v === "string" && v.length > 0) {
            rawBody = v;
            log(`GET ${path} body from .${key} length: ${rawBody.length}`);
            log(`GET ${path} preview: ${rawBody.slice(0, 400)}${rawBody.length > 400 ? "…" : ""}`);
            break;
          }
        }
      }
      if (rawBody == null) {
        for (const key of Object.getOwnPropertyNames(obj)) {
          try {
            const v = (obj as Record<string, unknown>)[key];
            if (typeof v === "string" && /<Table/i.test(v) && /<Content[\s>]/i.test(v)) {
              rawBody = v;
              log(`GET ${path} body from .${key} (XML-like) length: ${rawBody.length}`);
              break;
            }
          } catch {
            /* skip */
          }
        }
      }
      if (rawBody == null) {
        const str = JSON.stringify(response);
        if (str && str.length < 5000 && /<Table/i.test(str) && /<Content[\s>]/i.test(str)) {
          const start = str.indexOf("<Result");
          const altStart = str.indexOf("<Table");
          const begin = start >= 0 ? start : altStart;
          const endTag = "</Result>";
          const end = str.indexOf(endTag);
          if (begin >= 0 && end > begin) {
            rawBody = str.slice(begin, end + endTag.length);
            log(`GET ${path} body extracted from stringify (Result/Table) length: ${rawBody.length}`);
          }
        }
      }
      if (rawBody == null) {
        log(`GET ${path} stringify preview: ${JSON.stringify(response).slice(0, 500)}…`);
        const isEmpty = JSON.stringify(response) === "{}";
        if (isEmpty) {
          log(`GET ${path} empty response {} — check Flowgear app embedding or response size limits.`);
        } else {
          log(`GET ${path} no string body found in response object`);
        }
      }
    }
    if (rawBody != null) {
      const trimmed = rawBody.trim();
      if (trimmed.startsWith("{") && /"Result"/i.test(trimmed) && /"Table"/i.test(trimmed)) {
        log(`GET ${path} detected Result/Table JSON, parsing…`);
        const list = parseResultTableJson(rawBody);
        log(`GET ${path} → ${list.length} order(s) from JSON`);
        return list;
      }
      if (trimmed.startsWith("[")) {
        log(`GET ${path} detected JSON row array, parsing…`);
        const list = parseResultTableJsonRows(rawBody);
        log(`GET ${path} → ${list.length} order(s) from JSON rows`);
        return list;
      }
      const looksLikeXml = /<Table/i.test(rawBody) && /<Content[\s>]/i.test(rawBody);
      if (looksLikeXml) {
        log(`GET ${path} detected Result/Table XML (base64 Content), parsing…`);
        const list = parseResultTableXml(rawBody);
        log(`GET ${path} → ${list.length} order(s) from XML`);
        return list;
      }
      log(`GET ${path} response is not Result/Table JSON or XML; trying JSON array…`);
    }
    let raw: unknown = response;
    if (typeof response === "object" && response != null && "FgResponseBody" in response) {
      const body = (response as { FgResponseBody?: string }).FgResponseBody;
      raw = typeof body === "string" ? safeParseJson(body) : body;
    }
    if (!Array.isArray(raw)) {
      log(`GET ${path} → not a JSON array`);
      return [];
    }
    const list = raw
      .filter(
        (item): item is ReceiptConfirmationPayload =>
          item != null &&
          typeof item === "object" &&
          (item as ReceiptConfirmationPayload).Receipt_Confirmation != null
      )
      .map((p) => ({ payload: p, targetPayloadBase64: null, sourcePayloadBase64: null }));
    log(`GET ${path} → ${list.length} order(s)`);
    return list;
  } catch (e) {
    if (e instanceof AuthError || e instanceof ConnectionError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    log(`GET ${path} failed: ${msg}`);
    if (isAuthFailure(e)) {
      throw new AuthError("Not signed in or session expired. Sign in to the Flowgear Console and try again.");
    }
    if (msg.includes("timed out") || msg.includes("timeout")) {
      throw new ConnectionError(
        "Request timed out. Open this app from the Flowgear Console, ensure you're signed in, and try again."
      );
    }
    return [];
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
