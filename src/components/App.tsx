import { useState, useCallback } from "react";
import type { ReceiptConfirmationPayload } from "../models/receiptConfirmation";
import { normalizePayloadOrderPriceToRate } from "../models/receiptConfirmation";
import { getOrdersList, AuthError, ConnectionError, isEmbeddedInConsole } from "../services/payloadService";
import OrderListPanel from "./OrderListPanel";
import ReceiptEditor from "./ReceiptEditor";

const isDev = import.meta.env.DEV;

function App() {
  const [orders, setOrders] = useState<ReceiptConfirmationPayload[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [listStatus, setListStatus] = useState<string>("");
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
      const normalized = list.map(normalizePayloadOrderPriceToRate);
      setOrders(normalized);
      setSelectedIndex(normalized.length > 0 ? 0 : null);
    } catch (e) {
      if (e instanceof AuthError) setAuthFailed(true);
      else if (e instanceof ConnectionError) setConnectionFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectedPayload = selectedIndex != null && orders[selectedIndex] != null
    ? orders[selectedIndex]
    : null;

  const handlePostSuccess = useCallback(() => {
    if (selectedIndex == null || orders.length === 0) return;
    const next = orders.filter((_, i) => i !== selectedIndex);
    setOrders(next);
    setSelectedIndex(next.length > 0 ? Math.min(selectedIndex, next.length - 1) : null);
  }, [selectedIndex, orders]);

  return (
    <>
      <nav className="navbar navbar-fixed-top toolbar-container receipt-app-nav">
        <div className="command-container-center-controls">
          <span className="navbar-text">Receipt confirmation – edit Order Price then Post to ERP</span>
        </div>
      </nav>

      {!embedded && (
        <div className="alert alert-warning receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>This app must be opened from the Flowgear Console to load data.</strong> For local development, use the Console debug URL. For production, open the app from your site&apos;s app menu.
        </div>
      )}
      {embedded && authFailed && (
        <div className="alert alert-danger receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>Not signed in or session expired.</strong> Please sign in to the Flowgear Console and click Refresh to try again.
        </div>
      )}
      {embedded && connectionFailed && (
        <div className="alert alert-danger receipt-auth-failed-banner m-0 rounded-0" role="alert">
          <strong>No response from Flowgear.</strong> Open this app from the Flowgear Console (debug or published) and ensure you&apos;re signed in, then click Refresh.
        </div>
      )}
      <div className="receipt-split-container">
        <aside className="receipt-split-left">
          <OrderListPanel
            orders={orders}
            selectedIndex={selectedIndex}
            onSelectOrder={setSelectedIndex}
            onRefresh={loadOrders}
            loading={loading}
            listStatus={listStatus}
          />
        </aside>
        <main className="receipt-split-right">
          <ReceiptEditor
            key={selectedIndex ?? "none"}
            initialPayload={selectedPayload}
            onRefresh={loadOrders}
            onPostSuccess={handlePostSuccess}
          />
        </main>
      </div>
    </>
  );
}

export default App;
