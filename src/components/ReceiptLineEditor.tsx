import { useState, useEffect, useMemo, useRef } from "react";

interface ReceiptLineEditorProps {
  rowKey: string;
  lineLabel: string;
  itemCode: string;
  description: string;
  inventoryDisplay: string;
  quantity: number;
  netWeight: number;
  uom: string;
  holdCode?: string;
  rate: number | null;
  rateReadOnly?: boolean;
  rateIsAveraged?: boolean;
  isWeightBased: boolean;
  onOrderPriceChange: (value: number | null) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatRateFromNumber(rate: number | null): string {
  if (rate == null) return "";
  return String(round2(rate));
}

/** Allows in-progress decimals like "24.01" without forcing round2 on each keystroke. */
function tryParseRateDraft(draft: string): number | null {
  const v = draft.trim().replace(",", ".");
  if (v === "" || v === "." || v === "-") return null;
  const r = parseFloat(v);
  return Number.isNaN(r) ? null : r;
}

export default function ReceiptLineEditor({
  rowKey,
  lineLabel,
  itemCode,
  description,
  inventoryDisplay,
  quantity,
  netWeight,
  uom,
  holdCode,
  rate,
  rateReadOnly = false,
  rateIsAveraged = false,
  isWeightBased,
  onOrderPriceChange,
}: ReceiptLineEditorProps) {
  const [draft, setDraft] = useState(() => formatRateFromNumber(rate));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(formatRateFromNumber(rate));
    }
  }, [rate, rowKey]);

  const displayTotal = useMemo(() => {
    const fromDraft = tryParseRateDraft(draft);
    const eff = fromDraft ?? rate;
    if (eff == null) return null;
    if (isWeightBased) return round2(eff * netWeight);
    return round2(eff * quantity);
  }, [draft, rate, isWeightBased, netWeight, quantity]);

  function commitDraft() {
    const v = draft.trim().replace(",", ".");
    if (v === "" || v === "." || v === "-") {
      onOrderPriceChange(null);
      setDraft("");
      return;
    }
    const r = parseFloat(v);
    if (Number.isNaN(r)) {
      setDraft(formatRateFromNumber(rate));
      return;
    }
    const rounded = round2(r);
    onOrderPriceChange(rounded);
    setDraft(String(rounded));
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
  }

  return (
    <tr className="receipt-tr" key={rowKey}>
      <td className="receipt-td receipt-td-line text-align-left">{lineLabel}</td>
      <td className="receipt-td receipt-td-item text-align-left">{itemCode}</td>
      <td className="receipt-td receipt-td-desc text-align-left">{description}</td>
      <td className="receipt-td receipt-td-inv text-align-left">{inventoryDisplay}</td>
      {holdCode !== undefined && (
        <td className="receipt-td receipt-td-hold text-align-left">{holdCode || "—"}</td>
      )}
      <td className="receipt-td receipt-td-num text-align-right">{quantity}</td>
      <td className="receipt-td receipt-td-num text-align-right">{netWeight}</td>
      <td className="receipt-td receipt-td-uom text-align-left">{uom}</td>
      <td className="receipt-td receipt-td-rate text-align-right">
        {rateReadOnly ? (
          <span
            className="receipt-rate-readonly"
            title="Another tab may be editing this receipt. Close it or wait for the lock to clear."
          >
            {rate != null ? formatRateFromNumber(rate) : "—"}
            {rateIsAveraged ? <span className="receipt-rate-asterisk"> *</span> : null}
          </span>
        ) : (
          <span
            className={`receipt-rate-input-wrap${rateIsAveraged ? " receipt-rate-input-wrap-averaged" : ""}`}
            title={rateIsAveraged ? "Average of line prices captured" : undefined}
          >
            {rateIsAveraged ? (
              <span className="receipt-rate-asterisk" aria-hidden>
                *
              </span>
            ) : null}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={`receipt-input-price${rateIsAveraged ? " receipt-input-price-averaged" : ""}`}
              placeholder="0.00"
              value={draft}
              onChange={handleDraftChange}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={() => {
                focusedRef.current = false;
                commitDraft();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label={`Rate (R per UOM) for line ${lineLabel}`}
            />
          </span>
        )}
      </td>
      <td className="receipt-td receipt-td-price text-align-right receipt-td-calculated">
        {displayTotal != null ? displayTotal.toFixed(2) : "—"}
      </td>
    </tr>
  );
}
