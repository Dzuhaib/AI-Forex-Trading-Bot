/**
 * Cloudflare Worker — Telegram Bot API relay.
 *
 * Deploy this once (free plan, no card needed) and the bot can reach
 * api.telegram.org through your Cloudflare subdomain even while Telegram
 * is blocked on your local network.
 *
 * ── Setup steps ─────────────────────────────────────────────────────
 * 1. Sign up at https://workers.cloudflare.com (free).
 * 2. Click "Create Worker" → pick the "Hello World" template → Deploy.
 * 3. Click "Edit Code", DELETE everything, paste this whole file, deploy.
 * 4. Edit RELAY_KEY below first: make it a long random string so nobody
 *    else can use your relay.
 * 5. In .env set:
 *      TELEGRAM_API_BASE=https://<your-worker>.<your-subdomain>.workers.dev/<RELAY_KEY>
 *    (copy the exact workers.dev URL of your deployed worker and append /<RELAY_KEY>)
 * 6. Restart the server.
 * ────────────────────────────────────────────────────────────────────
 */

const RELAY_KEY = 'CHANGE_ME_to_a_long_random_string';

const UPSTREAM = 'https://api.telegram.org';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // e.g. "KEY/bot<token>/sendMessage"

    if (!path.startsWith(RELAY_KEY + '/')) {
      return new Response('Forbidden', { status: 403 });
    }
    const rest = path.slice(RELAY_KEY.length + 1);
    if (!rest.startsWith('bot')) {
      return new Response('Forbidden', { status: 403 });
    }

    let body;
    if (request.method === 'POST') {
      body = await request.text();
    }
    const upstream = await fetch(UPSTREAM + '/' + rest + url.search, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
