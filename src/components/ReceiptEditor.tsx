import { useState, useCallback, useEffect, useMemo } from "react";
import { Flowgear } from "flowgear-webapp";

const { AlertMessageTypes, AlertDismissOptions } = Flowgear.Sdk;
import type { ReceiptConfirmationPayload, ReceiptConfirmationItem } from "../models/receiptConfirmation";
import { hasMissingOrderPrice, isZeroOutLine } from "../models/receiptConfirmation";
import { postToErp, isStandaloneMode } from "../services/payloadService";
import ReceiptLineEditor from "./ReceiptLineEditor";

const MAX_STATUS_LINES = 25;
const isDev = import.meta.env.DEV;

interface ReceiptEditorProps {
  initialPayload: ReceiptConfirmationPayload | null;
  onRefresh?: () => void;
  onPostSuccess?: () => void;
}

export default function ReceiptEditor({
  initialPayload,
  onRefresh,
  onPostSuccess,
}: ReceiptEditorProps) {
  const [payload, setPayload] = useState<ReceiptConfirmationPayload | null>(
    initialPayload
  );
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showPayloadView, setShowPayloadView] = useState(false);

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

  const updateOrderPrice = useCallback(
    (lineNo: string, value: number | null) => {
      if (payload == null) return;
      setPayload({
        ...payload,
        Receipt_Confirmation: {
          ...payload.Receipt_Confirmation,
          Items: payload.Receipt_Confirmation.Items.map((item) =>
            item.Line_No === lineNo ? { ...item, Order_Price: value } : item
          ),
        },
      });
      setError(null);
    },
    [payload]
  );

  async function handlePost() {
    if (payload == null) return;
    const itemsToValidate = payload.Receipt_Confirmation.Items ?? [];
    const missing = itemsToValidate.filter(
      (i) => !isZeroOutLine(i) && i.Order_Price == null
    );
    if (missing.length > 0) {
      setError(
        `Please set Rate (R/kg) for line(s): ${missing.map((i) => i.Line_No).join(", ")}.`
      );
      Flowgear.Sdk.setAlert(
        `Rate (R/kg) is required for all lines. Missing: ${missing.map((i) => i.Line_No).join(", ")}.`,
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
        Flowgear.Sdk.setAlert(
          "Receipt confirmation posted to ERP.",
          AlertMessageTypes.Success,
          AlertDismissOptions.Auto
        );
        onPostSuccess?.();
        setPayload(null);
        onRefresh?.();
      } else {
        const msg =
          result.body != null && typeof result.body === "object" && "message" in result.body
            ? String((result.body as { message: string }).message)
            : result.statusCode ?? "Post failed";
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

  if (payload == null) {
    return (
      <div className="app-contentarea">
        <p className="text-muted">
          No receipt confirmation to edit. Load a payload from your workflow or
          use sample data when a GET endpoint is configured.
        </p>
        {onRefresh != null && (
          <button
            type="button"
            className="receipt-btn receipt-btn-secondary"
            onClick={onRefresh}
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  const rc = payload.Receipt_Confirmation;
  const items = rc.Items ?? [];
  const visibleItems = useMemo(
    () => items.filter((item) => !isZeroOutLine(item)),
    [items]
  );
  const needsPrice = hasMissingOrderPrice(payload);

  const { totalQty, totalWeight, totalOrderPrice } = useMemo(() => {
    let qty = 0;
    let weight = 0;
    let orderPrice = 0;
    for (const item of visibleItems) {
      qty += item.Quantity;
      weight += item.Net_Weight_Shipped;
      if (item.Order_Price != null && item.Net_Weight_Shipped > 0) {
        orderPrice += item.Order_Price * item.Net_Weight_Shipped;
      }
    }
    return {
      totalQty: qty,
      totalWeight: weight,
      totalOrderPrice: Math.round(orderPrice * 100) / 100,
    };
  }, [visibleItems]);

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
              <span><strong>Receipt</strong> {rc.Inbound_Receipt_No}</span>
              <span><strong>Supplier</strong> {rc.Supplier}</span>
              <span><strong>Order type</strong> {rc.Order_Type}</span>
              <span><strong>Probill</strong> {rc.Probill_Number}</span>
              <span><strong>Reference</strong> {rc.Inbound_Reference_No}</span>
            </div>
          </div>
        </header>

        {needsPrice && (
          <div className="alert alert-warning receipt-sheet-alert" role="alert">
            Enter a rate (R/kg) for every line; order price is calculated from Net weight × Rate.
          </div>
        )}

        {error != null && (
          <div className="alert alert-danger receipt-sheet-alert" role="alert">
            {error}
          </div>
        )}

        <div className="receipt-table-wrap">
          <table className="table receipt-table">
            <thead>
              <tr>
                <th className="receipt-th receipt-th-line">Line</th>
                <th className="receipt-th receipt-th-item">Item code</th>
                <th className="receipt-th receipt-th-desc">Description</th>
                <th className="receipt-th receipt-th-inv">Pack Size / Lot</th>
                <th className="receipt-th receipt-th-num">Qty</th>
                <th className="receipt-th receipt-th-num">Net weight (kg)</th>
                <th className="receipt-th receipt-th-rate">Rate (R/kg)</th>
                <th className="receipt-th receipt-th-price">Order price</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item: ReceiptConfirmationItem) => (
                <ReceiptLineEditor
                  key={item.Line_No}
                  item={item}
                  onOrderPriceChange={updateOrderPrice}
                />
              ))}
              <tr className="receipt-tr receipt-tr-total">
                <td className="receipt-td receipt-td-line text-align-right" colSpan={4}>
                  <strong>Total</strong>
                </td>
                <td className="receipt-td receipt-td-num text-align-right">{totalQty}</td>
                <td className="receipt-td receipt-td-num text-align-right">{totalWeight.toFixed(2)}</td>
                <td className="receipt-td receipt-td-rate text-align-right">—</td>
                <td className="receipt-td receipt-td-price text-align-right receipt-td-calculated">
                  {totalOrderPrice.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="receipt-sheet-powered" aria-hidden="true">
          <span>Powered by</span>
          <img src={`${import.meta.env.BASE_URL}inhance_logo.png`} alt="Inhance" />
        </div>

        <footer className="receipt-sheet-footer">
          <div className="receipt-sheet-actions">
            <button
              type="button"
              className="receipt-btn receipt-btn-primary"
              onClick={handlePost}
              disabled={posting || needsPrice}
            >
              {posting ? "Posting…" : "Post to ERP"}
            </button>
            {posting && (
              <span className="receipt-posting-hint text-muted ms-2 align-self-center">
                This can take a minute while the workflow runs.
              </span>
            )}
            {onRefresh != null && (
              <button
                type="button"
                className="receipt-btn receipt-btn-secondary"
                onClick={onRefresh}
                disabled={posting}
              >
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
                  onClick={() => setShowPayloadView((v) => !v)}
                >
                  {showPayloadView ? "Hide payload" : "View payload"}
                </button>
                {showPayloadView && (
                  <button
                    type="button"
                    className="receipt-btn receipt-btn-secondary ms-2"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    Copy JSON
                  </button>
                )}
              </div>
              {showPayloadView && (
                <pre className="receipt-debug-payload-json" aria-label="Current record payload">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
