import type { Product } from "@/data/types";

/**
 * Utilidades de stock y oferta flash compartidas por tienda (tarjeta + ficha) y
 * panel de admin. Todo es derivado del `Product` (los campos viven dentro del
 * payload JSON de `br_custom_products`, sin columnas nuevas ni migración).
 */

/** Unidades disponibles: `null` = sin control de stock (siempre disponible). */
export function stockLeft(p: Product): number | null {
  return typeof p.stock === "number" ? Math.max(0, Math.floor(p.stock)) : null;
}

/** Agotado = control de stock activo y quedan 0 unidades. */
export function isSoldOut(p: Product): boolean {
  const s = stockLeft(p);
  return s !== null && s <= 0;
}

/** ¿Oferta flash en vigor ahora mismo (queda tiempo)? */
export function flashActive(p: Product, now: number = Date.now()): boolean {
  return typeof p.flashUntil === "number" && p.flashUntil > now;
}

/** ¿Control de stock activo (el admin fijó un número)? */
export function hasStockControl(p: Product): boolean {
  return typeof p.stock === "number";
}

/** Escasez: control activo y pocas unidades (≤5) → se avisa en color de urgencia. */
export function isLowStock(p: Product): boolean {
  const s = stockLeft(p);
  return s !== null && s > 0 && s <= 5;
}

/**
 * Etiqueta de stock para la tienda (tarjeta + ficha). Con control activo el
 * cliente SIEMPRE ve cuántas unidades quedan (antes solo se mostraba si eran
 * ≤5, así que con más existencias no sabía de cuánto había). `null` = sin
 * control (no se dice nada). El texto de urgencia (≤5) lo pinta quien llama en
 * color rojo; el resto en un tono tranquilo.
 */
export function stockLabel(p: Product): string | null {
  const s = stockLeft(p);
  if (s === null) return null;
  if (s <= 0) return "Agotado";
  if (s <= 5) return `¡Solo quedan ${s}!`;
  return `${s} disponibles`;
}

/** Cuenta atrás legible a partir de milisegundos restantes. */
export function countdown(msLeft: number): string {
  if (msLeft <= 0) return "Terminada";
  const totalMin = Math.floor(msLeft / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  const s = Math.floor((msLeft % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")} min`;
}

/** epoch ms → valor de `<input type="datetime-local">` en hora local. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** valor de `<input type="datetime-local">` → epoch ms (o null si vacío). */
export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
