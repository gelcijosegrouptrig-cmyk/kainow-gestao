/**
 * Cloudflare Worker — Proxy API AverbaTech
 * Route: averba-api-proxy.gelci-jose-grouptrig.workers.dev/api/*
 * Proxies requests to the backend server and adds CORS headers
 */

// Backend URL — Railway production
const BACKEND = 'https://kainow-gestao-production.up.railway.app';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With,Accept',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === '/health' || url.pathname === '/ping') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'averba-api-proxy', ts: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Build backend URL
    const backendUrl = BACKEND + url.pathname + url.search;

    // Forward request headers (strip host to avoid conflicts)
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.delete('host');
    fwdHeaders.delete('cf-connecting-ip');
    fwdHeaders.delete('cf-ipcountry');
    fwdHeaders.delete('cf-ray');
    fwdHeaders.delete('cf-visitor');

    const proxyReq = new Request(backendUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    try {
      const backendResp = await fetch(proxyReq);
      const respHeaders = new Headers(backendResp.headers);

      // Inject CORS headers
      Object.entries(CORS_HEADERS).forEach(([k, v]) => respHeaders.set(k, v));

      // Remove problematic headers
      respHeaders.delete('transfer-encoding');

      return new Response(backendResp.body, {
        status: backendResp.status,
        statusText: backendResp.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({
        erro: 'Proxy error: ' + err.message,
        backend: BACKEND,
        path: url.pathname,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  }
};
