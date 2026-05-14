import type { OrderListFilters } from "../utils/orderListFilters";

interface OrderFiltersBarProps {
  filters: OrderListFilters;
  onFiltersChange: (next: OrderListFilters) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  loading?: boolean;
  hasActiveFilters: boolean;
  loadedCount: number;
}

export default function OrderFiltersBar({
  filters,
  onFiltersChange,
  onRefresh,
  onClearFilters,
  loading = false,
  hasActiveFilters,
  loadedCount,
}: OrderFiltersBarProps) {
  const patch = (partial: Partial<OrderListFilters>) => onFiltersChange({ ...filters, ...partial });

  return (
    <div className="receipt-main-filters" aria-label="Filter orders">
      <div className="receipt-main-filters-head">
        <span className="receipt-main-filters-title">Search orders</span>
        <span className="receipt-main-filters-count">{loadedCount} loaded</span>
      </div>
      <div className="receipt-main-filters-inner">
        <div className="receipt-main-filter-field">
          <label htmlFor="main-filter-company">Company</label>
          <input
            id="main-filter-company"
            type="search"
            autoComplete="off"
            placeholder="Contains…"
            value={filters.company}
            onChange={(e) => patch({ company: e.target.value })}
          />
        </div>
        <div className="receipt-main-filter-field">
          <label htmlFor="main-filter-probill">Probill</label>
          <input
            id="main-filter-probill"
            type="search"
            autoComplete="off"
            placeholder="Contains…"
            value={filters.probill}
            onChange={(e) => patch({ probill: e.target.value })}
          />
        </div>
        <div className="receipt-main-filter-field">
          <label htmlFor="main-filter-receipt-no">Receipt no.</label>
          <input
            id="main-filter-receipt-no"
            type="search"
            autoComplete="off"
            placeholder="Contains…"
            value={filters.receiptNo}
            onChange={(e) => patch({ receiptNo: e.target.value })}
          />
        </div>
        <div className="receipt-main-filter-field receipt-main-filter-field-date">
          <label htmlFor="main-filter-date-from">From date</label>
          <input
            id="main-filter-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => patch({ dateFrom: e.target.value })}
          />
        </div>
        <div className="receipt-main-filter-field receipt-main-filter-field-date">
          <label htmlFor="main-filter-date-to">To date</label>
          <input
            id="main-filter-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => patch({ dateTo: e.target.value })}
          />
        </div>
        <div className="receipt-main-filters-actions">
          <button
            type="button"
            className="receipt-btn receipt-btn-filter-refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh list"}
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              className="receipt-btn receipt-btn-filter-clear"
              onClick={onClearFilters}
              disabled={loading}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
