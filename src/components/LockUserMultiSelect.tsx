import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { LOCK_USER_FILTER_MINE } from "../utils/orderListFilters";

export interface LockUserMultiSelectOption {
  value: string;
  label: string;
}

interface LockUserMultiSelectProps {
  options: LockUserMultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export default function LockUserMultiSelect({
  options,
  selected,
  onChange,
  disabled = false,
}: LockUserMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      m.set(o.value, o.label);
    }
    return m;
  }, [options]);

  const summary = useMemo(() => {
    const n = selected.length;
    if (n === 0) return "All users";
    if (n === 1) return labelByValue.get(selected[0]!) ?? selected[0]!;
    return `${n} selected`;
  }, [selected, labelByValue]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(ev: MouseEvent) {
      const el = rootRef.current;
      if (el != null && ev.target instanceof Node && !el.contains(ev.target)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const toggle = useCallback(
    (value: string) => {
      const set = new Set(selected);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      onChange([...set]);
    },
    [selected, onChange]
  );

  const clearUserFilter = useCallback(() => {
    onChange([]);
    setSearch("");
  }, [onChange]);

  return (
    <div className="receipt-lock-user-ms" ref={rootRef}>
      <span className="receipt-main-filter-field receipt-lock-user-ms-field">
        <span id="lock-user-ms-label" className="receipt-lock-user-ms-static-label">
          Current user
        </span>
        <button
          type="button"
          className="receipt-lock-user-ms-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="lock-user-ms-label"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
            if (open) setSearch("");
          }}
        >
          <span className="receipt-lock-user-ms-trigger-text">{summary}</span>
          <span className="receipt-lock-user-ms-chevron" aria-hidden>
            ▾
          </span>
        </button>
      </span>

      {open ? (
        <div className="receipt-lock-user-ms-panel" role="listbox" aria-multiselectable="true">
          <input
            type="search"
            className="receipt-lock-user-ms-search"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            aria-label="Search current users"
          />
          <div className="receipt-lock-user-ms-list">
            {filteredOptions.length === 0 ? (
              <div className="receipt-lock-user-ms-empty">No matches.</div>
            ) : (
              filteredOptions.map((o) => {
                const isMine = o.value === LOCK_USER_FILTER_MINE;
                return (
                  <label
                    key={o.value}
                    className={`receipt-lock-user-ms-option${isMine ? " receipt-lock-user-ms-option-mine" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(o.value)}
                      onChange={() => toggle(o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="receipt-lock-user-ms-footer">
            <button type="button" className="receipt-lock-user-ms-clear" onClick={clearUserFilter}>
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
