# Hosting the Receipt Confirmation App on Azure

You can run the app as a **standalone web application** on Azure (without Flowgear app-loading permissions). The frontend is hosted as a static site; a small Azure Function forwards the “Post to ERP” request to Flowgear using a **Token-based API key**.

## Architecture

1. **Static web app** (React) – Azure Static Web Apps or Storage + CDN.
2. **Azure Function** – Receives `POST /api/post-receipt` with the receipt payload, calls Flowgear’s workflow URL with the token, returns the result.

## 1. Flowgear setup

- Create a **Token-based API Key** in Flowgear (not Cookie) for server-to-server calls.
- Note the **API base URL** for your tenant/site (e.g. `https://app.flowgear.net` or the URL shown on the API key page).
- Ensure the key is allowed to run the **Procurement & Inbound** workflow (`POST /v2/ProcurementInbound`).

## 2. Deploy the Azure Function

```bash
cd azure-function
npm install
npm run build
```

- Create a **Function App** in Azure (Node 18+, Windows or Linux).
- Set **Application settings**:
  - `FLOWGEAR_API_BASE` – Flowgear API base URL (e.g. `https://app.flowgear.net`).
  - `FLOWGEAR_API_TOKEN` – Your Flowgear Token API key.
- Deploy the function (e.g. from VS Code Azure Functions extension, or `func azure functionapp publish <YourFunctionAppName>`).
- In the Function App, open **CORS** and add the origin of your frontend (e.g. `https://your-static-app.azurestaticapps.net` or `https://your-app.z22.web.core.windows.net`). For local dev, add `http://localhost:5173` and `http://localhost:3000`.

The function exposes: **POST** `https://<your-function-app>.azurewebsites.net/api/post-receipt`.

## 3. Build and deploy the frontend (standalone mode)

Set the backend URL at **build time**:

**Windows (PowerShell):**

```powershell
$env:VITE_STANDALONE_API_URL="https://<your-function-app>.azurewebsites.net"
npm run build
```

**Linux/macOS:**

```bash
VITE_STANDALONE_API_URL=https://<your-function-app>.azurewebsites.net npm run build
```

Then deploy the contents of the **`dist`** folder to:

- **Azure Static Web Apps** – Connect your repo and set the build output to `dist`; set env var `VITE_STANDALONE_API_URL` in the build configuration.
- **Azure Blob Storage (static website)** – Upload `dist` contents to the `$web` container.
- **Azure App Service (static site)** – Upload `dist` or deploy from a repo with the same build step.

## 4. Auth header (if Flowgear uses a different header)

The function sends: `Authorization: Bearer <FLOWGEAR_API_TOKEN>`. If your Flowgear API expects a different header (e.g. `X-API-Key`), change `src/functions/postReceipt.ts`:

```ts
headers: {
  "Content-Type": "application/json",
  "X-API-Key": FLOWGEAR_API_TOKEN,  // example
},
```

Redeploy the function after changing.

## Summary

| Component        | Purpose |
|-----------------|---------|
| `VITE_STANDALONE_API_URL` | Frontend build-time: base URL of your Azure Function (e.g. `https://myfunc.azurewebsites.net`). |
| Azure Function  | Receives POST with receipt payload, calls Flowgear with token, returns response. |
| `FLOWGEAR_API_BASE` | Function app setting: Flowgear API base URL. |
| `FLOWGEAR_API_TOKEN` | Function app setting: Flowgear Token API key. |

Without `VITE_STANDALONE_API_URL`, the app runs in **embedded mode** (inside the Flowgear Console using cookie auth). With it set, the app runs in **standalone mode** and posts via your Azure Function.
