import { useState, useMemo, useEffect } from "react";
import type { ReceiptOrderListEntry } from "../models/receiptConfirmation";

interface OrderListPanelProps {
  orders: ReceiptOrderListEntry[];
  selectedIndex: number | null;
  onSelectOrder: (index: number | null) => void;
  onRefresh: () => void;
  loading?: boolean;
  listStatus?: string;
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
  selectedIndex,
  onSelectOrder,
  onRefresh,
  loading = false,
  listStatus = "",
}: OrderListPanelProps) {
  const [filterCompany, setFilterCompany] = useState("");
  const [filterProbill, setFilterProbill] = useState("");
  const [filterReceiptNo, setFilterReceiptNo] = useState("");
  const hasActiveFilters =
    filterCompany.trim().length > 0 || filterProbill.trim().length > 0 || filterReceiptNo.trim().length > 0;

  const clearFilters = () => {
    setFilterCompany("");
    setFilterProbill("");
    setFilterReceiptNo("");
  };

  const filteredEntries = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const fc = norm(filterCompany);
    const fp = norm(filterProbill);
    const fr = norm(filterReceiptNo);
    return orders
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => {
        const rc = order.payload.Receipt_Confirmation;
        if (fc && !(rc.Company ?? "").toLowerCase().includes(fc)) return false;
        if (fp && !(rc.Probill_Number ?? "").toLowerCase().includes(fp)) return false;
        if (fr && !(rc.Inbound_Receipt_No ?? "").toLowerCase().includes(fr)) return false;
        return true;
      });
  }, [orders, filterCompany, filterProbill, filterReceiptNo]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      if (selectedIndex !== null) onSelectOrder(null);
      return;
    }
    const stillVisible = filteredEntries.some((e) => e.index === selectedIndex);
    if (!stillVisible) {
      onSelectOrder(filteredEntries[0].index);
    }
  }, [filteredEntries, selectedIndex, onSelectOrder]);

  return (
    <div className="receipt-orders-panel">
      <div className="receipt-orders-panel-header">
        <span className="receipt-orders-panel-title">Orders</span>
        <button
          type="button"
          className="receipt-btn receipt-btn-secondary receipt-orders-refresh"
          onClick={() => {
            clearFilters();
            onRefresh();
          }}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            className="receipt-btn receipt-btn-secondary ms-2"
            onClick={clearFilters}
            disabled={loading}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="receipt-orders-filters" aria-label="Filter orders">
        <div className="receipt-orders-filter-field">
          <label htmlFor="receipt-filter-company">Company</label>
          <input
            id="receipt-filter-company"
            type="search"
            autoComplete="off"
            placeholder="Filter…"
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
          />
        </div>
        <div className="receipt-orders-filter-field">
          <label htmlFor="receipt-filter-probill">Probill</label>
          <input
            id="receipt-filter-probill"
            type="search"
            autoComplete="off"
            placeholder="Filter…"
            value={filterProbill}
            onChange={(e) => setFilterProbill(e.target.value)}
          />
        </div>
        <div className="receipt-orders-filter-field">
          <label htmlFor="receipt-filter-receipt-no">Receipt no.</label>
          <input
            id="receipt-filter-receipt-no"
            type="search"
            autoComplete="off"
            placeholder="Filter…"
            value={filterReceiptNo}
            onChange={(e) => setFilterReceiptNo(e.target.value)}
          />
        </div>
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
        {orders.length > 0 && filteredEntries.length === 0 && !loading && (
          <li className="receipt-orders-empty">
            No orders match the filters.{" "}
            <button type="button" className="receipt-btn receipt-btn-secondary ms-2" onClick={clearFilters}>
              Show all
            </button>
          </li>
        )}
        {filteredEntries.map(({ order, index }) => (
          <li
            key={`${order.payload.Receipt_Confirmation.Inbound_Reference_No}-${order.payload.Receipt_Confirmation.Inbound_Receipt_No}-${index}`}
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
