import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReceiptOrderListEntry, ReceiptConfirmationPayload } from "../models/receiptConfirmation";
import { normalizePayloadOrderPriceToRate, getReceiptLockRecordId } from "../models/receiptConfirmation";
import {
  getOrdersList,
  AuthError,
  ConnectionError,
  isEmbeddedInConsole,
  setReceiptNoPriceLock,
  getReceiptLockDashboardId,
  getReceiptLockUsernameForRequest,
} from "../services/payloadService";
import {
  tryAcquireReceiptLock,
  releaseReceiptLock,
  isReceiptLockHeldByOther,
  receiptLockStorageKey,
  RECEIPT_LOCK_HEARTBEAT_MS,
} from "../utils/receiptSessionLock";
import {
  filterReceiptOrders,
  ordersListEntryKey,
  type OrderListFilters,
} from "../utils/orderListFilters";
import OrderListPanel from "./OrderListPanel";
import OrderFiltersBar from "./OrderFiltersBar";
import ReceiptEditor from "./ReceiptEditor";

const isDev = import.meta.env.DEV;

function receiptLockKeyFromPayload(payload: ReceiptConfirmationPayload): string | undefined {
  const rc = payload.Receipt_Confirmation;
  const company = (rc.Company ?? "").trim();
  const no = (rc.Inbound_Receipt_No ?? "").trim();
  if (no.length === 0) return undefined;
  return `${company}|${no}`;
}

function App() {
  const [orders, setOrders] = useState<ReceiptOrderListEntry[]>([]);
  const [listFilters, setListFilters] = useState<OrderListFilters>({
    company: "",
    probill: "",
    receiptNo: "",
    dateFrom: "",
    dateTo: "",
  });
  const filteredOrders = useMemo(() => filterReceiptOrders(orders, listFilters), [orders, listFilters]);
  const hasActiveFilters =
    listFilters.company.trim().length > 0 ||
    listFilters.probill.trim().length > 0 ||
    listFilters.receiptNo.trim().length > 0 ||
    listFilters.dateFrom.trim().length > 0 ||
    listFilters.dateTo.trim().length > 0;

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [listStatus, setListStatus] = useState<string>("");
  const [lockUserOverrideByRecordId, setLockUserOverrideByRecordId] = useState<Record<string, string>>({});
  const [authFailed, setAuthFailed] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const embedded = isEmbeddedInConsole();

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setAuthFailed(false);
    setConnectionFailed(false);
    if (isDev) setListStatus("");
    try {
      const list = await getOrdersList(
        isDev ? (msg) => setListStatus((s) => (s ? `${s}\n${msg}` : msg)) : undefined
      );
      const normalized = list.map((entry) => normalizePayloadOrderPriceToRate(entry));
      setOrders(normalized);
      setLockUserOverrideByRecordId({});
    } catch (e) {
      if (e instanceof AuthError) setAuthFailed(true);
      else if (e instanceof ConnectionError) setConnectionFailed(true);
      else if (isDev) {
        const msg = e instanceof Error ? e.message : String(e);
        setListStatus((s) => (s ? `${s}\nPost-parse error: ${msg}` : `Post-parse error: ${msg}`));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filteredOrders.length === 0) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex((i) => {
      if (i == null || i < 0 || i >= filteredOrders.length) return 0;
      return i;
    });
  }, [filteredOrders]);

  const selectedOrder =
    selectedIndex != null && filteredOrders[selectedIndex] != null ? filteredOrders[selectedIndex]! : null;

  const lockPrevRecordIdRef = useRef<string | null>(null);

  useEffect(() => {
    const dashboardId = getReceiptLockDashboardId();
    if (!dashboardId) return;

    const newId = selectedOrder != null ? getReceiptLockRecordId(selectedOrder) : null;
    const prevId = lockPrevRecordIdRef.current;

    let cancelled = false;
    (async () => {
      try {
        if (prevId != null && prevId !== newId) {
          await setReceiptNoPriceLock({ dashboardId, recordId: prevId, username: null });
          if (cancelled) return;
          setLockUserOverrideByRecordId((m) => {
            const next = { ...m };
            delete next[prevId];
            return next;
          });
        }
        if (newId != null) {
          const u = getReceiptLockUsernameForRequest().trim();
          await setReceiptNoPriceLock({
            dashboardId,
            recordId: newId,
            username: u.length > 0 ? u : null,
          });
          if (cancelled) return;
          if (u.length > 0) {
            setLockUserOverrideByRecordId((m) => ({ ...m, [newId]: u }));
          }
        }
      } catch {
        /* server lock is best-effort */
      } finally {
        if (!cancelled) {
          lockPrevRecordIdRef.current = newId;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedOrder]);

  const receiptLockKey =
    selectedOrder?.payload != null ? receiptLockKeyFromPayload(selectedOrder.payload) : undefined;

  const [receiptLockHeld, setReceiptLockHeld] = useState(true);

  useEffect(() => {
    const key = receiptLockKey;
    if (key == null || key.length === 0) {
      setReceiptLockHeld(true);
      return;
    }

    const lockKey: string = key;

    setReceiptLockHeld(false);
    const ok = tryAcquireReceiptLock(lockKey);
    setReceiptLockHeld(ok);

    const hb = window.setInterval(() => {
      if (isReceiptLockHeldByOther(lockKey)) {
        setReceiptLockHeld(false);
        return;
      }
      const mine = tryAcquireReceiptLock(lockKey);
      setReceiptLockHeld(mine);
    }, RECEIPT_LOCK_HEARTBEAT_MS);

    function onStorage(ev: StorageEvent) {
      if (ev.key !== receiptLockStorageKey(lockKey)) return;
      if (isReceiptLockHeldByOther(lockKey)) {
        setReceiptLockHeld(false);
        return;
      }
      const reclaimed = tryAcquireReceiptLock(lockKey);
      setReceiptLockHeld(reclaimed);
    }

    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(hb);
      window.removeEventListener("storage", onStorage);
      releaseReceiptLock(lockKey);
    };
  }, [receiptLockKey]);

  const handlePostSuccess = useCallback(() => {
    if (selectedOrder == null) return;
    const k = ordersListEntryKey(selectedOrder);
    setOrders((prev) => prev.filter((o) => ordersListEntryKey(o) !== k));
  }, [selectedOrder]);

  const foreignSessionLockActive = Boolean(receiptLockKey) && !receiptLockHeld;

  return (
    <>
      <nav className="navbar navbar-fixed-top toolbar-container receipt-app-nav">
        <div className="command-container-center-controls">
          <span className="navbar-text">Receipt confirmation – edit Order Price then Post to ERP</span>
        </div>
      </nav>

      {!embedded && (
        <div className="alert alert-warning receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>This app must be opened from the Flowgear Console to load data.</strong> For local development, use
          the Console debug URL. For production, open the app from your site&apos;s app menu.
        </div>
      )}
      {embedded && authFailed && (
        <div className="alert alert-danger receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>Not signed in or session expired.</strong> Please sign in to the Flowgear Console and click Refresh
          to try again.
        </div>
      )}
      {embedded && connectionFailed && (
        <div className="alert alert-danger receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>No response from Flowgear.</strong> Open this app from the Flowgear Console (debug or published) and
          ensure you&apos;re signed in, then click Refresh.
        </div>
      )}
      <div className="receipt-split-container">
        <aside className="receipt-split-left">
          <OrderListPanel
            orders={filteredOrders}
            totalLoadedCount={orders.length}
            selectedIndex={selectedIndex}
            onSelectOrder={setSelectedIndex}
            onClearFilters={() =>
              setListFilters({ company: "", probill: "", receiptNo: "", dateFrom: "", dateTo: "" })
            }
            loading={loading}
            listStatus={listStatus}
            lockUserOverrideByRecordId={lockUserOverrideByRecordId}
          />
        </aside>
        <main className="receipt-split-right">
          <OrderFiltersBar
            filters={listFilters}
            onFiltersChange={setListFilters}
            onRefresh={loadOrders}
            onClearFilters={() =>
              setListFilters({ company: "", probill: "", receiptNo: "", dateFrom: "", dateTo: "" })
            }
            loading={loading}
            hasActiveFilters={hasActiveFilters}
            loadedCount={orders.length}
          />
          <div className="receipt-split-right-body">
            <ReceiptEditor
              key={selectedOrder != null ? ordersListEntryKey(selectedOrder) : "none"}
              initialPayload={selectedOrder?.payload ?? null}
              targetPayloadBase64={selectedOrder?.targetPayloadBase64 ?? null}
              sourcePayloadBase64={selectedOrder?.sourcePayloadBase64 ?? null}
              onRefresh={loadOrders}
              onPostSuccess={handlePostSuccess}
              foreignSessionLockActive={foreignSessionLockActive}
            />
          </div>
        </main>
      </div>
    </>
  );
}

export default App;
