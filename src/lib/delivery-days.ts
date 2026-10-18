/**
 * Fase 11 — días de reparto y reservas. Helpers PUROS compartidos por cliente
 * y servidor: `dias` son índices de día de JS (0 = domingo ... 6 = sábado),
 * tal y como los guarda el CMS en la sección `reparto` de `br_content`.
 *
 * Regla de producto: si hoy NO es día de reparto, el pedido sigue siendo
 * válido pero queda RESERVADO para el próximo día de reparto. Lista vacía
 * = la función está apagada y se reparte todos los días (comportamiento
 * histórico).
 */

/** Default de la tienda (decisión del titular): viernes, sábado y domingo. */
export const DEFAULT_DELIVERY_DAYS = [5, 6, 0];

/** Orden de la semana laboral para los checkboxes del panel (Lun → Dom). */
export const WEEKDAY_UI: { idx: number; short: string; full: string }[] = [
  { idx: 1, short: "Lun", full: "lunes" },
  { idx: 2, short: "Mar", full: "martes" },
  { idx: 3, short: "Mié", full: "miércoles" },
  { idx: 4, short: "Jue", full: "jueves" },
  { idx: 5, short: "Vie", full: "viernes" },
  { idx: 6, short: "Sáb", full: "sábado" },
  { idx: 0, short: "Dom", full: "domingo" },
];

/** ¿Se reparte el día de `d`? `dias` vacío = todos los días. */
export function isDeliveryDay(dias: number[] | null | undefined, d: Date): boolean {
  if (!dias || dias.length === 0) return true;
  return dias.includes(d.getDay());
}

/**
 * Próximo día de reparto ESTRICTAMENTE posterior al día de `from` (compara
 * fechas, no horas). Devuelve un Date a las 12:00 de ese día (mediodía: lejos
 * de cualquier cambio de día por zona horaria) o `null` si `dias` está vacío.
 */
export function nextDeliveryDate(dias: number[] | null | undefined, from: Date): Date | null {
  if (!dias || dias.length === 0) return null;
  for (let k = 1; k <= 7; k += 1) {
    const d = new Date(from);
    d.setDate(d.getDate() + k);
    if (dias.includes(d.getDay())) {
      d.setHours(12, 0, 0, 0);
      return d;
    }
  }
  return null;
}

/** "viernes, sábado y domingo" · "todos los días" (para frases de la UI). */
export function deliveryDaysLabel(dias: number[] | null | undefined): string {
  if (!dias || dias.length === 0 || dias.length >= 7) return "todos los días";
  const names = WEEKDAY_UI.filter((w) => dias.includes(w.idx)).map((w) => w.full);
  return names.length ? names.join(", ") : "todos los días";
}

/** Época ms → "viernes 16/10" (para tarjetas de reserva en las tres vistas). */
export function fmtDeliveryDate(ts: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "2-digit",
  }).format(new Date(ts));
}
