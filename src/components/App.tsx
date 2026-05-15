import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReceiptOrderListEntry, ReceiptConfirmationPayload } from "../models/receiptConfirmation";
import {
  normalizePayloadOrderPriceToRate,
  lockUsersMatch,
  compareReceiptOrdersByDetailDate,
  getReceiptLockRecordId,
} from "../models/receiptConfirmation";
import {
  getOrdersList,
  AuthError,
  ConnectionError,
  isEmbeddedInConsole,
  setReceiptNoPriceLock,
  getReceiptLockUsernameForRequest,
  resolveReceiptLockUsernameForRequest,
  receiptNoPriceLockInvokePath,
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
  buildLockUserPickerOptions,
  type OrderListFilters,
  type OrderListFilterContext,
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

const COLLAPSE_LEFT_KEY = "cch-receipt-orders-panel-collapsed";

function readLeftPanelCollapsed(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSE_LEFT_KEY) === "1";
  } catch {
    return false;
  }
}

const LOCK_DEBUG_LOG_MAX = 40;

function App() {
  /** Dev-only lines for ReceiptNoPriceLock invoke debugging (shown in ReceiptEditor footer). */
  const [lockDebugLog, setLockDebugLog] = useState<string[]>([]);

  const appendLockDebug = useCallback((line: string) => {
    if (!isDev) return;
    const ts = new Date().toISOString().slice(11, 23);
    setLockDebugLog((prev) => [...prev.slice(-(LOCK_DEBUG_LOG_MAX - 1)), `${ts}  ${line}`]);
  }, []);

  const [orders, setOrders] = useState<ReceiptOrderListEntry[]>([]);
  const [listFilters, setListFilters] = useState<OrderListFilters>({
    company: "",
    probill: "",
    receiptNo: "",
    dateFrom: "",
    dateTo: "",
    lockUserSelections: [],
  });

  const [listDateSortDesc, setListDateSortDesc] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(readLeftPanelCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_LEFT_KEY, leftPanelCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [leftPanelCollapsed]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [listStatus, setListStatus] = useState<string>("");
  const [lockUserOverrideByRecordId, setLockUserOverrideByRecordId] = useState<Record<string, string>>({});
  /** Row Ids (dashboard Id) we successfully POST-locked in this session — list may not yet show us as LockedBy. */
  const [clientServerLockIds, setClientServerLockIds] = useState<Record<string, boolean>>({});
  /** Dashboard Id for which ReceiptNoPriceLock POST succeeded (rate edit or pre-post claim). */
  const [editSessionRecordId, setEditSessionRecordId] = useState<string | null>(null);
  const [editSessionBusy, setEditSessionBusy] = useState(false);
  const editSessionRecordIdRef = useRef<string | null>(null);
  const lastSelectedListRecordIdRef = useRef<string | null>(null);
  const lockGenerationRef = useRef(0);
  const rateEditFlagsRef = useRef<Record<string, boolean>>({});
  const [authFailed, setAuthFailed] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const embedded = isEmbeddedInConsole();

  const [lockUserResolvedNonce, setLockUserResolvedNonce] = useState(0);
  useEffect(() => {
    void resolveReceiptLockUsernameForRequest().finally(() => setLockUserResolvedNonce((n) => n + 1));
  }, []);

  const lockUserPickerOptions = useMemo(
    () => buildLockUserPickerOptions(orders, lockUserOverrideByRecordId),
    [orders, lockUserOverrideByRecordId]
  );

  const orderFilterContext: OrderListFilterContext = useMemo(
    () => ({
      lockUserOverrideByRecordId,
      currentUserLockLabel: getReceiptLockUsernameForRequest(),
    }),
    [lockUserOverrideByRecordId, lockUserResolvedNonce]
  );
  const filteredOrders = useMemo(() => {
    const filtered = filterReceiptOrders(orders, listFilters, orderFilterContext);
    const dir = listDateSortDesc ? "desc" : "asc";
    return [...filtered].sort((a, b) => compareReceiptOrdersByDetailDate(a, b, dir));
  }, [orders, listFilters, orderFilterContext, listDateSortDesc]);
  const hasActiveFilters =
    listFilters.company.trim().length > 0 ||
    listFilters.probill.trim().length > 0 ||
    listFilters.receiptNo.trim().length > 0 ||
    listFilters.dateFrom.trim().length > 0 ||
    listFilters.dateTo.trim().length > 0 ||
    listFilters.lockUserSelections.length > 0;

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
      setClientServerLockIds({});
      rateEditFlagsRef.current = {};
      if (isDev) setLockDebugLog([]);
      editSessionRecordIdRef.current = null;
      setEditSessionRecordId(null);
      lastSelectedListRecordIdRef.current = null;
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

  useEffect(() => {
    editSessionRecordIdRef.current = editSessionRecordId;
  }, [editSessionRecordId]);

  const selectedOrder =
    selectedIndex != null && filteredOrders[selectedIndex] != null ? filteredOrders[selectedIndex]! : null;

  const dashboardRecordId =
    selectedOrder?.recordId != null && String(selectedOrder.recordId).trim().length > 0
      ? String(selectedOrder.recordId).trim()
      : null;

  /** Matches OrderListPanel "Current user": workflow LockedBy plus client lock override for this row. */
  const selectedReceiptListLockUser = useMemo(() => {
    if (selectedOrder == null) return "—";
    const rid = getReceiptLockRecordId(selectedOrder);
    const fromList = (selectedOrder.currentLockUser ?? "").trim();
    const fromOverride = (lockUserOverrideByRecordId[rid] ?? "").trim();
    return fromList || fromOverride || "—";
  }, [selectedOrder, lockUserOverrideByRecordId]);

  /** Unlock previous row when selection changes while an edit session was active. */
  useEffect(() => {
    const newId = dashboardRecordId;
    const prevId = lastSelectedListRecordIdRef.current;
    if (prevId === newId) {
      return;
    }
    lastSelectedListRecordIdRef.current = newId;

    const editingId = editSessionRecordIdRef.current;
    const seq = ++lockGenerationRef.current;

    if (editingId != null && prevId != null && editingId === prevId && newId !== prevId) {
      const hadRateEdits = rateEditFlagsRef.current[editingId] === true;
      void (async () => {
        if (hadRateEdits) {
          delete rateEditFlagsRef.current[editingId];
          return;
        }
        try {
          const unlockPath = receiptNoPriceLockInvokePath(editingId, null);
          appendLockDebug(`(row change) Flowgear.Sdk.invoke POST ${unlockPath}`);
          await setReceiptNoPriceLock({ dashboardId: editingId, username: null });
          if (lockGenerationRef.current !== seq) return;
          appendLockDebug(`(row change) ReceiptNoPriceLock returned (released ${editingId})`);
          editSessionRecordIdRef.current = null;
          setEditSessionRecordId(null);
          setClientServerLockIds((m) => {
            const next = { ...m };
            delete next[editingId];
            return next;
          });
          setLockUserOverrideByRecordId((m) => {
            const next = { ...m };
            delete next[editingId];
            return next;
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          appendLockDebug(`(row change) ReceiptNoPriceLock ERROR: ${msg}`);
          if (isDev) console.warn("[ReceiptNoPriceLock] request failed", e);
        } finally {
          delete rateEditFlagsRef.current[editingId];
        }
      })();
    }
  }, [selectedOrder, dashboardRecordId, appendLockDebug]);

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

  const selectedOrderKey = selectedOrder != null ? ordersListEntryKey(selectedOrder) : null;

  const handleOrderPayloadChange = useCallback(
    (payload: ReceiptConfirmationPayload) => {
      if (selectedOrderKey == null) return;
      setOrders((prev) =>
        prev.map((o) => (ordersListEntryKey(o) === selectedOrderKey ? { ...o, payload } : o))
      );
    },
    [selectedOrderKey]
  );

  const serverLockedByOther = useMemo(() => {
    const recordId =
      selectedOrder?.recordId != null && String(selectedOrder.recordId).trim().length > 0
        ? String(selectedOrder.recordId).trim()
        : "";
    const locker = (selectedOrder?.currentLockUser ?? "").trim();
    const me = getReceiptLockUsernameForRequest().trim();
    const weHold =
      recordId.length > 0 &&
      (editSessionRecordId === recordId || clientServerLockIds[recordId] === true);
    if (weHold) return false;
    if (locker.length === 0) return false;
    if (me.length === 0) return true;
    return !lockUsersMatch(locker, me);
  }, [selectedOrder, clientServerLockIds, editSessionRecordId, lockUserResolvedNonce]);

  const beginEditSession = useCallback(async () => {
    if (dashboardRecordId == null || dashboardRecordId.length === 0 || serverLockedByOther) return;
    setEditSessionBusy(true);
    try {
      const u = (await resolveReceiptLockUsernameForRequest()).trim();
      const lockPath = receiptNoPriceLockInvokePath(dashboardRecordId, u.length > 0 ? u : null);
      appendLockDebug(`Flowgear.Sdk.invoke POST ${lockPath}`);
      await setReceiptNoPriceLock({
        dashboardId: dashboardRecordId,
        username: u.length > 0 ? u : null,
      });
      appendLockDebug(`ReceiptNoPriceLock returned (lock ${dashboardRecordId})`);
      editSessionRecordIdRef.current = dashboardRecordId;
      setEditSessionRecordId(dashboardRecordId);
      setClientServerLockIds((m) => ({ ...m, [dashboardRecordId]: true }));
      if (u.length > 0) {
        setLockUserOverrideByRecordId((m) => ({ ...m, [dashboardRecordId]: u }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLockDebug(`ReceiptNoPriceLock ERROR: ${msg}`);
      if (isDev) console.warn("[ReceiptNoPriceLock] request failed", e);
    } finally {
      setEditSessionBusy(false);
    }
  }, [dashboardRecordId, appendLockDebug, serverLockedByOther]);

  const endEditSession = useCallback(async () => {
    const id = editSessionRecordIdRef.current;
    if (id == null) return;
    setEditSessionBusy(true);
    try {
      const unlockPath = receiptNoPriceLockInvokePath(id, null);
      appendLockDebug(`Flowgear.Sdk.invoke POST ${unlockPath} (Done editing)`);
      await setReceiptNoPriceLock({ dashboardId: id, username: null });
      appendLockDebug(`ReceiptNoPriceLock returned (released ${id})`);
      editSessionRecordIdRef.current = null;
      setEditSessionRecordId(null);
      setClientServerLockIds((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      setLockUserOverrideByRecordId((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLockDebug(`ReceiptNoPriceLock ERROR: ${msg}`);
      if (isDev) console.warn("[ReceiptNoPriceLock] request failed", e);
    } finally {
      setEditSessionBusy(false);
    }
  }, [appendLockDebug]);

  const onRateFieldFocus = useCallback(() => {
    if (dashboardRecordId == null || dashboardRecordId.length === 0) return;
    if (editSessionRecordIdRef.current === dashboardRecordId) return;
    void beginEditSession();
  }, [dashboardRecordId, beginEditSession]);

  const onRateValueCommitted = useCallback(() => {
    if (dashboardRecordId == null || dashboardRecordId.length === 0) return;
    rateEditFlagsRef.current[dashboardRecordId] = true;
  }, [dashboardRecordId]);

  /** Claim server lock before post when list row has DashboardId (covers pre-filled rates with no keystrokes). */
  const ensureLockBeforePost = useCallback(async (): Promise<boolean> => {
    if (dashboardRecordId == null || dashboardRecordId.length === 0) return true;
    if (serverLockedByOther) return false;
    if (editSessionRecordIdRef.current === dashboardRecordId) return true;
    await beginEditSession();
    return editSessionRecordIdRef.current === dashboardRecordId;
  }, [dashboardRecordId, serverLockedByOther, beginEditSession]);

  const lockerDisplay = (selectedOrder?.currentLockUser ?? "").trim();
  const sessionLockBannerOverride: string | null = serverLockedByOther
    ? lockerDisplay.length > 0
      ? `This receipt is locked by ${lockerDisplay}. Only that user can edit rates or post. Refresh the list when they are done.`
      : `This receipt is locked by another user. Sign in to the Flowgear Console with the same account shown in the list, or refresh after they release it.`
    : null;

  const tabSessionLockActive = Boolean(receiptLockKey) && !receiptLockHeld;
  const foreignSessionLockActive = serverLockedByOther || tabSessionLockActive;

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
        <div
          className={`receipt-split-left-wrap${leftPanelCollapsed ? " receipt-split-left-wrap--collapsed" : ""}`}
        >
          <aside className="receipt-split-left">
            <OrderListPanel
              orders={filteredOrders}
              totalLoadedCount={orders.length}
              selectedIndex={selectedIndex}
              onSelectOrder={setSelectedIndex}
              onClearFilters={() =>
                setListFilters({
                  company: "",
                  probill: "",
                  receiptNo: "",
                  dateFrom: "",
                  dateTo: "",
                  lockUserSelections: [],
                })
              }
              loading={loading}
              listStatus={listStatus}
              lockUserOverrideByRecordId={lockUserOverrideByRecordId}
              listDateSortDesc={listDateSortDesc}
              onListDateSortToggle={() => setListDateSortDesc((d) => !d)}
            />
          </aside>
          <button
            type="button"
            className="receipt-split-collapse-toggle"
            aria-expanded={!leftPanelCollapsed}
            aria-controls="receipt-orders-panel"
            title={leftPanelCollapsed ? "Show orders list" : "Hide orders list"}
            onClick={() => setLeftPanelCollapsed((c) => !c)}
          >
            <span aria-hidden="true">{leftPanelCollapsed ? "›" : "‹"}</span>
          </button>
        </div>
        <main className="receipt-split-right">
          <OrderFiltersBar
            filters={listFilters}
            onFiltersChange={setListFilters}
            onRefresh={loadOrders}
            onClearFilters={() =>
              setListFilters({
                company: "",
                probill: "",
                receiptNo: "",
                dateFrom: "",
                dateTo: "",
                lockUserSelections: [],
              })
            }
            loading={loading}
            hasActiveFilters={hasActiveFilters}
            loadedCount={orders.length}
            lockUserPickerOptions={lockUserPickerOptions}
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
              sessionLockBannerOverride={sessionLockBannerOverride}
              lockApiDebugLog={lockDebugLog}
              dashboardRecordId={dashboardRecordId}
              onRateFieldFocus={onRateFieldFocus}
              onRateValueCommitted={onRateValueCommitted}
              ensureLockBeforePost={ensureLockBeforePost}
              onEndEditSession={endEditSession}
              editSessionBusy={editSessionBusy}
              receiptListLockUserDisplay={selectedReceiptListLockUser}
              onPayloadChange={handleOrderPayloadChange}
            />
          </div>
        </main>
      </div>
    </>
  );
}

export default App;
