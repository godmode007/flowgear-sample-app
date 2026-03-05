# CCH Price Capture Tool

React + TypeScript app that is always embedded inside the Flowgear Console. All data access goes through the Flowgear SDK, and the dev server is wired to open the console in debug mode automatically.

## Tech stack (current)
- React 19.1 + React DOM 19.1 with the React Compiler enabled
- Vite 7.1 (TypeScript 5.9) with `@vitejs/plugin-react` and `@vitejs/plugin-basic-ssl`
- Flowgear SDK: `flowgear-webapp@1.4.3` (`Flowgear.Sdk.invoke`, `init`, `setAlert`, etc.)
- UI: Bootstrap 5.3.8 and Sass
- Linting: ESLint 9.x (see `eslint.config.js`)

## API usage
- Call workflows via `Flowgear.Sdk.invoke(method, relativePath, payload?, headers?, tenant?)`.
- Discover available endpoints in `openapi.yml`, but ignore `servers`, `components`, and `security`; only the method and relative URL are passed to `invoke`.
- Do not call APIs directly with `fetch`/`axios` because the console provides the auth cookie on your behalf.

### Orders list workflow
- The app loads the orders list via **GET `/v2/ReceiptNoPrice`** (Result/Table XML with base64 Content per order).
- Override with **`VITE_GET_ORDERS_LIST_PATH`** in `.env.local` if needed.

## Local development
1. Set `.env.local` values:
   - `FG_DEV_TENANT` and `FG_DEV_SITE` (required)
   - Optional: `FG_DEV_PROTOCOL` (`https` default), `FG_DEV_HOST` (`localhost`), `FG_DEV_PORT` (`3000`)
2. Install and run:
   ```bash
   npm install
   npm run dev
   ```
3. The dev server starts on a self-signed HTTPS host and opens two tabs:
   - Local app URL (accept the certificate)
   - Flowgear Console debug URL: `https://app.flowgear.net/#t-{tenant}/sites/{site}/apps/debug/?debugUrl={encoded-local-url}`

## Publishing checklist
- Update `public/app.json` (manifest, embed mode, menu placement) and bump `Version`.
- Provide the icon at `public/icon.svg`.
- Build: `npm run build` (output is in `dist/`). If build fails with EBUSY, close any app using the `dist` folder and retry.
- Package for upload: zip the **contents** of `dist/` (not the folder itself). From project root in PowerShell:
  ```powershell
  Compress-Archive -Path "dist\*" -DestinationPath "ReceiptConfirmationApp-1.0.0.1.zip" -Force
  ```
  Upload the ZIP in the Flowgear Console.

## Published app not loading data (auth / embedding)

**Debug works, published doesn’t:** the app only gets data when the Flowgear Console runs it in an iframe and performs the API call with the user’s session. If the published app never retrieves data, check Flowgear **site configuration**:

1. **Cookie-based API key**  
   Published apps must use a **Cookie-based API key** (not Token-based), tied to the user, with the right Workflows allowed. In Flowgear: API Keys → use a Cookie key and assign the workflows (e.g. GET `/v2/ReceiptNoPrice`, POST `/v2/ProcurementInbound`).

2. **Allowed Origins / Host names**  
   The URL the app is loaded from (e.g. the host that serves the published app) must be in **Site settings → Environments → [your environment] → Allowed Origins / Host names**. If the app is hosted by Flowgear, their host may already be allowed; if you host it elsewhere, add that origin.

3. **Open from the Console**  
   Always open the app from the Flowgear Console (e.g. site menu or Apps). Don’t open the app’s URL directly in a new tab; the Console must be the parent frame so it can run `invoke()` with your cookie.

4. **Sign in**  
   Be signed in to the Flowgear Console in the same browser session before opening the app.

The app shows specific messages when it detects no response, timeout, or auth failure; use those to narrow down the issue.

## Recommended extensions & tooling
- ESLint (VS Code extension) to surface lint feedback from the existing config.
- Codex (CLI or VS Code extension) to develop with the guidance in `AGENTS.md` and keep API calls routed through `Flowgear.Sdk.invoke`.
