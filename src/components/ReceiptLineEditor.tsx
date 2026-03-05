import { useMemo } from "react";
import type { ReceiptConfirmationItem } from "../models/receiptConfirmation";

interface ReceiptLineEditorProps {
  item: ReceiptConfirmationItem;
  onOrderPriceChange: (lineNo: string, value: number | null) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function ReceiptLineEditor({
  item,
  onOrderPriceChange,
}: ReceiptLineEditorProps) {
  const netWeight = item.Net_Weight_Shipped;
  const rate = item.Order_Price;

  const rateDisplay = rate != null ? String(round2(rate)) : "";

  const displayTotal = useMemo(() => {
    if (rate != null && netWeight > 0) return round2(rate * netWeight);
    return null;
  }, [rate, netWeight]);

  function handleRateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.trim();
    if (v === "") {
      onOrderPriceChange(item.Line_No, null);
      return;
    }
    const r = parseFloat(v);
    if (!Number.isNaN(r)) {
      onOrderPriceChange(item.Line_No, round2(r));
    }
  }

  const invL3 = item.Inventory_Level3 ?? item.Line_Stock_Details?.[0]?.To_Inventory_L3 ?? "";
  const description = item.Item_Description ?? "";

  return (
    <tr className="receipt-tr">
      <td className="receipt-td receipt-td-line text-align-left">{item.Line_No}</td>
      <td className="receipt-td receipt-td-item text-align-left">{item.Item_Code}</td>
      <td className="receipt-td receipt-td-desc text-align-left">{description}</td>
      <td className="receipt-td receipt-td-inv text-align-left">{invL3}</td>
      <td className="receipt-td receipt-td-num text-align-right">{item.Quantity}</td>
      <td className="receipt-td receipt-td-num text-align-right">{netWeight}</td>
      <td className="receipt-td receipt-td-rate text-align-right">
        <input
          type="number"
          step="any"
          min="0"
          className="receipt-input-price"
          placeholder="0.00"
          value={rateDisplay}
          onChange={handleRateChange}
          aria-label={`Rate per KG for line ${item.Line_No}`}
        />
      </td>
      <td className="receipt-td receipt-td-price text-align-right receipt-td-calculated">
        {displayTotal != null ? displayTotal.toFixed(2) : "—"}
      </td>
    </tr>
  );
}
