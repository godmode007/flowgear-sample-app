import { useCallback, useEffect, useRef } from "react";
import type { PayloadDiffSideRow } from "../utils/payloadLineDiff";

interface PayloadDiffComparePanesProps {
  rows: PayloadDiffSideRow[];
  targetPayloadText: string;
  sourcePayloadText: string;
}

function copyPayloadText(text: string): void {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

/**
 * Two independently scrollable columns with scroll position kept in sync (vertical and horizontal)
 * so target and source stay aligned while comparing.
 */
export default function PayloadDiffComparePanes({
  rows,
  targetPayloadText,
  sourcePayloadText,
}: PayloadDiffComparePanesProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncLockRef = useRef(false);

  useEffect(() => {
    const l = leftRef.current;
    const r = rightRef.current;
    if (l != null) {
      l.scrollTop = 0;
      l.scrollLeft = 0;
    }
    if (r != null) {
      r.scrollTop = 0;
      r.scrollLeft = 0;
    }
  }, [rows]);

  const syncScroll = useCallback((source: "left" | "right") => {
    if (syncLockRef.current) return;
    const l = leftRef.current;
    const r = rightRef.current;
    if (l == null || r == null) return;
    const from = source === "left" ? l : r;
    const to = source === "left" ? r : l;
    if (to.scrollTop === from.scrollTop && to.scrollLeft === from.scrollLeft) return;
    syncLockRef.current = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    queueMicrotask(() => {
      syncLockRef.current = false;
    });
  }, []);

  return (
    <>
      <div className="receipt-debug-diff-head">
        <div className="receipt-debug-diff-head-cell">
          <span className="receipt-debug-diff-head-title">Target payload</span>
          <button
            type="button"
            className="receipt-btn receipt-btn-secondary receipt-debug-diff-copy-btn"
            aria-label="Copy target payload JSON to clipboard"
            onClick={() => copyPayloadText(targetPayloadText)}
          >
            Copy target JSON
          </button>
        </div>
        <div className="receipt-debug-diff-head-cell">
          <span className="receipt-debug-diff-head-title">Source payload</span>
          <button
            type="button"
            className="receipt-btn receipt-btn-secondary receipt-debug-diff-copy-btn"
            aria-label="Copy source payload JSON to clipboard"
            onClick={() => copyPayloadText(sourcePayloadText)}
          >
            Copy source JSON
          </button>
        </div>
      </div>
      <div className="receipt-debug-diff-panes">
        <div
          ref={leftRef}
          className="receipt-debug-diff-scroll receipt-debug-diff-scroll--left"
          onScroll={() => syncScroll("left")}
        >
          {rows.map((row, i) => (
            <pre
              key={i}
              className={`receipt-debug-diff-line receipt-debug-diff-cell--${row.leftKind}`}
            >
              {row.left.length > 0 ? row.left : "\u00a0"}
            </pre>
          ))}
        </div>
        <div
          ref={rightRef}
          className="receipt-debug-diff-scroll receipt-debug-diff-scroll--right"
          onScroll={() => syncScroll("right")}
        >
          {rows.map((row, i) => (
            <pre
              key={i}
              className={`receipt-debug-diff-line receipt-debug-diff-cell--${row.rightKind}`}
            >
              {row.right.length > 0 ? row.right : "\u00a0"}
            </pre>
          ))}
        </div>
      </div>
    </>
  );
}
