import { useState, useCallback, useEffect, useMemo } from "react";
import { Flowgear } from "flowgear-webapp";

const { AlertMessageTypes, AlertDismissOptions, ConfirmResult } = Flowgear.Sdk;
import type { ReceiptConfirmationPayload, ReceiptConfirmationItem } from "../models/receiptConfirmation";
import {
  displayLineUom,
  hasMissingOrderPrice,
  hasInvalidOrderPrice,
  isZeroOutLine,
  compareReceiptLineNoAsc,
  getItemHoldCodeForGrouping,
} from "../models/receiptConfirmation";
import { postToErp, isStandaloneMode } from "../services/payloadService";
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
  onPostSuccess?: () => void;
  foreignSessionLockActive?: boolean;
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
    () => decodePayloadBase64(targetPayloadBase64),
    [targetPayloadBase64]
  );
  const decodedSourcePayload = useMemo(
    () => decodePayloadBase64(sourcePayloadBase64),
    [sourcePayloadBase64]
  );

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
    setShowTargetPayloadView(false);
    setShowSourcePayloadView(false);
    setShowHoldCodeDetails(false);
  }, [initialPayload, targetPayloadBase64, sourcePayloadBase64]);

  const updateOrderPrice = useCallback((lineNos: string[], value: number | null) => {
    setPayload((prev) => {
      if (prev == null) return prev;
      const lineNoSet = new Set(lineNos);
      return {
        ...prev,
        Receipt_Confirmation: {
          ...prev.Receipt_Confirmation,
          Items: prev.Receipt_Confirmation.Items.map((item) =>
            lineNoSet.has(item.Line_No) ? { ...item, Order_Price: value } : item
          ),
        },
      };
    });
    setError(null);
  }, []);

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

    let confirmed = false;
    try {
      const embedded = typeof window !== "undefined" && window.top !== window.self;
      if (embedded) {
        const r = await Flowgear.Sdk.confirmModal(
          "Post to ERP?",
          "Are you sure you want to post this receipt confirmation to ERP? The current rates and quantities will be sent to the ERP workflow.",
          "Post"
        );
        confirmed = r === ConfirmResult.Yes;
      } else {
        confirmed = window.confirm("Are you sure you want to post this receipt confirmation to ERP?");
      }
    } catch {
      confirmed = window.confirm("Are you sure you want to post this receipt confirmation to ERP?");
    }
    if (!confirmed) return;

    setPosting(true);
    setError(null);
    appendStatus("---");
    try {
      const result = await postToErp(payload, appendStatus);
      if (result.ok) {
        Flowgear.Sdk.setAlert(
          "Receipt confirmation posted to ERP.",
          AlertMessageTypes.Success,
          AlertDismissOptions.Auto
        );
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

  const displayRows = useMemo<ReceiptDisplayRow[]>(() => {
    if (showHoldCodeDetails) {
      return visibleItems.map((item) => {
        const invL3 = item.Inventory_Level3 ?? item.Line_Stock_Details?.[0]?.To_Inventory_L3 ?? "";
        const holdCode =
          (item.Hold_Code ?? "").trim() || (item.Line_Stock_Details?.[0]?.To_Hold_Code ?? "").trim();
        return {
          key: `line-${item.Line_No}`,
          lineLabel: item.Line_No,
          itemCode: item.Item_Code,
          description: item.Item_Description ?? "",
          inventoryDisplay: invL3,
          holdCode,
          quantity: item.Quantity,
          netWeight: item.Net_Weight_Shipped,
          uom: displayLineUom(item),
          rate: item.Order_Price,
          isWeightBased: displayLineUom(item).trim().toUpperCase() === "KG",
          sourceLineNos: [item.Line_No],
        };
      });
    }

    const groups = new Map<string, ReceiptConfirmationItem[]>();
    for (const item of visibleItems) {
      const itemKey = (item.Item_Code ?? "").trim().toUpperCase();
      const holdKey = getItemHoldCodeForGrouping(item);
      const gkey = `${itemKey}||${holdKey}`;
      const existing = groups.get(gkey);
      if (existing == null) groups.set(gkey, [item]);
      else existing.push(item);
    }

    return Array.from(groups.values()).map((items) => {
      const first = items[0];
      const qty = items.reduce((sum, item) => sum + item.Quantity, 0);
      const netWeight = items.reduce((sum, item) => sum + item.Net_Weight_Shipped, 0);
      const lineNos = items.map((item) => item.Line_No);
      const inventoryDisplay = items
        .map((item) => {
          const lot = item.Inventory_Level3 ?? item.Line_Stock_Details?.[0]?.To_Inventory_L3 ?? "";
          const lotDisp = lot.trim().length > 0 ? lot.trim() : "—";
          return `${item.Line_No}: ${lotDisp}`;
        })
        .join(" · ");
      const priced = items
        .map((item) => item.Order_Price)
        .filter((v): v is number => v != null);
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
      const holdSeg = getItemHoldCodeForGrouping(first) || "NOHOLD";
      return {
        key: `consolidated-${(first.Item_Code ?? "").trim()}-${holdSeg}`.replace(/\s+/g, "_"),
        lineLabel: lineNos.length > 1 ? lineNos.join(", ") : lineNos[0],
        itemCode: first.Item_Code,
        description: first.Item_Description ?? "",
        inventoryDisplay,
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
          <>
            <div className="alert alert-success" role="status">
              {postSuccessMessage}
            </div>
            <button
              type="button"
              className="receipt-btn receipt-btn-primary receipt-btn-primary-ready"
              onClick={() => {
                onPostSuccess?.();
                onRefresh?.();
                setPostSuccessMessage(null);
              }}
            >
              OK - Load next receipt
            </button>
          </>
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
        </header>

        {foreignSessionLockActive && (
          <div className="alert alert-warning receipt-sheet-alert" role="status">
            Another browser tab may already be editing this receipt on this device. Rates and posting are blocked until
            that session closes or the lock expires (about 2 minutes after the tab stops updating). For a lock across
            different users or PCs, use a Flowgear workflow.
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
            <label className="receipt-hold-toggle">
              <input
                type="checkbox"
                checked={showHoldCodeDetails}
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
                <button
                  type="button"
                  className="receipt-btn receipt-btn-secondary"
                  onClick={() => setShowTargetPayloadView((v) => !v)}
                >
                  {showTargetPayloadView ? "Hide target payload" : "View target payload"}
                </button>
                {decodedSourcePayload != null && (
                  <button
                    type="button"
                    className="receipt-btn receipt-btn-secondary ms-2"
                    onClick={() => setShowSourcePayloadView((v) => !v)}
                  >
                    {showSourcePayloadView ? "Hide source payload" : "View source payload"}
                  </button>
                )}
                {showTargetPayloadView && (
                  <button
                    type="button"
                    className="receipt-btn receipt-btn-secondary ms-2"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(decodedTargetPayload ?? JSON.stringify(payload, null, 2));
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    Copy JSON
                  </button>
                )}
              </div>
              {showTargetPayloadView && (
                <pre className="receipt-debug-payload-json" aria-label="Current record payload">
                  {decodedTargetPayload ?? JSON.stringify(payload, null, 2)}
                </pre>
              )}
              {showSourcePayloadView && decodedSourcePayload != null && (
                <pre className="receipt-debug-payload-json mt-2" aria-label="Current record source payload">
                  {decodedSourcePayload}
                </pre>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function decodePayloadBase64(base64Payload: string | null | undefined): string | null {
  const trimmed = (base64Payload ?? "").trim();
  if (trimmed.length === 0) return null;
  try {
    const decoded = atob(trimmed);
    try {
      return JSON.stringify(JSON.parse(decoded), null, 2);
    } catch {
      return decoded;
    }
  } catch {
    return null;
  }
}
