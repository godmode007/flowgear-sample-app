import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";

const TOUR_COMPLETED_KEY = "cch-receipt-tour-v1";
const TOUR_PADDING = 6; // px around highlighted element

/**
 * Module-level flag — fastest in-memory check. Resets only when the iframe is
 * fully reloaded (new JS context). Combined with storage below this prevents
 * the tour showing more than once per iframe session even if storage is blocked.
 */
let _tourSeenThisSession = false;

/** Returns true if at least one storage mechanism is available. */
export function isStorageAvailable(): boolean {
  try { localStorage.setItem("__fg_test", "1"); localStorage.removeItem("__fg_test"); return true; } catch { /* */ }
  try { sessionStorage.setItem("__fg_test", "1"); sessionStorage.removeItem("__fg_test"); return true; } catch { /* */ }
  return false;
}

function tryWrite(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { /* */ }
  try { sessionStorage.setItem(key, value); return true; } catch { /* */ }
  return false;
}

function tryRead(key: string): string | null {
  try { const v = localStorage.getItem(key); if (v != null) return v; } catch { /* */ }
  try { const v = sessionStorage.getItem(key); if (v != null) return v; } catch { /* */ }
  return null;
}

export function isTourCompleted(): boolean {
  if (_tourSeenThisSession) return true;
  return tryRead(TOUR_COMPLETED_KEY) === "1";
}

function markTourCompleted(): void {
  _tourSeenThisSession = true;
  tryWrite(TOUR_COMPLETED_KEY, "1");
}

export function resetTour(): void {
  _tourSeenThisSession = false;
  try { localStorage.removeItem(TOUR_COMPLETED_KEY); } catch { /* */ }
  try { sessionStorage.removeItem(TOUR_COMPLETED_KEY); } catch { /* */ }
}

type Placement = "center" | "right" | "bottom" | "top" | "left";

interface TourStep {
  id: string;
  /** data-tour attribute value to highlight, or null for centred modal. */
  target: string | null;
  title: string;
  content: string;
  placement: Placement;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    placement: "center",
    title: "Welcome to Receipt Confirmation",
    content:
      "This app lets you capture pricing for inbound receipts from Flowgear and post them to your ERP. This short tour walks you through every section — it only takes a minute.",
  },
  {
    id: "orders-panel",
    target: "orders-count",
    placement: "right",
    title: "Orders List & Count",
    content:
      "All pending receipt confirmations loaded from Flowgear appear here. The badge shows how many orders are visible (e.g. 16 / 45 means 16 match your filters out of 45 total). Each row shows the date, reference / receipt number, supplier, company, and probill. Rows are colour-coded by capture progress: amber = Edited (rates saved, not yet fully priced or posted — shows who last edited it), green = Ready to Post (all lines priced). Click any row to open it in the editor.",
  },
  {
    id: "orders-date-sort",
    target: "orders-date-sort",
    placement: "right",
    title: "Date Sort",
    content:
      "Click the Date column header to toggle between oldest-first (▲) and newest-first (▼) ordering of receipts.",
  },
  {
    id: "orders-current-user",
    target: "orders-current-user",
    placement: "right",
    title: "Current User (Lock Indicator)",
    content:
      "Shows who currently holds the edit lock on each receipt. If another user's name appears here, that receipt is locked — you will not be able to edit rates or post until they release it or the lock expires. The lock is automatically released as soon as you navigate to a different order, so you never need to manually unlock a record.",
  },
  {
    id: "filters-bar",
    target: "filters-bar",
    placement: "bottom",
    title: "Search & Filter Orders",
    content:
      "Filter the orders list in real time by Company, Probill number, Receipt number, or date range. Use the Current User picker to show only receipts locked to a specific user. Note: all records are always loaded from Flowgear on Refresh — the filters (including date range) simply shorten what you see in the list without reloading data.",
  },
  {
    id: "filters-refresh",
    target: "filters-refresh",
    placement: "bottom",
    title: "Refresh List",
    content:
      "Fetches the latest pending receipts from the Flowgear workflow. Always click Refresh at the start of a session, or whenever you expect new receipts to have arrived.",
  },
  {
    id: "receipt-header",
    target: "receipt-header",
    placement: "bottom",
    title: "Receipt Header",
    content:
      "Shows key identifiers for the selected receipt: Company, Receipt number, Supplier, Order type, Probill, and Reference number. These are read-only — they come directly from the Flowgear workflow.",
  },
  {
    id: "receipt-table",
    target: "receipt-table",
    placement: "top",
    title: "Receipt Line Items",
    content:
      "Each row is a stock item on this receipt. You can see the Item code, Description, Pack Size / Lot, Quantity, Net weight (kg), and Unit of Measure (UOM). Lines with identical Item + Lot are grouped together automatically.",
  },
  {
    id: "hold-code-toggle",
    target: "hold-code-toggle",
    placement: "top",
    title: "Show Hold Code Details",
    content:
      "This checkbox only becomes active when at least one stock item + lot combination on the receipt has more than one hold code. When enabled, ticking it splits the table rows by hold code so you can review quantities per hold status. Important: rates are read-only in this view — hold code does not drive pricing. To enter or edit rates, turn this off. Price is captured per item and lot, not per hold code.",
  },
  {
    id: "receipt-rate-th",
    target: "receipt-rate-th",
    placement: "top",
    title: "Rate (R/UOM) — The Key Field",
    content:
      "Enter the price per unit in the Rate column for every line. The calculation depends on the UOM: for KG items, Order Price = Net weight × Rate. For all other UOMs, Order Price = Quantity × Rate. Every line must have a valid rate (greater than 0) before you can post.",
  },
  {
    id: "post-btn",
    target: "post-btn",
    placement: "top",
    title: "Post to ERP",
    content:
      'Once all lines have a valid rate, click Post to ERP to submit the receipt confirmation. You will be asked to type "Y" to confirm. The button stays disabled until all rates are filled in. Posting can take up to a minute while the Flowgear workflow runs.',
  },
];

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  transform?: string;
}

function computeTooltipStyle(
  rect: HighlightRect | null,
  placement: Placement,
  tooltipW: number,
  tooltipH: number
): TooltipPosition {
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (rect == null || placement === "center") {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const { top, left, width, height } = rect;

  if (placement === "right") {
    const ttLeft = left + width + margin;
    const ttTop = Math.min(
      Math.max(margin, top + height / 2 - tooltipH / 2),
      vh - tooltipH - margin
    );
    if (ttLeft + tooltipW < vw - margin) {
      return { top: ttTop, left: ttLeft };
    }
    // fallback: left of element
    return {
      top: ttTop,
      left: Math.max(margin, left - tooltipW - margin),
    };
  }

  if (placement === "left") {
    const ttLeft = Math.max(margin, left - tooltipW - margin);
    const ttTop = Math.min(
      Math.max(margin, top + height / 2 - tooltipH / 2),
      vh - tooltipH - margin
    );
    return { top: ttTop, left: ttLeft };
  }

  if (placement === "bottom") {
    const ttTop = top + height + margin;
    const ttLeft = Math.min(
      Math.max(margin, left + width / 2 - tooltipW / 2),
      vw - tooltipW - margin
    );
    if (ttTop + tooltipH < vh - margin) {
      return { top: ttTop, left: ttLeft };
    }
    // fallback: above
    return {
      top: Math.max(margin, top - tooltipH - margin),
      left: ttLeft,
    };
  }

  // top
  const ttTop = Math.max(margin, top - tooltipH - margin);
  const ttLeft = Math.min(
    Math.max(margin, left + width / 2 - tooltipW / 2),
    vw - tooltipW - margin
  );
  return { top: ttTop, left: ttLeft };
}

interface TourOverlayProps {
  onClose: () => void;
}

export default function TourOverlay({ onClose }: TourOverlayProps) {
  // Mark as seen immediately on mount — prevents re-showing if the user
  // navigates away without explicitly closing the tour.
  useEffect(() => {
    markTourCompleted();
  }, []);

  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 340, h: 200 });

  const currentStep = TOUR_STEPS[step]!;
  const isLast = step === TOUR_STEPS.length - 1;

  const measureTarget = useCallback((target: string | null) => {
    if (target == null) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (el == null) {
      setRect(null);
      return;
    }
    // Scroll into view so it's visible
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  useLayoutEffect(() => {
    measureTarget(currentStep.target);
  }, [step, currentStep.target, measureTarget]);

  // Re-measure on resize / scroll
  useEffect(() => {
    const handler = () => measureTarget(currentStep.target);
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [currentStep.target, measureTarget]);

  // Track tooltip dimensions for positioning
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const { offsetWidth, offsetHeight } = tooltipRef.current;
      setTooltipSize({ w: offsetWidth || 340, h: offsetHeight || 200 });
    }
  }, [step, rect]);

  const handleClose = useCallback(() => {
    markTourCompleted();
    onClose();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (isLast) {
      handleClose();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, handleClose]);

  const handlePrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowRight" || e.key === "Enter") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, handleNext, handlePrev]);

  const highlightStyle: React.CSSProperties =
    rect != null
      ? {
          top: rect.top - TOUR_PADDING,
          left: rect.left - TOUR_PADDING,
          width: rect.width + TOUR_PADDING * 2,
          height: rect.height + TOUR_PADDING * 2,
        }
      : {
          top: "50%",
          left: "50%",
          width: 0,
          height: 0,
          transform: "translate(-50%, -50%)",
        };

  const tooltipStyle = computeTooltipStyle(
    rect,
    currentStep.placement,
    tooltipSize.w,
    tooltipSize.h
  );

  return (
    <>
      {/* Dark overlay — clicking backdrop closes tour */}
      <div className="tour-backdrop" onClick={handleClose} />

      {/* Spotlight highlight box (box-shadow creates the dark surround) */}
      <div className="tour-spotlight" style={highlightStyle} />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        style={{ position: "fixed", zIndex: 10002, ...tooltipStyle }}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${step + 1}: ${currentStep.title}`}
      >
        <div className="tour-tooltip-header">
          <span className="tour-step-indicator">
            {step + 1} / {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            className="tour-close-btn"
            onClick={handleClose}
            aria-label="Close tour"
          >
            ✕
          </button>
        </div>

        <h3 className="tour-title">{currentStep.title}</h3>
        <p className="tour-content">{currentStep.content}</p>

        <div className="tour-nav">
          {step > 0 ? (
            <button type="button" className="tour-btn tour-btn-secondary" onClick={handlePrev}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="tour-btn tour-btn-primary"
            onClick={handleNext}
            autoFocus
          >
            {isLast ? "Done ✓" : "Next →"}
          </button>
        </div>

        {step === 0 && (
          <button type="button" className="tour-skip-link" onClick={handleClose}>
            Skip tour
          </button>
        )}
      </div>
    </>
  );
}
