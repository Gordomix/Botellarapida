export type CategoryId =
  | "aperitivos"
  | "snacks"
  | "refrescos"
  | "basicos"
  | "alcohol"
  | "parafarmacia"
  | "ofertas"
  | "packs";

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
  /** Precio anterior (€, con tachado). Solo tiene sentido con `oferta`. */
  oldPrice?: number;
  /**
   * Posición manual en el catálogo (ascendente, 0 = primero). Lo fija el admin
   * con las flechas del panel; los productos sin `pos` conservan el orden de
   * creación detrás de los ordenados.
   */
  pos?: number;
  /**
   * Unidades disponibles. `undefined`/`null` = sin control de stock (siempre
   * disponible); `0` = agotado (no se puede añadir a la cesta). Lo gestiona el
   * admin desde Productos; vive en el payload JSON, sin columna nueva.
   */
  stock?: number | null;
  /** Oculto para la tienda: no aparece en el catálogo público (`listProducts`). */
  hidden?: boolean;
  /** Fin de la oferta flash (epoch ms). Mientras no caduque, la tarjeta/ficha muestran cuenta atrás. */
  flashUntil?: number | null;
  /**
   * Coste del proveedor (€, sin IVA). Solo alimenta el Excel de rentabilidad
   * (Productos → «Excel rentabilidad»): la tienda y el checkout lo ignoran por
   * completo. `undefined`/`null` = sin dato (el Excel lo marca).
   */
  coste?: number | null;
  /**
   * Etiquetas SEO (Fase 12): términos de búsqueda («bebida», «frío»,
   * «energética»…). Se autogeneran al dar de alta el producto a partir de su
   * nombre y categoría, y amplían lo que encuentra la barra de búsqueda. Son
   * opcionales: los productos anteriores no las tienen y siguen buscables vía
   * `deriveTags` (se derivan en tiempo de ejecución).
   */
  tags?: string[];
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

/**
 * Resultado de la base española (Open Food Facts, filtrada por países: España)
 * para precargar el alta del admin. `price` suele faltar en la base abierta:
 * entonces es `null` y el admin lo escribe a mano. `image` es una URL remota
 * válida para `<img>` (se guarda como URL, no como data URL).
 */
export type EanSearchHit = {
  ean: string;
  name: string;
  brand: string;
  unit: string;
  price: number | null;
  image: string | null;
  nutrition: Nutrition;
  alcohol: boolean;
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
  // El DNI ya NO viaja en la sesion del navegador (blindaje Fase 1): vive solo
  // en el servidor y se expone al admin via `PublicUser.dni`. Las sesiones
  // antiguas guardadas en sessionStorage con ese campo se leen sin problema
  // (propiedad sobrante, ignorada).
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
  /** CP de entrega (null en pedidos anteriores a la migración 0009). */
  postalCode?: string | null;
  phone: string;
  notes: string;
  status: OrderStatus;
  courier: string | null;
  createdAt: number;
  history: HistoryEntry[];
  /** Motivo de cancelación escrito por el repartidor/admin (null si no aplica). */
  cancelReason?: string | null;
  /** Quién canceló: 'repartidor' | 'admin' | null. */
  cancelledBy?: string | null;
  /** Importe descontado por cupón (€). 0 si no se aplicó ninguno. */
  discount?: number;
  /** Código de cupón/afiliado aplicado (null si no lleva). */
  couponCode?: string | null;
  /** Recargo nocturno cobrado en la madrugada (€). 0 en horario normal. */
  nightSurcharge?: number;
  /**
   * Fase 11 (migración 0032): si el pedido es RESERVA (lo hicieron un día sin
   * reparto), epoch ms del día de entrega previsto. `null` = reparto normal.
   */
  scheduledFor?: number | null;
};

/**
 * Último fix de GPS conocido de un repartidor (tabla `br_courier_locations`).
 * Solo lo devuelve el servidor a partes autorizadas: dueño del pedido,
 * repartidor asignado o admin. `updatedAt` en epoch ms.
 */
export type CourierPoint = {
  lat: number;
  lng: number;
  accuracyM: number;
  updatedAt: number;
};

/**
 * Datos de la página de seguimiento (`/seguimiento/BR-XXXX`). La posición de
 * entrega es el centroide del CP (geocodificación aproximada gratuita, mismo
 * sistema que el mapa de tiendas cercanas); el cliente ve SU posición real
 * gracias al GPS del móvil, con su permiso.
 */
export type TrackingInfo = {
  code: string;
  status: OrderStatus;
  address: string;
  postalCode: string | null;
  courierName: string | null;
  destination: [number, number];
  /** `true` si `destination` es la casa real (Nominatim) y no el centroide del CP. */
  destinationExact: boolean;
  courier: CourierPoint | null;
  /** `true` si el fix de `courier` tiene menos de 10 min (GPS en directo). */
  courierOnline: boolean;
  /**
   * Ubicación del CLIENTE si él activó «Compartir mi ubicación» (bidireccional).
   * La ve el repartidor asignado y el admin; nunca se expone a terceros.
   */
  customer: CourierPoint | null;
  /** `true` si el fix de `customer` tiene menos de 10 min. */
  customerOnline: boolean;
  history: HistoryEntry[];
  createdAt: number;
};

/**
 * Fila del mapa en vivo del panel de admin: repartidor + su último fix + el
 * pedido que tiene asignado ahora mismo (si existe).
 */
export type LiveCourier = CourierPoint & {
  courier: string;
  name: string;
  orderCode: string | null;
  status: OrderStatus | null;
  /** Ubicación compartida por el cliente de ese pedido (si la compartió). */
  customer: CourierPoint | null;
};

/** Punto de una serie temporal (una barra/punto de gráfico) para estadísticas. */
export type StatsPoint = {
  /** Etiqueta corta legible: "12/09" (día) o "sep" (mes). */
  label: string;
  orders: number;
  revenue: number;
  signups: number;
};

/**
 * Panel de estadísticas del admin (todo agregado en servidor contra MySQL).
 * `totals` = magnitudes del día/mes; `deltas` = variación % vs el periodo
 * anterior (día previo / mes previo); `daily`/`monthly` = series para gráficos.
 */
export type Stats = {
  updatedAt: number;
  totals: {
    ordersToday: number;
    ordersMonth: number;
    revenueToday: number;
    revenueMonth: number;
    signupsToday: number;
    signupsMonth: number;
    liveUsers: number;
    activeUsersToday: number;
    couriersActive: number;
    pendingOrders: number;
    inFlightOrders: number;
    courierCancelsMonth: number;
    /** Ticket medio del mes (€): revenue del mes / pedidos no cancelados. */
    avgTicket: number;
    /** % de clientes del mes que repitieron (≥2 pedidos no cancelados). */
    repeatRatePct: number;
    /** Pedidos del mes por cliente único (media). */
    ordersPerCustomer: number;
    /** Clientes únicos con pedido en el mes. */
    uniqueCustomers: number;
  };
  deltas: {
    ordersDayPct: number;
    ordersMonthPct: number;
    revenueDayPct: number;
    revenueMonthPct: number;
    signupsDayPct: number;
    signupsMonthPct: number;
    activeUsersDayPct: number;
  };
  daily: StatsPoint[];
  monthly: StatsPoint[];
  statusBreakdown: { status: OrderStatus; count: number }[];
};

/**
 * Ficha de un ACCESS registrado (fila de `br_sessions`): sirve al admin para
 * auditar quién ha entrado. `active` = la sesión sigue viva (no caducada) en el
 * momento de leer la lista. `key` es un identificador anónimo (trozo del hash),
 * nunca el token real.
 */
export type LoginSession = {
  key: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
  active: boolean;
};

/**
 * Solicitud de recuperación de contraseña sin SMTP (flujo mediado por el admin):
 * cada petición deja un token de un solo uso en `br_password_resets`, y el panel
 * las lista aquí para que una persona valide la identidad y fije la nueva clave.
 * `active` = el token aún no ha caducado. Nunca viaja el token, solo `email`.
 */
export type PasswordResetRequest = {
  email: string;
  name: string;
  role: Role;
  requestedAt: number;
  expiresAt: number;
  active: boolean;
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

/**
 * Mensaje del chat POR PEDIDO (cliente ↔ repartidor ↔ admin/soporte). La
 * identidad del remitente la fija el servidor desde la sesión; el navegador solo
 * manda `orderId` y el texto. Tipo cliente: nunca se importa desde `br-server`.
 */
export type ChatMessage = {
  id: string;
  orderCode: string;
  senderEmail: string;
  senderName: string;
  senderRole: Role;
  body: string;
  createdAt: number;
};

/**
 * Factura de MUESTRA (sin datos fiscales). La numeración y el importe los fija
 * SIEMPRE el servidor: se recalculan contra `br_order_items`, nunca se fía del
 * total que mande el navegador, y un pedido solo admite una factura.
 */
export type InvoiceItem = { name: string; qty: number; price: number };

export type Invoice = {
  id: string;
  number: string;
  orderCode: string;
  customerEmail: string;
  customerName: string;
  items: InvoiceItem[];
  itemsTotal: number;
  shippingCost: number;
  total: number;
  issuedByEmail: string;
  issuedByName: string;
  issuedByRole: Role;
  createdAt: number;
};

export const CATEGORIES: Record<CategoryId, { label: string; kicker: string; image: string }> = {
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
  parafarmacia: {
    label: "Parafarmacia",
    kicker: "Salud y cuidado",
    image: "/categories/basicos.jpg",
  },
  ofertas: {
    label: "Ofertas",
    kicker: "Precio chollo",
    image: "/categories/snacks.jpg",
  },
  packs: {
    label: "Packs",
    kicker: "Para compartir",
    image: "/categories/basicos.jpg",
  },
};

export const FREE_SHIPPING = 25;
export const SHIPPING_COST = 2.9;
/**
 * Recargo de madrugada (€): se aplica cuando la franja elegida es
 * `programada_noche` (23:00 – 07:00). Lo recalcula SIEMPRE el servidor en
 * `createOrder` a partir de la franja; el navegador solo la muestra.
 */
export const NIGHT_SURCHARGE = 3;

/**
 * Cupón de descuento creado y gestionado por el admin (`br_coupons`).
 * `kind` = 'percent' (descuento %) | 'fixed' (descuento €).
 * `affiliate` = true en los códigos pensados para creadores de contenido:
 * se listan aparte en el panel y permiten atribuir el origen del pedido.
 * Cantidades: `amount` en € (fixed) o % 1–100 (percent); `minOrder` en €.
 * `expiresAt` en epoch ms o null si no caduca. Nunca viaja a cliente el
 * `usedCount` salvo en el listado de admin.
 */
export type CouponKind = "percent" | "fixed";

export type Coupon = {
  id: string;
  code: string;
  kind: CouponKind;
  amount: number;
  minOrder: number;
  /** true = solo válido para el primer pedido del cliente. */
  firstOnly: boolean;
  /** true = código de afiliado (creadores de contenido). */
  affiliate: boolean;
  /** Nombre del afiliado/inky (solo interno, no lo ve el cliente). */
  affiliateName: string | null;
  active: boolean;
  /** Tope de usos; 0 = ilimitado. */
  maxUses: number;
  usedCount: number;
  /** epoch ms; null = sin caducidad. */
  expiresAt: number | null;
  createdAt: number;
};

/** Resultado de validar un cupón en el checkout (recalculado en servidor). */
export type CouponCheck = {
  ok: boolean;
  msg: string;
  /** Importe descontado (€) si ok; 0 en caso contrario. */
  discount: number;
  kind?: CouponKind;
  amount?: number;
  affiliate?: boolean;
};

/**
 * Reseña de un pedido entregado (`br_reviews`). Nace SIEMPRE privada: el admin
 * decide si se publica. `image` es un data URL pequeño (foto del cliente, opcional).
 * En el listado público no viaja el email del cliente, solo `customerName`.
 */
export type ReviewStatus = "privada" | "publicada";

export type Review = {
  id: string;
  orderCode: string;
  customerName: string;
  /** 1..5 estrellas. */
  stars: number;
  text: string;
  /** data URL con la foto compartida por el cliente; null si no subió. */
  image: string | null;
  status: ReviewStatus;
  createdAt: number;
};

/** Reseña vista por el admin: incluye el email del autor (trazabilidad). */
export type AdminReview = Review & { customer: string };

/**
 * Donación «Apóyanos» (`br_donations`): importe 1–999 € de un cliente con
 * sesión. Es un registro de agradecimiento, NO un cobro: la pasarela real
 * llega cuando el titular active Stripe.
 */
export type Donation = {
  id: string;
  customer: string;
  customerName: string;
  amount: number;
  message: string | null;
  createdAt: number;
};

/* ------------------------------------------------------------------ sorteo */

/**
 * Config global de la ruleta (`br_raffle_config`, fila única id=1). Nace
 * APAGADA: sin premios activos y `enabled = 0` la sección pública muestra
 * «no disponible» y no cambia nada en la tienda.
 */
export type RaffleConfig = {
  enabled: boolean;
  title: string;
  subtitle: string;
  howItWorks: string;
  winMessage: string;
  loseMessage: string;
  /**
   * Migración 0028: total mínimo (€) que debe tener un pedido entregado para
   * regalar 1 ticket de ruleta. El viejo `daily_limit` queda obsoleto: ya no
   * se limita por días, se limita por tickets conseguidos comprando.
   */
  ticketMinEuro: number;
  /**
   * Migración 0029 (casilla de «Sorteos»): giros ILIMITADOS para las cuentas
   * registradas, sin gastar tickets. Solo para probar la ruleta; el público
   * normal sigue necesitando su ticket.
   */
  unlimitedTest: boolean;
};

/**
 * Segmento de la ruleta visto por el PÚBLICO (`br_raffle_prizes`): nunca viaja
 * el `weight` — la probabilidad es un secreto de servidor. Con `secret = true`
 * el detalle (`name`/`image`) no se envía jamás: `publicName`/`publicImage`
 * vienen vacíos y la rueda pinta el rótulo genérico. Con `secret = false` el
 * premio es visible desde el principio: la rueda muestra su nombre real.
 */
export type RafflePrizePublic = {
  id: string;
  kind: "premio" | "perdedor" | "chapas";
  wheelLabel: string;
  revealPrice: number;
  /** Migración 0030: chapas que regala un segmento `kind = 'chapas'`. */
  chapas: number;
  /** Migración 0027: premio oculto tras el `???` hasta revelarlo. */
  secret: boolean;
  /** Nombre real SOLO si no es secreto (viene vacío en secreto). */
  publicName: string;
  /** Imagen SOLO si no es secreto. */
  publicImage: string | null;
};

/** Variante de admin: con name, precios, pesos y mensajes propios. */
export type RafflePrizeAdmin = RafflePrizePublic & {
  name: string;
  description: string | null;
  image: string | null;
  productId: string | null;
  weight: number;
  winMessage: string | null;
  active: boolean;
  sort: number;
};

/** Resultado de un giro: el servidor decide el índice; el cliente anima. */
export type RaffleSpinResult = {
  entryId: string;
  code: string;
  /** Índice del segmento ganado dentro de `prizes` (orden público). */
  index: number;
  outcome: "premio" | "perdedor" | "chapas";
  /** Premio oculto con `?` hasta pagar (revelado = true si revealPrice = 0). */
  revealed: boolean;
  /** € congelados a cobrar por revelar/reclamar este premio. */
  amount: number;
  /** Migración 0030: chapas regaladas al instante si el segmento es de chapas. */
  chapaAwarded: number;
  winMessage: string;
  loseMessage: string;
};

/** Fila de `br_raffle_entries` para el panel (histórico + gestión). */
export type RaffleEntry = {
  id: string;
  code: string;
  customer: string;
  customerName: string;
  prizeId: string;
  prizeName: string;
  wheelLabel: string;
  outcome: "premio" | "perdedor" | "chapas";
  revealed: boolean;
  paid: boolean;
  claimed: boolean;
  amount: number;
  createdAt: number;
  revealedAt: number | null;
};

/** Estado que la página pública necesita para pintar la ruleta y el dialogo. */
export type RafflePublicState = {
  config: RaffleConfig;
  prizes: RafflePrizePublic[];
  /** Tickets sin usar del cliente (null = sin sesión). Cada giro gasta uno. */
  spinsLeft: number | null;
  /** Último entry sin reclamar del cliente (para reanudar el reveal). */
  pending: RaffleSpinResult | null;
  /**
   * Fase 12: premios YA RECLAMADOS por el cliente (máx. reciente 20). Cada uno
   * es un hilo de chat con la tienda (`/mensajes`), para coordinar la entrega.
   * Null = sin sesión.
   */
  claims: RaffleClaimSummary[] | null;
};

/** Resumen de un premio reclamado, para listar su chat en «Tus mensajes». */
export type RaffleClaimSummary = {
  entryId: string;
  code: string;
  prizeName: string;
  createdAt: number;
};

/* ------------------------------------------------------------------ chapas */

/** Config de fidelización (`br_chapa_config`, fila única id=1; apagada por defecto). */
export type ChapaConfig = {
  enabled: boolean;
  title: string;
  subtitle: string;
  howItWorks: string;
  redeemNote: string;
  /**
   * Migración 0028 (equilibrio): euros gastados que hacen falta para REGALAR
   * 1 chapa (12 por defecto → 100 chapas cuestan ~1200 € de compra). La vieja
   * `earn_per_euro` queda obsoleta: no se lee ni se escribe.
   */
  eurosPerChapa: number;
};

/** Oferta de canje por chapas (`br_chapa_rewards`). */
export type ChapaReward = {
  id: string;
  title: string;
  description: string | null;
  image: string | null;
  cost: number;
  /**
   * Valor en € del regalo (migración 0028). Si es > 0, el coste en chapas se
   * deriva solo con la equivalencia 100 chapas = 12 €; con 0, `cost` a mano.
   */
  valueEuro: number;
  /** -1 = ilimitado. */
  stock: number;
  productId: string | null;
  active: boolean;
  sort: number;
};

/** Canje solicitado (`br_chapa_redemptions`), gestionado por el admin. */
export type ChapaRedemption = {
  id: string;
  code: string;
  customer: string;
  customerName: string;
  rewardId: string;
  rewardTitle: string;
  cost: number;
  status: "pendiente" | "entregado" | "cancelado";
  createdAt: number;
};

/** Movimiento del libro de chapas (`br_chapa_ledger`). */
export type ChapaLedgerEntry = {
  id: string;
  delta: number;
  reason: string;
  createdAt: number;
};

/* ------------------------------------------------------------------ pagos */

/**
 * Método por el que RECIBIMOS dinero (migración 0029). PayPal es el elegido
 * por el titular; Stripe queda como alternativa tarjeta ya preparada.
 */
export type PaymentProvider = "paypal" | "stripe";

/** Ajustes de la pasarela (`br_payment_settings`, fila única id=1). */
export type PaymentSettings = {
  provider: PaymentProvider;
  /** true ⇒ los pagos pasan por /pago-demo (simulados, sin cargo real). */
  testMode: boolean;
  /**
   * Interruptor maestro (migración 0030): con `false` no se cobra online por
   * ningún método — el checkout vuelve a «pago en mano». Sirve para QUITAR la
   * cuenta de cobro actual antes de añadir otra pasarela.
   */
  enabled: boolean;
};

/**
 * Parche de ajustes desde Panel → Pagos. Las claves son strings: `undefined`
 * = no tocar, `''` = borrarla (el método queda sin cobrar), texto = fijarla.
 */
export type PaymentSettingsPatch = Partial<PaymentSettings> & {
  paypalClientId?: string;
  paypalSecret?: string;
  stripeSecretKey?: string;
};

/** Lo que puede ver cualquier visitante sobre la pasarela (nunca las claves). */
export type PaymentPublicStatus = {
  /** Se puede pagar online ahora mismo (maestro activo + clave real o modo pruebas). */
  enabled: boolean;
  provider: PaymentProvider;
  testMode: boolean;
  stripeConfigured: boolean;
  paypalConfigured: boolean;
  /** Interruptor maestro de cobros (migración 0030). */
  masterEnabled: boolean;
};

/** Datos de la pasarela SIMULADA para pintar /pago-demo. */
export type DemoPaymentInfo = {
  kind: "pedido" | "ruleta";
  /** id del pedido o del entry (para redirigir al aprobar). */
  ref: string;
  code: string;
  amount: number;
  status: "abierto" | "pagado" | "cancelado";
};

/** Estado completo de la pasarela para la pestaña «Pagos» del panel. */
export type AdminPaymentsState = {
  settings: PaymentSettings;
  stripeConfigured: boolean;
  paypalConfigured: boolean;
  /** `PUBLIC_APP_URL` definido: sin él no hay retorno de pasarela externa. */
  hasPublicUrl: boolean;
  /**
   * Migración 0030: flags de claves GUARDADAS EN BD (distintas de «configurado",
   * que también admite entorno). La UI los usa para decir «claves del panel».
   */
  keysInDb: { paypalId: boolean; paypalSecret: boolean; stripe: boolean };
  payments: {
    id: string;
    kind: "pedido" | "ruleta";
    code: string;
    amount: number;
    provider: string;
    status: "abierto" | "pagado" | "cancelado";
    createdAt: number;
  }[];
};

/* -------------------------------------------------- afiliados y notificaciones */

/**
 * Enlace de invitación (`br_affiliates`, migración 0030). Es de UN solo uso:
 * se cierra (`usedBy`) cuando el invitado hace su primera compra entregada,
 * y entonces ambas partes suman `reward` chapas.
 */
export type AffiliateLink = {
  id: string;
  code: string;
  reward: number;
  createdAt: number;
  usedBy: string | null;
  usedAt: number | null;
};

/** Lo que ve quien ABRE un enlace de invitación (página /afiliado/$code). */
export type AffiliateInfo = {
  ok: boolean;
  ownerName: string;
  reward: number;
  /** false = el enlace ya lo gastó otra persona (1 uso). */
  available: boolean;
};

/** Notificación de la campanita (`br_notifications`, migración 0030). */
export type AppNotification = {
  id: string;
  kind: "premio" | "chapa" | "mensaje" | "pedido" | "afiliado" | "info";
  title: string;
  body: string;
  link: string | null;
  createdAt: number;
  readAt: number | null;
};
