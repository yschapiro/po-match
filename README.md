# PO Match — D365 vs Vendor Invoice

Web app that pulls live PO line data from Dynamics 365 F&O and compares it against an uploaded vendor invoice (Excel/CSV). Reports matches, mismatches, and missing lines on either side.

Same architecture as the **expenses** project:
- **Frontend** = `index.html` served by GitHub Pages.
- **Backend** = a Cloudflare Worker (`worker.js`) that holds the D365 client_secret and the shared password, and proxies OData calls.

One repo, two pieces, both free, no per-user accounts. Anyone with the shared password can use it.

The vendor invoice is parsed entirely in the browser — never uploaded.

---

## Deploy

### 1. Push to GitHub

```bash
cd po-invoice-matcher
git init
git add .
git commit -m "Initial commit"
gh repo create po-match --public --source=. --remote=origin --push
```

### 2. Deploy the Cloudflare Worker

Install wrangler if you don't have it: `npm install -g wrangler`. Then:

```bash
wrangler login                    # one-time browser auth
wrangler secret put APP_PASSWORD          # paste your shared password
wrangler secret put D365_CLIENT_ID        # paste 62993f8e-1b7e-473f-b4b9-aa9964ddee5c
wrangler secret put D365_TENANT_ID        # paste d5a49985-5534-44ad-8ced-67ee0203bfce
wrangler secret put D365_CLIENT_SECRET    # paste the value (it's in rc01_converter/config.json)
wrangler deploy
```

Wrangler prints the worker URL, something like `https://po-match-proxy.yschapiro.workers.dev`. **Copy this URL.**

### 3. Point `index.html` at the worker

Edit the `WORKER_URL` constant near the top of `index.html` (line ~290) to that URL, then push:

```bash
git commit -am "Set worker URL"
git push
```

### 4. Enable GitHub Pages

GitHub repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root)**. After a minute the page is live at `https://yschapiro.github.io/po-match/`.

### 5. One-time D365 setup

Skip if already done for the rc01 converter (which uses the same client_id). Otherwise, in D365 F&O: **System administration → Setup → Microsoft Entra ID applications → New**, with:
- **Client ID:** `62993f8e-1b7e-473f-b4b9-aa9964ddee5c`
- **User ID:** an account with read access to purchase orders

This grants the worker's identity D365 read access.

### 6. Done

Open the Pages URL, enter the password, type a PO number, drop an invoice, compare. Share the URL + password with the team.

---

## Use it

1. Type a PO number, click **Load PO**. Lines pull live from D365.
2. Drop the vendor invoice. Excel or CSV. Pick the columns from the dropdowns (the app guesses well and remembers your mapping per-template).
3. Set a price tolerance (default $0).
4. Click **Compare**. Tabs filter mismatches / missing-on-invoice / missing-on-PO / matches.
5. Use the row checkboxes to copy D365 item numbers to your clipboard. Or **Export** the full comparison to Excel.

### Match key

Vendor item code, normalized (trimmed, upper-cased). On the D365 side this is the `ExternalItemNumber` field on the PO line.

---

## Update later

- **Frontend changes:** edit `index.html`, push to GitHub. Pages redeploys on its own.
- **Backend changes:** edit `worker.js`, run `wrangler deploy`.
- **Change password:** `wrangler secret put APP_PASSWORD`. Existing logged-in users get bounced back to the login screen on their next request.

---

## Architecture

| | |
|--|--|
| `index.html` | The app. SheetJS parses the invoice in-browser. Sends every request to the worker with an `X-Password` header. Password is stored in `localStorage` after first sign-in. |
| `worker.js` | Cloudflare Worker. Validates the password, acquires a D365 client-credentials token (cached in worker memory ~1 hour), and proxies `/po/<num>` to D365 OData. |
| `wrangler.toml` | Worker config + non-secret env vars (`D365_BASE`, `D365_PO_LINE_ENTITY`). Edit if your D365 environment URL differs. |

### What's where

- **Secrets:** `APP_PASSWORD`, `D365_CLIENT_ID`, `D365_TENANT_ID`, `D365_CLIENT_SECRET` — only on Cloudflare, never in the repo.
- **Public defaults:** `D365_BASE`, `D365_PO_LINE_ENTITY` — in `wrangler.toml`.
- **Code:** in this public GitHub repo.

### Privacy

- Vendor invoice never leaves your browser.
- D365 calls go from Cloudflare's edge (the worker) to Microsoft over HTTPS.
- Anyone who knows the password can use the app and run PO lookups. Treat the password like access to D365 read.
