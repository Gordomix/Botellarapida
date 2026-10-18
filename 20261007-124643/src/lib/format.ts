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
  inmediata: "Inmediata · menos de 90 min",
  programada_hoy: "Hoy 19:00 – 21:00",
  programada_noche: "Hoy 21:00 – 23:00",
};
