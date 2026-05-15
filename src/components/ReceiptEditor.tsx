import { useState, useCallback, useEffect, useMemo } from "react";
import { Flowgear } from "flowgear-webapp";

const { AlertMessageTypes, AlertDismissOptions, GetTextResult } = Flowgear.Sdk;
import type { ReceiptConfirmationPayload } from "../models/receiptConfirmation";
import {
  displayLineUom,
  hasMissingOrderPrice,
  hasInvalidOrderPrice,
  isZeroOutLine,
  compareReceiptLineNoAsc,
  getItemHoldCodeDisplay,
  getItemPackLotDisplay,
  groupReceiptItemsForDisplay,
  hasDistinctHoldCodesPerItemLot,
} from "../models/receiptConfirmation";
import { postToErp, isStandaloneMode } from "../services/payloadService";
import { sideBySideLineDiff } from "../utils/payloadLineDiff";
import PayloadDiffComparePanes from "./PayloadDiffComparePanes";
import ReceiptLineEditor from "./ReceiptLineEditor";

const MAX_STATUS_LINES = 25;
const isDev = import.meta.env.DEV;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ReceiptEditorProps {
  initialPayload: ReceiptConfirmationPayload | null;
  targetPayloadBase64?: string | null;
  sourcePayloadBase64?: string | null;
  onRefresh?: () => void;
  onPostSuccess?: () => void | Promise<void>;
  foreignSessionLockActive?: boolean;
  /** When set, replaces the default “another tab” copy for the session-lock banner. */
  sessionLockBannerOverride?: string | null;
  /** Dashboard row Id from list workflow (ReceiptNoPriceLock DashboardId). */
  dashboardRecordId?: string | null;
  /** Pointer/focus into an editable rate field: request server lock (no payload mutation). */
  onRateFieldFocus?: () => void;
  /** After blur/Enter commits a rate to the payload — marks row as edited for unlock-on-navigate rules. */
  onRateValueCommitted?: () => void;
  ensureLockBeforePost?: () => Promise<boolean>;
  onEndEditSession?: () => void | Promise<void>;
  editSessionBusy?: boolean;
  lockApiDebugLog?: string[];
  /** Workflow / list lock holder for the open receipt (same as Orders "Current user" column). Not the Console sign-in identity. */
  receiptListLockUserDisplay?: string;
  /** Persist in-progress rates when the user selects another order and returns. */
  onPayloadChange?: (payload: ReceiptConfirmationPayload) => void;
}

interface ReceiptDisplayRow {
  key: string;
  lineLabel: string;
  itemCode: string;
  description: string;
  inventoryDisplay: string;
  holdCode?: string;
  quantity: number;
  netWeight: number;
  uom: string;
  rate: number | null;
  rateIsAveraged?: boolean;
  isWeightBased: boolean;
  sourceLineNos: string[];
}

export default function ReceiptEditor({
  initialPayload,
  targetPayloadBase64 = null,
  sourcePayloadBase64 = null,
  onRefresh,
  onPostSuccess,
  foreignSessionLockActive = false,
  sessionLockBannerOverride = null,
  lockApiDebugLog = [],
  dashboardRecordId = null,
  onRateFieldFocus,
  onRateValueCommitted,
  ensureLockBeforePost,
  onEndEditSession,
  editSessionBusy = false,
  receiptListLockUserDisplay = "",
  onPayloadChange,
}: ReceiptEditorProps) {
  const [payload, setPayload] = useState<ReceiptConfirmationPayload | null>(initialPayload);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postSuccessMessage, setPostSuccessMessage] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showTargetPayloadView, setShowTargetPayloadView] = useState(false);
  const [showSourcePayloadView, setShowSourcePayloadView] = useState(false);
  const [showHoldCodeDetails, setShowHoldCodeDetails] = useState(false);

  const decodedTargetPayload = useMemo(
    () => decodePayloadField(targetPayloadBase64),
    [targetPayloadBase64]
  );
  const decodedSourcePayload = useMemo(
    () => decodePayloadField(sourcePayloadBase64),
    [sourcePayloadBase64]
  );
  const hasSourcePayload = useMemo(
    () => (sourcePayloadBase64 ?? "").trim().length > 0,
    [sourcePayloadBase64]
  );

  const targetPayloadText = useMemo(() => {
    if (payload == null) return "";
    return decodedTargetPayload ?? JSON.stringify(payload, null, 2);
  }, [payload, decodedTargetPayload]);

  const sourcePayloadText = useMemo(() => {
    if (!hasSourcePayload) return "";
    return (
      decodedSourcePayload ??
      tryDecodeBase64Utf8(stripPayloadBase64Wrapper(sourcePayloadBase64)) ??
      (sourcePayloadBase64 ?? "").trim()
    );
  }, [hasSourcePayload, decodedSourcePayload, sourcePayloadBase64]);

  const payloadCompareRows = useMemo(() => {
    if (!showTargetPayloadView || !showSourcePayloadView || !hasSourcePayload) {
      return [];
    }
    return sideBySideLineDiff(targetPayloadText, sourcePayloadText);
  }, [
    showTargetPayloadView,
    showSourcePayloadView,
    hasSourcePayload,
    targetPayloadText,
    sourcePayloadText,
  ]);

  const showPayloadCompare =
    showTargetPayloadView && showSourcePayloadView && hasSourcePayload;

  const appendStatus = useCallback((message: string) => {
    setStatusLog((prev) => [...prev.slice(-(MAX_STATUS_LINES - 1)), message]);
  }, []);

  useEffect(() => {
    if (isStandaloneMode()) {
      appendStatus("App loaded. Standalone mode — posting via configured API backend.");
    } else {
      const embedded = typeof window !== "undefined" && window.top !== window.self;
      appendStatus(
        embedded
          ? "App loaded. Embedded in Console: yes — cookie auth will be used when you Post."
          : "App loaded. Embedded in Console: no — open via Flowgear debug URL so the cookie key is used."
      );
    }
  }, [appendStatus]);

  useEffect(() => {
    setPayload(initialPayload);
  }, [initialPayload]);

  useEffect(() => {
    setShowTargetPayloadView(false);
    setShowSourcePayloadView(false);
    setShowHoldCodeDetails(false);
  }, [initialPayload, targetPayloadBase64, sourcePayloadBase64]);

  const updateOrderPrice = useCallback(
    (lineNos: string[], value: number | null) => {
      setPayload((prev) => {
        if (prev == null) return prev;
        const lineNoSet = new Set(lineNos.map((n) => String(n)));
        const next: ReceiptConfirmationPayload = {
          ...prev,
          Receipt_Confirmation: {
            ...prev.Receipt_Confirmation,
            Items: prev.Receipt_Confirmation.Items.map((item) =>
              lineNoSet.has(String(item.Line_No)) ? { ...item, Order_Price: value } : item
            ),
          },
        };
        onPayloadChange?.(next);
        return next;
      });
      setError(null);
      onRateValueCommitted?.();
    },
    [onPayloadChange, onRateValueCommitted]
  );

  async function handlePost() {
    if (payload == null) return;
    if (foreignSessionLockActive) {
      Flowgear.Sdk.setAlert(
        "Another tab may be editing this receipt. Close the other session or wait before posting.",
        AlertMessageTypes.Warning,
        AlertDismissOptions.Tap
      );
      return;
    }
    const itemsToValidate = payload.Receipt_Confirmation.Items ?? [];
    const missing = itemsToValidate.filter((i) => !isZeroOutLine(i) && i.Order_Price == null);
    if (missing.length > 0) {
      setError(`Please set Rate (R/UOM) for line(s): ${missing.map((i) => i.Line_No).join(", ")}.`);
      Flowgear.Sdk.setAlert(
        `Rate (R/UOM) is required for all lines. Missing: ${missing.map((i) => i.Line_No).join(", ")}.`,
        AlertMessageTypes.Warning,
        AlertDismissOptions.Tap
      );
      return;
    }
    const invalid = itemsToValidate.filter((i) => !isZeroOutLine(i) && i.Order_Price != null && i.Order_Price <= 0);
    if (invalid.length > 0) {
      setError(`Rate (R/UOM) must be greater than 0 for line(s): ${invalid.map((i) => i.Line_No).join(", ")}.`);
      Flowgear.Sdk.setAlert(
        `Rate (R/UOM) must be positive. Invalid: ${invalid.map((i) => i.Line_No).join(", ")}.`,
        AlertMessageTypes.Warning,
        AlertDismissOptions.Tap
      );
      return;
    }

    const confirmDetail =
      "Post this receipt confirmation to ERP with the current rates and quantities?\n\nType Y to confirm.";
    let postConfirmText: string | null = null;
    try {
      const embedded = typeof window !== "undefined" && window.top !== window.self;
      if (embedded) {
        const r = await Flowgear.Sdk.getTextModal("Post to ERP", confirmDetail, "");
        if (r.result === GetTextResult.Cancel) return;
        postConfirmText = r.text ?? "";
      } else {
        postConfirmText = window.prompt(confirmDetail);
        if (postConfirmText == null) return;
      }
    } catch {
      postConfirmText = window.prompt(confirmDetail);
      if (postConfirmText == null) return;
    }
    if (postConfirmText.trim().toUpperCase() !== "Y") {
      Flowgear.Sdk.setAlert(
        "Posting cancelled. Type Y (any case) in the confirmation box to post to ERP.",
        AlertMessageTypes.Warning,
        AlertDismissOptions.Tap
      );
      return;
    }

    const okLock = (await ensureLockBeforePost?.()) ?? true;
    if (!okLock) {
      Flowgear.Sdk.setAlert(
        "Could not claim this receipt for posting. It may be locked by another user, or the lock request failed. Refresh the list and try again.",
        AlertMessageTypes.Warning,
        AlertDismissOptions.Tap
      );
      return;
    }

    setPosting(true);
    setError(null);
    appendStatus("---");
    try {
      const result = await postToErp(payload, appendStatus);
      if (result.ok) {
        try {
          await Promise.resolve(onEndEditSession?.());
        } catch {
          /* release lock best-effort after successful post */
        }
        setPostSuccessMessage("Receipt posted to ERP successfully.");
        setPayload(null);
      } else {
        const msg =
          result.errorDetail ??
          (result.body != null && typeof result.body === "object" && "message" in result.body
            ? String((result.body as { message: unknown }).message)
            : typeof result.body === "string" && result.body.trim().length > 0
              ? result.body.trim()
              : result.statusCode != null
                ? `Request failed (${result.statusCode}).`
                : "Post failed");
        setError(msg);
        Flowgear.Sdk.setAlert(msg, AlertMessageTypes.Error, AlertDismissOptions.Tap);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Post failed";
      setError(msg);
      appendStatus(`Throw: ${msg}`);
      Flowgear.Sdk.setAlert(msg, AlertMessageTypes.Error, AlertDismissOptions.Tap);
    } finally {
      setPosting(false);
    }
  }

  const visibleItems = useMemo(() => {
    const items = (payload?.Receipt_Confirmation.Items ?? []).filter((item) => !isZeroOutLine(item));
    return [...items].sort((a, b) => compareReceiptLineNoAsc(a.Line_No, b.Line_No));
  }, [payload]);

  const hasHoldCodeExtraInfo = useMemo(
    () => hasDistinctHoldCodesPerItemLot(visibleItems),
    [visibleItems]
  );

  useEffect(() => {
    if (!hasHoldCodeExtraInfo && showHoldCodeDetails) {
      setShowHoldCodeDetails(false);
    }
  }, [hasHoldCodeExtraInfo, showHoldCodeDetails]);

  const displayRows = useMemo<ReceiptDisplayRow[]>(() => {
    const groups = groupReceiptItemsForDisplay(visibleItems, {
      includeHoldCode: showHoldCodeDetails,
    });

    return groups.map((items) => {
      const first = items[0];
      const qty = items.reduce((sum, item) => sum + item.Quantity, 0);
      const netWeight = items.reduce((sum, item) => sum + item.Net_Weight_Shipped, 0);
      const lineNos = items.map((item) => item.Line_No);
      const priced = items.map((item) => item.Order_Price).filter((v): v is number => v != null);
      let rate: number | null = null;
      let rateIsAveraged = false;
      if (priced.length === 0) {
        rate = null;
      } else {
        const distinct = new Set(priced);
        if (distinct.size === 1) {
          rate = priced[0] ?? null;
        } else {
          rate = round2(priced.reduce((a, b) => a + b, 0) / priced.length);
          rateIsAveraged = true;
        }
      }
      const uom = displayLineUom(first);
      const holdCode = showHoldCodeDetails ? getItemHoldCodeDisplay(first) : undefined;
      return {
        key: showHoldCodeDetails
          ? `hold-${lineNos.join("-")}`
          : `consolidated-${lineNos.join("-")}`,
        lineLabel: lineNos.length > 1 ? lineNos.join(", ") : lineNos[0],
        itemCode: first.Item_Code,
        description: first.Item_Description ?? "",
        inventoryDisplay: getItemPackLotDisplay(first),
        holdCode,
        quantity: qty,
        netWeight,
        uom,
        rate,
        rateIsAveraged,
        isWeightBased: uom.trim().toUpperCase() === "KG",
        sourceLineNos: lineNos,
      };
    });
  }, [showHoldCodeDetails, visibleItems]);

  const needsPrice = payload != null ? hasMissingOrderPrice(payload) : false;
  const hasInvalidPrice = payload != null ? hasInvalidOrderPrice(payload) : false;
  const rateReadOnly = foreignSessionLockActive;
  const canPost = !needsPrice && !hasInvalidPrice && !foreignSessionLockActive;

  const postButtonTitle = useMemo(() => {
    if (posting) return undefined;
    if (needsPrice) return "Enter a rate (R/UOM) on every line.";
    if (hasInvalidPrice) return "Every rate must be greater than 0.";
    if (foreignSessionLockActive) return "Posting is blocked by another session or lock.";
    if (editSessionBusy && dashboardRecordId) return "Claiming this receipt on the server…";
    return undefined;
  }, [posting, needsPrice, hasInvalidPrice, foreignSessionLockActive, editSessionBusy, dashboardRecordId]);

  const { totalQty, totalWeight, totalOrderPrice } = useMemo(() => {
    let qty = 0;
    let weight = 0;
    let orderPrice = 0;
    for (const item of visibleItems) {
      qty += item.Quantity;
      weight += item.Net_Weight_Shipped;
      const r = item.Order_Price;
      if (r != null) {
        const byWeight = displayLineUom(item).trim().toUpperCase() === "KG";
        if (byWeight) {
          orderPrice += r * item.Net_Weight_Shipped;
        } else {
          orderPrice += r * item.Quantity;
        }
      }
    }
    return {
      totalQty: qty,
      totalWeight: weight,
      totalOrderPrice: round2(orderPrice),
    };
  }, [visibleItems]);

  if (payload == null) {
    return (
      <div className="app-contentarea">
        {postSuccessMessage != null ? (
          <div className="receipt-post-success" role="status">
            <p className="receipt-post-success-message">{postSuccessMessage}</p>
            <button
              type="button"
              className="receipt-btn receipt-btn-primary"
              onClick={() => {
                void Promise.resolve(onPostSuccess?.());
                onRefresh?.();
                setPostSuccessMessage(null);
              }}
            >
              OK — load next receipt
            </button>
          </div>
        ) : (
          <>
            <p className="text-muted">
              No receipt confirmation to edit. Load a payload from your workflow or use sample data when a GET endpoint
              is configured.
            </p>
            {onRefresh != null && (
              <button type="button" className="receipt-btn receipt-btn-secondary" onClick={onRefresh}>
                Refresh
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const rc = payload.Receipt_Confirmation;
  const currentUserDisplay = receiptListLockUserDisplay.trim().length > 0 ? receiptListLockUserDisplay.trim() : "—";

  return (
    <div className="app-contentarea">
      <div className="receipt-sheet">
        <header className="receipt-sheet-header">
          <div className="receipt-sheet-header-logo">
            <img src={`${import.meta.env.BASE_URL}CCH Logo.png?v=2`} alt="CCH" />
          </div>
          <div className="receipt-sheet-header-content">
            <h1 className="receipt-sheet-title">Receipt confirmation – Order price entry</h1>
            <div className="receipt-sheet-meta">
              <span>
                <strong>Company</strong> {rc.Company}
              </span>
              <span>
                <strong>Receipt</strong> {rc.Inbound_Receipt_No}
              </span>
              <span>
                <strong>Supplier</strong> {rc.Supplier}
              </span>
              <span>
                <strong>Order type</strong> {rc.Order_Type}
              </span>
              <span>
                <strong>Probill</strong> {rc.Probill_Number}
              </span>
              <span>
                <strong>Reference</strong> {rc.Inbound_Reference_No}
              </span>
            </div>
          </div>
          <div className="receipt-sheet-header-user" title={currentUserDisplay !== "—" ? currentUserDisplay : undefined}>
            <span className="receipt-sheet-user-label">Current user</span>
            <span className="receipt-sheet-user-value">{currentUserDisplay}</span>
          </div>
        </header>

        {foreignSessionLockActive && (
          <div className="alert alert-warning receipt-sheet-alert" role="status">
            {sessionLockBannerOverride != null && sessionLockBannerOverride.trim().length > 0
              ? sessionLockBannerOverride
              : "Another browser tab may already be editing this receipt on this device. Rates and posting are blocked until that session closes or the lock expires (about 2 minutes after the tab stops updating). For a lock across different users or PCs, use a Flowgear workflow."}
          </div>
        )}

        {(needsPrice || hasInvalidPrice) && (
          <div className="receipt-sheet-banner receipt-sheet-banner-price" role="status">
            {hasInvalidPrice
              ? "Rate (R/UOM) must be greater than 0 for every line."
              : "Enter a rate (R/UOM) for every line; when UOM is KG, order price = Net weight × Rate; otherwise order price = Quantity × Rate."}
          </div>
        )}

        {error != null && (
          <div className="alert alert-danger receipt-sheet-alert" role="alert">
            {error}
          </div>
        )}

        <div className="receipt-table-wrap">
          <div className="receipt-table-controls">
            <label
              className={`receipt-hold-toggle${hasHoldCodeExtraInfo ? "" : " receipt-hold-toggle--disabled"}`}
              title={
                hasHoldCodeExtraInfo
                  ? undefined
                  : "No stock item + lot groups with multiple hold codes — nothing extra to expand."
              }
            >
              <input
                type="checkbox"
                checked={showHoldCodeDetails}
                disabled={!hasHoldCodeExtraInfo}
                onChange={(e) => setShowHoldCodeDetails(e.target.checked)}
              />
              <span>Show Hold Code details</span>
            </label>
          </div>
          <table className="table receipt-table">
            <thead>
              <tr>
                <th className="receipt-th receipt-th-line">Line</th>
                <th className="receipt-th receipt-th-item">Item code</th>
                <th className="receipt-th receipt-th-desc">Description</th>
                <th className="receipt-th receipt-th-inv">Pack Size / Lot</th>
                {showHoldCodeDetails && <th className="receipt-th receipt-th-hold">Hold code</th>}
                <th className="receipt-th receipt-th-num">Qty</th>
                <th className="receipt-th receipt-th-num">Net weight (kg)</th>
                <th className="receipt-th receipt-th-uom">UOM</th>
                <th className="receipt-th receipt-th-rate">Rate (R/UOM)</th>
                <th className="receipt-th receipt-th-price">Order price</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <ReceiptLineEditor
                  key={row.key}
                  rowKey={row.key}
                  lineLabel={row.lineLabel}
                  itemCode={row.itemCode}
                  description={row.description}
                  inventoryDisplay={row.inventoryDisplay}
                  holdCode={showHoldCodeDetails ? row.holdCode : undefined}
                  quantity={row.quantity}
                  netWeight={row.netWeight}
                  uom={row.uom}
                  rate={row.rate}
                  rateIsAveraged={row.rateIsAveraged ?? false}
                  isWeightBased={row.isWeightBased}
                  rateReadOnly={rateReadOnly}
                  onRateFocus={onRateFieldFocus}
                  onOrderPriceChange={(value) => updateOrderPrice(row.sourceLineNos, value)}
                />
              ))}
              <tr className="receipt-tr receipt-tr-total">
                <td
                  className="receipt-td receipt-td-line text-align-right"
                  colSpan={showHoldCodeDetails ? 5 : 4}
                >
                  <strong>Total</strong>
                </td>
                <td className="receipt-td receipt-td-num text-align-right">{totalQty}</td>
                <td className="receipt-td receipt-td-num text-align-right">{totalWeight.toFixed(2)}</td>
                <td className="receipt-td receipt-td-uom text-align-right">—</td>
                <td className="receipt-td receipt-td-rate text-align-right">—</td>
                <td className="receipt-td receipt-td-price text-align-right receipt-td-calculated">
                  {totalOrderPrice.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
          {!showHoldCodeDetails && displayRows.some((r) => r.rateIsAveraged) ? (
            <p className="receipt-rate-average-footnote">For all * — Average of line prices captured</p>
          ) : null}
        </div>

        <div className="receipt-sheet-powered" aria-hidden="true">
          <span>Powered by</span>
          <img src={`${import.meta.env.BASE_URL}inhance_logo.png`} alt="Inhance" />
        </div>

        <footer className="receipt-sheet-footer">
          <div className="receipt-sheet-actions">
            <button
              type="button"
              className={`receipt-btn receipt-btn-primary ${canPost ? "receipt-btn-primary-ready" : ""}`}
              title={postButtonTitle}
              onClick={handlePost}
              disabled={posting || !canPost}
            >
              {posting ? "Posting…" : "Post to ERP"}
            </button>
            {posting && (
              <span className="receipt-posting-hint text-muted ms-2 align-self-center">
                This can take a minute while the workflow runs.
              </span>
            )}
            {onRefresh != null && (
              <button type="button" className="receipt-btn receipt-btn-secondary" onClick={onRefresh} disabled={posting}>
                Refresh
              </button>
            )}
          </div>

          {isDev && (
            <div className="receipt-status-section">
              <div className="receipt-status-heading">ReceiptNoPriceLock (debug)</div>
              <div className="receipt-status-log" role="log" aria-live="polite">
                {lockApiDebugLog.length === 0 ? (
                  <div className="text-muted">
                    No lock calls logged yet. Edit a rate (or post) on a row that includes Id in the list XML/JSON to
                    trigger Flowgear.Sdk.invoke POST /v2/ReceiptNoPriceLock. Use timestamps here to correlate with
                    Flowgear workflow activations.
                  </div>
                ) : (
                  lockApiDebugLog.map((line, i) => (
                    <div key={i} className="receipt-status-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {isDev && (
            <div className="receipt-status-section">
              <div className="receipt-status-heading">Status (verbose)</div>
              <div className="receipt-status-log" role="log" aria-live="polite">
                {statusLog.length === 0 ? (
                  <div className="text-muted">No messages yet.</div>
                ) : (
                  statusLog.map((line, i) => (
                    <div key={i} className="receipt-status-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {payload != null && (
            <div className="receipt-debug-payload-section">
              <div className="receipt-debug-payload-heading">
                <div className="receipt-debug-payload-btn-row">
                  <button
                    type="button"
                    className="receipt-btn receipt-btn-secondary"
                    onClick={() => setShowTargetPayloadView((v) => !v)}
                  >
                    {showTargetPayloadView ? "Hide target payload" : "View target payload"}
                  </button>
                  {hasSourcePayload ? (
                    <button
                      type="button"
                      className="receipt-btn receipt-btn-secondary"
                      onClick={() => setShowSourcePayloadView((v) => !v)}
                    >
                      {showSourcePayloadView ? "Hide source payload" : "View source payload"}
                    </button>
                  ) : null}
                  {showPayloadCompare ? (
                    <span className="receipt-debug-payload-compare-hint">Line diff (target vs source)</span>
                  ) : null}
                </div>
              </div>
              {showPayloadCompare ? (
                <div
                  className="receipt-debug-payload-compare"
                  role="region"
                  aria-label="Target and source payloads compared line by line"
                >
                  <PayloadDiffComparePanes
                    rows={payloadCompareRows}
                    targetPayloadText={targetPayloadText}
                    sourcePayloadText={sourcePayloadText}
                  />
                </div>
              ) : (
                <>
                  {showTargetPayloadView ? (
                    <div className="receipt-debug-payload-pane">
                      <div className="receipt-debug-payload-pane-toolbar">
                        <span className="receipt-debug-payload-pane-label">Target payload</span>
                        <button
                          type="button"
                          className="receipt-btn receipt-btn-secondary receipt-debug-payload-copy-btn"
                          aria-label="Copy target payload JSON to clipboard"
                          onClick={() => {
                            try {
                              void navigator.clipboard.writeText(targetPayloadText);
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          Copy target JSON
                        </button>
                      </div>
                      <pre
                        className="receipt-debug-payload-json"
                        aria-label="Current record target payload"
                      >
                        {targetPayloadText}
                      </pre>
                    </div>
                  ) : null}
                  {showSourcePayloadView && hasSourcePayload ? (
                    <div
                      className={`receipt-debug-payload-pane${showTargetPayloadView ? " receipt-debug-payload-pane--after" : ""}`}
                    >
                      <div className="receipt-debug-payload-pane-toolbar">
                        <span className="receipt-debug-payload-pane-label">Source payload</span>
                        <button
                          type="button"
                          className="receipt-btn receipt-btn-secondary receipt-debug-payload-copy-btn"
                          aria-label="Copy source payload JSON to clipboard"
                          onClick={() => {
                            try {
                              void navigator.clipboard.writeText(sourcePayloadText);
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          Copy source JSON
                        </button>
                      </div>
                      <pre
                        className="receipt-debug-payload-json"
                        aria-label="Current record source payload"
                      >
                        {sourcePayloadText}
                      </pre>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Decode workflow payload field: base64-encoded UTF-8 JSON (typical), or raw JSON string, or plain text.
 */
function stripPayloadBase64Wrapper(s: string | null | undefined): string {
  return (s ?? "").replace(/\s/g, "").replace(/^data:[^;]+;base64,/i, "");
}

function tryDecodeBase64Utf8(base64NoWhitespace: string): string | null {
  if (base64NoWhitespace.length === 0) return null;
  let padded = base64NoWhitespace;
  const mod = padded.length % 4;
  if (mod === 1) return null;
  if (mod === 2) padded += "==";
  else if (mod === 3) padded += "=";

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    try {
      binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return null;
    }
  }

  try {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return binary;
  }
}

function decodePayloadField(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return null;

  const b64Candidate = stripPayloadBase64Wrapper(trimmed);
  const decodedUtf8 = tryDecodeBase64Utf8(b64Candidate);
  if (decodedUtf8 != null) {
    try {
      return JSON.stringify(JSON.parse(decodedUtf8.trim()), null, 2);
    } catch {
      return decodedUtf8;
    }
  }

  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    }
  } catch {
    /* use raw below */
  }
  return trimmed;
}
