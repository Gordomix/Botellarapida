export type CategoryId = "aperitivos" | "snacks" | "refrescos" | "basicos" | "alcohol";

export type Nutrition = Record<string, string>;

export type Product = {
  id: string;
  name: string;
  cat: CategoryId;
  brand: string;
  price: number;
  unit: string;
  desc: string;
  long: string;
  nutrition: Nutrition;
  image: string;
  alcohol?: boolean;
  grad?: string;
  oferta?: boolean;
};

export type ProductDraft = {
  ean: string;
  name: string;
  brand: string;
  cat: CategoryId;
  unit: string;
  price: number;
  nutrition: Nutrition;
  alcohol?: boolean;
  grad?: string;
};

export type Role = "user" | "repartidor" | "admin";

export type UserStatus = "activo" | "solicitud" | "rechazado" | "suspendido";

export type Vehicle = "patinete" | "bici" | "moto" | "coche";

export type User = {
  name: string;
  email: string;
  /**
   * Obsoleto en MySQL: el servidor jamas devuelve el hash (`br-server` solo
   * expone `PublicUser`). Se mantiene opcional para no romper lecturas antiguas.
   */
  pass?: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  dni?: string | null;
  vehicle?: Vehicle | null;
};

export type Session = {
  email: string;
  role: Role;
  name: string;
  dni?: string | null;
  /**
   * Token de sesión emitido por el servidor (MySQL). Va en cada llamada de
   * `@/lib/br-api` y se valida siempre en servidor: nunca es una credencial de
   * acceso, solo la referencia a la sesión guardada en `br_sessions`.
   */
  sid?: string;
};

export type CartItem = {
  id: string;
  qty: number;
};

export type OrderStatus = "pendiente" | "asignado" | "en_reparto" | "entregado" | "cancelado";

export type PaymentMethod = "tarjeta" | "bizum" | "apple_google_pay" | "efectivo";

export type DeliverySlot = "inmediata" | "programada_hoy" | "programada_noche";

export type OrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
};

export type HistoryEntry = {
  at: number;
  by: string;
  what: string;
};

export type Order = {
  id: string;
  code: string;
  customer: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  tip: number;
  total: number;
  paymentMethod: PaymentMethod;
  deliverySlot: DeliverySlot;
  address: string;
  phone: string;
  notes: string;
  status: OrderStatus;
  courier: string | null;
  createdAt: number;
  history: HistoryEntry[];
};

export type Claim = {
  id: string;
  orderCode: string;
  email: string;
  type: string;
  text: string;
  status: "abierta" | "resuelta";
  answer: string;
  createdAt: number;
};

export type SupportMessage = {
  id: string;
  email: string;
  text: string;
  answer: string;
  status: "abierto" | "respondido";
  createdAt: number;
};

export const CATEGORIES: Record<
  CategoryId,
  { label: string; kicker: string; image: string }
> = {
  aperitivos: {
    label: "Aperitivos",
    kicker: "Para la mesa",
    image: "/categories/aperitivos.jpg",
  },
  snacks: {
    label: "Snacks",
    kicker: "Para el sofá",
    image: "/categories/snacks.jpg",
  },
  refrescos: {
    label: "Refrescos",
    kicker: "Bien fríos",
    image: "/categories/refrescos.jpg",
  },
  basicos: {
    label: "Despensa",
    kicker: "Lo de siempre",
    image: "/categories/basicos.jpg",
  },
  alcohol: {
    label: "Bodega",
    kicker: "Solo +18",
    image: "/categories/alcohol.jpg",
  },
};

export const FREE_SHIPPING = 25;
export const SHIPPING_COST = 2.9;
