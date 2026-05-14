import { useMemo } from "react";

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
  isWeightBased: boolean;
  onOrderPriceChange: (value: number | null) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  isWeightBased,
  onOrderPriceChange,
}: ReceiptLineEditorProps) {
  const rateDisplay = rate != null ? String(round2(rate)) : "";

  const displayTotal = useMemo(() => {
    if (rate == null) return null;
    if (isWeightBased) return round2(rate * netWeight);
    return round2(rate * quantity);
  }, [rate, isWeightBased, netWeight, quantity]);

  function handleRateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.trim();
    if (v === "") {
      onOrderPriceChange(null);
      return;
    }
    const r = parseFloat(v);
    if (!Number.isNaN(r)) {
      onOrderPriceChange(round2(r));
    }
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
            {rateDisplay || "—"}
          </span>
        ) : (
          <input
            type="number"
            step="any"
            min="0.01"
            className="receipt-input-price"
            placeholder="0.00"
            value={rateDisplay}
            onChange={handleRateChange}
            aria-label={`Rate (R per UOM) for line ${lineLabel}`}
          />
        )}
      </td>
      <td className="receipt-td receipt-td-price text-align-right receipt-td-calculated">
        {displayTotal != null ? displayTotal.toFixed(2) : "—"}
      </td>
    </tr>
  );
}
