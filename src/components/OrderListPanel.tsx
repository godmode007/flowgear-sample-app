import type { ReceiptConfirmationPayload } from "../models/receiptConfirmation";

interface OrderListPanelProps {
  orders: ReceiptConfirmationPayload[];
  selectedIndex: number | null;
  onSelectOrder: (index: number) => void;
  onRefresh: () => void;
  loading?: boolean;
  /** Status from GET /v2/ReceiptNoPrice (e.g. "GET /v2/ReceiptNoPrice → 2 order(s)"). */
  listStatus?: string;
}

function orderLabel(payload: ReceiptConfirmationPayload): string {
  const rc = payload.Receipt_Confirmation;
  return [rc.Inbound_Reference_No, rc.Inbound_Receipt_No, rc.Supplier]
    .filter(Boolean)
    .join(" · ") || "Order";
}

function orderSubtext(payload: ReceiptConfirmationPayload): string {
  const rc = payload.Receipt_Confirmation;
  const lines = rc.Items?.length ?? 0;
  return `${lines} line(s) · ${rc.Probill_Number || "—"}`;
}

export default function OrderListPanel({
  orders,
  selectedIndex,
  onSelectOrder,
  onRefresh,
  loading = false,
  listStatus = "",
}: OrderListPanelProps) {
  return (
    <div className="receipt-orders-panel">
      <div className="receipt-orders-panel-header">
        <span className="receipt-orders-panel-title">Orders</span>
        <button
          type="button"
          className="receipt-btn receipt-btn-secondary receipt-orders-refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {listStatus ? (
        <div className="receipt-orders-list-status" role="status">
          {listStatus.split("\n").map((line: string, i: number) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
      <ul className="receipt-orders-list" role="listbox" aria-label="Orders">
        {orders.length === 0 && !loading && (
          <li className="receipt-orders-empty">No orders. Click Refresh to load.</li>
        )}
        {orders.map((order, index) => (
          <li
            key={`${order.Receipt_Confirmation.Inbound_Reference_No}-${order.Receipt_Confirmation.Inbound_Receipt_No}-${index}`}
            className={`receipt-orders-item ${selectedIndex === index ? "receipt-orders-item-selected" : ""}`}
            role="option"
            aria-selected={selectedIndex === index}
            onClick={() => onSelectOrder(index)}
          >
            <div className="receipt-orders-item-label">{orderLabel(order)}</div>
            <div className="receipt-orders-item-sub">{orderSubtext(order)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
