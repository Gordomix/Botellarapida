import type { CartItem, Session } from "@/data/types";

/**
 * Persistencia LOCAL del navegador: solo lo que es efímero y del visitante, no
 * dato de negocio. Usuarios, pedidos, reclamaciones, soporte y altas de producto
 * viven ahora en MySQL (ver `@/lib/br-server` y `@/lib/use-br`).
 *
 *  - cesta: se pierde si cambias de dispositivo, como en cualquier súper online.
 *  - "tengo +18": un toque por sesión de navegador (sessionStorage).
 *  - sesión: el token de la sesión de MySQL, para no depender de cookies (la
 *    vista previa embebida del proyecto las tiene particionadas).
 */

const KEYS = {
  cart: "br_cart_v2",
  age: "br_age_ok",
  session: "br_session_v2",
} as const;

const CHANNEL = "br-sync";

function notify() {
  window.dispatchEvent(new Event(CHANNEL));
}

export function onSync(cb: () => void) {
  const wrap = () => cb();
  window.addEventListener(CHANNEL, wrap);
  window.addEventListener("storage", wrap);
  return () => {
    window.removeEventListener(CHANNEL, wrap);
    window.removeEventListener("storage", wrap);
  };
}

/* --------------------------------------------------------------------- edad */

/**
 * Confirmación de +18 guardada en `sessionStorage`: se pide **una vez por
 * sesión de navegador** (no en cada recarga, y no arrastra el "sí" de sesiones
 * anteriores). `sessionStorage` es fiable dentro del `iframe` de la preview,
 * a diferencia de cookies y (a veces) `localStorage` particionados.
 */
export function isAgeVerified() {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(KEYS.age) === "1";
  } catch {
    return false;
  }
}

export function setAgeVerified(ok: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (ok) sessionStorage.setItem(KEYS.age, "1");
    else sessionStorage.removeItem(KEYS.age);
  } catch {
    /* almacenamiento bloqueado: seguimos en memoria vía notify() */
  }
  notify();
}

/* -------------------------------------------------------------------- cesta */

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getCart(): CartItem[] {
  return read<CartItem[]>(KEYS.cart, []);
}

export function setCart(items: CartItem[]) {
  localStorage.setItem(KEYS.cart, JSON.stringify(items));
  notify();
}

/* ------------------------------------------------------------------ sesión */

export function currentSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(KEYS.session) || "null");
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  if (s) sessionStorage.setItem(KEYS.session, JSON.stringify(s));
  else sessionStorage.removeItem(KEYS.session);
  notify();
}

/** Token de sesión para las llamadas de `@/lib/br-api` (server-side validado). */
export function currentSid(): string | undefined {
  return currentSession()?.sid;
}
