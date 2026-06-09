# Flowgear Web App Agent Guide

This repository hosts a React app that is always embedded in an iframe inside the Flowgear Console at https://app.flowgear.net. Treat anything shipped in the build as publicly accessible.

## Core rules
- All data access must go through `Flowgear.Sdk.invoke` from the `flowgear-webapp` package. The Console holds the auth cookie and performs the HTTP call on behalf of the iframe. Never call APIs directly with `fetch`/`axios`.
- Use the API descriptors in the root `openapi.yml` to discover available endpoints, but pass only the HTTP method and relative path to `Flowgear.Sdk.invoke(...)`. Always send HTTP methods in uppercase (e.g., `GET`, `POST`, `PUT`, `PATCH`) even if `openapi.yml` lists them in lowercase. Ignore the `servers`, `components`, and `security` sections in that file.
- Place feature-specific work under `components`, `models`, `services`, and `utils`, splitting by functional area.

## Flowgear SDK helpers
- `init()` is called in `src/index.tsx` to register the app with the host console before rendering.
- `invoke(method, url, payload?, headers?, tenant?)` calls published Flowgear workflows (no manual auth required). If you hit CORS errors, ensure the host is whitelisted on the Flowgear site.
- UI helpers: `confirmModal`, `getTextModal`, `setAlert`, and `openUrl` are available for confirmations, text prompts, alerts, and opening new tabs.

## Local development notes
- `.env.local` must provide `FG_DEV_TENANT` and `FG_DEV_SITE`; Vite does not auto open Flowgear debug URL if missing. Optional: `FG_DEV_PROTOCOL` (default `https`), `FG_DEV_HOST` (default `localhost`), `FG_DEV_PORT` (default `3000`).
- `npm run dev` uses `vite.config.mts` to start a self-signed HTTPS server (`@vitejs/plugin-basic-ssl`) and auto-opens two tabs: the local app URL (accept the cert) and the Flowgear Console debug URL (`https://app.flowgear.net/#t-{tenant}/sites/{site}/apps/debug/?debugUrl={encoded-local-url}`).

## Publishing checklist
- Update `public/app.json` with manifest version, identity, embed mode, and menu placement; bump `Version` for every publish.
- Supply the menu/focus icon at `public/icon.svg`.
- Run `npm run build` and package the `build` directory contents as a ZIP for upload.

## Security considerations
- Validate user input before invoking Workflows; do not rely on server-side secrecy for anything emitted in the frontend bundle.
