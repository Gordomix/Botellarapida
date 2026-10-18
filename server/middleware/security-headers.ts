/**
 * Cabeceras de seguridad y tope anti-desbordamiento por IP para toda la app
 * desplegada. Nitro registra este fichero automaticamente como middleware
 * global (`vite.config.ts` -> `serverDir: "./server"`, misma convencion que
 * `grok-pwa.ts`). Puramente aditivo: no toca rutas ni HTML.
 *
 *  - CSP minima pero REAL, con las exclusiones que la app necesita de verdad:
 *    preview embebida de grok.com (chrome de la plataforma), Google Identity,
 *    Stripe (preparado para el dia del cobro), teselas del mapa y fotos en
 *    data: URL. Sin `X-Frame-Options` a proposito: el sucesor moderno es
 *    `frame-ancestors`, y DENY/SAMEORIGIN romperia el iframe de la preview.
 *  - Nosniff / Referrer-Policy / Permissions-Policy. NO se restringe
 *    `geolocation`: el reparto en directo la necesita, tambien embebida.
 *  - POST por IP: ventana de 60 s con tope; por encima, 429. Primera linea a
 *    nivel de aplicacion contra avalanchas de mutaciones (el escudo DDoS
 *    completo va delante del origen: Cloudflare en el DNS).
 */

interface SecurityEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

const POST_WINDOW_MS = 60_000;
// Tope anti-avalanchas. Las server functions de TanStack viajan TODAS como POST
// (también las lecturas), y varias consultas sondean cada 15 s, así que un solo
// usuario conectado ya emite decenas de POST/min. Un techo bajo (120) cortaba el
// catálogo con un 429 en el uso normal, sobre todo cuando el proxy del hosting
// agrupa a varios visitantes bajo la misma IP. 1200/min sigue frenando bucles
// descontrolados y scripts de fuerza bruta sin tocar a nadie legítimo.
const POST_MAX_PER_WINDOW = 1200;
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * IP real del visitante. El PRIMER elemento de `x-forwarded-for` lo escribe el
 * propio cliente (falsificable a voluntad); solo vale el ÚLTIMO salto — el que
 * añade nuestro proxy — y preferimos las cabeceras puestas por el CDN.
 */
function ipOf(event: SecurityEvent): string {
  const h = event.req.headers;
  const cdn = h.get("cf-connecting-ip")?.trim() || h.get("x-real-ip")?.trim();
  if (cdn) return cdn;
  const parts = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || "unknown";
}

function overBudget(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + POST_WINDOW_MS });
    if (buckets.size > 10_000) {
      // Purga la insercion mas antigua: la tabla no puede crecer sin limite.
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    return false;
  }
  b.count += 1;
  return b.count > POST_MAX_PER_WINDOW;
}

function cspHeader(secure: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://js.stripe.com https://grok.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://accounts.google.com https://api.stripe.com https://grok.com",
    "frame-src 'self' https://accounts.google.com https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://grok.com",
    // Solo bajo https: en local (http://localhost) romperia los assets.
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export default async function securityHeadersMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if ((event.req.method ?? "GET").toUpperCase() === "POST" && overBudget(ipOf(event))) {
    return new Response("Demasiadas peticiones. Espera un momento.", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "60",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const result = await next();
  if (!(result instanceof Response)) return result;

  const secure =
    (event.req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() === "https" ||
    event.url.protocol === "https:";
  const headers = new Headers(result.headers);
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", cspHeader(secure));
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), payment=()");
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
