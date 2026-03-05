import { Flowgear } from "flowgear-webapp";
import type { ReceiptConfirmationPayload } from "../models/receiptConfirmation";
import { parseResultTableXml, parseResultTableJson } from "../utils/ordersListParser";

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
 * Flowgear path: /v2/ReceiptNoPrice (GET).
 * Override with env: VITE_GET_ORDERS_LIST_PATH if needed.
 */
const GET_ORDERS_LIST_PATH: string | null =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_GET_ORDERS_LIST_PATH) ||
  "/v2/ReceiptNoPrice";

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

export async function postToErp(
  payload: ReceiptConfirmationPayload,
  onStatus?: PostToErpStatusCallback
): Promise<{ ok: boolean; statusCode?: string; body?: unknown; rawKeys?: string[] }> {
  const log = (msg: string) => onStatus?.(msg);

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
          body: JSON.stringify(payload),
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
    return { ok, statusCode: code, body: bodyStr != null ? safeParseJson(bodyStr) : undefined, rawKeys: Object.keys(data) };
  }

  log(`Sending POST to ${POST_PROCUREMENT_INBOUND_PATH} (auth via Console cookie)…`);
  log(`Waiting for Flowgear response (timeout ${POST_TIMEOUT_MS / 1000}s)…`);

  let response: unknown;
  try {
    response = await withTimeout(
      Flowgear.Sdk.invoke("POST", POST_PROCUREMENT_INBOUND_PATH, payload),
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

  return {
    ok,
    statusCode: code,
    body: bodyStr != null ? safeParseJson(bodyStr) : undefined,
    rawKeys: Object.keys(data),
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

/** Path used for the list request (GET). Exported for display/logging. */
export const ORDERS_LIST_PATH = GET_ORDERS_LIST_PATH;

/** Returns list of orders (array of same JSON payload). Calls GET on GET_ORDERS_LIST_PATH (/v2/ReceiptNoPrice).
 * Supports: (1) Result/Table XML with base64 <Content> per table; (2) JSON array of payloads. */
export async function getOrdersList(
  onStatus?: (message: string) => void
): Promise<ReceiptConfirmationPayload[]> {
  const path = GET_ORDERS_LIST_PATH;
  if (path == null || path === "") {
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
    const list = raw.filter(
      (item): item is ReceiptConfirmationPayload =>
        item != null &&
        typeof item === "object" &&
        (item as ReceiptConfirmationPayload).Receipt_Confirmation != null
    );
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
