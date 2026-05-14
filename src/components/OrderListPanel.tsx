import type { ReceiptOrderListEntry } from "../models/receiptConfirmation";
import { getReceiptLockRecordId } from "../models/receiptConfirmation";

interface OrderListPanelProps {
  /** Already filtered list */
  orders: ReceiptOrderListEntry[];
  totalLoadedCount: number;
  selectedIndex: number | null;
  onSelectOrder: (index: number | null) => void;
  onClearFilters: () => void;
  loading?: boolean;
  listStatus?: string;
  /** Optimistic lock holder from client lock API (merged with workflow `currentLockUser`). */
  lockUserOverrideByRecordId: Record<string, string>;
}

function orderLabel(entry: ReceiptOrderListEntry): string {
  const rc = entry.payload.Receipt_Confirmation;
  return [rc.Inbound_Reference_No, rc.Inbound_Receipt_No, rc.Supplier].filter(Boolean).join(" · ") || "Order";
}

function orderSubtext(entry: ReceiptOrderListEntry): string {
  const rc = entry.payload.Receipt_Confirmation;
  const lines = rc.Items?.length ?? 0;
  return `${rc.Company || "—"} · ${lines} line(s) · ${rc.Probill_Number || "—"}`;
}

export default function OrderListPanel({
  orders,
  totalLoadedCount,
  selectedIndex,
  onSelectOrder,
  onClearFilters,
  loading = false,
  listStatus = "",
  lockUserOverrideByRecordId,
}: OrderListPanelProps) {
  return (
    <div className="receipt-orders-panel">
      <div className="receipt-orders-panel-header">
        <span className="receipt-orders-panel-title">Orders</span>
        <span className="receipt-orders-panel-badge" title="Rows returned from workflow">
          {orders.length}
          {orders.length !== totalLoadedCount ? ` / ${totalLoadedCount}` : ""}
        </span>
      </div>
      {listStatus ? (
        <div className="receipt-orders-list-status" role="status">
          {listStatus.split("\n").map((line: string, i: number) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
      {totalLoadedCount > 0 && orders.length > 0 ? (
        <div className="receipt-orders-list-head" aria-hidden>
          <span>Order</span>
          <span>Current user</span>
        </div>
      ) : null}
      <ul className="receipt-orders-list" role="listbox" aria-label="Orders">
        {totalLoadedCount === 0 && !loading && (
          <li className="receipt-orders-empty">No orders. Use Refresh list in the main panel.</li>
        )}
        {totalLoadedCount > 0 && orders.length === 0 && !loading && (
          <li className="receipt-orders-empty">
            No orders match the filters.{" "}
            <button type="button" className="receipt-btn receipt-btn-secondary ms-2" onClick={onClearFilters}>
              Show all
            </button>
          </li>
        )}
        {orders.map((order, index) => {
          const rid = getReceiptLockRecordId(order);
          const fromList = (order.currentLockUser ?? "").trim();
          const fromOverride = (lockUserOverrideByRecordId[rid] ?? "").trim();
          const displayUser = fromList || fromOverride || "—";
          return (
            <li
              key={rid}
              className={`receipt-orders-item ${selectedIndex === index ? "receipt-orders-item-selected" : ""}`}
              role="option"
              aria-selected={selectedIndex === index}
              onClick={() => onSelectOrder(index)}
            >
              <div className="receipt-orders-item-cols">
                <div className="receipt-orders-item-main">
                  <div className="receipt-orders-item-label">{orderLabel(order)}</div>
                  <div className="receipt-orders-item-sub">{orderSubtext(order)}</div>
                </div>
                <div className="receipt-orders-item-user" title={displayUser !== "—" ? displayUser : undefined}>
                  {displayUser}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
