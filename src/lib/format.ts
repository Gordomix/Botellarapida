import type { OrderStatus, PaymentMethod, DeliverySlot } from "@/data/types";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente: "Pendiente",
  asignado: "Asignado",
  en_reparto: "En reparto",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const PAY_LABEL: Record<PaymentMethod, string> = {
  tarjeta: "Tarjeta",
  bizum: "Bizum",
  apple_google_pay: "Apple / Google Pay",
  efectivo: "En mano",
};

export const SLOT_LABEL: Record<DeliverySlot, string> = {
  inmediata: "Inmediata · aprox. 30 min",
  programada_hoy: "Hoy · 19:00 – 21:00",
  programada_noche: "Madrugada · 23:00 – 07:00",
};

/**
 * Jornada del repartidor: 8 horas dentro del día, guardadas solo como hora de
 * inicio (0-23). Devuelve el rango legible "HH:00 – HH:00" (con corte de
 * medianoche si el turno lo cruza). `null` → todavía sin franja elegida.
 */
export function shiftRange(start: number | null | undefined): string {
  if (start === null || start === undefined) return "Sin jornada asignada";
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const end = (start + 8) % 24;
  return `${pad(start)} – ${pad(end)}`;
}
