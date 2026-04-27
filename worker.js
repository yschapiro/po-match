// PO Match — D365 proxy worker
//
// Deployed to Cloudflare Workers via `wrangler deploy`.
// Frontend (GitHub Pages) sends an X-Password header on every request;
// worker checks it against APP_PASSWORD secret, then proxies to D365 OData
// using a service-account token acquired via client-credentials.

let tokenCache = { token: null, expiresAt: 0 };

async function getD365Token(env) {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const tokenUrl = `https://login.microsoftonline.com/${env.D365_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.D365_CLIENT_ID,
    client_secret: env.D365_CLIENT_SECRET,
    scope: `${(env.D365_BASE || "").replace(/\/+$/, "")}/.default`,
  });
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token endpoint ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = await r.json();
  if (!data.access_token) throw new Error("No access_token in response");
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Password",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

async function handlePO(poNum, env) {
  let token;
  try {
    token = await getD365Token(env);
  } catch (e) {
    return json({ error: `Could not acquire D365 token: ${e.message}` }, 502);
  }

  const safePo = String(poNum).replace(/'/g, "''");
  const base = (env.D365_BASE || "https://szy-prod.operations.dynamics.com").replace(/\/+$/, "");
  const entity = env.D365_PO_LINE_ENTITY || "PurchaseOrderLinesV2";
  const params = `$filter=PurchaseOrderNumber eq '${encodeURIComponent(safePo)}'&$top=1000`;
  let nextUrl = `${base}/data/${entity}?${params}`;

  const lines = [];
  try {
    while (nextUrl) {
      const r = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "OData-MaxVersion": "4.0",
        },
      });
      if (!r.ok) {
        const text = await r.text();
        return json({ error: `D365 returned ${r.status}: ${text.slice(0, 400)}` }, 502);
      }
      const data = await r.json();
      lines.push(...(data.value || []));
      nextUrl = data["@odata.nextLink"] || null;
    }
  } catch (e) {
    return json({ error: `Network error: ${e.message}` }, 502);
  }

  return json({ po: poNum, count: lines.length, lines });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Public endpoint for keep-warm pings
    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { ...CORS, "Content-Type": "text/plain" } });
    }

    // Password gate — checked on every protected request
    const pw = request.headers.get("X-Password") || "";
    if (!env.APP_PASSWORD || !timingSafeEqual(pw, env.APP_PASSWORD)) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Lightweight check used by the login screen to validate the password
    if (url.pathname === "/auth") {
      return json({ ok: true });
    }

    // /po/<num>
    const m = url.pathname.match(/^\/po\/(.+)$/);
    if (m) return handlePO(decodeURIComponent(m[1]), env);

    return json({ error: "Not found" }, 404);
  },
};
