import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  scrypt as scryptCb,
  randomInt,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";
import type { JsonWebKey as NodeJsonWebKey, KeyObject } from "node:crypto";
import { promisify } from "node:util";
import type { PoolConnection } from "mysql2/promise";
import { getRequest } from "@tanstack/react-start/server";
import { ensureEnvLoaded, execute, getDb, query } from "./db";
import { FREE_SHIPPING, NIGHT_SURCHARGE, SHIPPING_COST } from "@/data/types";
import { isWithinServiceArea, SERVICE_AREA_LABEL } from "@/data/service-area";
import { coordsForCp, SAMPLE_STORES } from "@/data/stores";
import type {
  AdminReview,
  AffiliateInfo,
  AffiliateLink,
  AppNotification,
  ChatMessage,
  Coupon,
  CouponCheck,
  CourierPoint,
  Donation,
  EanSearchHit,
  Invoice,
  InvoiceItem,
  LiveCourier,
  LoginSession,
  Nutrition,
  OrderItem,
  PasswordResetRequest,
  Product,
  RaffleConfig,
  PaymentPublicStatus,
  PaymentSettings,
  PaymentSettingsPatch,
  DemoPaymentInfo,
  AdminPaymentsState,
  RaffleEntry,
  RafflePrizeAdmin,
  RafflePrizePublic,
  RafflePublicState,
  RaffleSpinResult,
  RaffleClaimSummary,
  ChapaConfig,
  ChapaLedgerEntry,
  ChapaRedemption,
  ChapaReward,
  Review,
  ReviewStatus,
  Stats,
  StatsPoint,
  TrackingInfo,
} from "@/data/types";
import type { SiteSectionKey } from "@/data/site-defaults";
import { DEFAULT_DELIVERY_DAYS } from "@/lib/delivery-days";
import { autoSeoDescription, autoSeoTags } from "@/lib/product-search";
import { brandedEmailHtml } from "@/lib/mail-brand";

/**
 * Lógica de negocio de Botella Rápida, server-only sobre MySQL.
 *
 * Ninguna de estas funciones confía en el rol o el email que manda el navegador:
 * todo acceso se autentica con el token de sesión (`br_sessions`), que el
 * servidor emite y puede revocar. La capa expuesta al cliente (`@/lib/br-api`)
 * pasa SIEMPRE el `sid` recibido en `login`.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/** Tiempo de vida de la sesión: 12 h (igual que el sessionStorage que sustituía). */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Tope ABSOLUTO de una sesión: 30 dias desde su creacion, se use o no. El
 * rolado deslizante (Fase 2) renueva el vencimiento mientras haya actividad,
 * pero ningun token vive para siempre: si alguien robara una sesion, el corte
 * llega solo con el plazo maximo. (La contraseña nueva o la suspension siguen
 * expulsando al momento: eso no cambia.)
 */
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Nombre de la cookie httpOnly que lleva el token de sesión. Es un canal
 * ADICIONAL al `sid` que ya viaja por el cuerpo de cada llamada: el servidor
 * acepta cualquiera de los dos (body primero). Así la sesión sobrevive en el
 * dominio real aunque el `sessionStorage` se borre, y el token queda accesible
 * por JS para la preview embebida (que tiene las cookies particionadas).
 */
const SID_COOKIE = "br_sid";

export type Role = "user" | "repartidor" | "admin";
export type UserStatus = "activo" | "solicitud" | "rechazado" | "suspendido";
export type OrderStatus = "pendiente" | "asignado" | "en_reparto" | "entregado" | "cancelado";
export type PaymentMethod = "tarjeta" | "bizum" | "apple_google_pay" | "efectivo";
export type DeliverySlot = "inmediata" | "programada_hoy" | "programada_noche";
export type Vehicle = "patinete" | "bici" | "moto" | "coche";

export type PublicUser = {
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  dni: string | null;
  vehicle: string | null;
  createdAt: number;
  /** Hora de inicio de la jornada (0-23) del repartidor; null si no la ha elegido. */
  shiftStart: number | null;
  /** Teléfono de contacto facilitado al registrarse (visible solo para el admin). */
  phone: string | null;
  /**
   * Migración 0030: `false` si la cuenta aún no ha confirmado su correo.
   * Opcional para no romper lecturas antiguas; el panel lo usa en «Cuentas».
   */
  emailVerified?: boolean;
};

export type Session = {
  email: string;
  role: Role;
  name: string;
  // El DNI NO viaja al navegador: vive solo en el servidor (`br_users`) y se
  // expone al admin a traves de `PublicUser`. La sesion del cliente no lo usa.
};

export type SessionInfo = Session & { sid: string; createdAt: number; expiresAt: number };

export type OrderRow = {
  id: string;
  code: string;
  customer: string;
  customer_name: string;
  subtotal: number;
  shipping_cost: number;
  tip: number;
  total: number;
  payment_method: PaymentMethod;
  delivery_slot: DeliverySlot;
  address: string;
  postal_code: string | null;
  phone: string;
  notes: string | null;
  status: OrderStatus;
  courier: string | null;
  created_at: number;
  /** Fase 11 (migración 0032): época ms del día de entrega si es RESERVA. */
  scheduled_for: number | null;
  store_id: string | null;
  store_name: string | null;
  /** Dirección exacta resuelta con Nominatim al crear el pedido (null = CP). */
  dest_lat: string | number | null;
  dest_lng: string | number | null;
  /** Motivo escrito por quien canceló un reparto en curso (migración 0018). */
  cancel_reason: string | null;
  cancelled_by: string | null;
  /** € descontados por cupón y código aplicado (migración 0019). */
  discount: number;
  coupon_code: string | null;
  /** Recargo de madrugada realmente cobrado (migración 0019). */
  night_surcharge: number;
};

export type ItemRow = {
  order_id: string;
  product_id: string;
  name: string;
  qty: number;
  price: number;
};

export type HistoryRow = {
  order_id: string;
  at: number;
  actor: string;
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
  postalCode: string | null;
  phone: string;
  notes: string;
  status: OrderStatus;
  courier: string | null;
  createdAt: number;
  /** Fase 11: día de entrega previsto si el pedido es una reserva (null si no). */
  scheduledFor: number | null;
  history: { at: number; by: string; what: string }[];
  /** Tienda de origen elegida por el cliente (null en pedidos antiguos). */
  storeId: string | null;
  storeName: string | null;
  /** Motivo de la cancelación y quién la provocó (null si no se canceló). */
  cancelReason: string | null;
  cancelledBy: string | null;
  /** € descontados por cupón aplicado (0 si no lleva). */
  discount: number;
  couponCode: string | null;
  /** Recargo nocturno cobrado (0 en horario normal). */
  nightSurcharge: number;
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

/* ------------------------------------------------------------------ utils */

/**
 * Normaliza el dominio de `PUBLIC_APP_URL`: recorta la barra final y añade el
 * prefijo `https://` si falta. En el panel del hosting se suele escribir el
 * valor pelado (`botellarapida.es`), y un enlace de correo —o una URL de
 * retorno de Stripe/PayPal— sin protocolo no abre ni funciona.
 */
function normalizePublicUrl(raw: string): string {
  const u = raw.trim().replace(/\/+$/, "");
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/**
 * Dominio público para los enlaces de los correos (verificación, recuperación,
 * seguimiento). Prioridad:
 *  1. `PUBLIC_APP_URL` si está registrada (el caso recomendado).
 *  2. Si no, se DERIVA del propio request entrante (`x-forwarded-host` / `host`
 *     + `x-forwarded-proto`), para que los enlaces salgan correctos en Render
 *     o cualquier hosting aunque se olvide la variable.
 *  3. Loopback (localhost / 127.0.0.1) devuelve "": un enlace con localhost
 *     dentro de un correo no lo puede abrir nadie más; en local el flujo cae
 *     por consola (ver `send*Email`) y en el `reset` se puede pegar el código.
 */
function publicBaseUrl(): string {
  const explicit = normalizePublicUrl(process.env.PUBLIC_APP_URL || "");
  if (explicit) return explicit;
  try {
    const req = getRequest();
    const host =
      req?.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      req?.headers.get("host")?.trim() ||
      "";
    if (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return "";
    const proto = req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

/** Identificador corto y único por entidad (mismo formato que el cliente espera). */
function newId(prefix: string) {
  return prefix + Date.now().toString(36) + randomBytes(3).toString("hex");
}

/** Código de pedido legible BR-XXXXXX, reintentando si colisiona con el único. */
async function freshOrderCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // 6 hex (16,7 M de combinaciones): con 4 el espacio era demasiado pequeño
    // para enumerarlo. Los códigos antiguos (BR-XXXX) siguen siendo válidos.
    const code = "BR-" + randomBytes(3).toString("hex").toUpperCase();
    const hit = await query<{ code: string }>("select code from br_orders where code = ? limit 1", [
      code,
    ]);
    if (hit.length === 0) return code;
  }
  throw new Error("No se pudo generar un código de pedido libre.");
}

/**
 * Hash de contraseña: `scrypt$salt$hex`. scrypt es de `node:crypto` (cero
 * dependencias nativas, instala igual en Windows y en el VPS) y el formato
 * auto-descriptivo permite cambiar parámetros sin migrar filas.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** Las contraseñas antiguas (`btoa("br$"+pass)`) no se migran: se rechazan. */
function isLegacyHash(stored: string) {
  return !stored.startsWith("scrypt$");
}

/* ---------------------------------------------------------------- sesión */

/**
 * Crea una sesión y devuelve el token en claro (solo una vez, para el cliente).
 * SESIÓN ÚNICA POR CUENTA para clientes y repartidores: antes de emitir el
 * token nuevo se borran TODAS las sesiones previas de ese email (quien inicia
 * sesión en otro dispositivo expulsa al anterior). Disuade la suplantación sin
 * frenar a ningún comprador legítimo (varias pestañas del MISMO navegador
 * comparten el mismo token y siguen funcionando).
 * EXCEPCIÓN — ADMIN: el equipo puede trabajar a la vez hasta
 * `MAX_ADMIN_SESSIONS` personas/dispositivos; al iniciar uno nuevo por encima
 * del tope, caducan las sesiones MÁS ANTIGUAS (el recién llegado nunca corta
 * a los compañeros en activo, solo a los dispositivos zombis).
 */
const MAX_ADMIN_SESSIONS = 3;

async function createSession(user: UserRowDto): Promise<SessionInfo> {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const now = Date.now();
  if (user.role === "admin") {
    // Dejar hueco para la sesión nueva sin pasar del tope: sobran todas menos
    // las (MAX-1) más recientes.
    const live = await query<{ token_hash: string }>(
      "select token_hash from br_sessions where user_email = ? order by created_at desc",
      [user.email],
    );
    const stale = live.slice(MAX_ADMIN_SESSIONS - 1);
    if (stale.length) {
      const marks = stale.map(() => "?").join(",");
      await execute(`delete from br_sessions where token_hash in (${marks})`, [
        ...stale.map((r) => r.token_hash),
      ]);
      void audit(user.email, "sesion.limite", "", {
        cerradas: stale.length,
        tope: MAX_ADMIN_SESSIONS,
      });
    }
  } else {
    await execute("delete from br_sessions where user_email = ?", [user.email]);
  }
  const sIp = clientIp();
  const sUa = userAgent();
  try {
    await execute(
      "insert into br_sessions (token_hash, user_email, role, created_at, expires_at, ip, user_agent) values (?, ?, ?, ?, ?, ?, ?)",
      [tokenHash, user.email, user.role, now, now + SESSION_TTL_MS, sIp, sUa],
    );
  } catch {
    // BD sin la migración 0033 (columnas ip/user_agent todavía no existen):
    // el insert antiguo crea la sesión igualmente. Nunca rompe un login.
    await execute(
      "insert into br_sessions (token_hash, user_email, role, created_at, expires_at) values (?, ?, ?, ?, ?)",
      [tokenHash, user.email, user.role, now, now + SESSION_TTL_MS],
    );
  }
  return {
    sid: raw,
    email: user.email,
    role: user.role,
    name: user.name,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
}

type UserRowDto = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  dni: string | null;
  vehicle: string | null;
  created_at: number;
  pass_hash: string;
  shift_start: number | null;
  phone: string | null;
  email_verified: number;
};

const USER_COLUMNS =
  "id, email, name, role, status, dni, vehicle, created_at, pass_hash, shift_start, phone, email_verified";

function toPublicUser(r: UserRowDto): PublicUser {
  return {
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    dni: r.dni,
    vehicle: r.vehicle,
    createdAt: r.created_at,
    shiftStart: r.shift_start ?? null,
    phone: r.phone ?? null,
    emailVerified: Number(r.email_verified ?? 1) === 1,
  };
}

/* -------------------------------------------------------------- auditoria */

/**
 * Bitacora append-only de acciones sensibles (tabla `br_audit`, migracion
 * 0021). BEST-EFFORT por diseno: un fallo de insercion NUNCA rompe la
 * operacion auditada (por eso no lanza y nada con `void audit(...)`). No
 * guarda secretos ni tokens: solo actor, accion, objetivo y detalles utiles.
 */
export async function audit(
  actor: string,
  action: string,
  target = "",
  meta?: unknown,
): Promise<void> {
  try {
    await execute(
      "insert into br_audit (id, actor, action, target, meta, created_at) values (?, ?, ?, ?, ?, ?)",
      [
        newId("au"),
        actor.slice(0, 191),
        action.slice(0, 96),
        String(target ?? "").slice(0, 191),
        meta === undefined ? null : JSON.stringify(meta).slice(0, 2000),
        Date.now(),
      ],
    );
  } catch {
    /* la auditoria no puede tumbar una accion legitima */
  }
}

export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  target: string;
  meta: string | null;
  createdAt: number;
};

/** Ultimas entradas de auditoria (solo admin): las 300 mas recientes. */
export async function listAudit(sid: string | undefined): Promise<AuditEntry[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<{
    id: string;
    actor: string;
    action: string;
    target: string;
    meta: string | null;
    created_at: number;
  }>(
    "select id, actor, action, target, meta, created_at from br_audit order by created_at desc limit 300",
  );
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    target: r.target,
    meta: r.meta,
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------ cookie de sesión */

/**
 * Helpers de la cookie httpOnly. Usan `import()` dinámico del subsistema de
 * servidor para NO arrastrar el framework al cargar `br-server` desde scripts
 * Node puros (`seed`/`migrate`), y son best-effort: fuera de un contexto de
 * petición (o si el navegador rechaza la cookie) se ignoran y seguimos con el
 * canal `sid` del body, que siempre funciona. Nunca dejan caer una operación.
 */
async function setSidCookie(token: string): Promise<void> {
  try {
    const { setCookie, getRequestProtocol } = await import("@tanstack/react-start/server");
    // En produccion la cookie es SIEMPRE `Secure`: no nos fiamos del protocolo
    // que reporta el proxy (detras de Render/Cloudflare puede llegar como http
    // y dejar la cookie de session expuesta a una linea sin TLS).
    const forceSecure =
      process.env.NODE_ENV === "production" || /^https:/i.test(process.env.PUBLIC_APP_URL || "");
    setCookie(SID_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: forceSecure || getRequestProtocol() === "https",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  } catch {
    /* sin contexto de petición / cookie bloqueada: seguimos con el body */
  }
}

async function clearSidCookie(): Promise<void> {
  try {
    const { deleteCookie } = await import("@tanstack/react-start/server");
    deleteCookie(SID_COOKIE, { path: "/", httpOnly: true, sameSite: "lax" });
  } catch {
    /* idem */
  }
}

async function readSidCookie(): Promise<string | undefined> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(SID_COOKIE);
  } catch {
    return undefined;
  }
}

/**
 * Resuelve el token de sesión: primero el `sid` explícito (body, canal que usa
 * la preview), y si viene vacío cae en la cookie httpOnly (dominio real).
 */
async function resolveToken(sid: string | undefined): Promise<string | undefined> {
  const fromBody = sid?.trim();
  if (fromBody) return fromBody;
  return (await readSidCookie())?.trim();
}

/** Lee la sesión desde el token; `null` si no existe, caducó o el usuario cambió de estado. */
export async function readSession(sid: string | undefined): Promise<SessionInfo | null> {
  // IP baneada = sin sesión: cae cualquier acción autenticada y expulsa a quien
  // ya estuviera dentro. Fail-open si la tabla falta (vease `ipIsBanned`).
  if (await ipIsBanned(clientIp())) return null;
  const token = await resolveToken(sid);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await query<{
    token_hash: string;
    user_email: string;
    role: Role;
    expires_at: number;
    created_at: number;
    name: string;
    user_status: UserStatus;
  }>(
    "select s.token_hash, s.user_email, s.role, s.created_at, s.expires_at, " +
      "u.name, u.status as user_status " +
      "from br_sessions s join br_users u on u.email = s.user_email " +
      "where s.token_hash = ? limit 1",
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await execute("delete from br_sessions where token_hash = ?", [row.token_hash]);
    return null;
  }
  // Un repartidor suspendido o rechazado pierde el acceso al momento.
  if (row.user_status === "suspendido" || row.user_status === "rechazado") return null;
  // Tope absoluto: a los 30 dias la sesion muere aunque se use a diario.
  if (Date.now() - row.created_at > SESSION_MAX_MS) {
    await execute("delete from br_sessions where token_hash = ?", [row.token_hash]);
    return null;
  }
  // Rolado deslizante (Fase 2): si queda menos de media vida restante, se
  // renueva el vencimiento en BD (y se reemite la cookie, best-effort). Quien
  // usa la app a diario no se desconecta; el que la abandona cae al plazo.
  let expiresAt = row.expires_at;
  if (expiresAt - Date.now() < SESSION_TTL_MS / 2) {
    expiresAt = Date.now() + SESSION_TTL_MS;
    await execute("update br_sessions set expires_at = ? where token_hash = ?", [
      expiresAt,
      row.token_hash,
    ]).catch(() => undefined);
    void setSidCookie(token);
  }
  return {
    sid: token,
    email: row.user_email,
    role: row.role,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Autenticación de una operación. `roles` restringe quién puede llamarla: si el
 * token no es válido o el rol no está en la lista, se rechaza en servidor (el
 * guard de pantalla en cliente es cosmético, nunca la autorización).
 */
export async function requireSession(sid: string | undefined, roles?: Role[]) {
  const session = await readSession(sid);
  if (!session) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
  if (roles && !roles.includes(session.role)) {
    throw new Error("No tienes permiso para hacer esto.");
  }
  return session;
}

/* ---------------------------------------------------------------- cuentas */

export type RegisterInput = {
  name: string;
  email: string;
  pass: string;
  role?: Role;
  dni?: string | null;
  vehicle?: Vehicle | null;
  phone?: string | null;
  /** Código de afiliado (`AF-...`) por el que llegó el alta (migración 0030). */
  ref?: string | null;
};

/* --------------------------------------------------- guard de registro */

/**
 * ¿Exigir confirmación de correo al registrarse? Solo si el admin marca la
 * casilla «confirmarCorreo» (Ajustes → Portales). OFF por defecto a propósito:
 * con SMTP activo en producción, exigir el correo bloqueaba TODAS las altas si
 * el mensaje no llegaba — y el registro era «no se puede crear cuentas».
 * Fail-open: cualquier error leyendo el CMS deja el registro abierto.
 */
async function requireEmailVerifyFlag(): Promise<boolean> {
  try {
    const rows = await query<{ payload: string | Record<string, unknown> }>(
      "select payload from br_content where section = 'portales' limit 1",
    );
    if (!rows.length) return false;
    const p =
      typeof rows[0].payload === "string"
        ? (JSON.parse(rows[0].payload) as Record<string, unknown>)
        : rows[0].payload;
    return p.confirmarCorreo === true;
  } catch {
    return false;
  }
}

/**
 * Frena la creación MASIVA de cuentas (registro-buitre por bots): ventana
 * deslizante en memoria que solo cuenta ALTAS EXITOSAS. Umbral generoso: a un
 * humano no le afecta (se registra una vez), pero corta un chorro de bots.
 * Es por proceso (node-server único); es defensa en profundidad, no la única.
 */
const REGISTER_WINDOW_MS = 60 * 1000; // 1 min
const REGISTER_MAX_PER_WINDOW = 30; // techo ABSOLUTO de altas por minuto
const recentRegistrations: number[] = [];

function registrationsInWindow(): number {
  const now = Date.now();
  while (recentRegistrations.length && now - recentRegistrations[0] > REGISTER_WINDOW_MS) {
    recentRegistrations.shift();
  }
  return recentRegistrations.length;
}

/** Registra una alta EXITOSA en la ventana (llamar solo tras el insert). */
function noteRegistration(): void {
  recentRegistrations.push(Date.now());
  // Tope duro: la ventana ya limpia sola, esto evita crecimiento sin límite.
  if (recentRegistrations.length > REGISTER_MAX_PER_WINDOW * 10) {
    recentRegistrations.splice(0, recentRegistrations.length - REGISTER_MAX_PER_WINDOW);
  }
}

export async function registerUser(input: RegisterInput): Promise<{ ok: boolean; msg: string }> {
  const email = input.email.trim().toLowerCase();
  if (await ipIsBanned(clientIp())) {
    return {
      ok: false,
      msg: "No podemos crear la cuenta desde tu dirección. Contacta con soporte.",
    };
  }
  const role: Role = input.role ?? "user";
  const dni = input.dni?.trim().toUpperCase() || null;
  const phone = input.phone?.trim() || null;

  if (registrationsInWindow() >= REGISTER_MAX_PER_WINDOW) {
    return { ok: false, msg: "Demasiados registros seguidos. Inténtalo en un minuto." };
  }
  // Tope POR RED (el global no vale: un bot lo agotaría y cerraría la puerta a
  // todas las altas legítimas de la tienda). Seis altas por minuto desde la
  // misma IP es muchísimo para un humano; un bot se corta aquí.
  try {
    assertThrottle(
      `reg:ip:${clientIp()}`,
      6,
      REGISTER_WINDOW_MS,
      "Demasiados registros desde tu red. Inténtalo en un minuto.",
    );
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  }

  const existing = await query<{ email: string }>(
    "select email from br_users where email = ? limit 1",
    [email],
  );
  if (existing.length) return { ok: false, msg: "Ya existe una cuenta con ese email." };

  if (role === "repartidor") {
    if (!dni) return { ok: false, msg: "El repartidor necesita DNI." };
    if (dni.length < 8 || !/^[0-9]+[A-Z]$/.test(dni)) {
      return { ok: false, msg: "DNI no válido (ejemplo: 12345678B)." };
    }
    if (input.pass.length < 8) {
      return { ok: false, msg: "La contraseña necesita al menos 8 caracteres." };
    }
    const dupDni = await query<{ email: string }>(
      "select email from br_users where dni = ? limit 1",
      [dni],
    );
    if (dupDni.length) return { ok: false, msg: "Ese DNI ya está registrado." };
  } else if (input.pass.length < 8) {
    return { ok: false, msg: "La contraseña necesita al menos 8 caracteres." };
  }

  // Un registro público nunca puede crear admin: el admin se sembró por entorno.
  const safeRole: Role = role === "admin" ? "user" : role;
  const status: UserStatus = safeRole === "repartidor" ? "solicitud" : "activo";

  // Con SMTP activo Y la casilla de portales marcada, la alta nace SIN verificar
  // y recibe enlace. Sin casilla (o sin SMTP) entra ya verificada: el registro
  // nunca depende de que el correo llegue (migración 0030).
  const needsVerify = smtpEnabled() && (await requireEmailVerifyFlag());

  // Referido por enlace de afiliado (migración 0030): solo se guarda si el
  // código existe y aún no se ha usado; el premio llega con la 1ª entrega.
  const refCode = (input.ref ?? "").trim().toUpperCase();
  let referredBy: string | null = null;
  if (refCode) {
    const af = await query<{ owner_email: string }>(
      "select owner_email from br_affiliates where code = ? and used_by is null limit 1",
      [refCode],
    ).catch(() => [] as { owner_email: string }[]);
    if (af.length) referredBy = af[0].owner_email;
  }

  try {
    await execute(
      "insert into br_users (id, name, email, pass_hash, role, status, dni, vehicle, phone, created_at, email_verified, referred_by) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId("u"),
        input.name.trim(),
        email,
        await hashPassword(input.pass),
        safeRole,
        status,
        dni,
        safeRole === "repartidor" ? (input.vehicle ?? null) : null,
        phone,
        Date.now(),
        needsVerify ? 0 : 1,
        referredBy,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      return { ok: false, msg: "Ese DNI o email ya están registrados." };
    }
    throw err;
  }

  // Alta real: consume una posición de la ventana anti-bots.
  noteRegistration();

  if (needsVerify) {
    // Best-effort EN SEGUNDO PLANO (Fase 13): si el correo de verificación no
    // sale o el SMTP va lento, NO rompemos ni retrasamos el alta — el login
    // reenvía el enlace cuando el usuario intente entrar.
    void sendVerificationEmail(email).catch((err) =>
      console.error("[verify] no se pudo enviar el correo:", (err as Error)?.message || err),
    );
  }

  const verifyNote = needsVerify
    ? " Te hemos enviado un correo de confirmación desde botellarapidadmin@gmail.com: pulsa su botón y entrarás directamente."
    : "";
  return {
    ok: true,
    msg:
      safeRole === "repartidor"
        ? `Solicitud enviada. El admin debe aprobarla antes de que puedas aceptar repartos.${verifyNote}`.trim()
        : `Cuenta creada.${needsVerify ? " Revisa tu correo: pulsa el botón de confirmación y entrarás directamente." : " Ya puedes entrar."}`,
  };
}

/* ------------------------------------------------- verificación por enlace */

/** El enlace de confirmación caduca a las 24 h. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cooldown de envío (en memoria, por proceso). El registro y el login con correo
 * sin confirmar llaman cada uno a `sendVerificationEmail`; con React StrictMode
 * o reintentos podían salir 3 correos casi a la vez. Si ya se mandó uno hace
 * menos de 60 s a esa dirección, se omite: el enlace anterior sigue valiendo 24 h.
 * Es un `Map` síncrono para que corte también los disparos simultáneos.
 */
const VERIFY_SEND_COOLDOWN_MS = 60_000;
const verifySendAt = new Map<string, number>();

/**
 * Genera el token de un solo uso (guarda solo su hash) y manda el correo desde
 * botellarapidadmin@gmail.com. Con enlace público sale la versión de marca
 * (banner landscape + botón «Confirmar» que además inicia sesión al pinchar);
 * sin `PUBLIC_APP_URL` registrada, consuela el código por log para recuperarlo
 * en local/preview sin romper el flujo.
 *
 * `force` (reenvío manual del admin) se salta el cooldown.
 */
async function sendVerificationEmail(email: string, opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force) {
    const now = Date.now();
    const last = verifySendAt.get(email);
    if (last && now - last < VERIFY_SEND_COOLDOWN_MS) return;
    verifySendAt.set(email, now);
    // Higiene del mapa: si crece demasiado, poda los vencidos.
    if (verifySendAt.size > 5000) {
      for (const [k, t] of verifySendAt) {
        if (now - t >= VERIFY_SEND_COOLDOWN_MS) verifySendAt.delete(k);
      }
    }
  } else {
    verifySendAt.set(email, Date.now());
  }
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await execute(
    "insert into br_email_verifications (email, token_hash, expires_at, created_at) values (?, ?, ?, ?) " +
      "on duplicate key update token_hash = values(token_hash), expires_at = values(expires_at), created_at = values(created_at)",
    [email, tokenHash, Date.now() + VERIFY_TTL_MS, Date.now()],
  );
  const base = publicBaseUrl();
  const link = base ? `${base}/verificar?token=${encodeURIComponent(raw)}` : "";
  // Antes de gastar el enlace en un envío que no puede salir, avisar (y dejar
  // el código por log para recuperarlo a mano).
  if (!smtpEnabled()) {
    console.warn(`[verify] correo no configurado — enlace de ${email}: ${link || raw}`);
    return;
  }
  const subject = "Confirma el correo de tu cuenta Botella Rápida";
  const body = link
    ? `Hola:\n\nPara activar tu cuenta de Botella Rápida confirma este correo.\n\nAbre este enlace (válido 24 h):\n${link}\n\nSi no has creado tú la cuenta, ignora este mensaje.`
    : `Hola:\n\nTu código de verificación de Botella Rápida (válido 24 h) es:\n\n${raw}\n\nSi no has creado tú la cuenta, ignora este mensaje.`;
  const html = link
    ? brandedEmailHtml({
        base,
        heading: "Un último paso: confirma tu correo",
        intro:
          "Has creado tu cuenta en Botella Rápida. Pulsa el botón para activarla: confirmarás tu correo y entrarás directamente (el enlace caduca a las 24 h).",
        ctaLabel: "Confirmar mi correo y entrar",
        ctaUrl: link,
        note: "Si no has creado tú esta cuenta, ignora este mensaje: no se activará nada.",
      })
    : undefined;
  await sendEmailBestEffort(email, subject, body, html);
}

/**
 * Activa la cuenta desde el enlace. Función PÚBLICA (sin sesión): quien abre el
 * correo aún no ha iniciado sesión. El token vale una vez; al verificar se
 * marca el usuario y se borra el token.
 *
 * Plus de la Fase 13: el botón del correo también inicia sesión (magic link).
 * El token de 32 bytes aleatorios, de un solo uso y 24 h de vida ES la
 * credencial que el servidor acaba de validar, así que emitir ahí la sesión
 * equivale a un login correcto: misma sesión única por cuenta y misma cookie
 * httpOnly. Solo para cuentas activas — un repartidor en «solicitud» confirma
 * el correo pero sigue esperando la aprobación del admin.
 */
export async function verifyEmail(
  token: string,
): Promise<{ ok: boolean; msg: string; session?: SessionInfo }> {
  const t = token.trim();
  if (!t) return { ok: false, msg: "Enlace no válido." };
  const tokenHash = createHash("sha256").update(t).digest("hex");
  const rows = await query<{ email: string; expires_at: number }>(
    "select email, expires_at from br_email_verifications where token_hash = ? limit 1",
    [tokenHash],
  );
  const r = rows[0];
  if (!r || r.expires_at < Date.now()) {
    return {
      ok: false,
      msg: "Ese enlace ha caducado. Intenta entrar de nuevo: te mandaremos otro.",
    };
  }
  await execute("update br_users set email_verified = 1 where email = ?", [r.email]);
  await execute("delete from br_email_verifications where email = ?", [r.email]);
  // Auto-entrada solo si la cuenta está activa (los guards de `login` se
  // respetan igual: solicitud/suspendido/rechazado confirman pero no entran).
  const users = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
    [r.email],
  );
  const u = users[0];
  if (u && u.status === "activo" && !isLegacyHash(u.pass_hash)) {
    const session = await createSession(u);
    await setSidCookie(session.sid);
    return {
      ok: true,
      msg: "Correo confirmado. Has entrado directamente: ya puedes comprar.",
      session,
    };
  }
  return { ok: true, msg: "Correo confirmado. Ya puedes entrar en Botella Rápida." };
}

/**
 * El admin confirma el correo de una cuenta a mano (Panel → Cuentas): puerta de
 * socorro si el cliente no recibe el enlace de activación.
 */
export async function adminVerifyEmail(
  sid: string | undefined,
  email: string,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const target = email.trim().toLowerCase();
  const exists = await query<{ email: string }>(
    "select email from br_users where email = ? limit 1",
    [target],
  );
  if (!exists.length) throw new Error("Esa cuenta no existe.");
  await execute("update br_users set email_verified = 1 where email = ?", [target]);
  await execute("delete from br_email_verifications where email = ?", [target]);
  void audit(admin.email, "usuario.verificar-correo", target);
  return { ok: true };
}

/** El admin reenvía el enlace de confirmación a una cuenta sin verificar. */
export async function adminResendVerification(
  sid: string | undefined,
  email: string,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  if (!smtpEnabled()) throw new Error("El correo (SMTP) no está configurado en el servidor.");
  const target = email.trim().toLowerCase();
  const exists = await query<{ email: string }>(
    "select email from br_users where email = ? limit 1",
    [target],
  );
  if (!exists.length) throw new Error("Esa cuenta no existe.");
  await sendVerificationEmail(target, { force: true });
  void audit(admin.email, "usuario.reenviar-correo", target);
  return { ok: true };
}

/* ================================================================= campanita */

/**
 * Notificaciones in-app (migración 0030): la campanita de la cabecera acumula
 * premios, chapas, mensajes, pedidos y avisos de invitación. Best-effort: un
 * fallo al guardar NUNCA rompe el flujo de negocio que la originó.
 */
const NOTIF_KEEP_PER_USER = 200;

export type NotificationKind = AppNotification["kind"];

/** Guardar una notificación para un email (histórico recortado al grabar). */
export async function pushNotification(
  email: string,
  kind: NotificationKind,
  title: string,
  body = "",
  link: string | null = null,
): Promise<void> {
  const to = (email || "").trim().toLowerCase();
  if (!to || !title) return;
  try {
    await execute(
      "insert into br_notifications (id, email, kind, title, body, link, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      [
        newId("nt"),
        to,
        kind,
        title.slice(0, 160),
        body.slice(0, 500),
        link ? link.slice(0, 400) : null,
        Date.now(),
      ],
    );
    // Tope por cuenta: la tabla no crece sin límite (la subquery duplicada en
    // `t` es la forma legal de borrar por LIMIT en MySQL).
    await execute(
      "delete from br_notifications where email = ? and id not in " +
        `(select id from (select id from br_notifications where email = ? order by created_at desc limit ${NOTIF_KEEP_PER_USER}) t)`,
      [to, to],
    );
  } catch (err) {
    console.error("[notif] no se pudo guardar la notificación:", (err as Error)?.message || err);
  }
}

/** Campanita de la sesión: últimas `limit` + contador de no leídas. */
export async function listNotifications(
  sid: string | undefined,
  limit = 40,
): Promise<{ items: AppNotification[]; unread: number }> {
  const session = await requireSession(sid);
  const cap = Math.max(1, Math.min(100, Math.floor(Number(limit) || 40)));
  const rows = await query<{
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    link: string | null;
    created_at: number;
    read_at: number | null;
  }>(
    "select id, kind, title, body, link, created_at, read_at from br_notifications " +
      `where email = ? order by created_at desc limit ${cap}`,
    [session.email],
  );
  const cnt = await query<{ n: number | string }>(
    "select count(*) as n from br_notifications where email = ? and read_at is null",
    [session.email],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body ?? "",
      link: r.link,
      createdAt: Number(r.created_at),
      readAt: r.read_at === null ? null : Number(r.read_at),
    })),
    unread: Number(cnt[0]?.n ?? 0),
  };
}

/** Marcar como leídas: todas de golpe, o una sola por `id`. */
export async function markNotificationsRead(
  sid: string | undefined,
  id?: string,
): Promise<{ ok: true }> {
  const session = await requireSession(sid);
  if (id) {
    await execute("update br_notifications set read_at = ? where id = ? and email = ?", [
      Date.now(),
      id,
      session.email,
    ]);
  } else {
    await execute("update br_notifications set read_at = ? where email = ? and read_at is null", [
      Date.now(),
      session.email,
    ]);
  }
  return { ok: true };
}

/**
 * Auto-crea el admin en el arranque desde ADMIN_EMAIL/ADMIN_PASSWORD del
 * entorno, para que "desplegar y ya" funcione sin un `db:seed` manual.
 * Idempotente y NO letal: si faltan credenciales, si ya existe un admin o si
 * la BD aun no esta lista, se limita a avisar y el servidor sigue arrancando.
 * (Se llama desde el bootstrap de `@/lib/db` tras aplicar migraciones.)
 */
export async function ensureAdminFromEnv(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !pass) return; // sin credenciales en entorno: nada que hacer
  const admins = await query<{ id: string }>(
    "select id from br_users where role = 'admin' limit 1",
  );
  if (admins.length) return; // ya hay admin: nunca se pisa su contraseña
  if (pass.length < 8) {
    console.warn("[db] ADMIN_PASSWORD corta (<8): no se crea el admin automático.");
    return;
  }
  await execute(
    "insert into br_users (id, name, email, pass_hash, role, status, dni, vehicle, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId("u"),
      "Administrador",
      email,
      await hashPassword(pass),
      "admin",
      "activo",
      null,
      null,
      Date.now(),
    ],
  );
  console.log(`[db] admin inicial creado desde el entorno: ${email}`);
}

/* ---------------------------------------------------- TOTP (2FA de admin) */

/**
 * Verificacion en dos pasos segun RFC 6238 (HMAC-SHA1, paso de 30 s, 6
 * digitos): lo que hablan Google Authenticator, Aegis, Authy, 1Password...
 * Implementado con `node:crypto` puro (como el scrypt de las contraseñas):
 * cero dependencias nativas, igual en Windows y en el hosting.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32Encode(buf: Buffer): string {
  let acc = 0;
  let bits = 0;
  let out = "";
  for (const byte of buf) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

function b32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/\s+/g, "").replace(/=+$/, "");
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("El secreto no es Base32 válido.");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) >>> 0;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Comparacion del codigo actual con ventana +/-1 paso (tolera reloj desajustado 30 s). */
function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (let i = -window; i <= window; i += 1) {
    const expect = hotp(secretB32, step + i);
    if (timingSafeEqual(Buffer.from(expect, "utf8"), Buffer.from(code, "utf8"))) return true;
  }
  return false;
}

function newTotpSecret(): string {
  return b32Encode(randomBytes(20));
}

const hashRecovery = (code: string) => createHash("sha256").update(code).digest("hex");

function parseJsonArray(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Fila TOTP de la cuenta (columnas de la migracion 0022). */
async function getTotpRow(email: string): Promise<{
  secret: string | null;
  enabled: number;
  recovery: string | null;
}> {
  try {
    const rows = await query<{
      totp_secret: string | null;
      totp_enabled: number;
      totp_recovery: string | null;
    }>("select totp_secret, totp_enabled, totp_recovery from br_users where email = ? limit 1", [
      email,
    ]);
    const r = rows[0];
    return {
      secret: r?.totp_secret ?? null,
      enabled: Number(r?.totp_enabled ?? 0),
      recovery: r?.totp_recovery ?? null,
    };
  } catch {
    /* BD antigua sin las columnas todavia: 2FA inactivo (el login no se rompe) */
    return { secret: null, enabled: 0, recovery: null };
  }
}

/**
 * Prueba el segundo factor: TOTP actual, codigo de respaldo propio o —si el
 * equipo lo ha generado— el codigo maestro de emergencia (migracion 0024).
 * Si acierta con un respaldo, lo consume (un codigo de recuperacion vale una
 * sola vez); el maestro NO se consume: es compartido y se rota cuando se quiera.
 */
async function checkSecondFactor(
  email: string,
  code: string,
): Promise<{ ok: boolean; via: "totp" | "recuperacion" | "maestro" | null }> {
  const row = await getTotpRow(email);
  if (!row.secret) return { ok: false, via: null };
  if (verifyTotp(row.secret, code.trim())) return { ok: true, via: "totp" };
  const list = parseJsonArray(row.recovery);
  const h = hashRecovery(code.trim().toLowerCase());
  const idx = list.indexOf(h);
  if (idx >= 0) {
    const left = list.filter((_, i) => i !== idx);
    await execute("update br_users set totp_recovery = ? where email = ?", [
      JSON.stringify(left),
      email,
    ]);
    return { ok: true, via: "recuperacion" };
  }
  // Ultima puerta: el codigo maestro compartido del equipo. Si alguien entra
  // por aqui se audita como `login.admin` con `via: "maestro"` (lo hace
  // `loginAdmin`, que ya registra el `via`).
  if (await matchesMasterCode(code)) return { ok: true, via: "maestro" };
  return { ok: false, via: null };
}

/* ------------------------------------------------------- guard de login */

/**
 * Bloqueo por intentos fallidos (fuerza bruta / robo de cuentas). Todo en
 * servidor y "fail-open": cualquier error en la tabla de intentos deja pasar
 * el login para no romper NUNCA un acceso legitimo. Umbral generoso.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOGIN_MAX_FAILS = 20; // por email: antes 8 (un atacante lo usaba para bloquear a clientes inocentes)

/**
 * IP real del visitante. OJO con el orden: el PRIMER elemento de
 * `x-forwarded-for` lo escribe el propio cliente (se puede inventar uno nuevo
 * en cada request y obtener contadores vírgenes), así que solo vale el ÚLTIMO
 * salto — que es el que añade nuestro proxy — y preferimos las cabeceras que
 * pone directamente el CDN (`cf-connecting-ip` / `x-real-ip`).
 */
function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    const cdn = h?.get("cf-connecting-ip")?.trim() || h?.get("x-real-ip")?.trim();
    if (cdn) return cdn;
    const parts = (h?.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts[parts.length - 1] || "unknown";
  } catch {
    return "unknown";
  }
}

/** Navegador/sistema del visitante (cabecera `user-agent`), recortado a 512. */
function userAgent(): string {
  try {
    return (getRequest()?.headers?.get("user-agent") ?? "").slice(0, 512);
  } catch {
    return "";
  }
}

/**
 * Descripción legible del dispositivo a partir del user-agent, sin dependencias
 * (se usa en el aviso de «nueva sesión» y en el panel de accesos). Nunca lanza.
 */
function describeDevice(ua: string): string {
  const s = ua || "";
  let os = "dispositivo desconocido";
  if (/Windows/i.test(s)) os = "Windows";
  else if (/Android/i.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Macintosh|Mac OS X/i.test(s)) os = "macOS";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";
  let browser = "navegador";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Firefox/i.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS/i.test(s)) browser = "Chrome";
  else if (/Safari/i.test(s)) browser = "Safari";
  return `${browser} · ${os}`;
}

/** Máscara de IP para mostrarla tapada en el panel (74.220.***.***). */
export function maskIp(ip: string | null): string {
  const t = (ip || "").trim();
  if (!t || t === "unknown") return t || "—";
  if (t.includes(":")) return `${t.split(":")[0] ?? "*"}:****:****`; // IPv6
  const p = t.split(".");
  if (p.length !== 4 || p.some((x) => !x)) return "****";
  return `${p[0]}.${p[1]}.***.***`;
}

/* --------------------------------------------------------- bloqueo por IP */

/**
 * IPs baneadas cacheadas en memoria (TTL corto) para no golpear la BD en cada
 * petición. `fail-open`: si la tabla aún no existe (BD sin migrar) o la lectura
 * falla, se trata como «ninguna IP baneada» — NUNCA bloquea un acceso legítimo
 * ni tumba el arranque. `invalidateBanCache()` fuerza el refresco al banear.
 */
let bannedIpCache: { set: Set<string>; at: number } = { set: new Set(), at: 0 };
const BANNED_IP_TTL_MS = 20_000;

async function bannedIpSet(): Promise<Set<string>> {
  const now = Date.now();
  if (now - bannedIpCache.at < BANNED_IP_TTL_MS) return bannedIpCache.set;
  try {
    const rows = await query<{ ip: string }>("select ip from br_ip_bans");
    bannedIpCache = { set: new Set(rows.map((r) => r.ip)), at: now };
  } catch {
    bannedIpCache = { set: new Set(), at: now };
  }
  return bannedIpCache.set;
}

function invalidateBanCache(): void {
  bannedIpCache = { set: new Set(), at: 0 };
}

/** ¿La IP está baneada? (`unknown` nunca lo está, para no bloquear el dev). */
async function ipIsBanned(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  return (await bannedIpSet()).has(ip);
}

/** Lanza si la IP del visitante está baneada (puertas que no devuelven msg). */
async function assertNotBanned(): Promise<void> {
  if (await ipIsBanned(clientIp())) {
    throw new Error(
      "Tu dirección no puede usar Botella Rápida. Si crees que es un error, contacta con soporte.",
    );
  }
}

/**
 * Tope de fallos por RED/IP de origen, en memoria (por proceso). Es lo que
 * convierte el guard en «a prueba de bloqueos»: quien dispara contra emails
 * ajenos se corta a sí mismo antes de poder cerrar la puerta a un cliente.
 */
const LOGIN_IP_MAX_FAILS = 12;
const loginFailsByIp = new Map<string, number[]>();

function recentIpLoginFails(ip: string): number {
  const now = Date.now();
  const hits = (loginFailsByIp.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFailsByIp.set(ip, hits);
  return hits.length;
}

function noteIpLoginFail(ip: string): void {
  const now = Date.now();
  if (loginFailsByIp.size > 5000) {
    for (const [k, arr] of loginFailsByIp) {
      const fresh = arr.filter((t) => now - t < LOGIN_WINDOW_MS);
      if (fresh.length === 0) loginFailsByIp.delete(k);
    }
  }
  const hits = (loginFailsByIp.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  hits.push(now);
  loginFailsByIp.set(ip, hits);
}

/**
 * Ventana deslizante genérica en memoria: segunda capa anti-abuso para los
 * endpoints abiertos (soporte, reclamaciones, donaciones, reseñas).
 * `fail-open`: un error del mapa jamas bloquea una operación legitima; solo
 * el exceso de ritmo lanza. Es POR PROCESO (defensa de app; el blindaje
 * gordo va delante, en Cloudflare).
 */
const throttleWindows = new Map<string, number[]>();

function assertThrottle(key: string, max: number, windowMs: number, msg: string): void {
  try {
    const now = Date.now();
    if (throttleWindows.size > 5000) {
      for (const [k, arr] of throttleWindows) {
        const fresh = arr.filter((t) => now - t < windowMs);
        if (fresh.length === 0) throttleWindows.delete(k);
      }
    }
    const hits = (throttleWindows.get(key) ?? []).filter((t) => now - t < windowMs);
    hits.push(now);
    throttleWindows.set(key, hits);
    if (hits.length > max) throw new Error(msg);
  } catch (err) {
    if (err instanceof Error && err.message === msg) throw err;
    /* fallo inesperado del mapa: dejar pasar (fail-open) */
  }
}

/** Fallos recientes de un email. Ante cualquier error devuelve 0 (deja pasar). */
async function recentLoginFails(email: string): Promise<number> {
  try {
    const rows = await query<{ n: number }>(
      `select count(*) as n from br_login_attempts
         where email = ? and ok = 0 and created_at >= ?`,
      [email, Date.now() - LOGIN_WINDOW_MS],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Registra el resultado; si es correcto limpia los fallos de ese email. */
async function recordLoginAttempt(email: string, ok: boolean): Promise<void> {
  try {
    const aIp = clientIp();
    const aUa = userAgent();
    try {
      await execute(
        "insert into br_login_attempts (email, ok, created_at, ip, user_agent) values (?, ?, ?, ?, ?)",
        [email, ok ? 1 : 0, Date.now(), aIp, aUa],
      );
    } catch {
      // BD sin la migración 0033: se registramos el intento sin IP, no rompe.
      await execute("insert into br_login_attempts (email, ok, created_at) values (?, ?, ?)", [
        email,
        ok ? 1 : 0,
        Date.now(),
      ]);
    }
    if (ok) {
      await execute("delete from br_login_attempts where email = ? and ok = 0", [email]);
    }
  } catch {
    /* best-effort: un fallo aqui nunca debe romper el login */
  }
}

export async function login(
  email: string,
  pass: string,
): Promise<{ ok: boolean; msg: string; session?: SessionInfo; totpRequired?: boolean }> {
  const em = email.trim().toLowerCase();
  const ip = clientIp();
  if (await ipIsBanned(ip)) {
    return {
      ok: false,
      msg: "Acceso denegado desde tu dirección. Si crees que es un error, contacta con soporte.",
    };
  }
  if (recentIpLoginFails(ip) >= LOGIN_IP_MAX_FAILS) {
    return {
      ok: false,
      msg: "Demasiados intentos desde tu red. Espera unos minutos antes de reintentar.",
    };
  }
  if ((await recentLoginFails(em)) >= LOGIN_MAX_FAILS) {
    return {
      ok: false,
      msg: "Demasiados intentos fallidos. Espera unos minutos antes de reintentar.",
    };
  }
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
    [em],
  );
  const user = rows[0];
  if (!user || isLegacyHash(user.pass_hash)) {
    await recordLoginAttempt(em, false);
    noteIpLoginFail(ip);
    return { ok: false, msg: "Email o contraseña incorrectos." };
  }
  if (!(await verifyPassword(pass, user.pass_hash))) {
    await recordLoginAttempt(em, false);
    noteIpLoginFail(ip);
    return { ok: false, msg: "Email o contraseña incorrectos." };
  }
  if (user.status === "solicitud") {
    return {
      ok: false,
      msg: `Tu solicitud de repartidor (DNI ${user.dni}) sigue pendiente de aprobación.`,
    };
  }
  if (user.status === "rechazado") {
    return { ok: false, msg: "Tu solicitud de repartidor fue rechazada. Contacta con soporte." };
  }
  if (user.status === "suspendido") {
    return { ok: false, msg: "Cuenta suspendida. Contacta con soporte." };
  }
  // Contraseña correcta pero correo sin confirmar: NO se da sesión. Se reenvía
  // el enlace (best-effort) para que el usuario no se quede atascado.
  if (Number(user.email_verified ?? 1) === 0) {
    await sendVerificationEmail(em).catch(() => undefined);
    return {
      ok: false,
      msg: "Confirma primero tu correo: te hemos enviado un enlace de activación (revisa también Spam).",
    };
  }
  // Ultra seguridad (Fase 2): si la cuenta de admin tiene 2FA activo, la
  // contraseña sola NO abre sesión: falta el código de la app autenticadora,
  // que se pide en un segundo paso (`loginAdmin`). Sin 2FA activado, el login
  // es idéntico al de siempre — nadie más nota nada.
  if (user.role === "admin") {
    const totp = await getTotpRow(em);
    if (totp.enabled === 1) {
      // IMPORTANTE: aqui NO se limpian los contadores. Mientras el segundo
      // factor no se supere, la autenticación no ha terminado: si los
      // limpiáramos solo por acertar la contraseña, un atacante con ella
      // podría reintentar códigos TOTP al infinito (login -> reset -> fallo ->
      // login -> reset...). La limpieza la hace `loginAdmin` al validar el
      // código, que es cuando la autenticación es de verdad completa.
      return {
        ok: false,
        totpRequired: true,
        msg: "Introduce el código de verificación de tu app autenticadora.",
      };
    }
  }
  // Autenticación completa (contraseña y, si aplica, segundo factor):
  // se resetea el contador de fuerza bruta.
  loginFailsByIp.delete(ip);
  await recordLoginAttempt(em, true);
  const session = await createSession(user);
  // Emitimos también la cookie httpOnly (canal adicional para el dominio real).
  await setSidCookie(session.sid);
  // Aviso best-effort si el acceso viene de un dispositivo/IP desconocidos para
  // esta cuenta (va en segundo plano: nunca retrasa ni rompe el login).
  void maybeAlertNewDevice(em, ip, userAgent()).catch(() => undefined);
  return { ok: true, msg: "Bienvenido.", session };
}

/**
 * Segundo paso del acceso de admin (Fase 2 «ultra seguridad»): la contraseña
 * ya es correcta y además hay que probar el segundo factor (código TOTP de la
 * app o código de recuperación de un solo uso). Mismos guards anti fuerza
 * bruta que `login`; el intento de código fallido también cuenta como fallo.
 */
export async function loginAdmin(
  email: string,
  pass: string,
  code: string,
): Promise<{ ok: boolean; msg: string; session?: SessionInfo; totpRequired?: boolean }> {
  const em = email.trim().toLowerCase();
  const ip = clientIp();
  if (await ipIsBanned(ip)) {
    return {
      ok: false,
      msg: "Acceso denegado desde tu dirección. Si crees que es un error, contacta con soporte.",
    };
  }
  if (recentIpLoginFails(ip) >= LOGIN_IP_MAX_FAILS) {
    return {
      ok: false,
      msg: "Demasiados intentos desde tu red. Espera unos minutos antes de reintentar.",
    };
  }
  if ((await recentLoginFails(em)) >= LOGIN_MAX_FAILS) {
    return {
      ok: false,
      msg: "Demasiados intentos fallidos. Espera unos minutos antes de reintentar.",
    };
  }
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
    [em],
  );
  const user = rows[0];
  if (!user || user.role !== "admin" || isLegacyHash(user.pass_hash)) {
    await recordLoginAttempt(em, false);
    noteIpLoginFail(ip);
    return { ok: false, msg: "Email o contraseña incorrectos." };
  }
  if (!(await verifyPassword(pass, user.pass_hash))) {
    await recordLoginAttempt(em, false);
    noteIpLoginFail(ip);
    return { ok: false, msg: "Email o contraseña incorrectos." };
  }
  if (user.status === "suspendido") {
    return { ok: false, msg: "Cuenta suspendida. Contacta con soporte." };
  }
  if (Number(user.email_verified ?? 1) === 0) {
    await sendVerificationEmail(em).catch(() => undefined);
    return {
      ok: false,
      msg: "Confirma primero tu correo: te hemos enviado un enlace de activación (revisa también Spam).",
    };
  }
  // Contador PROPIO para el segundo factor, independiente del de contraseña:
  // seis códigos malos en 15 min = espera, aunque la contraseña sea correcta.
  // Sin esto, el espacio de 10^6 códigos TOTP se podría probar sin límite.
  try {
    assertThrottle(
      `2fa:${em}`,
      6,
      LOGIN_WINDOW_MS,
      "Demasiados códigos fallidos. Espera 15 minutos.",
    );
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  }
  const check = await checkSecondFactor(em, code);
  if (!check.ok) {
    await recordLoginAttempt(em, false);
    noteIpLoginFail(ip);
    return { ok: false, msg: "Código de verificación no válido (o caducado)." };
  }
  // Código correcto: autenticación totalmente completada. Se limpia el contador
  // PROPIO del 2FA (si no, un admin legítimo que entre varias veces en 15 min
  // se auto-bloquearía con un mensaje de «códigos fallidos» que no es cierto)
  // y los contadores de fuerza bruta de contraseña/IP.
  throttleWindows.delete(`2fa:${em}`);
  loginFailsByIp.delete(ip);
  await recordLoginAttempt(em, true);
  const session = await createSession(user);
  await setSidCookie(session.sid);
  void maybeAlertNewDevice(em, ip, userAgent()).catch(() => undefined);
  void audit(em, "login.admin", "", { via: check.via });
  return { ok: true, msg: "Bienvenido.", session };
}

/* ------------------------------------------------- gestión del 2FA (admin) */

export type TwoFactorStatus = { enabled: boolean; recoveryLeft: number };

/** Estado del segundo factor de la cuenta admin que llama (para el panel). */
export async function twoFactorStatus(sid: string | undefined): Promise<TwoFactorStatus> {
  const s = await requireSession(sid, ["admin"]);
  const row = await getTotpRow(s.email);
  return { enabled: Number(row.enabled) === 1, recoveryLeft: parseJsonArray(row.recovery).length };
}

export type TwoFactorSetup = { secret: string; qrDataUrl: string; otpauthUrl: string };

/**
 * Prepara el alta del 2FA: genera un secreto NUEVO (queda PENDIENTE hasta
 * `confirmTwoFactor`), el enlace otpauth: que leen todas las apps autenticadoras
 * y el QR como data-URL (se pinta con <img> sin tocar estilos ni assets).
 * `qrcode` se importa en dynamic import: solo pesa cuando alguien abre este paso.
 */
export async function beginTwoFactor(sid: string | undefined): Promise<TwoFactorSetup> {
  const s = await requireSession(sid, ["admin"]);
  const secret = newTotpSecret();
  const otpauthUrl =
    `otpauth://totp/BotellaRapida:${encodeURIComponent(s.email)}` +
    `?secret=${secret}&issuer=BotellaRapida&algorithm=SHA1&digits=6&period=30`;
  const { toDataURL } = await import("qrcode");
  const qrDataUrl = await toDataURL(otpauthUrl, { errorCorrectionLevel: "m" });
  await execute("update br_users set totp_secret = ?, totp_enabled = 0 where email = ?", [
    secret,
    s.email,
  ]);
  return { secret, qrDataUrl, otpauthUrl };
}

/**
 * Confirma el alta: exige el código de 6 dígitos generado con el secreto
 * PENDING (así no se activa con un secreto que nadie llegó a escanear) y
 * entrega 8 códigos de respaldo — solo se muestran esta única vez, se guardan
 * como hash SHA-256 igual que las contraseñas.
 */
export async function confirmTwoFactor(
  sid: string | undefined,
  secret: string,
  code: string,
): Promise<{ ok: boolean; msg: string; recovery?: string[] }> {
  const s = await requireSession(sid, ["admin"]);
  const clean = secret.trim().toUpperCase();
  if (!/^[A-Z2-7]{16,64}$/.test(clean)) return { ok: false, msg: "El secreto no es válido." };
  const row = await getTotpRow(s.email);
  if (!row.secret || row.secret !== clean) {
    return { ok: false, msg: "El secreto ha cambiado: vuelve a generar el código QR." };
  }
  if (!verifyTotp(clean, code.trim())) {
    return { ok: false, msg: "Código incorrecto: prueba con el que aparece ahora mismo." };
  }
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
  await execute("update br_users set totp_enabled = 1, totp_recovery = ? where email = ?", [
    JSON.stringify(codes.map(hashRecovery)),
    s.email,
  ]);
  void audit(s.email, "2fa.activar", s.email);
  return { ok: true, msg: "Verificación en dos pasos activada.", recovery: codes };
}

/** Desactiva el 2FA: exige un código VÁLIDO primero (nadie lo apaga de fuera). */
export async function disableTwoFactor(
  sid: string | undefined,
  code: string,
): Promise<{ ok: boolean; msg: string }> {
  const s = await requireSession(sid, ["admin"]);
  const check = await checkSecondFactor(s.email, code);
  if (!check.ok) {
    return { ok: false, msg: "Código incorrecto: la verificación en dos pasos sigue activa." };
  }
  await execute(
    "update br_users set totp_secret = null, totp_enabled = 0, totp_recovery = null where email = ?",
    [s.email],
  );
  void audit(s.email, "2fa.desactivar", s.email);
  return { ok: true, msg: "Verificación en dos pasos desactivada." };
}

/* ------------------------------------------ código maestro de emergencia */

/**
 * Segundo factor COMPARTIDO del equipo para emergencias («break glass»): si la
 * app autenticadora falla (móvil perdido, reloj desincronizado) o la situación
 * se tuerce (contraseña comprometida mientras se cambia), las 3-5 personas de
 * confianza entran en el panel escribiendo ESTE código en el paso del código,
 * junto a la contraseña de admin de siempre.
 *
 * En `br_master_code` (migración 0024) solo vive su hash SHA-256 —nunca el
 * código en claro—, igual que con las contraseñas. Si la tabla está vacía, la
 * funcionalidad NO EXISTE: el 2FA y el login se comportan exactamente como
 * siempre. El código se puede rotar o quitar cuando se quiera desde «Seguridad».
 *
 * Formato: 16 caracteres hex (64 bits de entropía) mostrados en grupos de 4,
 * p. ej. `A1B2-C3D4-E5F6-7890`. Se compara sin espacios ni guiones y sin
 * distinguir mayúsculas/minusculas, y está protegido por el mismo contador
 * anti fuerza bruta del 2FA (6 códigos mal por 15 min).
 */

/** Forma canónica para hashear/comparar: minúsculas, solo alfanumérico. */
function normalizeMasterCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Formato «humano»: mayúsculas y grupos de 4 separados por guiones. */
function prettyMasterCode(hex: string): string {
  return hex.toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

/** ¿`input` coincide con el código maestro? Comparación constante en tiempo. */
async function matchesMasterCode(input: string): Promise<boolean> {
  const norm = normalizeMasterCode(input);
  if (norm.length !== 16) return false; // filtro rápido: ni consulta con basura
  try {
    const rows = await query<{ code_hash: string }>(
      "select code_hash from br_master_code where id = 1 limit 1",
    );
    const stored = rows[0]?.code_hash;
    if (!stored) return false;
    const given = createHash("sha256").update(norm).digest();
    const want = Buffer.from(stored, "hex");
    return given.length === want.length && timingSafeEqual(given, want);
  } catch {
    return false; // tabla aún sin migrar: no rompe NUNCA un login legítimo
  }
}

export type MasterCodeStatus = { configured: boolean; updatedAt: number | null };

/** ¿Hay código maestro de emergencia? ¿Cuándo se rotó? (solo admin). */
export async function masterCodeStatus(sid: string | undefined): Promise<MasterCodeStatus> {
  await requireSession(sid, ["admin"]);
  try {
    const rows = await query<{ updated_at: number }>(
      "select updated_at from br_master_code where id = 1 limit 1",
    );
    const r = rows[0];
    return { configured: !!r, updatedAt: r ? Number(r.updated_at) : null };
  } catch {
    return { configured: false, updatedAt: null };
  }
}

/**
 * Genera un código maestro NUEVO y sustituye al anterior (el viejo deja de
 * valer al instante). El código en claro se devuelve SOLO en esta respuesta:
 * en la BD no queda forma de «recuperarlo» luego — si se pierde, se gira otro.
 */
export async function rotateMasterCode(
  sid: string | undefined,
): Promise<{ ok: true; code: string; msg: string }> {
  const s = await requireSession(sid, ["admin"]);
  const hex = randomBytes(8).toString("hex");
  await execute(
    "insert into br_master_code (id, code_hash, updated_at) values (1, ?, ?) " +
      "on duplicate key update code_hash = values(code_hash), updated_at = values(updated_at)",
    [hashRecovery(normalizeMasterCode(hex)), Date.now()],
  );
  void audit(s.email, "codigo.maestro.rotar", "");
  return { ok: true, code: prettyMasterCode(hex), msg: "Código maestro generado." };
}

/** Quita el código maestro: el 2FA vuelve a depender solo de la app y los respaldos. */
export async function revokeMasterCode(
  sid: string | undefined,
): Promise<{ ok: true; msg: string }> {
  const s = await requireSession(sid, ["admin"]);
  await execute("delete from br_master_code where id = 1");
  void audit(s.email, "codigo.maestro.revocar", "");
  return { ok: true, msg: "Código maestro eliminado." };
}

/** Cierra la sesión pasada y todas las del usuario (cambio de estado, "Salir"). */
export async function logout(sid: string | undefined): Promise<{ ok: true }> {
  const token = await resolveToken(sid);
  await clearSidCookie();
  if (!token) return { ok: true };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await execute("delete from br_sessions where token_hash = ?", [tokenHash]);
  return { ok: true };
}

/**
 * Recupera la sesión desde la cookie httpOnly (sin `sid` en el body). La usan
 * los navegadores móviles al arrancar, que suelen vaciar `sessionStorage` al
 * cerrar la pestaña: en el dominio real la cookie sigue viva y el usuario no
 * tiene que volver a entrar. `readSession(undefined)` cae en el canal cookie.
 */
export async function restoreSession(): Promise<SessionInfo | null> {
  return readSession(undefined);
}

/* -------------------------------------------------------- login con Google */

/**
 * «Continuar con Google» (Google Identity Services): gratis, sin instalar SDK
 * (el navegador carga el script oficial y obtiene un ID token JWT). Aquí ese
 * token se VERIFICA de verdad antes de dar ninguna sesión: firma RS256 contra
 * el JWKS oficial de Google, `aud` = nuestra `GOOGLE_CLIENT_ID`, emisor de
 * Google y caducidad con 60 s de holgura. Un token robado de otra app o
 * fabricado no abre sesión: el email lo firma Google, nunca el navegador.
 *
 * Requiere en el entorno `GOOGLE_CLIENT_ID` (OAuth «Web application» de
 * Google Cloud con el dominio en los orígenes permitidos). Sin esa variable
 * el botón simplemente no aparece y el login por contraseña sigue igual.
 */
export function googleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}

export function googleSignInEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

/**
 * Estado del «Continuar con Google» para el botón. Es ASÍNCRONO a propósito:
 * garantiza que el `.env` local está volcado en `process.env` antes de leer
 * `GOOGLE_CLIENT_ID` (en producción el entorno del hosting ya está presente).
 */
export async function googleStatus(): Promise<{ enabled: boolean; clientId: string }> {
  await ensureEnvLoaded();
  return { enabled: googleSignInEnabled(), clientId: googleClientId() };
}

/** Claves públicas de Google cacheadas: rotan pocas veces; 6 h está bien. */
let googleKeysCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;
const GOOGLE_KEYS_TTL_MS = 6 * 60 * 60 * 1000;

async function getGoogleSigningKeys(): Promise<Map<string, KeyObject>> {
  const now = Date.now();
  if (googleKeysCache && now - googleKeysCache.fetchedAt < GOOGLE_KEYS_TTL_MS) {
    return googleKeysCache.keys;
  }
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error("No se pudieron obtener las claves de Google.");
  const jwks = (await res.json()) as { keys: Array<{ kid?: string; [k: string]: unknown }> };
  const map = new Map<string, KeyObject>();
  for (const jwk of jwks.keys || []) {
    if (!jwk.kid) continue;
    try {
      // El `JsonWebKey` del DOM y el de node:crypto no son el mismo tipo: se
      // usa el de Node, que es el que acepta `createPublicKey`.
      map.set(jwk.kid, createPublicKey({ key: jwk as unknown as NodeJsonWebKey, format: "jwk" }));
    } catch {
      /* clave en formato no soportado: se ignora */
    }
  }
  googleKeysCache = { keys: map, fetchedAt: now };
  return map;
}

async function verifyGoogleIdToken(credential: string): Promise<{ email: string; name: string }> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("El acceso con Google no está activo.");
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Token de Google no válido.");
  const [h64, p64, s64] = parts;
  const header = JSON.parse(Buffer.from(h64, "base64url").toString("utf8")) as {
    kid?: string;
    alg?: string;
  };
  const payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (payload.aud !== clientId) throw new Error("El token no es de esta app.");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("Emisor de token no reconocido.");
  }
  // 60 s de holgura para relojes desincronizados; más que eso, caducado.
  if (!payload.exp || payload.exp * 1000 < Date.now() - 60_000) {
    throw new Error("El token de Google ha caducado. Inténtalo otra vez.");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("Token de Google no válido.");
  const key = (await getGoogleSigningKeys()).get(header.kid);
  if (!key) throw new Error("No se pudo verificar la firma del token.");
  const valid = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${h64}.${p64}`),
    key,
    Buffer.from(s64, "base64url"),
  );
  if (!valid) throw new Error("La firma del token no es válida.");
  // Cuentas con email no verificado (raro en Google) no abren cuenta.
  if (!payload.email || payload.email_verified !== true) {
    throw new Error("El email de esa cuenta Google no está verificado.");
  }
  return {
    email: payload.email.trim().toLowerCase(),
    name: (payload.name || payload.email.split("@")[0]).trim().slice(0, 191),
  };
}

/**
 * Entrada o alta con Google. LO DECIDE LA PUERTA (la página que llama) y el
 * servidor lo contrasta:
 *  - Puerta de cliente: si hay cuenta con ese email (creada con contraseña o
 *    no) entra; si no existe, se crea como cliente activo al vuelo — sin
 *    contraseña, porque la pone Google. Es justo lo del «olvidé mi contraseña».
 *  - Puerta de repartidor: SOLO entran repartidores ya aprobados. El alta de
 *    repartidor exige DNI y aprobación del admin: un OAuth no se la salta.
 *  - Un OAuth nunca crea ni loguea admins: si el email es un admin, esta
 *    puerta lo rechaza (el panel se rige por contraseña).
 */
export async function googleSignIn(
  credential: string,
  intent: "cliente" | "repartidor",
): Promise<{ ok: boolean; msg: string; session?: SessionInfo }> {
  await ensureEnvLoaded();
  const gIp = clientIp();
  if (await ipIsBanned(gIp)) {
    return {
      ok: false,
      msg: "Acceso denegado desde tu dirección. Si crees que es un error, contacta con soporte.",
    };
  }
  const g = await verifyGoogleIdToken(credential);
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
    [g.email],
  );
  let user = rows[0];

  if (!user && intent === "repartidor") {
    return {
      ok: false,
      msg: "Ese Gmail no tiene alta de repartidor. Solicita plaza desde el registro.",
    };
  }

  if (!user) {
    // Alta exprés de cliente. El pass_hash es un valor aleatorio imposible de
    // usar: esta cuenta solo se abre con Google (o recupera el email si un día
    // quiere contraseña).
    try {
      await execute(
        "insert into br_users (id, name, email, pass_hash, role, status, dni, vehicle, phone, created_at) " +
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          newId("u"),
          g.name,
          g.email,
          `scrypt$${randomBytes(8).toString("hex")}$${randomBytes(64).toString("hex")}`,
          "user",
          "activo",
          null,
          null,
          null,
          Date.now(),
        ],
      );
      noteRegistration();
    } catch (err) {
      if ((err as { code?: string }).code !== "ER_DUP_ENTRY") throw err;
      // Carrera entre dos dispositivos del mismo cliente: la cuenta ya estaba.
    }
    const again = await query<UserRowDto>(
      `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
      [g.email],
    );
    user = again[0];
    if (!user) return { ok: false, msg: "No se pudo crear la cuenta. Inténtalo de nuevo." };
  }

  if (intent === "repartidor" && user.role !== "repartidor") {
    return { ok: false, msg: "Esa cuenta no es de repartidor. Entra por la puerta de clientes." };
  }
  if (user.role === "admin") {
    return { ok: false, msg: "Las cuentas de administración entran con su contraseña." };
  }
  if (user.status === "solicitud") {
    return { ok: false, msg: "Tu solicitud de repartidor sigue pendiente de aprobación." };
  }
  if (user.status === "rechazado") {
    return { ok: false, msg: "Tu solicitud de repartidor fue rechazada. Contacta con soporte." };
  }
  if (user.status === "suspendido") {
    return { ok: false, msg: "Cuenta suspendida. Contacta con soporte." };
  }
  // Google ya certificó que el correo es suyo: si la cuenta estaba pendiente de
  // confirmación por contraseña, entrar por Google la activa (sin duplicados).
  if (Number(user.email_verified ?? 1) === 0) {
    await execute("update br_users set email_verified = 1 where email = ?", [user.email]);
    await execute("delete from br_email_verifications where email = ?", [user.email]);
  }
  const session = await createSession(user);
  await setSidCookie(session.sid);
  void maybeAlertNewDevice(user.email, gIp, userAgent()).catch(() => undefined);
  return { ok: true, msg: "Bienvenido.", session };
}

/* ------------------------------------------------- recuperación de contraseña */

/** El enlace de restablecimiento caduca a la hora. */
const RESET_TTL_MS = 60 * 60 * 1000;
/**
 * Anti-spam del flujo de recuperación: ventana deslizante en memoria que limita
 * cuántos enlaces se emiten por minuto por proceso. Es un techo ABSOLUTO: el
 * límite fino va por cuenta y por red (`assertThrottle` en
 * `requestPasswordReset`), para que un spammer no pueda dejar a toda la tienda
 * sin recuperación consumiendo una ventana global pequeñita.
 */
const RESET_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const RESET_MAX_PER_WINDOW = 60;
const recentResetRequests: number[] = [];

function resetRequestsInWindow(): number {
  const now = Date.now();
  while (recentResetRequests.length && now - recentResetRequests[0] > RESET_REQUEST_WINDOW_MS) {
    recentResetRequests.shift();
  }
  return recentResetRequests.length;
}

function noteResetRequest(): void {
  recentResetRequests.push(Date.now());
  if (recentResetRequests.length > RESET_MAX_PER_WINDOW * 10) {
    recentResetRequests.splice(0, recentResetRequests.length - RESET_MAX_PER_WINDOW);
  }
}

/**
 * Envía un correo automatizado por SMTP. Best-effort y NO letal: sin
 * `SMTP_HOST` registrado simplemente avisa (el flujo de negocio sigue); si el
 * proveedor falla, log y seguimos. Lo usan tanto la recuperación de contraseña
 * como las notificaciones de pedido (asignado / en reparto / entregado).
 */
/**
 * Remitente por defecto de TODOS los correos automáticos (verificación,
 * recuperación, avisos de pedido). Se puede pisar con `SMTP_FROM`; si no, sale
 * como Botella Rápida <botellarapidadmin@gmail.com>. Para que Gmail lo acepte
 * como From, `SMTP_USER` debe ser esa misma cuenta (con contraseña de aplicación
 * en `SMTP_PASS`); así el usuario ve siempre el mismo remitente known.
 */
function mailFrom(): string {
  const from = process.env.SMTP_FROM?.trim();
  if (from) return from;
  // Sin SMTP_FROM explícito, usamos la MISMA cuenta que autentica (`SMTP_USER`):
  // Gmail rechaza un `From` de otro dominio (spoofing), y así el remitente sale
  // siempre conocido y válido para el proveedor.
  const user = process.env.SMTP_USER?.trim();
  if (user) return `Botella R\u00e1pida <${user}>`;
  return "Botella R\u00e1pida <botellarapidadmin@gmail.com>";
}

/** `true` si hay correo de salida: SMTP clásico o API de Brevo por HTTPS. */
export function smtpEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST || brevoApiKey());
}

/**
 * Clave de la API v3 de Brevo (empieza por `xkeysib-…`, NO la SMTP key
 * `xsmtpsib-…`). Si existe, TODOS los correos salen por HTTPS (puerto 443):
 * es la vía que funciona en el plan gratis de Render, que corta la salida
 * SMTP por los puertos 25/465/587. Sin esta variable se sigue usando SMTP.
 */
function brevoApiKey(): string {
  return process.env.BREVO_API_KEY?.trim() || "";
}

/**
 * Remitente para la API de Brevo: `SMTP_FROM` si está puesto (admite
 * «Nombre <email>» o un email pelado); si no, el correo de la tienda. Brevo
 * solo deja enviar desde remitentes VERIFICADOS de la cuenta (el email con el
 * que te registraste ya lo está automáticamente).
 */
function brevoSender(): { name: string; email: string } {
  const raw =
    (process.env.SMTP_FROM?.trim() || process.env.ADMIN_EMAIL?.trim() || "").replace(
      /^"|"$/g,
      "",
    ) || "botellarapidadmin@gmail.com";
  const m = /^(.*?)<([^>]+)>$/.exec(raw);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    return { name: name || "Botella R\u00e1pida", email: m[2].trim() };
  }
  return { name: "Botella R\u00e1pida", email: raw };
}

/**
 * Envío por la API v3 de Brevo (`POST /v3/smtp/email`, JSON por HTTPS puro):
 * sin sockets SMTP, sin puertos bloqueados y sin login de usuario — solo la
 * `api-key` en una cabecera. Devuelve el mismo espíritu que nodemailer: `ok`
 * y un mensaje legible para el botón de prueba.
 */
async function sendEmailViaBrevo(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: brevoSender(),
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
      // Como en SMTP: el envío SIEMPRE termina (Render congela sockets caídos).
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { messageId?: string } | null;
      return { ok: true, msg: `aceptado (messageId ${j?.messageId || "sin id"})` };
    }
    const body = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, msg: `Brevo respondió ${res.status}: ${body || "sin detalle"}` };
  } catch (err) {
    return {
      ok: false,
      msg: `fallo al llamar a la API de Brevo: ${(err as Error)?.message || err}`,
    };
  }
}

/**
 * Render y muchos hosts no tienen salida IPv6 usable, y nodemailer 10 resuelve
 * el `SMTP_HOST` por su cuenta eligiendo una IP **al azar** entre las v4 y las
 * v6: si cae en una v6 el connect muere con `ENETUNREACH` (los tipos publicados
 * tampoco exponen ya la opción `family` que lo evitaba en v6). Para cerrarlo,
 * resolvemos NOSOTROS el host a IPv4 y se lo pasamos ya resuelto, con
 * `servername` para que el TLS verifique el nombre real del certificado.
 * Si la resolución falla, nodemailer lo intenta a su manera: es una mejora,
 * nunca un bloqueo.
 */
async function smtpResolveIPv4(host: string): Promise<{ host: string; servername?: string }> {
  try {
    const dns = await import("node:dns/promises");
    const ips = await dns.resolve4(host);
    if (ips.length > 0) return { host: ips[0], servername: host };
  } catch {
    /* sin DNS o host ya literal (IP): que lo gestione nodemailer */
  }
  return { host };
}

/**
 * Diagnóstico de SMTP (Fase 13): intento de envío REAL desde el panel con el
 * error EN CLARO si falla (contraseña mala, puerto bloqueado, timeout). A
 * diferencia de los envíos best-effort —que se callan para no romper flujos—,
 * aquí el fallo se muestra tal cual: es la herramienta para responder a
 * «no llega el correo» sin mirar los logs del servidor. Solo admin.
 */
export async function testSmtpEmail(
  sid: string | undefined,
  to?: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const dest = (to?.trim() || admin.email).toLowerCase();
  if (!smtpEnabled()) {
    return {
      ok: false,
      msg: "Faltan las variables de correo en el servidor: SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_PORT (Gmail/Brevo por SMTP) o BREVO_API_KEY (Brevo por HTTPS, la vía que funciona en Render gratis). Sin ellas no sale ningún correo.",
    };
  }
  // La base pública se calcula AHORA, con la petición viva (luego el envío
  // sigue en background y el contexto de request puede haber cerrado).
  const base = publicBaseUrl();
  const testHtml = brandedEmailHtml({
    base,
    heading: "Prueba de correo superada",
    intro:
      "Estás leyendo el correo de Botella Rápida. Si te ha llegado, las confirmaciones de registro y las recuperaciones de contraseña saldrán igual de bien. Puedes borrar este mensaje.",
    ctaLabel: "",
    ctaUrl: "",
  });
  const testText = "Si recibes este mensaje, el correo de Botella Rápida funciona correctamente.";
  // Ruta API de Brevo (BREVO_API_KEY): HTTPS puro, inmune al bloqueo de
  // puertos SMTP de Render; si existe, es la vía PRIORITARIA.
  if (brevoApiKey()) {
    const r = await sendEmailViaBrevo(
      dest,
      "Prueba de correo — Botella Rápida",
      testText,
      testHtml,
    );
    void audit(admin.email, "correo.prueba", dest, {
      ok: r.ok,
      via: "brevo-api",
      error: r.ok ? undefined : r.msg.slice(0, 300),
    });
    return r.ok
      ? { ok: true, msg: `Enviado a ${dest} por la API de Brevo — ${r.msg}. Revisa también Spam.` }
      : { ok: false, msg: `El envío ha fallado: ${r.msg}` };
  }
  try {
    const { createTransport } = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const target = await smtpResolveIPv4(process.env.SMTP_HOST || "");
    const transporter = createTransport({
      host: target.host,
      ...(target.servername ? { servername: target.servername } : {}),
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      const info = await transporter.sendMail({
        from: mailFrom(),
        to: dest,
        subject: "Prueba de correo — Botella Rápida",
        text: testText,
        html: testHtml,
      });
      void audit(admin.email, "correo.prueba", dest, { ok: true });
      const id = typeof info?.messageId === "string" ? info.messageId : "aceptado";
      return {
        ok: true,
        msg: `Enviado a ${dest} — el servidor SMTP lo aceptó (${id}). Revisa también Spam.`,
      };
    } finally {
      transporter.close();
    }
  } catch (err) {
    const m = (err as Error)?.message || String(err);
    void audit(admin.email, "correo.prueba", dest, { ok: false, error: m.slice(0, 300) });
    // Se dice la RUTA usada: si sale «por SMTP» y el fallo es de conexión, la
    // BREVO_API_KEY no está llegando a la app (nombre mal, sin guardar o
    // despliegue viejo), porque con ella activa el envío ni tocaría SMTP.
    const ruta = `SMTP ${process.env.SMTP_HOST || "?"}:${process.env.SMTP_PORT || 587}`;
    return {
      ok: false,
      msg:
        `El envío ha fallado (vía ${ruta}): ${m}. ` +
        "Si el fallo es de conexión/timeout, el hosting bloquea ese puerto: «Probar" +
        " el correo» debe salir por la API de Brevo (variable BREVO_API_KEY con la" +
        " clave xkeysib-…). Si este mensaje dice «vía SMTP» pese a tenerla puesta," +
        " revisa el nombre exacto de la variable y que Render haya re-desplegado.",
    };
  }
}

async function sendEmailBestEffort(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<boolean> {
  // API de Brevo por HTTPS si está configurada (prioritaria en Render gratis);
  // sin ella, SMTP clásico como siempre.
  if (brevoApiKey()) {
    const r = await sendEmailViaBrevo(to, subject, text, html);
    if (!r.ok) console.error(`[email] vía API Brevo — ${r.msg} — no se envió "${subject}" a ${to}`);
    return r.ok;
  }
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.warn(`[email] SMTP no configurado — no se envió "${subject}" a ${to}`);
    return false;
  }
  try {
    const { createTransport } = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const target = await smtpResolveIPv4(host);
    const transporter = createTransport({
      host: target.host,
      ...(target.servername ? { servername: target.servername } : {}),
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      // Timeouts FRONTERIZOS (Fase 13): sin ellos, un puerto de salida bloqueado
      // por el hosting o un handshake caído deja el socket colgado ~2 min y la
      // petición que espera el correo se queda «pillada». 10 s para conectar y
      // saludar, 15 s por socket inactivo: el envío siempre termina.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const from = mailFrom();
    try {
      await transporter.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
    } finally {
      // Cerramos el transporte SIEMPRE: en envíos fire-and-forget un transporter
      // abierto dejaría sockets (y el proceso) colgando tras responder.
      transporter.close();
    }
    return true;
  } catch (err) {
    console.error("[email] fallo al enviar el correo:", (err as Error)?.message || err);
    return false;
  }
}

/**
 * SMS: un SMS de verdad NO es gratis (el operador siempre cobra por envío),
 * así que el canal gratuito son el email y las notificaciones del navegador.
 * Aun así dejamos la costura lista: si en el despliegue aparecen las claves
 * de Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`), el
 * mismo aviso se manda también como SMS sin tocar una línea de código más.
 */
async function sendSmsBestEffort(phone: string, text: string): Promise<boolean> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!account || !token || !from) return false;
  const to = phone.trim();
  if (!/^\+?[\d\s-]{7,20}$/.test(to)) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: text.slice(0, 300) }),
    });
    if (!res.ok) console.warn(`[sms] Twilio respondió ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[sms] fallo al enviar:", (err as Error)?.message || err);
    return false;
  }
}

/**
 * Notifica a las partes implicadas tras un cambio de estado REALIZADO (se
 * dispara después del commit, fire-and-forget: un fallo de correo jamais
 * deshace el reparto). Canales gratuitos: email al repartidor cuando se le
 * asigna, email al cliente cuando el pedido sale / se entrega / se cancela,
 * con enlace de seguimiento en vivo. El SMS es opcional vía costura Twilio.
 */
async function notifyOrderChange(order: Order): Promise<void> {
  const base = publicBaseUrl();
  const trackLink = base ? `${base}/seguimiento/${order.code}` : "";
  const addr = [order.address, order.postalCode].filter(Boolean).join(", ");

  if (order.status === "asignado" && order.courier) {
    // Aviso al repartidor: email (siempre) + SMS (si hay proveedor configurado).
    const u = await query<{ name: string; phone: string | null }>(
      "select name, phone from br_users where email = ? limit 1",
      [order.courier],
    );
    const cash =
      order.paymentMethod === "efectivo" ? ` Cobrar en mano: ${order.total.toFixed(2)} €.` : "";
    await sendEmailBestEffort(
      order.courier,
      `Nuevo reparto ${order.code}`,
      `Hola ${u[0]?.name || ""}:\n\nTe han asignado el pedido ${order.code} a ${addr}.\n\nAbre tu portal para aceptarlo: ${base ? `${base}/repartidor` : "(configura PUBLIC_APP_URL para ver el enlace)"}.${cash}`,
    );
    const phone = u[0]?.phone || "";
    if (phone) {
      void sendSmsBestEffort(
        phone,
        `Botella Rápida: nuevo pedido ${order.code} → ${addr}. Abre la app para aceptarlo.`,
      ).catch(() => undefined);
    }
    void pushNotification(
      order.courier,
      "pedido",
      `🛵 Nuevo reparto ${order.code}`,
      `Dirección: ${addr}`,
      "/repartidor",
    );
    return;
  }

  if (order.status === "en_reparto") {
    const where = trackLink ? `Síguelo en vivo: ${trackLink}` : "Te avisaremos cuando llegue.";
    await sendEmailBestEffort(
      order.customer,
      `Tu pedido ${order.code} va en camino`,
      `¡Buenas noticias! Tu pedido ${order.code} está en reparto hacia ${addr}.\n\n${where}`,
    );
    if (order.phone) {
      void sendSmsBestEffort(
        order.phone,
        trackLink
          ? `Botella Rápida ${order.code}: ¡en camino! Síguelo en vivo: ${trackLink}`
          : `Botella Rápida ${order.code}: tu pedido está en reparto.`,
      ).catch(() => undefined);
    }
    void pushNotification(
      order.customer,
      "pedido",
      `🛵 Tu pedido ${order.code} va en camino`,
      trackLink ? "Síguelo en vivo en el mapa." : "Te avisaremos cuando llegue.",
      `/seguimiento/${order.code}`,
    );
    return;
  }

  if (order.status === "entregado") {
    void pushNotification(
      order.customer,
      "pedido",
      `✅ Pedido ${order.code} entregado`,
      "¡Gracias por elegir Botella Rápida! Si falta algo, abre una reclamación desde tu cuenta.",
      "/cuenta",
    );
    await sendEmailBestEffort(
      order.customer,
      `Pedido ${order.code} entregado`,
      `Tu pedido ${order.code} ha sido entregado. ¡Gracias por elegir Botella Rápida! Si falta algo, abre una reclamación desde tu cuenta.`,
    );
    return;
  }

  if (order.status === "cancelado") {
    const mail = `Tu pedido ${order.code} ha sido cancelado. Si ya habías pagado, no se te cobra nada o se te reembolsa según el método.`;
    void pushNotification(
      order.customer,
      "pedido",
      `❌ Pedido ${order.code} cancelado`,
      "Si ya habías pagado, no se te cobra nada o se te reembolsa según el método.",
      "/cuenta",
    );
    await sendEmailBestEffort(order.customer, `Pedido ${order.code} cancelado`, mail);
    if (order.courier) {
      void pushNotification(
        order.courier,
        "pedido",
        `Reparto ${order.code} cancelado`,
        "No te desplaces: el pedido se ha cancelado.",
        "/repartidor",
      );
      await sendEmailBestEffort(
        order.courier,
        `Reparto ${order.code} cancelado`,
        `El pedido ${order.code} que tenías asignado se ha cancelado. No te desplaces.`,
      );
    }
  }
}

/**
 * Envía el correo con el enlace. Best-effort y NO letal:
 *  - Si no hay SMTP configurado (SMTP_HOST), registra el enlace por consola para
 *    que el operador lo recupere en local/preview sin romper el flujo.
 *  - Si el envío falla, solo avisa: `requestPasswordReset` responde igual de todos
 *    modos (no revelamos estados internos ni al atacante).
 */
async function sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
  const base = publicBaseUrl();
  const link = base ? `${base}/restablecer?token=${encodeURIComponent(rawToken)}` : "";
  const subject = "Recuperar tu contraseña de Botella Rápida";
  const body = link
    ? `Alguien ha pedido restablecer la contraseña de ${email}.\n\nAbre este enlace (válido 1 hora):\n${link}\n\nSi no has sido tú, ignora este correo.`
    : `Alguien ha pedido restablecer la contraseña de ${email}. Tu código de recuperación (válido 1 hora) es:\n\n${rawToken}\n\nSi no has sido tú, contacta con soporte.`;

  const host = process.env.SMTP_HOST;
  if (!host) {
    console.warn(`[reset] SMTP no configurado — enlace de ${email}: ${link || rawToken}`);
    return;
  }
  await sendEmailBestEffort(email, subject, body);
}

/**
 * Aviso (best-effort) a los admin de que alguien ha pedido recuperar el acceso.
 * La petición YA queda en la bandeja «Cuentas» del panel, pero el correo asegura
 * que el equipo se entera aunque el usuario no tenga SMTP o su cuenta esté sin
 * activar. Nunca se envía el token al admin: solo la cuenta que pide ayuda.
 */
async function notifyAdminsOfReset(email: string): Promise<void> {
  const u = await query<{ name: string | null; role: string; status: string }>(
    "select name, role, status from br_users where email = ? limit 1",
    [email],
  );
  const info = u[0];
  const base = publicBaseUrl();
  const panel = base ? `${base}/admin (pestaña «Cuentas»)` : "Panel de admin → «Cuentas»";
  const subject = "Recuperación de contraseña solicitada";
  const body =
    `${info?.name || "(sin nombre)"} — ${email} — (rol: ${info?.role || "usuario"}, estado: ${info?.status || "?"}) ` +
    `ha pedido recuperar su contraseña.\n\n` +
    `Atiéndelo en ${panel}: valida su identidad por tu canal habitual y asígnale una clave nueva. ` +
    `La solicitud caduca en 1 hora.`;
  const admins = await query<{ email: string }>(
    "select email from br_users where role = 'admin' and status = 'activo'",
  );
  if (!admins.length) {
    console.warn(`[reset] no hay admin activo al que avisar de la solicitud de ${email}`);
    return;
  }
  for (const a of admins) {
    await sendEmailBestEffort(a.email, subject, body);
  }
}

/**
 * Pide un enlace de recuperación. Si el correo NO tiene cuenta, lo decimos
 * CLARAMENTE (`exists: false`) para que la persona lo corrija o se registre:
 * en una tienda local el riesgo de enumeración es asumible y el beneficio
 * (no dejar a nadie sin ayuda) es mayor. Con cuenta, la respuesta es neutra.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: boolean; msg: string; exists: boolean }> {
  const em = email.trim().toLowerCase();
  const neutral = "Si el email existe, te hemos enviado un enlace de recuperación.";

  // Primero se comprueba si la CUENTA EXISTE (da igual el estado): si no existe
  // NO se registra nada ni se consume ventana (un spammer con emails falsos no
  // puede agotar el cupo ni llenar la bandeja del admin). Avisamos a la UI.
  // Registrar también para cuentas NO activas (p. ej. un repartidor pendiente de
  // aprobar) es justo lo que permite al admin ver la petición y ayudar.
  const rows = await query<{ email: string; status: string }>(
    "select email, status from br_users where email = ? limit 1",
    [em],
  );
  if (!rows.length)
    return {
      ok: false,
      exists: false,
      msg: "No hay ninguna cuenta asociada a ese correo. Revisa si está mal escrito, o créate una cuenta nueva desde «Crear cuenta».",
    };

  // Límites FINOS por cuenta (3/15 min) y por red (10/15 min): quien insista
  // recibe siempre el mismo mensaje neutro, así que no aprende nada útil.
  let limited = false;
  try {
    assertThrottle(`rst:em:${em}`, 3, 15 * 60_000, "c");
    assertThrottle(`rst:ip:${clientIp()}`, 10, 15 * 60_000, "c");
  } catch {
    limited = true;
  }
  if (limited || resetRequestsInWindow() >= RESET_MAX_PER_WINDOW) {
    // Devolvemos ok neutro igualmente: el spammer no aprende nada útil.
    return { ok: true, exists: true, msg: neutral };
  }
  noteResetRequest();

  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  // Un nuevo enlace invalida los anteriores del mismo email.
  await execute("delete from br_password_resets where email = ?", [em]);
  await execute(
    "insert into br_password_resets (email, token_hash, expires_at, used, created_at) values (?, ?, ?, 0, ?)",
    [em, tokenHash, Date.now() + RESET_TTL_MS, Date.now()],
  );

  // Al admin SIEMPRE le avisamos (y la petición queda en su bandeja «Cuentas»),
  // para que pueda ayudar aunque el correo automático no llegue o la cuenta no
  // esté activa. Desde la Fase 13 los dos envíos van EN SEGUNDO PLANO
  // (fire-and-forget): el token ya está guardado y la respuesta es neutra, así
  // que un SMTP lento o caído NUNCA deja la pantalla «Enviando…» pillada. Si el
  // correo falla, la solicitud sigue visible en el panel para atenderla a mano.
  void notifyAdminsOfReset(em).catch(() => undefined);

  // Solo enviamos el enlace/código al USUARIO si su cuenta está activa: no
  // activamos ni damos acceso a cuentas dadas de baja o pendientes.
  if (rows[0].status === "activo") {
    void sendPasswordResetEmail(em, raw).catch(() => undefined);
  }
  return { ok: true, exists: true, msg: neutral };
}

/**
 * Aplica la nueva contraseña con el token de un solo uso. Si es válido:
 * cambia el hash, marca el token como usado y expulsa las sesiones activas
 * de la cuenta (un cambio de contraseña debe cerrar todas las puertas).
 */
export async function resetPassword(
  token: string,
  newPass: string,
): Promise<{ ok: boolean; msg: string }> {
  const t = token.trim();
  if (!t) return { ok: false, msg: "Enlace no válido." };
  if (newPass.length < 8) {
    return { ok: false, msg: "La contraseña necesita al menos 8 caracteres." };
  }
  const tokenHash = createHash("sha256").update(t).digest("hex");
  const rows = await query<{ email: string; expires_at: number; used: number }>(
    "select email, expires_at, used from br_password_resets where token_hash = ? limit 1",
    [tokenHash],
  );
  const r = rows[0];
  if (!r || r.used === 1 || r.expires_at < Date.now()) {
    return { ok: false, msg: "El enlace ha caducado o ya se usó. Pide uno nuevo." };
  }
  await execute("update br_users set pass_hash = ? where email = ?", [
    await hashPassword(newPass),
    r.email,
  ]);
  await execute("update br_password_resets set used = 1 where token_hash = ?", [tokenHash]);
  // Fuerza el re-login en todos los dispositivos de esa cuenta.
  await execute("delete from br_sessions where user_email = ?", [r.email]);
  void audit(r.email, "password.reset", r.email);
  return { ok: true, msg: "Contraseña actualizada. Ya puedes entrar con la nueva." };
}

export async function listUsers(sid: string | undefined): Promise<PublicUser[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users order by created_at desc`,
  );
  return rows.map(toPublicUser);
}

/**
 * Solicitudes de recuperación pendientes (flujo sin SMTP, mediado por el admin).
 * Cada `requestPasswordReset` deja un token de un solo uso en `br_password_resets`;
 * aquí se listen las NO usadas para que una persona valide la identidad y fije la
 * nueva clave desde el panel. Nunca se expone el token, solo `email`.
 */
export async function listResetRequests(sid: string | undefined): Promise<PasswordResetRequest[]> {
  await requireSession(sid, ["admin"]);
  const now = Date.now();
  const rows = await query<{
    email: string;
    name: string | null;
    role: Role | null;
    created_at: number;
    expires_at: number;
  }>(
    "select r.email, u.name, u.role, r.created_at, r.expires_at " +
      "from br_password_resets r " +
      "left join br_users u on u.email = r.email " +
      "where r.used = 0 " +
      "order by r.created_at desc limit 200",
  );
  const seen = new Set<string>();
  const out: PasswordResetRequest[] = [];
  // ordered by created_at desc: keep the most recent request per email so the
  // admin list never shows the same account twice (and no duplicate React key).
  for (const r of rows) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      email: r.email,
      name: r.name || r.email,
      role: (r.role ?? "user") as Role,
      requestedAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      active: Number(r.expires_at) > now,
    });
  }
  return out;
}

/**
 * El admin fija una contraseña nueva a una cuenta (recuperación mediada por
 * persona). Vía alternativa al enlace por email cuando no hay SMTP: valida la
 * identidad fuera de línea, actualiza el hash, da por atendida la solicitud y
 * expulsa las sesiones activas de la cuenta (un cambio de clave cierra puertas).
 */
export async function adminSetPassword(
  sid: string | undefined,
  email: string,
  newPass: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const em = email.trim().toLowerCase();
  if (newPass.length < 8) {
    return { ok: false, msg: "La contraseña necesita al menos 8 caracteres." };
  }
  const target = await query<{ email: string }>(
    "select email from br_users where email = ? limit 1",
    [em],
  );
  if (!target.length) return { ok: false, msg: "Ese usuario no existe." };
  await execute("update br_users set pass_hash = ? where email = ?", [
    await hashPassword(newPass),
    target[0].email,
  ]);
  await execute("delete from br_password_resets where email = ?", [target[0].email]);
  await execute("delete from br_sessions where user_email = ?", [target[0].email]);
  void audit(admin.email, "password.admin_set", target[0].email);
  return { ok: true, msg: `Contraseña actualizada para ${target[0].email}.` };
}

/**
 * Alta de admin por consola (`scripts/seed.mjs`) o panel: solo un admin ya
 * autenticado puede promover a otro, y nunca desde un registro público.
 */
export async function setUserStatus(
  sid: string | undefined,
  email: string,
  status: UserStatus,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const target = await query<{ email: string; role: Role }>(
    "select email, role from br_users where email = ? limit 1",
    [email.trim().toLowerCase()],
  );
  if (!target.length) return { ok: false, msg: "Ese usuario no existe." };
  if (target[0].role === "admin" && status !== "activo") {
    return { ok: false, msg: "A otro admin no lo puedes suspender: usa una cuenta intermedia." };
  }
  await execute("update br_users set status = ? where email = ?", [status, target[0].email]);
  // Suspender o rechazar expulsa las sesiones activas de esa cuenta.
  if (status !== "activo") {
    await execute("delete from br_sessions where user_email = ?", [target[0].email]);
  }
  void audit(admin.email, "usuario.estado", target[0].email, { status });
  return { ok: true, msg: "Estado actualizado." };
}

/**
 * Baja definitiva de una cuenta (el admin la BORRA de la BD). Solo aplica a
 * repartidores y clientes: un admin nunca se elimina desde aquí (se protege el
 * acceso al panel). Los pedidos históricos que él repartían siguen intactos:
 * `br_orders.courier` guarda una email como texto, sin clave foránea.
 *
 * Exige el código de admin: vale el 2FA (TOTP), un código de respaldo o el
 * código maestro del equipo. Así un panel abierto en un ordenador equivocado no
 * basta para borrar cuentas — hace falta el segundo factor por delante.
 */
export async function deleteUser(
  sid: string | undefined,
  email: string,
  code: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const target = await query<{ email: string; role: Role }>(
    "select email, role from br_users where email = ? limit 1",
    [email.trim().toLowerCase()],
  );
  if (!target.length) return { ok: false, msg: "Ese usuario no existe." };
  if (target[0].role === "admin") {
    return { ok: false, msg: "A un admin no se puede borrar desde el panel." };
  }
  // Blindaje con código de admin: 2FA / respaldo / maestro. `checkSecondFactor`
  // corta si no hay TOTP configurado; por eso la última puerta prueba además el
  // código maestro directamente, para que el equipo pueda borrar aunque girase 2FA.
  const trimmed = (code || "").trim();
  if (trimmed.length < 6) {
    return { ok: false, msg: "Necesitas el código de admin (2FA o maestro) para borrar la cuenta." };
  }
  const check = await checkSecondFactor(admin.email, trimmed);
  const via =
    check.ok ? check.via : (await matchesMasterCode(trimmed)) ? ("maestro" as const) : null;
  if (!via) {
    return { ok: false, msg: "Código de admin no válido (o caducado). Borrado cancelado." };
  }
  await execute("delete from br_sessions where user_email = ?", [target[0].email]);
  await execute("delete from br_users where email = ?", [target[0].email]);
  void audit(admin.email, "usuario.eliminar", target[0].email, {
    role: target[0].role,
    via,
  });
  return { ok: true, msg: "Cuenta eliminada." };
}

/* ==================================================== seguridad de accesos */

/** IP baneada (tabla `br_ip_bans`, migración 0033). */
export type IpBan = {
  ip: string;
  createdAt: number;
  actor: string;
  note: string;
};

/** Una IP usada por una cuenta al intentar entrar (detector de «muchas IPs»). */
export type AccountIp = {
  email: string;
  ip: string;
  device: string;
  attempts: number;
  lastSeen: number;
  banned: boolean;
};

/**
 * ¿Activo el 2FA de esta cuenta admin? Lo exige el bloqueo por IP: sin segundo
 * factor no se banea (decisión del titular: «banear necesita confirmar con 2FA»).
 */
async function assertAdmin2faForBan(adminEmail: string): Promise<void> {
  const row = await getTotpRow(adminEmail);
  if (row.enabled !== 1) {
    throw new Error(
      "Para bloquear IPs necesitas el 2FA activo en tu cuenta de admin (o un código maestro generado).",
    );
  }
}

/**
 * Bloquea una IP de forma TOTAL: desde ella no se puede entrar, registrar,
 * pedir ni usar ninguna acción autenticada (vease `readSession`). Exige el
 * código de 2FA del admin que llama. Reversible con `unbanIp` (también con 2FA).
 * Guarda la IP en claro: es lo único que hace falta para comparar en cada acceso.
 */
export async function banIp(
  sid: string | undefined,
  code: string,
  ip: string,
  note?: string,
): Promise<{ ok: true; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const target = (ip || "").trim();
  if (!target || target === "unknown") throw new Error("Esa IP no es válida para bloquear.");
  await assertAdmin2faForBan(admin.email);
  const check = await checkSecondFactor(admin.email, code);
  if (!check.ok) throw new Error("Código de 2FA no válido (o caducado). Bloqueo cancelado.");
  // Auto-protección: si el admin banea la IP desde la que está operando, se
  // quedaría fuera del panel sin poder desbanear. Se lo impedimos aquí.
  if (target === clientIp()) {
    throw new Error(
      "Esa es tu IP actual: te quedarías fuera del panel. Bloquéala desde otra red o desiste.",
    );
  }
  await execute(
    "insert into br_ip_bans (ip, created_at, actor, note) values (?, ?, ?, ?) " +
      "on duplicate key update created_at = values(created_at), actor = values(actor), note = values(note)",
    [target, Date.now(), admin.email, (note || "").trim().slice(0, 512)],
  );
  // Expulsa de inmediato las sesiones vivas que vinieron de esa IP.
  await execute("delete from br_sessions where ip = ?", [target]).catch(() => undefined);
  invalidateBanCache();
  void audit(admin.email, "ip.ban", target, { via: check.via, note: (note || "").slice(0, 200) });
  return { ok: true, msg: `IP ${target} bloqueada.` };
}

/** Levanta el bloqueo de una IP. Exige de nuevo el 2FA («para no liarla»). */
export async function unbanIp(
  sid: string | undefined,
  code: string,
  ip: string,
): Promise<{ ok: true; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const target = (ip || "").trim();
  if (!target) throw new Error("Falta la IP a desbloquear.");
  await assertAdmin2faForBan(admin.email);
  const check = await checkSecondFactor(admin.email, code);
  if (!check.ok) throw new Error("Código de 2FA no válido (o caducado). Desbloqueo cancelado.");
  await execute("delete from br_ip_bans where ip = ?", [target]);
  invalidateBanCache();
  void audit(admin.email, "ip.unban", target, { via: check.via });
  return { ok: true, msg: `IP ${target} desbloqueada.` };
}

/** Listado de IPs baneadas (solo admin). Vacío si la tabla aún no existe. */
export async function listIpBans(sid: string | undefined): Promise<IpBan[]> {
  await requireSession(sid, ["admin"]);
  try {
    const rows = await query<{
      ip: string;
      created_at: number;
      actor: string;
      note: string | null;
    }>("select ip, created_at, actor, note from br_ip_bans order by created_at desc limit 500");
    return rows.map((r) => ({
      ip: r.ip,
      createdAt: Number(r.created_at),
      actor: r.actor,
      note: r.note ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Detector de «muchas IPs por cuenta» en los intentos de login de las últimas
 * 24 h: si un atacante dispara desde muchas redes, la cuenta aparecerá con
 * varias filas y el admin podrá banear cada IP desde ahí. Ordena por cuenta y
 * por número de intentos. Vacío si las columnas nuevas aún no existen.
 */
export async function listSuspiciousIps(
  sid: string | undefined,
  withinHours = 24,
): Promise<AccountIp[]> {
  await requireSession(sid, ["admin"]);
  const banned = await bannedIpSet();
  try {
    const since = Date.now() - Math.max(1, withinHours) * 3600_000;
    const rows = await query<{
      email: string;
      ip: string;
      user_agent: string | null;
      n: number | string;
      last: number | string;
    }>(
      "select email, ip, user_agent, count(*) as n, max(created_at) as last " +
        "from br_login_attempts " +
        "where created_at >= ? and ip is not null and ip <> 'unknown' " +
        "group by email, ip, user_agent order by last desc limit 800",
      [since],
    );
    return rows.map((r) => ({
      email: r.email,
      ip: r.ip,
      device: describeDevice(r.user_agent ?? ""),
      attempts: Number(r.n),
      lastSeen: Number(r.last),
      banned: banned.has(r.ip),
    }));
  } catch {
    return [];
  }
}

/**
 * Registra el dispositivo/IP con el que una cuenta acaba de entrar y, si es la
 * PRIMERA vez que lo usa, lanza el aviso. Fail-open: cualquier error (tabla sin
 * migrar, correo caído) se traga; el login YA tuvo lugar y no debe notarse.
 */
async function maybeAlertNewDevice(email: string, ip: string, ua: string): Promise<void> {
  if (!email || !ip || ip === "unknown") return;
  let isNew = true;
  try {
    const seen = await query<{ n: number | string }>(
      "select count(*) as n from br_user_devices where email = ? and (ip = ? or user_agent = ?)",
      [email, ip, ua],
    );
    if (Number(seen[0]?.n ?? 0) > 0) isNew = false;
  } catch {
    return; // tabla sin migrar: no avisamos (y no rompemos nada).
  }
  const now = Date.now();
  try {
    await execute(
      "insert into br_user_devices (email, ip, user_agent, first_seen, last_seen) values (?, ?, ?, ?, ?) " +
        "on duplicate key update last_seen = values(last_seen), user_agent = values(user_agent)",
      [email, ip, ua, now, now],
    );
  } catch {
    /* registro de dispositivo es opcional */
  }
  if (isNew) await notifyNewLogin(email, ip, ua);
}

/** Correo + campanita de «nueva sesión», con enlace para cambiar la contraseña. */
async function notifyNewLogin(email: string, ip: string, ua: string): Promise<void> {
  const device = describeDevice(ua);
  const base = publicBaseUrl();
  const link = base ? `${base}/cuenta` : "";
  const subject = "Nuevo inicio de sesión en tu cuenta Botella Rápida";
  const body = link
    ? `Hola:\n\nSe ha iniciado sesión en tu cuenta de Botella Rápida desde ${device} (IP ${ip}).\n\nSi has sido tú, ignora este mensaje. Si NO reconoces el acceso, cambia tu contraseña cuanto antes:\n${link}\n`
    : `Hola:\n\nSe ha iniciado sesión en tu cuenta de Botella Rápida desde ${device} (IP ${ip}).\n\nSi no has sido tú, entra en tu cuenta y cambia la contraseña.`;
  const html = link
    ? brandedEmailHtml({
        base,
        heading: "Se ha iniciado sesión en tu cuenta",
        intro: `El acceso viene de ${device} (IP ${ip}). Si has sido tú, no hace falta hacer nada. Si no lo reconoces, cambia tu contraseña ahora.`,
        ctaLabel: "Cambiar mi contraseña",
        ctaUrl: link,
        note: "Este aviso se envía solo cuando entras desde un dispositivo o red que no conocíamos.",
      })
    : undefined;
  await sendEmailBestEffort(email, subject, body, html);
  void pushNotification(
    email,
    "info",
    "🔐 Nuevo inicio de sesión",
    `${device}. Si no has sido tú, cambia tu contraseña.`,
    link ? "/cuenta" : null,
  );
}

/**
 * El repartidor elige su jornada: 8 horas dentro del día. Se guarda solo la
 * hora de inicio (0-23); el cierre se calcula como (inicio + 8) mod 24.
 */
export async function setCourierShift(
  sid: string | undefined,
  startHour: number,
): Promise<{ ok: boolean; msg: string }> {
  const session = await requireSession(sid, ["repartidor"]);
  const h = Math.trunc(startHour);
  if (!(h >= 0 && h <= 23)) return { ok: false, msg: "Hora de inicio fuera de rango." };
  await execute("update br_users set shift_start = ? where email = ?", [h, session.email]);
  return { ok: true, msg: "Jornada actualizada." };
}

/** Franja del propio repartidor (para pintar su selector en el portal). */
export async function getCourierShift(
  sid: string | undefined,
): Promise<{ shiftStart: number | null }> {
  const session = await requireSession(sid, ["repartidor"]);
  const rows = await query<{ shift_start: number | null }>(
    "select shift_start from br_users where email = ? limit 1",
    [session.email],
  );
  return { shiftStart: rows[0]?.shift_start ?? null };
}

/* ------------------------------------------------------------------ faltas */

export type CourierFault = {
  id: string;
  courierEmail: string;
  reason: string;
  ack: boolean;
  createdAt: number;
};

type FaultRow = {
  id: string;
  courier_email: string;
  reason: string;
  ack: number;
  created_at: number;
};

function toFault(r: FaultRow): CourierFault {
  return {
    id: r.id,
    courierEmail: r.courier_email,
    reason: r.reason,
    ack: Number(r.ack) === 1,
    createdAt: r.created_at,
  };
}

/** El admin anota una falta a un repartidor (quedan registradas y se le avisa). */
export async function addCourierFault(
  sid: string | undefined,
  courierEmail: string,
  reason: string,
): Promise<{ ok: boolean; msg: string }> {
  await requireSession(sid, ["admin"]);
  const email = courierEmail.trim().toLowerCase();
  const text = reason.trim().slice(0, 512);
  if (!text) return { ok: false, msg: "Describe el motivo de la falta." };
  const target = await query<{ email: string; role: Role }>(
    "select email, role from br_users where email = ? limit 1",
    [email],
  );
  if (!target.length || target[0].role !== "repartidor") {
    return { ok: false, msg: "Ese repartidor no existe." };
  }
  await execute(
    "insert into br_courier_faults (id, courier_email, reason, ack, created_at) values (?, ?, ?, 0, ?)",
    [newId("f"), email, text, Date.now()],
  );
  return { ok: true, msg: "Falta registrada y notificada." };
}

/** Borra una falta (el admin la retira). */
export async function deleteCourierFault(
  sid: string | undefined,
  id: string,
): Promise<{ ok: boolean; msg: string }> {
  await requireSession(sid, ["admin"]);
  await execute("delete from br_courier_faults where id = ?", [id]);
  return { ok: true, msg: "Falta eliminada." };
}

/** Todas las faltas (panel de admin): las agrupa por repartidor en el cliente. */
export async function listFaultsAdmin(sid: string | undefined): Promise<CourierFault[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<FaultRow>(
    "select id, courier_email, reason, ack, created_at from br_courier_faults order by created_at desc limit 1000",
  );
  return rows.map(toFault);
}

/** Faltas del propio repartidor + cuántas tiene (para el pop-up de aviso). */
export async function myFaults(
  sid: string | undefined,
): Promise<{ faults: CourierFault[]; total: number; unread: number }> {
  const session = await requireSession(sid, ["repartidor"]);
  const rows = await query<FaultRow>(
    "select id, courier_email, reason, ack, created_at from br_courier_faults where courier_email = ? order by created_at desc limit 200",
    [session.email],
  );
  const faults = rows.map(toFault);
  return {
    faults,
    total: faults.length,
    unread: faults.filter((f) => !f.ack).length,
  };
}

/** El repartidor acusa recibo de TODAS sus faltas pendientes (cierra el aviso). */
export async function ackFaults(sid: string | undefined): Promise<{ ok: true }> {
  const session = await requireSession(sid, ["repartidor"]);
  await execute("update br_courier_faults set ack = 1 where courier_email = ?", [session.email]);
  return { ok: true };
}

/* ---------------------------------------------------------------- pedidos */

function toOrder(row: OrderRow, items: ItemRow[], history: HistoryRow[]): Order {
  return {
    id: row.id,
    code: row.code,
    customer: row.customer,
    customerName: row.customer_name,
    subtotal: Number(row.subtotal),
    shippingCost: Number(row.shipping_cost),
    tip: Number(row.tip),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    deliverySlot: row.delivery_slot,
    address: row.address,
    postalCode: row.postal_code ?? null,
    phone: row.phone,
    notes: row.notes ?? "",
    status: row.status,
    courier: row.courier,
    createdAt: row.created_at,
    scheduledFor: row.scheduled_for == null ? null : Number(row.scheduled_for),
    history: history.map((h) => ({ at: h.at, by: h.actor, what: h.what })),
    storeId: row.store_id ?? null,
    storeName: row.store_name ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelledBy: row.cancelled_by ?? null,
    discount: Number(row.discount ?? 0),
    couponCode: row.coupon_code ?? null,
    nightSurcharge: Number(row.night_surcharge ?? 0),
    items: items.map((i) => ({
      id: i.product_id,
      name: i.name,
      qty: i.qty,
      price: Number(i.price),
    })),
  };
}

/**
 * Lista de pedidos visible según rol:
 *  - admin: todos
 *  - cliente: los suyos
 *  - repartidor: cola abierta + los suyos (aceptados/en curso/entregados)
 */
export async function listOrders(sid: string | undefined): Promise<Order[]> {
  const session = await requireSession(sid);
  let rows: OrderRow[];
  // `archived = 0`: los pedidos borrados por el admin salen de todas las listas
  // normales (siguen vivos en «Archivados»).
  if (session.role === "admin") {
    rows = await query<OrderRow>(
      "select * from br_orders where archived = 0 order by created_at desc limit 500",
    );
  } else if (session.role === "user") {
    rows = await query<OrderRow>(
      "select * from br_orders where archived = 0 and customer = ? order by created_at desc limit 200",
      [session.email],
    );
  } else {
    rows = await query<OrderRow>(
      "select * from br_orders where archived = 0 and (status = 'pendiente' or courier = ?) order by created_at desc limit 300",
      [session.email],
    );
  }
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const [items, history] = await Promise.all([
    query<ItemRow>(
      `select order_id, product_id, name, qty, price from br_order_items where order_id in (${marks})`,
      ids,
    ),
    query<HistoryRow>(
      `select order_id, at, actor, what from br_order_history where order_id in (${marks}) order by at asc`,
      ids,
    ),
  ]);
  return rows.map((r) =>
    toOrder(
      r,
      items.filter((i) => i.order_id === r.id),
      history.filter((h) => h.order_id === r.id),
    ),
  );
}

/** Repartidores aprobados, solo para el panel de admin (el selector de delegar). */
export async function listCouriers(sid: string | undefined): Promise<PublicUser[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where role = 'repartidor' and status = 'activo' order by name`,
  );
  return rows.map(toPublicUser);
}

/* ------------------------------------------------ geocodificación de dirección */

/** Caché en memoria: "cp|dirección" → [lat,lng] o null (no resuelta). */
const geocodeCache = new Map<string, [number, number] | null>();

type NominatimHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { road?: string; house_number?: string; postcode?: string };
};

/** GET a Nominatim con nuestra identificación (UA) y tope de 4,5 s; null si falla. */
async function nominatimJson(url: string): Promise<NominatimHit[] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "botella-rapida (botellarapidadmin@gmail.com)" },
      signal: AbortSignal.timeout(4_500),
    });
    if (!res.ok) return null;
    return (await res.json()) as NominatimHit[];
  } catch {
    return null;
  }
}

/** Distancia (km) entre dos coordenadas (haversine): control de zona. */
function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Caja ±~5 km alrededor del centroide del CP (parámetro `viewbox` de Nominatim). */
function viewboxForCp(cp: string): string | null {
  if (!/^\d{5}$/.test(cp)) return null;
  const [lat, lng] = coordsForCp(cp);
  const dLat = 0.05;
  const dLng = 0.06;
  return `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
}

/**
 * Resuelve las coordenadas EXACTAS de la dirección con Nominatim
 * (OpenStreetMap): gratis, sin API key ni cuenta. Cumple su política de uso:
 * nos identificamos con `User-Agent`, pedimos `limit=1` y la caché evita
 * repetir consultas. Fase 10: el texto libre a veces elegía una calle HOMÓNIMA
 * de otra ciudad, así que primero se busca DENTRO de la caja del CP
 * (`viewbox` + `bounded`) y solo si ahí no hay nada se reintenta sin recorte
 * (mejor lejos que sin geocodificar). Si falla o tarda devuelve null y el mapa
 * usa el centroide del CP (comportamiento anterior): NUNCA rompe un pedido.
 */
export async function geocodeAddress(
  address: string,
  postalCode: string,
): Promise<[number, number] | null> {
  const key = `${postalCode}|${address}`.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  const q = `${address}, ${postalCode}, España`;
  const base = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`;
  const box = viewboxForCp(postalCode.trim());
  let data: NominatimHit[] = [];
  if (box) data = (await nominatimJson(`${base}&viewbox=${box}&bounded=1`)) ?? [];
  if (data.length === 0) data = (await nominatimJson(base)) ?? [];
  const first = data[0];
  const point =
    first?.lat && first?.lon ? ([Number(first.lat), Number(first.lon)] as [number, number]) : null;
  geocodeCache.set(key, point);
  return point;
}

/** Una opción del desplegable de calles del checkout (Fase 10). */
export type AddressSuggestion = {
  /** Forma corta que se escribe en el campo («Carrer de Maragall 20»). */
  street: string;
  /** Dirección completa de Nominatim, para despejar dudas en el desplegable. */
  full: string;
  lat: number;
  lng: number;
};

/** Caché de sugerencias: "cp|término" → lista con marca de tiempo. */
const suggestCache = new Map<string, { at: number; list: AddressSuggestion[] }>();
const SUGGEST_TTL_MS = 24 * 60 * 60_000;

/**
 * Autocompletado de calles FILTRADO POR CÓDIGO POSTAL: Nominatim en modo
 * estructurado (`street` + `postalcode`) solo devuelve calles que existen en
 * ese CP, así una calle homónima de otra ciudad jamás aparece como opción.
 * El cliente elige la suya y el pedido guarda ESAS coordenadas exactas: el
 * repartidor deja de depender de una geocodificación a ciegas. Primero las
 * coincidencias exactas de CP; los términos cortos no se consultan (ruido).
 */
export async function addressSuggestions(
  sid: string | undefined,
  postalCode: string,
  rawQuery: string,
): Promise<AddressSuggestion[]> {
  const session = await requireSession(sid, ["user", "admin"]);
  const cp = postalCode.trim();
  const term = rawQuery.trim().replace(/\s+/g, " ");
  if (!/^\d{5}$/.test(cp) || !isWithinServiceArea(cp)) return [];
  if (term.length < 3) return [];
  assertThrottle(
    `sug:${session.email}`,
    40,
    60 * 60_000,
    "Demasiadas búsquedas de dirección seguidas. Espera un momento.",
  );
  const key = `${cp}|${term.toLowerCase()}`;
  const hit = suggestCache.get(key);
  if (hit && Date.now() - hit.at < SUGGEST_TTL_MS) return hit.list;
  const box = viewboxForCp(cp);
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&structured=1&country=España" +
    `&postalcode=${encodeURIComponent(cp)}&street=${encodeURIComponent(term)}` +
    (box ? `&viewbox=${box}` : "");
  const data = (await nominatimJson(url)) ?? [];
  const raw: { s: AddressSuggestion; exact: boolean }[] = [];
  for (const r of data) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !r.display_name) continue;
    // El campo corto usa calle (y número si lo hay); sin detalles, la primera
    // parte de la dirección completa.
    const road = r.address?.road?.trim();
    const num = r.address?.house_number?.trim();
    const street = road
      ? `${road}${num ? ` ${num}` : ""}`
      : r.display_name.split(",")[0]?.trim() || r.display_name;
    raw.push({
      s: { street, full: r.display_name, lat, lng },
      exact: (r.address?.postcode ?? "").trim() === cp,
    });
  }
  // El `postalcode` estructurado de Nominatim es SOLO una preferencia: si en el
  // CP no existe esa calle, devuelve homónimas de otras ciudades (08380,
  // 08871…). Justo eso es lo que el usuario no quiere ver, así que si HAY
  // coincidencias del CP exacto, el desplegable muestra SOLO esas; los restos
  // se ordenan por cercanía al centroide (el usuario ve el pueblo completo y
  // decide; `createOrder` además rechaza puntos a >15 km).
  const centroid = coordsForCp(cp);
  raw.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      distanceKm([a.s.lat, a.s.lng], centroid) - distanceKm([b.s.lat, b.s.lng], centroid),
  );
  const exacts = raw.filter((x) => x.exact);
  const list = (exacts.length ? exacts : raw).slice(0, 6).map((x) => x.s);
  if (suggestCache.size > 2000) suggestCache.clear();
  suggestCache.set(key, { at: Date.now(), list });
  return list;
}

/* ------------------------------------------------- días de reparto (Fase 11) */

/** Fecha "YYYY-MM-DD" de `d` en hora de Madrid (el servidor puede correr en UTC). */
function madridYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/\//g, "-");
}

/**
 * Días de reparto configurados: sección `reparto` del CMS (la cambia el admin
 * desde Panel → Ajustes). Devuelve `null` = SIN restricción (reparto a diario):
 *  - fila guardada con `dias: []` → la función apagada a propósito;
 *  - fallo al leer la BD → fail-open: jamás bloqueamos ventas por un criterio
 *    de comodidad. Sin fila vale el default del titular (vie/sáb/dom).
 */
export async function getDeliveryDays(): Promise<number[] | null> {
  try {
    const rows = await query<{ payload: string | Record<string, unknown> }>(
      "select payload from br_content where section = 'reparto' limit 1",
    );
    if (!rows.length) return [...DEFAULT_DELIVERY_DAYS];
    const p =
      typeof rows[0].payload === "string"
        ? (JSON.parse(rows[0].payload) as Record<string, unknown>)
        : rows[0].payload;
    const raw = Array.isArray(p.dias) ? p.dias : null;
    if (!raw) return [...DEFAULT_DELIVERY_DAYS];
    const dias = [
      ...new Set(raw.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6)),
    ];
    return dias.length ? dias : null;
  } catch {
    return null;
  }
}

/**
 * Época ms del PRÓXIMO día de reparto tras el de hoy (anclada al mediodía UTC
 * de esa fecha: nunca cambia de día por zona horaria). `null` si hoy YA es
 * día de reparto. Días de 7 como máximo de búsqueda: con lista no vacía hay
 * SIEMPRE un día válido a menos de una semana.
 */
function nextReservationAnchor(days: number[], now: Date): number | null {
  const anchorToday = Date.parse(`${madridYmd(now)}T12:00:00Z`);
  if (days.includes(new Date(anchorToday).getUTCDay())) return null;
  for (let k = 1; k <= 7; k += 1) {
    const cand = anchorToday + k * 86_400_000;
    if (days.includes(new Date(cand).getUTCDay())) return cand;
  }
  return null;
}

/** "viernes 16/10" en hora de Madrid, desde la época de la reserva. */
function deliveryDateLabel(ts: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(ts));
}

export type CreateOrderInput = {
  items: { id: string; name: string; qty: number; price: number }[];
  subtotal: number;
  shippingCost: number;
  tip: number;
  total: number;
  paymentMethod: PaymentMethod;
  deliverySlot: DeliverySlot;
  address: string;
  /** Código postal de 5 dígitos: se valida contra la zona de reparto en servidor. */
  postalCode: string;
  phone: string;
  notes: string;
  /**
   * Tienda de origen (opcional). El navegador manda solo el `id`; el nombre real
   * se toma de `SAMPLE_STORES` en servidor (autoritativo), nunca del cliente.
   */
  store?: { id: string };
  /**
   * Solo admin: el panel puede simular el pedido de un cliente concreto para
   * probar el flujo. Un cliente nunca puede poner aqui un email ajeno.
   */
  asCustomer?: { email: string; name: string };
  /**
   * Código de cupón/afiliado escrito en el checkout. Se valida y se recalcula
   * SIEMPRE en servidor (`evaluateCoupon`); lo que afirme el navegador da igual.
   */
  coupon?: string;
  /**
   * Código de enlace de invitación (`AF-...`) con el que llegó el cliente
   * (migración 0030): si es válido y aún libre, se le asigna como referidor y
   * su PRIMERA compra entregada da chapas a ambas partes.
   */
  ref?: string | null;
  /**
   * Coordenadas EXACTAS elegidas en el desplegable de calles (Fase 10). El
   * servidor solo las acepta si caen dentro de la zona del CP (≤15 km al
   * centroide); si no, se ignoran y se geocodifica el texto de la dirección.
   */
  destLat?: number | null;
  destLng?: number | null;
  /**
   * Declaración de mayoría de edad que acompaña a los pedidos con alcohol.
   * En servidor se contrasta con `br_users.age_ok` (migración 0023): este flag
   * solo registra la declaración la primera vez; después manda lo guardado.
   */
  ageConfirmed?: boolean;
};

/**
 * El cliente solo puede crear pedidos PARA SÍ: `customer` y `customerName` se
 * leen de la sesión, nunca del cuerpo de la petición.
 */
export async function createOrder(
  sid: string | undefined,
  input: CreateOrderInput,
): Promise<Order> {
  // Bloqueo total por IP: desde una dirección baneada no se pide (además de no
  // poder entrar: `readSession` ya devuelve null para esa IP). Fail-open si la
  // tabla falta. Message claro en vez del genérico «sesión caducada».
  await assertNotBanned();
  const session = await requireSession(sid, ["user", "admin"]);
  // Tienda cerrada por mantenimiento (el admin lo decide desde Ajustes): ni
  // clientes ni anónimos crean pedidos; el admin sí, para pruebas internas.
  // Comprobado aquí, en servidor: el overlay de la web es un aviso, no un candado.
  if (session.role !== "admin" && (await maintenanceActive())) {
    throw new Error(
      "La tienda está temporalmente cerrada por mantenimiento. Vuelve en unos minutos.",
    );
  }
  if (input.items.length === 0) throw new Error("La cesta está vacía.");
  if (!input.address.trim() || !input.phone.trim()) {
    throw new Error("Faltan dirección o teléfono de entrega.");
  }
  // La zona es autoritativa en servidor: el formulario se puede manipular y no
  // queremos un pedido repartible fuera de nuestra área.
  if (!isWithinServiceArea(input.postalCode)) {
    throw new Error(`No repartimos en el CP ${input.postalCode}: solo ${SERVICE_AREA_LABEL}.`);
  }

  let customer = session.email;
  let customerName = session.name;
  if (session.role === "admin" && input.asCustomer?.email) {
    const wanted = input.asCustomer.email.trim().toLowerCase();
    const rows = await query<{ email: string; name: string }>(
      "select email, name from br_users where email = ? limit 1",
      [wanted],
    );
    if (!rows.length) throw new Error("Ese cliente no existe en la BD.");
    customer = rows[0].email;
    customerName = input.asCustomer.name?.trim() || rows[0].name;
  }

  // Recalculamos el importe en servidor contra el CATÁLOGO COMPLETO (estático de
  // `src/data/catalog.ts` + altas del admin): el precio que manda el navegador no
  // es de fiar, y limitar la validación a los custom rechazaba cualquier producto
  // del catálogo normal (checkout del cliente y "pedido de prueba" del admin).
  const catalog = await listProducts();
  const priceOf = new Map<string, number>();
  const nameOf = new Map<string, string>();
  const alcoholOf = new Map<string, boolean>();
  const stockOf = new Map<string, number>();
  for (const p of catalog) {
    priceOf.set(p.id, p.price);
    nameOf.set(p.id, p.name);
    if (p.alcohol) alcoholOf.set(p.id, true);
    if (typeof p.stock === "number") stockOf.set(p.id, Math.max(0, Math.floor(p.stock)));
  }
  let subtotal = 0;
  for (const item of input.items) {
    const price = priceOf.get(item.id);
    if (price === undefined) throw new Error(`Producto fuera de catálogo: ${item.name}`);
    subtotal += price * item.qty;
  }
  // Stock validado EN SERVIDOR (el carrito del navegador se puede manipular):
  // solo para pedidos de clientes; el admin puede crear pedidos de prueba sin
  // tope. Un producto oculto ya queda fuera de `catalog` (filtra `listProducts`),
  // así que cae en el error de «fuera de catálogo».
  if (session.role === "user") {
    for (const item of input.items) {
      const st = stockOf.get(item.id);
      if (st !== undefined && item.qty > st) {
        throw new Error(
          st <= 0
            ? `${nameOf.get(item.id) ?? item.name} está agotado.`
            : `Solo quedan ${st} unidades de ${nameOf.get(item.id) ?? item.name}.`,
        );
      }
    }
  }
  subtotal = round2(subtotal);
  // +18 AUTORIZADO EN SERVIDOR: el gate del navegador es solo la interfaz; si
  // en la cesta hay alcohol, la cuenta debe traer la declaración de mayoría de
  // edad registrada aquí (o enviarla en este pedido). `age_ok` llega de la
  // migración 0023; si el esquema aún no la tiene (BD sin migrar) no rompemos
  // la venta: fail-open.
  if (session.role === "user" && input.items.some((i) => alcoholOf.get(i.id))) {
    let declared = input.ageConfirmed === true;
    try {
      if (input.ageConfirmed === true) {
        await execute("update br_users set age_ok = 1 where email = ?", [customer]);
      }
      const u = await query<{ age_ok: number }>(
        "select age_ok from br_users where email = ? limit 1",
        [customer],
      );
      if (Number(u[0]?.age_ok ?? 0) === 1) declared = true;
    } catch {
      declared = true;
    }
    if (!declared) {
      throw new Error("Para pedir alcohol necesitas confirmar tu mayoría de edad.");
    }
  }
  const shippingCost = subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
  const tip = round2(Math.max(0, Math.min(20, input.tip)));
  // Fase 11 — días de reparto: si hoy NO toca, el pedido NO se bloquea, queda
  // RESERVA para el próximo día de reparto (criterio en hora de Madrid aunque
  // el servidor corra en UTC). `schedMs` viaja a `br_orders.scheduled_for`.
  const days = await getDeliveryDays();
  const schedMs = days ? nextReservationAnchor(days, new Date()) : null;
  // Franja EFECTIVA: en un día de reserva lo «inmediato» no tiene sentido y se
  // remapea AQUÍ (en servidor), así nadie se lleva un "30 minutos" de martes.
  const slot: DeliverySlot =
    schedMs && input.deliverySlot === "inmediata" ? "programada_hoy" : input.deliverySlot;
  // Recargo de madrugada: lo dispara la FRANJA elegida (no un flag del
  // navegador), así es imposible colarse sin él en una franja nocturna.
  const nightSurcharge = slot === "programada_noche" ? NIGHT_SURCHARGE : 0;
  // Cupón: validado en servidor contra `br_coupons` y contra los pedidos
  // previos reales del cliente (regla «primera compra»). Un código inválido
  // aborta el pedido con aviso claro: mejor eso que cobrar de más en silencio.
  const couponRaw = input.coupon?.trim() ?? "";
  let discount = 0;
  let couponId: string | null = null;
  let couponCode: string | null = null;
  if (couponRaw) {
    const check = await evaluateCoupon(couponRaw, subtotal, customer);
    if (!check.ok) throw new Error(check.msg);
    discount = check.discount;
    couponId = check.couponId;
    couponCode = check.code;
  }
  const total = round2(Math.max(0, subtotal - discount) + shippingCost + nightSurcharge + tip);

  // Tienda de origen: validamos el id contra el listado real y fijamos el nombre
  // en servidor (el cliente solo elige un id conocido; nunca manda un nombre libre).
  let storeId: string | null = null;
  let storeName: string | null = null;
  if (input.store?.id) {
    const st = SAMPLE_STORES.find((s) => s.id === input.store!.id);
    if (!st) throw new Error("Esa tienda no está disponible ahora.");
    storeId = st.id;
    storeName = st.name;
  }

  const id = newId("o");
  const code = await freshOrderCode();
  const now = Date.now();
  // Dirección exacta (best-effort, FUERA de la transacción: es una llamada
  // externa). Fase 10: si el cliente ELIGIÓ una calle del desplegable, se
  // guardan esas coordenadas tales cuales (validadas: deben caer cerca del
  // centroide de su CP). Si no, geocodificación Nominatim con sesgo por CP.
  // Si todo falla, NULL y el mapa cae en el centroide del CP: un fallo de
  // geocodificación jamás debe frenar ni revertir el pedido.
  let dest: [number, number] | null = null;
  const pickedLat = Number(input.destLat);
  const pickedLng = Number(input.destLng);
  if (
    input.destLat != null &&
    input.destLng != null &&
    Number.isFinite(pickedLat) &&
    Number.isFinite(pickedLng) &&
    Math.abs(pickedLat) <= 90 &&
    Math.abs(pickedLng) <= 180
  ) {
    const centroid = coordsForCp(input.postalCode.trim());
    if (distanceKm([pickedLat, pickedLng], centroid) <= 15) {
      dest = [pickedLat, pickedLng];
    }
  }
  if (!dest) {
    dest = await geocodeAddress(input.address.trim(), input.postalCode.trim()).catch(() => null);
  }
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "insert into br_orders (id, code, customer, customer_name, subtotal, shipping_cost, tip, total, " +
        "payment_method, delivery_slot, address, postal_code, phone, notes, status, courier, created_at, store_id, store_name, dest_lat, dest_lng, discount, coupon_code, night_surcharge, scheduled_for) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', null, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        code,
        customer,
        customerName,
        subtotal,
        shippingCost,
        tip,
        total,
        input.paymentMethod,
        slot,
        input.address.trim(),
        input.postalCode.trim(),
        input.phone.trim(),
        input.notes.trim(),
        now,
        storeId,
        storeName,
        dest ? dest[0] : null,
        dest ? dest[1] : null,
        discount,
        couponCode,
        nightSurcharge,
        schedMs,
      ],
    );
    if (couponId) {
      // Primera fila BLOQUEANDO el cupón (`for update`): dos pedidos simultáneos
      // del mismo usuario no pueden pasar a la vez la regla «solo primera
      // compra». Sin el candado, cada transacción veía 0 pedidos ajenos (el otro
      // aún no estaba commiteado) y ambos aplicaban el descuento de bienvenida.
      const [lockRows] = (await conn.query(
        "select first_only from br_coupons where id = ? for update",
        [couponId],
      )) as [{ first_only: number }[], unknown];
      if (lockRows[0]?.first_only === 1) {
        const [prev] = (await conn.query(
          "select count(*) as n from br_orders where archived = 0 and status <> 'cancelado' and customer = ? and id <> ?",
          [customer, id],
        )) as [{ n: number }[], unknown];
        if (Number(prev[0]?.n ?? 0) > 0)
          throw new Error("Este código es solo para tu primer pedido.");
      }
      // Contabiliza el uso con tope dentro de la transacción: si otro pedido ha
      // agotado la última unidad entre medias, `affectedRows` = 0 y el pedido
      // completo se rechaza (nunca se cuela un uso de más).
      const [res] = (await conn.query(
        "update br_coupons set used_count = used_count + 1 where id = ? and (max_uses = 0 or used_count < max_uses)",
        [couponId],
      )) as [{ affectedRows: number }, unknown];
      if (res.affectedRows === 0) throw new Error("El cupón ha agotado sus usos.");
    }
    for (const item of input.items) {
      // El nombre se toma del CATÁLOGO (como el precio): el que manda el
      // navegador no se persiste, así ningún pedido puede mostrarse con un
      // producto que no se vendió (disputas de reclamación/factura).
      await conn.query(
        "insert into br_order_items (order_id, product_id, name, qty, price) values (?, ?, ?, ?, ?)",
        [id, item.id, nameOf.get(item.id) ?? item.name, item.qty, priceOf.get(item.id) as number],
      );
    }
    await conn.query(
      "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
      [id, now, "sistema", `Pedido creado (${input.paymentMethod})`],
    );
    if (schedMs) {
      // La reserva se explica sola en el historial (lo ven cliente, panel y
      // seguimiento sin tocar ninguna otra pantalla).
      await conn.query(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [id, now, "sistema", `Reserva: entrega el ${deliveryDateLabel(schedMs)}`],
      );
    }
    if (couponCode) {
      await conn.query(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [id, now, "sistema", `Cupón ${couponCode} aplicado (−${discount.toFixed(2)}€)`],
      );
    }
    if (nightSurcharge > 0) {
      await conn.query(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [id, now, "sistema", `Recargo madrugada (+${nightSurcharge.toFixed(2)}€)`],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Referido por enlace de invitación (migración 0030): si llegó con `ref` y
  // su cuenta aún no tiene referidor, se fija ahora (quienes se registraron
  // desde el enlace ya lo traen puesto). Best-effort: jamás rompe un pedido.
  const refRaw = (input.ref ?? "").trim().toUpperCase();
  if (refRaw) {
    try {
      await attachReferralOnOrder(customer, refRaw);
    } catch (err) {
      console.warn(
        "[afiliados] no se pudo adjuntar la referencia:",
        (err as Error)?.message || err,
      );
    }
  }

  // Releemos para devolver exactamente lo que quedó en la BD (con el importe
  // recalculado en servidor, no el que mandó el navegador).
  const [rows, items, history] = await Promise.all([
    query<OrderRow>("select * from br_orders where id = ? limit 1", [id]),
    query<ItemRow>(
      "select order_id, product_id, name, qty, price from br_order_items where order_id = ?",
      [id],
    ),
    query<HistoryRow>(
      "select order_id, at, actor, what from br_order_history where order_id = ? order by at asc",
      [id],
    ),
  ]);
  return toOrder(rows[0], items, history);
}

/**
 * Fija la mayoría de edad de la cuenta (la llama el cliente AL aceptar el age
 * gate, no al pedir: así la declaración queda registrada aunque el pedido sea
 * posterior). Best-effort: si el esquema aún no tiene `age_ok` (BD sin
 * migrar), no rompe nada — el gate de pantalla sigue funcionando igual.
 */
export async function declareAdult(sid: string | undefined): Promise<{ ok: boolean }> {
  const session = await requireSession(sid, ["user"]);
  try {
    await execute("update br_users set age_ok = 1 where email = ?", [session.email]);
  } catch {
    /* sin columna: nada que persistir */
  }
  return { ok: true };
}

/* ------------------------------------------------------------- cupones */

/** Fila cruda de `br_coupons` (migración 0019). */
type CouponRow = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  amount: string | number;
  min_order: string | number;
  first_only: number;
  affiliate: number;
  affiliate_name: string | null;
  active: number;
  max_uses: number;
  used_count: number;
  expires_at: number | null;
  created_at: number;
};

function toCoupon(r: CouponRow): Coupon {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    amount: Number(r.amount),
    minOrder: Number(r.min_order),
    firstOnly: r.first_only === 1,
    affiliate: r.affiliate === 1,
    affiliateName: r.affiliate_name ?? null,
    active: r.active === 1,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAt: r.expires_at ?? null,
    createdAt: r.created_at,
  };
}

/**
 * Validación autoritativa de un cupón: se llama SIEMPRE en servidor, tanto en
 * la pre-visualización del checkout (`validateCoupon`) como al crear el pedido
 * (`createOrder`, contra el subtotal real recalculado del catálogo). El código
 * se normaliza a mayúsculas. `customer` activa la regla «primera compra»:
 * cuenta los pedidos previos NO cancelados y NO archivados del cliente.
 */
async function evaluateCoupon(
  rawCode: string,
  subtotal: number,
  customer: string,
): Promise<CouponCheck & { couponId: string; code: string }> {
  const fail = (msg: string) => ({
    ok: false as const,
    msg,
    discount: 0,
    couponId: "",
    code: "",
  });
  const code = rawCode.trim().toUpperCase();
  if (!code) return fail("Escribe un código de descuento.");
  const rows = await query<CouponRow>("select * from br_coupons where code = ? limit 1", [code]);
  const c = rows[0];
  if (!c || c.active !== 1) return fail("El código no es válido o ya no está activo.");
  if (c.expires_at != null && c.expires_at < Date.now()) return fail("El código ha caducado.");
  if (c.max_uses > 0 && c.used_count >= c.max_uses) return fail("El código ha agotado sus usos.");
  const minOrder = Number(c.min_order);
  if (subtotal < minOrder) {
    return fail(`Este código requiere un pedido mínimo de ${minOrder.toFixed(2)} €.`);
  }
  if (c.first_only === 1) {
    const prev = await query<{ n: number }>(
      "select count(*) as n from br_orders where archived = 0 and status <> 'cancelado' and customer = ?",
      [customer],
    );
    if ((prev[0]?.n ?? 0) > 0) return fail("Este código es solo para tu primer pedido.");
  }
  const amount = Number(c.amount);
  const discount = round2(
    c.kind === "percent" ? (subtotal * amount) / 100 : Math.min(amount, subtotal),
  );
  if (discount <= 0) return fail("El código no aplica a esta cesta.");
  return {
    ok: true,
    msg:
      c.affiliate === 1
        ? `Código de creador aplicado: −${discount.toFixed(2)} €`
        : `Cupón aplicado: −${discount.toFixed(2)} €`,
    discount,
    kind: c.kind,
    amount,
    affiliate: c.affiliate === 1,
    couponId: c.id,
    code,
  };
}

/**
 * Pre-visualización honesta del cupón en el checkout: valida y devuelve el
 * descuento que se aplicaría con la cesta actual. Al crear el pedido se
 * REVALIDA contra el subtotal real de catálogo, así que inflar el importe
 * desde el navegador no cambia nada.
 */
export async function validateCoupon(
  sid: string | undefined,
  p: { code: string; subtotal: number },
): Promise<CouponCheck & { code: string }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const subtotal = Math.max(0, Math.min(10_000, Number(p.subtotal) || 0));
  const { couponId: _couponId, ...check } = await evaluateCoupon(p.code, subtotal, session.email);
  return check;
}

/** Listado de cupones para el panel de admin (incluye los inactivos). */
export async function listCoupons(sid: string | undefined): Promise<Coupon[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<CouponRow>(
    "select * from br_coupons order by created_at desc limit 300",
  );
  return rows.map(toCoupon);
}

export type CouponDraft = {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  minOrder: number;
  firstOnly: boolean;
  affiliate: boolean;
  affiliateName?: string;
  /** Tope de usos; 0 = ilimitado. */
  maxUses?: number;
  /** epoch ms o null = sin caducidad. */
  expiresAt?: number | null;
};

/** Códigos legibles y sin ambigüedades visuales para compartir en redes. */
const COUPON_CODE_RE = /^[A-Z0-9_-]{3,24}$/;

export async function createCoupon(sid: string | undefined, d: CouponDraft): Promise<Coupon> {
  const admin = await requireSession(sid, ["admin"]);
  const code = d.code.trim().toUpperCase().replace(/\s+/g, "");
  if (!COUPON_CODE_RE.test(code)) {
    throw new Error("Código no válido: 3–24 caracteres (A–Z, 0–9, guion o subrayado).");
  }
  const amount = round2(Number(d.amount));
  if (!Number.isFinite(amount)) throw new Error("Importe no válido.");
  if (d.kind === "percent" && (amount < 1 || amount > 90)) {
    throw new Error("El porcentaje debe estar entre 1 y 90.");
  }
  if (d.kind === "fixed" && (amount < 0.5 || amount > 500)) {
    throw new Error("El descuento fijo debe estar entre 0,50 y 500 €.");
  }
  const minOrder = round2(Math.max(0, Number(d.minOrder) || 0));
  const maxUses = Math.max(0, Math.min(1_000_000, Math.floor(Number(d.maxUses) || 0)));
  const expiresAt = typeof d.expiresAt === "number" && d.expiresAt > 0 ? d.expiresAt : null;
  const affiliateName = d.affiliate ? d.affiliateName?.trim().slice(0, 120) || "Afiliado" : null;
  const dup = await query<{ id: string }>("select id from br_coupons where code = ? limit 1", [
    code,
  ]);
  if (dup.length) throw new Error(`El código ${code} ya existe.`);
  const id = newId("cp");
  const now = Date.now();
  await execute(
    "insert into br_coupons (id, code, kind, amount, min_order, first_only, affiliate, affiliate_name, active, max_uses, used_count, expires_at, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)",
    [
      id,
      code,
      d.kind,
      amount,
      minOrder,
      d.firstOnly ? 1 : 0,
      d.affiliate ? 1 : 0,
      affiliateName,
      maxUses,
      expiresAt,
      now,
    ],
  );
  void audit(admin.email, "coupon.crear", code, { kind: d.kind, amount });
  return {
    id,
    code,
    kind: d.kind,
    amount,
    minOrder,
    firstOnly: d.firstOnly,
    affiliate: d.affiliate,
    affiliateName,
    active: true,
    maxUses,
    usedCount: 0,
    expiresAt,
    createdAt: now,
  };
}

/** Activar/desactivar un cupón sin borrarlo (histórico de usos intacto). */
export async function setCouponActive(
  sid: string | undefined,
  id: string,
  active: boolean,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("update br_coupons set active = ? where id = ?", [active ? 1 : 0, id]);
  void audit(admin.email, "coupon.estado", id, { active });
  return { ok: true };
}

/**
 * Borra un cupón. Los pedidos ya realizados conservan su `coupon_code` escrito
 * (es texto, no FK), así que la trazabilidad de afiliados no se pierde.
 */
export async function deleteCoupon(sid: string | undefined, id: string): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_coupons where id = ?", [id]);
  void audit(admin.email, "coupon.eliminar", id);
  return { ok: true };
}

/* ------------------------------------------------------ reseñas y apoyos */

type ReviewRow = {
  id: string;
  order_id: string;
  order_code: string;
  customer: string;
  customer_name: string;
  stars: number;
  body: string;
  photo: string | null;
  status: ReviewStatus;
  created_at: number;
};

/**
 * Foto de reseña: data URL pequeño generado EN EL NAVEGADOR del cliente. El
 * servidor solo admite `data:image/…` de como mucho ~700 KB; nada de URLs
 * remotas (evita peticiones forjadas desde el campo).
 */
const REVIEW_PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,/;
const REVIEW_PHOTO_MAX = 700_000;

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    orderCode: r.order_code,
    customerName: r.customer_name,
    stars: r.stars,
    text: r.body,
    image: r.photo,
    status: r.status,
    createdAt: r.created_at,
  };
}

/**
 * Reseña de un pedido entregado: nace SIEMPRE privada. El servidor comprueba
 * que el pedido es del cliente (o del admin) y que está entregado, y evita el
 * duplicado por (pedido, cliente). La foto la redujo el navegador del cliente.
 */
export async function createReview(
  sid: string | undefined,
  input: { orderId: string; stars: number; text: string; image?: string },
): Promise<Review> {
  const session = await requireSession(sid, ["user", "admin"]);
  assertThrottle(
    `rev:${session.email}`,
    8,
    60 * 60_000,
    "Has enviado muchas reseñas seguidas. Espera un momento.",
  );
  const stars = Math.round(Number(input.stars));
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    throw new Error("Las estrellas deben estar entre 1 y 5.");
  }
  const body = input.text.trim().slice(0, 600);
  const photoRaw = input.image?.trim() ?? "";
  let photo: string | null = null;
  if (photoRaw) {
    if (!REVIEW_PHOTO_RE.test(photoRaw) || photoRaw.length > REVIEW_PHOTO_MAX) {
      throw new Error("La foto no es válida o pesa demasiado (máx. 500 KB).");
    }
    photo = photoRaw;
  }
  const rows = await query<{ id: string; code: string; customer: string; status: OrderStatus }>(
    "select id, code, customer, status from br_orders where id = ? limit 1",
    [input.orderId],
  );
  const order = rows[0];
  if (!order) throw new Error("Pedido no encontrado.");
  if (order.customer !== session.email && session.role !== "admin") {
    throw new Error("Solo puedes valorar tus propios pedidos.");
  }
  if (order.status !== "entregado") {
    throw new Error("Solo puedes valorar un pedido cuando ya se haya entregado.");
  }
  const dup = await query<{ id: string }>(
    "select id from br_reviews where order_id = ? and customer = ? limit 1",
    [order.id, session.email],
  );
  if (dup.length) throw new Error("Ya valoraste este pedido.");
  const id = newId("rv");
  const now = Date.now();
  await execute(
    "insert into br_reviews (id, order_id, order_code, customer, customer_name, stars, body, photo, status, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?, ?, 'privada', ?)",
    [id, order.id, order.code, session.email, session.name, stars, body, photo, now],
  );
  return {
    id,
    orderCode: order.code,
    customerName: session.name,
    stars,
    text: body,
    image: photo,
    status: "privada",
    createdAt: now,
  };
}

/** Reseñas publicadas: PÚBLICO y sin emails (solo el nombre que el cliente quiere mostrar). */
export async function listPublishedReviews(): Promise<Review[]> {
  const rows = await query<ReviewRow>(
    "select * from br_reviews where status = 'publicada' order by created_at desc limit 30",
  );
  return rows.map(toReview);
}

/** Todas las reseñas (solo admin): incluye las privadas y el email del autor. */
export async function listAllReviews(sid: string | undefined): Promise<AdminReview[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<ReviewRow>(
    "select * from br_reviews order by created_at desc limit 300",
  );
  return rows.map((r) => ({ ...toReview(r), customer: r.customer }));
}

/** Publicar/ocultar una reseña (solo admin). Nada se publica sin este paso. */
export async function setReviewPublished(
  sid: string | undefined,
  id: string,
  published: boolean,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("update br_reviews set status = ? where id = ?", [
    published ? "publicada" : "privada",
    id,
  ]);
  void audit(admin.email, "resena.publicar", id, { published });
  return { ok: true };
}

export async function deleteReview(sid: string | undefined, id: string): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_reviews where id = ?", [id]);
  void audit(admin.email, "resena.eliminar", id);
  return { ok: true };
}

/**
 * Reseñas ya enviadas por el cliente (para su propio panel: saber qué pedido
 * puede aún valorar). Devuelve solo los ids de pedido valorados por SU sesión.
 */
export async function listMyReviewedOrderIds(sid: string | undefined): Promise<string[]> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{ order_id: string }>(
    "select order_id from br_reviews where customer = ?",
    [session.email],
  );
  return rows.map((r) => r.order_id);
}

type DonationRow = {
  id: string;
  customer: string;
  customer_name: string;
  amount: number;
  message: string | null;
  created_at: number;
};

function toDonation(r: DonationRow): Donation {
  return {
    id: r.id,
    customer: r.customer,
    customerName: r.customer_name,
    amount: Number(r.amount),
    message: r.message,
    createdAt: r.created_at,
  };
}

/**
 * Donación «Apóyanos»: 1–999 € de un cliente con sesión. QUEDA REGISTRADA, no
 * se cobra: la pasarela real se conectará cuando el titular active Stripe.
 */
export async function createDonation(
  sid: string | undefined,
  input: { amount: number; message?: string },
): Promise<Donation> {
  const session = await requireSession(sid, ["user", "admin"]);
  assertThrottle(
    `don:${session.email}`,
    10,
    60 * 60_000,
    "Has registrado muchos apoyos seguidos. Espera un momento.",
  );
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
    throw new Error("El importe debe estar entre 1 y 999 €.");
  }
  const message = input.message?.trim().slice(0, 200) || null;
  const id = newId("dn");
  const now = Date.now();
  await execute(
    "insert into br_donations (id, customer, customer_name, amount, message, created_at) values (?, ?, ?, ?, ?, ?)",
    [id, session.email, session.name, amount, message, now],
  );
  return {
    id,
    customer: session.email,
    customerName: session.name,
    amount,
    message,
    createdAt: now,
  };
}

/** Apoyos registrados (solo admin): los últimos 300, orden descendente. */
export async function listDonations(sid: string | undefined): Promise<Donation[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<DonationRow>(
    "select * from br_donations order by created_at desc limit 300",
  );
  return rows.map(toDonation);
}

export async function deleteDonation(sid: string | undefined, id: string): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_donations where id = ?", [id]);
  void audit(admin.email, "donacion.eliminar", id);
  return { ok: true };
}

/** Mutación de estado con transición validada en servidor e historial anotado. */
async function mutateOrder(
  sid: string | undefined,
  orderId: string,
  allowed: OrderStatus[],
  next: (
    order: OrderRow,
    session: SessionInfo,
    conn: PoolConnection,
  ) => Promise<{ status: OrderStatus; courier?: string | null }>,
  roles: Role[],
): Promise<Order | null> {
  const session = await requireSession(sid, roles);
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = (await conn.query(
      "select * from br_orders where id = ? or code = ? limit 1 for update",
      [orderId, orderId],
    )) as [OrderRow[], unknown];
    const order = rows[0];
    if (!order) {
      await conn.rollback();
      return null;
    }
    if (!allowed.includes(order.status)) {
      await conn.rollback();
      throw new Error(`Este pedido ya está en estado ${order.status}.`);
    }
    const change = await next(order, session, conn);
    await conn.query("update br_orders set status = ?, courier = ? where id = ?", [
      change.status,
      change.courier === undefined ? order.courier : change.courier,
      order.id,
    ]);
    await conn.query(
      "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
      [order.id, Date.now(), session.email, change.status],
    );
    await conn.commit();

    const [items] = (await conn.query(
      "select order_id, product_id, name, qty, price from br_order_items where order_id = ?",
      [order.id],
    )) as [ItemRow[], unknown];
    const [history] = (await conn.query(
      "select order_id, at, actor, what from br_order_history where order_id = ? order by at asc",
      [order.id],
    )) as [HistoryRow[], unknown];
    const result = toOrder(
      {
        ...order,
        status: change.status,
        courier: change.courier === undefined ? order.courier : change.courier,
      },
      items,
      history,
    );
    // Notificación fire-and-forget: va DESPUÉS del commit, así que un fallo de
    // correo/SMS jamás revierte el cambio de estado del reparto.
    void notifyOrderChange(result).catch((err) =>
      console.error("[notify]", (err as Error)?.message || err),
    );
    return result;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function assignCourier(
  sid: string | undefined,
  orderId: string,
  courierEmail: string,
): Promise<Order | null> {
  return mutateOrder(
    sid,
    orderId,
    ["pendiente", "asignado"],
    async (_order, _session, conn) => {
      // El email del repartidor lo elige el admin en un select: verificamos en
      // servidor que existe y está aprobado, o delegaríamos en una cuenta falsa.
      const [rows] = (await conn.query(
        `select ${USER_COLUMNS} from br_users where email = ? and role = 'repartidor' and status = 'activo' limit 1`,
        [courierEmail.trim().toLowerCase()],
      )) as [UserRowDto[], unknown];
      if (!rows.length) throw new Error("Ese repartidor no está aprobado.");
      return { status: "asignado" as const, courier: rows[0].email };
    },
    ["admin"],
  );
}

export function courierAccept(sid: string | undefined, orderId: string) {
  return mutateOrder(
    sid,
    orderId,
    ["pendiente", "asignado"],
    async (order, session) => {
      // Propiedad: si el admin ya lo asignó a otro repartidor, nadie más puede
      // adelantarlo. Sin esta comprobación, cualquier repartidor con el id (que
      // la cola abierta sirve) robaba repartos ajenos y con ellos la dirección,
      // el teléfono y el chat del cliente.
      if (
        session.role !== "admin" &&
        order.status === "asignado" &&
        order.courier &&
        order.courier !== session.email
      ) {
        throw new Error("Este reparto ya está asignado a otro repartidor.");
      }
      return { status: "en_reparto" as const, courier: session.email };
    },
    ["repartidor", "admin"],
  );
}

export async function markDelivered(sid: string | undefined, orderId: string) {
  const res = await mutateOrder(
    sid,
    orderId,
    ["en_reparto"],
    async (order, session) => {
      // Solo quien lleva el reparto (o el admin) puede cerrar un reparto: así
      // nadie marca como entregado algo que no ha entregado — lo que además
      // abriría la facturación y el cobro en efectivo de ese pedido.
      if (session.role !== "admin" && order.courier && order.courier !== session.email) {
        throw new Error("Solo el repartidor asignado puede marcar este reparto como entregado.");
      }
      return { status: "entregado" as const };
    },
    ["repartidor", "admin"],
  );
  // CHAPAS (migración 0026): al ENTREGARSE el pedido se suman las chapas del
  // cliente. FUERA de la transacción de la entrega, pero ESPERADA aquí: en
  // hosting serverless el proceso puede congelarse justo después de responder,
  // y un fire-and-forget se perdía a medias (el cliente no veía sus chapas).
  // Si el programa está apagado o algo falla, la entrega NO se rompe.
  if (res && res.status === "entregado") {
    try {
      await awardChapasForOrder(res);
    } catch (err) {
      console.warn("[chapas] no se pudo acumular:", (err as Error)?.message || err);
    }
    // TICKET DE RULETA (migración 0028): cada pedido entregado de más de
    // `ticket_min_euro` regala 1 giro. Best-effort como las chapas: si falla,
    // la entrega NO se rompe.
    try {
      await awardRaffleTicketForOrder(res);
    } catch (err) {
      console.warn("[sorteo] no se pudo registrar el ticket:", (err as Error)?.message || err);
    }
    // AFILIADOS (migración 0030): la PRIMERA entrega del invitado cierra su
    // enlace y da el premio a ambas partes. Best-effort: jamás rompe la entrega.
    try {
      await awardAffiliateForOrder(res);
    } catch (err) {
      console.warn("[afiliados] no se pudo registrar el premio:", (err as Error)?.message || err);
    }
  }
  return res;
}

export function cancelOrder(sid: string | undefined, orderId: string) {
  return mutateOrder(
    sid,
    orderId,
    ["pendiente", "asignado", "en_reparto"],
    async (order, _session, conn) => {
      // La cancelación LIBERA el uso del cupón: el pedido ya no existe a todos
      // los efectos, así que su descuento no debe quedar quemado para siempre.
      if (order.coupon_code) {
        await conn.query(
          "update br_coupons set used_count = greatest(0, used_count - 1) where code = ? and used_count > 0",
          [order.coupon_code],
        );
      }
      return { status: "cancelado" as const };
    },
    ["admin"],
  );
}

/**
 * REASIGNAR un pedido cancelado (Fase 10): si el cliente pide una segunda
 * oportunidad, el admin lo reactiva y lo delega a otro repartidor EN LA MISMA
 * acción. El pedido vuelve a «asignado» y, si traía cupón, se intenta volver a
 * contabilizar su uso (el reparto no se frena si el cupón ya agotó su tope:
 * la cancelación lo liberó y ahora puede volver a quemarse).
 */
export function reactivateAndAssignCourier(
  sid: string | undefined,
  orderId: string,
  courierEmail: string,
) {
  return mutateOrder(
    sid,
    orderId,
    ["cancelado"],
    async (order, _session, conn) => {
      // Mismo candado que `assignCourier`: solo repartidores existentes y
      // aprobados, aunque llegue un email inventado por el formulario.
      const [rows] = (await conn.query(
        `select ${USER_COLUMNS} from br_users where email = ? and role = 'repartidor' and status = 'activo' limit 1`,
        [courierEmail.trim().toLowerCase()],
      )) as [UserRowDto[], unknown];
      if (!rows.length) throw new Error("Ese repartidor no está aprobado.");
      if (order.coupon_code) {
        await conn.query(
          "update br_coupons set used_count = used_count + 1 where code = ? and (max_uses = 0 or used_count < max_uses)",
          [order.coupon_code],
        );
      }
      return { status: "asignado" as const, courier: rows[0].email };
    },
    ["admin"],
  );
}

/**
 * El admin ELIMINA un pedido del flujo normal en cualquier momento (nuevo o ya
 * en curso). Es un BORRADO LÓGICO: se marca `archived = 1` y desaparece de las
 * listas de admin/cliente/repartidor, pero la fila, sus items, historial y
 * factura siguen intactos para poder consultarlos y descargarlos en PDF desde
 * «Archivados». Nunca se borra físicamente (no se pierde información).
 */
export async function deleteOrder(
  sid: string | undefined,
  orderId: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const rows = await query<{ id: string }>(
    "select id from br_orders where id = ? or code = ? limit 1",
    [orderId, orderId],
  );
  if (!rows.length) return { ok: false, msg: "Ese pedido no existe." };
  await execute("update br_orders set archived = 1 where id = ?", [rows[0].id]);
  void audit(admin.email, "pedido.archivar", rows[0].id);
  return { ok: true, msg: "Pedido archivado (queda en la lista de eliminados)." };
}

/** Vuelve a poner un pedido archivado en el flujo normal. */
export async function restoreOrder(
  sid: string | undefined,
  orderId: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const rows = await query<{ id: string }>(
    "select id from br_orders where id = ? or code = ? limit 1",
    [orderId, orderId],
  );
  if (!rows.length) return { ok: false, msg: "Ese pedido no existe." };
  await execute("update br_orders set archived = 0 where id = ?", [rows[0].id]);
  void audit(admin.email, "pedido.restaurar", rows[0].id);
  return { ok: true, msg: "Pedido restaurado." };
}

/**
 * Lista de pedidos ELIMINADOS (archivados), solo para el admin. Trae items e
 * historial igual que `listOrders` para poder verlos y descargarlos en PDF.
 */
export async function listArchivedOrders(sid: string | undefined): Promise<Order[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<OrderRow>(
    "select * from br_orders where archived = 1 order by created_at desc limit 500",
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const [items, history] = await Promise.all([
    query<ItemRow>(
      `select order_id, product_id, name, qty, price from br_order_items where order_id in (${marks})`,
      ids,
    ),
    query<HistoryRow>(
      `select order_id, at, actor, what from br_order_history where order_id in (${marks}) order by at asc`,
      ids,
    ),
  ]);
  return rows.map((r) =>
    toOrder(
      r,
      items.filter((i) => i.order_id === r.id),
      history.filter((h) => h.order_id === r.id),
    ),
  );
}

/* ------------------------------------------------- borrado definitivo */

/**
 * BORRADO DEFINITIVO de un pedido ya archivado. A diferencia de `deleteOrder`
 * (borrado lógico), aquí se elimina la fila de `br_orders` y con ella, en
 * cascada por clave foránea, sus items/historial/facturas/pagos; borramos además
 * a mano el chat y la ubicación del cliente (tablas sin FK) para no dejar filas
 * huérfanas. Solo admin y SOLO sobre un pedido archivado: así es imposible borrar
 * por error un reparto en curso.
 */
export async function purgeOrder(
  sid: string | undefined,
  orderId: string,
): Promise<{ ok: boolean; msg: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const rows = await query<{ id: string; archived: number }>(
    "select id, archived from br_orders where id = ? or code = ? limit 1",
    [orderId, orderId],
  );
  if (!rows.length) return { ok: false, msg: "Ese pedido no existe." };
  if (rows[0].archived !== 1) {
    return { ok: false, msg: "Solo se puede borrar de verdad un pedido archivado." };
  }
  const id = rows[0].id;
  // Satélites SIN clave foránea: se limpian a mano antes de borrar la fila.
  await execute("delete from br_chat_messages where order_id = ?", [id]);
  await execute("delete from br_customer_locations where order_id = ?", [id]);
  await execute("update br_courier_locations set order_id = null where order_id = ?", [id]);
  // La fila: items, historial, facturas y pagos caen en cascada (FK on delete).
  await execute("delete from br_orders where id = ?", [id]);
  void audit(admin.email, "pedido.purgar", id);
  return { ok: true, msg: "Pedido borrado definitivamente." };
}

/* ------------------------------------------------- cancelación del repartidor */

/**
 * El REPARTIDOR cancela un reparto que ya tenía asignado. Es OBLIGATORIO
 * escribir por qué: sin motivo no se acepta. Se valida en servidor que el pedido
 * es SUYO y que sigue EN JUEGO (asignado/en_reparto). Guarda el motivo en el
 * pedido, deja el hito en el historial y AVISA al admin (correo a cada admin)
 * y al cliente. El aviso es fire-and-forget: un fallo de correo no revierte la
 * cancelación.
 */
export async function courierCancel(
  sid: string | undefined,
  orderId: string,
  reason: string,
): Promise<{ ok: boolean; msg: string }> {
  const session = await requireSession(sid, ["repartidor"]);
  const text = (reason || "").trim().slice(0, 512);
  if (!text) return { ok: false, msg: "Debes indicar el motivo de la cancelación." };
  const rows = await query<{
    id: string;
    code: string;
    courier: string | null;
    status: OrderStatus;
    customer: string;
    address: string;
    postal_code: string | null;
  }>(
    "select id, code, courier, status, customer, address, postal_code from br_orders " +
      "where (id = ? or code = ?) and archived = 0 limit 1",
    [orderId, orderId],
  );
  const o = rows[0];
  if (!o) return { ok: false, msg: "Ese pedido no existe." };
  if (o.courier !== session.email) {
    return { ok: false, msg: "Solo puedes cancelar un reparto asignado a ti." };
  }
  if (o.status !== "asignado" && o.status !== "en_reparto") {
    return { ok: false, msg: "Este pedido ya no está en curso." };
  }
  await execute(
    "update br_orders set status = 'cancelado', cancel_reason = ?, cancelled_by = 'repartidor' where id = ?",
    [text, o.id],
  );
  await execute("insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)", [
    o.id,
    Date.now(),
    session.email,
    `cancelado por repartidor: ${text}`,
  ]);
  void notifyCourierCancel(o, session.name || session.email, text).catch((err) =>
    console.error("[notify]", (err as Error)?.message || err),
  );
  return { ok: true, msg: "Reparto cancelado. El admin ha recibido el aviso con el motivo." };
}

/**
 * Aviso (best-effort) a los admin y al cliente de una cancelación hecha por el
 * repartidor. El admin recibe el MOTIVO textual para poder reasignar o contactar;
 * el cliente recibe un aviso neutro (el motivo lo gestiona el equipo).
 */
async function notifyCourierCancel(
  o: { code: string; customer: string; address: string; postal_code: string | null },
  courierName: string,
  reason: string,
): Promise<void> {
  const addr = [o.address, o.postal_code].filter(Boolean).join(", ");
  const admins = await query<{ email: string }>(
    "select email from br_users where role = 'admin' and status = 'activo'",
  );
  const body =
    `El repartidor ${courierName} ha cancelado el reparto ${o.code} (${addr}).\n\n` +
    `Motivo indicado: ${reason}\n\n` +
    `El pedido ha pasado a «cancelado»: reasígnalo o contacta con el cliente.`;
  for (const a of admins) {
    await sendEmailBestEffort(a.email, `Reparto ${o.code} cancelado por el repartidor`, body);
  }
  await sendEmailBestEffort(
    o.customer,
    `Tu pedido ${o.code}: buscamos otra solución de reparto`,
    `El repartidor asignado a tu pedido ${o.code} no ha podido completar el reparto. ` +
      `Lo sentimos mucho: nuestro equipo está revisándolo y te avisará por aquí.`,
  );
}

/* ------------------------------------------------------------- estadísticas */

const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** Variación % de `cur` respecto a `prev` (0 → 0; sin base pero con valor → 100). */
function pctDelta(cur: number, prev: number): number {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return cur > 0 ? 100 : 0;
}

/**
 * Estadísticas del panel de admin, TODO agregado en servidor contra MySQL.
 * Ventanas naturales en huso local (día 00:00, mes día 1). «Ingresos» = suma de
 * `total` de los pedidos NO cancelados y NO archivados según su fecha de
 * creación. «Usuarios en vivo» = sesiones vigentes (distinct); «usuarios
 * diarios» = distinct con sesión iniciada hoy. Los % comparan con el periodo
 * anterior (ayer / mes previo). Solo admin.
 */
export async function getStats(sid: string | undefined): Promise<Stats> {
  await requireSession(sid, ["admin"]);
  const now = Date.now();
  const DAY = 86_400_000;

  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const startToday = today0.getTime();
  const startYesterday = startToday - DAY;
  const month0 = new Date();
  month0.setDate(1);
  month0.setHours(0, 0, 0, 0);
  const startMonth = month0.getTime();
  const prevMonthStart = new Date(month0.getFullYear(), month0.getMonth() - 1, 1).getTime();
  const dailyStart = startToday - 29 * DAY;
  const monthlyStart = new Date(month0.getFullYear(), month0.getMonth() - 11, 1).getTime();
  const windowStart = Math.min(monthlyStart, dailyStart, prevMonthStart, startYesterday);

  const [
    orderRows,
    userRows,
    liveRows,
    todayUserRows,
    yUserRows,
    pendingRows,
    flightRows,
    courierRows,
    cancelRows,
  ] = await Promise.all([
    query<{ created_at: number; total: string | number; status: OrderStatus; customer: string }>(
      "select created_at, total, status, customer from br_orders where archived = 0 and created_at >= ?",
      [windowStart],
    ),
    query<{ created_at: number }>("select created_at from br_users where created_at >= ?", [
      windowStart,
    ]),
    query<{ n: number }>(
      "select count(distinct user_email) as n from br_sessions where expires_at > ?",
      [now],
    ),
    query<{ n: number }>(
      "select count(distinct user_email) as n from br_sessions where created_at >= ?",
      [startToday],
    ),
    query<{ n: number }>(
      "select count(distinct user_email) as n from br_sessions where created_at >= ? and created_at < ?",
      [startYesterday, startToday],
    ),
    query<{ n: number }>(
      "select count(*) as n from br_orders where archived = 0 and status = 'pendiente'",
    ),
    query<{ n: number }>(
      "select count(*) as n from br_orders where archived = 0 and status in ('asignado','en_reparto')",
    ),
    query<{ n: number }>(
      "select count(*) as n from br_users where role = 'repartidor' and status = 'activo'",
    ),
    query<{ n: number }>(
      "select count(*) as n from br_order_history where what like 'cancelado por repartidor%' and at >= ?",
      [startMonth],
    ),
  ]);

  const sold = orderRows.filter((r) => r.status !== "cancelado");
  const revOf = (rows: { created_at: number; total: string | number }[]) =>
    rows.reduce((s, r) => s + Number(r.total), 0);
  const inRange = (t: number, from: number, to: number) => t >= from && t < to;

  const ordersToday = orderRows.filter((r) => r.created_at >= startToday).length;
  const ordersYesterday = orderRows.filter((r) =>
    inRange(r.created_at, startYesterday, startToday),
  ).length;
  const ordersMonth = orderRows.filter((r) => r.created_at >= startMonth).length;
  const ordersPrevMonth = orderRows.filter((r) =>
    inRange(r.created_at, prevMonthStart, startMonth),
  ).length;
  const revenueToday = revOf(sold.filter((r) => r.created_at >= startToday));
  const revenueYesterday = revOf(
    sold.filter((r) => inRange(r.created_at, startYesterday, startToday)),
  );
  const revenueMonth = revOf(sold.filter((r) => r.created_at >= startMonth));
  const revenuePrevMonth = revOf(
    sold.filter((r) => inRange(r.created_at, prevMonthStart, startMonth)),
  );
  const signupsToday = userRows.filter((r) => r.created_at >= startToday).length;
  const signupsYesterday = userRows.filter((r) =>
    inRange(r.created_at, startYesterday, startToday),
  ).length;
  const signupsMonth = userRows.filter((r) => r.created_at >= startMonth).length;
  const signupsPrevMonth = userRows.filter((r) =>
    inRange(r.created_at, prevMonthStart, startMonth),
  ).length;

  // Serie diaria (últimos 30 días).
  const daily: StatsPoint[] = [];
  for (let d = dailyStart; d <= startToday; d += DAY) {
    const end = d + DAY;
    daily.push({
      label: new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
      orders: orderRows.filter((r) => inRange(r.created_at, d, end)).length,
      revenue: Math.round(revOf(sold.filter((r) => inRange(r.created_at, d, end))) * 100) / 100,
      signups: userRows.filter((r) => inRange(r.created_at, d, end)).length,
    });
  }

  // Serie mensual (últimos 12 meses).
  const monthly: StatsPoint[] = [];
  for (let m = 0; m < 12; m += 1) {
    const start = new Date(month0.getFullYear(), month0.getMonth() - (11 - m), 1).getTime();
    const end = new Date(
      new Date(start).getFullYear(),
      new Date(start).getMonth() + 1,
      1,
    ).getTime();
    monthly.push({
      label: MONTHS_ES[new Date(start).getMonth()],
      orders: orderRows.filter((r) => inRange(r.created_at, start, end)).length,
      revenue: Math.round(revOf(sold.filter((r) => inRange(r.created_at, start, end))) * 100) / 100,
      signups: userRows.filter((r) => inRange(r.created_at, start, end)).length,
    });
  }

  const STATUS_ORDER: OrderStatus[] = [
    "pendiente",
    "asignado",
    "en_reparto",
    "entregado",
    "cancelado",
  ];
  const statusBreakdown = STATUS_ORDER.map((status) => ({
    status,
    count: orderRows.filter((r) => r.status === status).length,
  }));

  // Recurrencia del mes actual (solo pedidos NO cancelados): ticket medio, % de
  // clientes que repiten (≥2 pedidos) y media de pedidos por cliente único.
  const soldMonth = sold.filter((r) => r.created_at >= startMonth);
  const byCustomer = new Map<string, number>();
  for (const r of soldMonth) byCustomer.set(r.customer, (byCustomer.get(r.customer) ?? 0) + 1);
  const uniqueCustomers = byCustomer.size;
  const repeatCustomers = [...byCustomer.values()].filter((n) => n >= 2).length;
  const repeatRatePct = uniqueCustomers ? Math.round((repeatCustomers / uniqueCustomers) * 100) : 0;
  const ordersPerCustomer = uniqueCustomers ? round2(soldMonth.length / uniqueCustomers) : 0;
  const avgTicket = soldMonth.length ? round2(revOf(soldMonth) / soldMonth.length) : 0;

  return {
    updatedAt: now,
    totals: {
      ordersToday,
      ordersMonth,
      revenueToday: Math.round(revenueToday * 100) / 100,
      revenueMonth: Math.round(revenueMonth * 100) / 100,
      signupsToday,
      signupsMonth,
      liveUsers: liveRows[0]?.n ?? 0,
      activeUsersToday: todayUserRows[0]?.n ?? 0,
      couriersActive: courierRows[0]?.n ?? 0,
      pendingOrders: pendingRows[0]?.n ?? 0,
      inFlightOrders: flightRows[0]?.n ?? 0,
      courierCancelsMonth: cancelRows[0]?.n ?? 0,
      avgTicket,
      repeatRatePct,
      ordersPerCustomer,
      uniqueCustomers,
    },
    deltas: {
      ordersDayPct: pctDelta(ordersToday, ordersYesterday),
      ordersMonthPct: pctDelta(ordersMonth, ordersPrevMonth),
      revenueDayPct: pctDelta(revenueToday, revenueYesterday),
      revenueMonthPct: pctDelta(revenueMonth, revenuePrevMonth),
      signupsDayPct: pctDelta(signupsToday, signupsYesterday),
      signupsMonthPct: pctDelta(signupsMonth, signupsPrevMonth),
      activeUsersDayPct: pctDelta(todayUserRows[0]?.n ?? 0, yUserRows[0]?.n ?? 0),
    },
    daily,
    monthly,
    statusBreakdown,
  };
}

/* ------------------------------------------------- seguimiento y ubicación */

/** Ventana de frescura del fix de un repartidor para mostrarlo en el mapa. */
const LOCATION_FRESH_MS = 10 * 60_000;

type LocationRow = {
  courier_email: string;
  lat: string | number;
  lng: string | number;
  accuracy_m: number;
  order_id: string | null;
  updated_at: number;
};

/** Fila de `br_customer_locations`: último fix que el CLIENTE compartió. */
type CustomerLocationRow = {
  order_id: string;
  lat: string | number;
  lng: string | number;
  accuracy_m: number;
  updated_at: number;
};

/**
 * El móvil del repartidor manda su posición (con su permiso) mientras tiene un
 * reparto en curso. Se guarda SOLO el último fix por repartidor (upsert): no
 * trazamos rutas históricas, así la privacidad se respeta y la tabla no crece.
 * El `orderId` se valida contra los pedidos realmente asignados a él: nadie
 * puede colgar su posición a un pedido ajeno.
 */
export async function pingCourierLocation(
  sid: string | undefined,
  p: { lat: number; lng: number; accuracyM?: number; orderId?: string },
): Promise<{ ok: true }> {
  const session = await requireSession(sid, ["repartidor"]);
  if (!(p.lat >= -90 && p.lat <= 90) || !(p.lng >= -180 && p.lng <= 180)) {
    throw new Error("Coordenadas no válidas.");
  }
  const acc = Math.max(0, Math.min(100_000, Math.round(p.accuracyM ?? 0)));
  let orderId: string | null = p.orderId?.trim() || null;
  if (orderId) {
    const owns = await query<{ id: string }>(
      "select id from br_orders where (id = ? or code = ?) and courier = ? limit 1",
      [orderId, orderId, session.email],
    );
    orderId = owns.length ? owns[0].id : null;
  }
  await execute(
    "insert into br_courier_locations (courier_email, lat, lng, accuracy_m, order_id, updated_at) " +
      "values (?, ?, ?, ?, ?, ?) " +
      "on duplicate key update lat = values(lat), lng = values(lng), accuracy_m = values(accuracy_m), " +
      "order_id = values(order_id), updated_at = values(updated_at)",
    [session.email, p.lat, p.lng, acc, orderId, Date.now()],
  );
  return { ok: true };
}

/**
 * El CLIENTE manda su posición al repartidor y al admin, PERO SOLO si él ha
 * activado «Compartir mi ubicación» en la pantalla de seguimiento (permiso
 * explícito del navegador) y el pedido está EN JUEGO. Autorización: dueño del
 * pedido. Se guarda una sola fila por pedido (upsert, sin histórico): privacidad
 * por diseño, igual que el repartidor.
 */
export async function pingCustomerLocation(
  sid: string | undefined,
  p: { orderRef: string; lat: number; lng: number; accuracyM?: number },
): Promise<{ ok: true }> {
  const session = await requireSession(sid);
  if (!(p.lat >= -90 && p.lat <= 90) || !(p.lng >= -180 && p.lng <= 180)) {
    throw new Error("Coordenadas no válidas.");
  }
  const ref = p.orderRef.trim();
  const rows = await query<{ id: string; customer: string; status: OrderStatus }>(
    "select id, customer, status from br_orders where id = ? or code = ? limit 1",
    [ref, ref],
  );
  const order = rows[0];
  if (!order) throw new Error("Pedido no encontrado.");
  if (order.customer !== session.email) {
    throw new Error("Solo puedes compartir la ubicación de tus propios pedidos.");
  }
  // Fuera de reparto en curso no se guarda GPS: se ignora en silencio (no es
  // error, el cliente sigue viendo su mapa aunque ya no comparta).
  if (order.status !== "asignado" && order.status !== "en_reparto") return { ok: true };
  const acc = Math.max(0, Math.min(100_000, Math.round(p.accuracyM ?? 0)));
  await execute(
    "insert into br_customer_locations (order_id, lat, lng, accuracy_m, updated_at) values (?, ?, ?, ?, ?) " +
      "on duplicate key update lat = values(lat), lng = values(lng), accuracy_m = values(accuracy_m), updated_at = values(updated_at)",
    [order.id, p.lat, p.lng, acc, Date.now()],
  );
  return { ok: true };
}

/**
 * Datos para la página de seguimiento. Autorización calcada de `chatAccess`:
 * dueño, repartidor asignado o admin, siempre contra la sesión. Se sirve el
 * ÚLTIMO fix conocido del repartidor aunque esté viejo (el cliente así sabe
 * dónde se quedó, en vez de quedarse sin mapa); `courierOnline` avisa si el
 * fix es reciente (ventana de 10 min) o si el GPS del repartidor está en pausa.
 */
export async function getOrderTracking(
  sid: string | undefined,
  orderIdOrCode: string,
): Promise<TrackingInfo> {
  const session = await requireSession(sid);
  const rows = await query<OrderRow>("select * from br_orders where id = ? or code = ? limit 1", [
    orderIdOrCode,
    orderIdOrCode,
  ]);
  const order = rows[0];
  if (!order) throw new Error("Pedido no encontrado.");
  const isCustomer = order.customer === session.email;
  const isCourier = Boolean(order.courier) && order.courier === session.email;
  if (!(isCustomer || isCourier || session.role === "admin")) {
    throw new Error("No tienes acceso a este seguimiento.");
  }

  const inFlight = order.status === "asignado" || order.status === "en_reparto";
  const [history, locRows, custRows, nameRows] = await Promise.all([
    query<HistoryRow>(
      "select order_id, at, actor, what from br_order_history where order_id = ? order by at asc",
      [order.id],
    ),
    inFlight && order.courier
      ? query<LocationRow>(
          "select courier_email, lat, lng, accuracy_m, order_id, updated_at from br_courier_locations where courier_email = ? limit 1",
          [order.courier],
        )
      : Promise.resolve([] as LocationRow[]),
    // El cliente SOLO aparece si él activó «Compartir mi ubicación». Es el fijo
    // más reciente de esa pantalla para este pedido (caduca a los 10 min).
    inFlight
      ? query<CustomerLocationRow>(
          "select order_id, lat, lng, accuracy_m, updated_at from br_customer_locations where order_id = ? limit 1",
          [order.id],
        )
      : Promise.resolve([] as CustomerLocationRow[]),
    order.courier
      ? query<{ name: string }>("select name from br_users where email = ? limit 1", [
          order.courier,
        ])
      : Promise.resolve([] as { name: string }[]),
  ]);
  const loc = locRows[0];
  const point: CourierPoint | null = loc
    ? {
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        accuracyM: Number(loc.accuracy_m),
        updatedAt: Number(loc.updated_at),
      }
    : null;
  const online = point ? Date.now() - point.updatedAt < LOCATION_FRESH_MS : false;

  const cust = custRows[0];
  const customerPoint: CourierPoint | null = cust
    ? {
        lat: Number(cust.lat),
        lng: Number(cust.lng),
        accuracyM: Number(cust.accuracy_m),
        updatedAt: Number(cust.updated_at),
      }
    : null;
  const customerOnline = customerPoint
    ? Date.now() - customerPoint.updatedAt < LOCATION_FRESH_MS
    : false;

  // Destination exacta si el geocoder (Nominatim) resolvió la calle al crear el
  // pedido; si no, centroide del CP. `destinationExact` avisa a la UI de que el
  // punto es la casa real y no una aproximación por código postal.
  const destLat = Number(order.dest_lat);
  const destLng = Number(order.dest_lng);
  const hasExact =
    order.dest_lat != null &&
    order.dest_lng != null &&
    Number.isFinite(destLat) &&
    Number.isFinite(destLng);

  return {
    code: order.code,
    status: order.status,
    address: order.address,
    postalCode: order.postal_code,
    courierName: nameRows[0]?.name ?? null,
    destination: hasExact ? [destLat, destLng] : coordsForCp(order.postal_code || ""),
    destinationExact: hasExact,
    courier: point,
    courierOnline: online,
    customer: customerPoint,
    customerOnline,
    history: history.map((h) => ({ at: h.at, by: h.actor, what: h.what })),
    createdAt: order.created_at,
  };
}

/**
 * Mapa en vivo del panel de admin: último fix de cada repartidor (últimas 6 h)
 * con el pedido que lleva asignado en ese momento. Solo admin.
 */
export async function listLiveLocations(sid: string | undefined): Promise<LiveCourier[]> {
  await requireSession(sid, ["admin"]);
  const since = Date.now() - 6 * 60 * 60 * 1000;
  const rows = await query<
    LocationRow & {
      name: string | null;
      order_code: string | null;
      order_status: OrderStatus | null;
      cust_lat: string | number | null;
      cust_lng: string | number | null;
      cust_acc: number | null;
      cust_at: number | null;
    }
  >(
    "select l.courier_email, l.lat, l.lng, l.accuracy_m, l.order_id, l.updated_at, " +
      "u.name, o.code as order_code, o.status as order_status, " +
      "cl.lat as cust_lat, cl.lng as cust_lng, cl.accuracy_m as cust_acc, cl.updated_at as cust_at " +
      "from br_courier_locations l " +
      "left join br_users u on u.email = l.courier_email " +
      "left join br_orders o on o.id = l.order_id " +
      "left join br_customer_locations cl on cl.order_id = l.order_id " +
      "where l.updated_at >= ? order by l.updated_at desc limit 100",
    [since],
  );
  return rows.map((r) => {
    const hasCust =
      r.cust_lat != null &&
      r.cust_lng != null &&
      Number.isFinite(Number(r.cust_lat)) &&
      Number.isFinite(Number(r.cust_lng));
    return {
      courier: r.courier_email,
      name: r.name || r.courier_email,
      lat: Number(r.lat),
      lng: Number(r.lng),
      accuracyM: Number(r.accuracy_m),
      updatedAt: Number(r.updated_at),
      orderCode: r.order_code,
      status: r.order_status,
      customer: hasCust
        ? {
            lat: Number(r.cust_lat),
            lng: Number(r.cust_lng),
            accuracyM: Number(r.cust_acc ?? 0),
            updatedAt: Number(r.cust_at ?? 0),
          }
        : null,
    };
  });
}

/* -------------------------------------------------------------------- chat */

type ChatRow = {
  id: string;
  order_id: string;
  sender_email: string;
  sender_name: string;
  sender_role: Role;
  body: string;
  created_at: number;
};

/**
 * Resuelve el pedido por id o código y comprueba que quien llama es parte
 * interesada: el dueño (cliente), el repartidor asignado o un admin (soporte).
 * La autorización es SIEMPRE en servidor contra la sesión: el navegador solo
 * envía un id de pedido, nunca su identidad ni su rol.
 */
async function chatAccess(
  sid: string | undefined,
  orderIdOrCode: string,
): Promise<{
  session: SessionInfo;
  order: { id: string; code: string; customer: string; courier: string | null };
}> {
  const session = await requireSession(sid);
  const rows = await query<{ id: string; code: string; customer: string; courier: string | null }>(
    "select id, code, customer, courier from br_orders where id = ? or code = ? limit 1",
    [orderIdOrCode, orderIdOrCode],
  );
  const order = rows[0];
  if (!order) {
    // CHAT DE CANJES (migración 0028): el mismo hilo admite el id/código de un
    // canje de chapas (`br_chapa_redemptions`): hablan su cliente dueño y el
    // admin para coordinar cómo llega el regalo. Nunca otro cliente.
    const red = await query<{ id: string; code: string; customer: string }>(
      "select id, code, customer from br_chapa_redemptions where id = ? or code = ? limit 1",
      [orderIdOrCode, orderIdOrCode],
    );
    const r = red[0];
    if (r) {
      if (r.customer !== session.email && session.role !== "admin") {
        throw new Error("No tienes acceso a este chat.");
      }
      return { session, order: { id: r.id, code: r.code, customer: r.customer, courier: null } };
    }
    // CHAT DE PREMIOS (Fase 12): el hilo admite también el id/código de un
    // entry de la ruleta (`br_raffle_entries`): cuando un cliente RECLAMA un
    // premio, el admin recibe aviso y puede abrirle chat para coordinar la
    // entrega. Mismo mecanismo de chat por pedido, sin tabla nueva: el `order_id`
    // de `br_chat_messages` guarda el id del entry. Solo dueño y admin.
    const raf = await query<{ id: string; code: string; customer: string }>(
      "select id, code, customer from br_raffle_entries where id = ? or code = ? limit 1",
      [orderIdOrCode, orderIdOrCode],
    );
    const sf = raf[0];
    if (!sf) throw new Error("Pedido no encontrado.");
    if (sf.customer !== session.email && session.role !== "admin") {
      throw new Error("No tienes acceso a este chat.");
    }
    return { session, order: { id: sf.id, code: sf.code, customer: sf.customer, courier: null } };
  }
  const isCustomer = order.customer === session.email;
  const isCourier = Boolean(order.courier) && order.courier === session.email;
  if (!(isCustomer || isCourier || session.role === "admin")) {
    throw new Error("No tienes acceso a este chat.");
  }
  return {
    session,
    order: { id: order.id, code: order.code, customer: order.customer, courier: order.courier },
  };
}

/**
 * Throttle anti-spam/anti-abuso: tope de mensajes por minuto por remitente.
 * Se apoya en el índice `idx_chat_sender_time`. No sustituye a un rate-limit de
 * infraestructura, pero corta el envío en ráfaga desde la propia app.
 */
async function assertNotFlooding(email: string): Promise<void> {
  const since = Date.now() - 60_000;
  const rows = await query<{ n: number | string }>(
    "select count(*) as n from br_chat_messages where sender_email = ? and created_at >= ?",
    [email, since],
  );
  if (Number(rows[0]?.n ?? 0) >= 30) {
    throw new Error("Demasiados mensajes muy rápido. Espera un momento.");
  }
}

export async function listChatMessages(
  sid: string | undefined,
  orderIdOrCode: string,
): Promise<ChatMessage[]> {
  const { order } = await chatAccess(sid, orderIdOrCode);
  const rows = await query<ChatRow>(
    "select id, order_id, sender_email, sender_name, sender_role, body, created_at " +
      "from br_chat_messages where order_id = ? order by created_at asc limit 500",
    [order.id],
  );
  return rows.map((r) => ({
    id: r.id,
    orderCode: order.code,
    senderEmail: r.sender_email,
    senderName: r.sender_name,
    senderRole: r.sender_role,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function sendChatMessage(
  sid: string | undefined,
  input: { orderId: string; body: string },
): Promise<ChatMessage> {
  const { session, order } = await chatAccess(sid, input.orderId);
  const body = input.body.replace(/[\r\t]+/g, " ").trim();
  if (!body) throw new Error("El mensaje está vacío.");
  if (body.length > 2000) throw new Error("Mensaje demasiado largo (máximo 2000 caracteres).");
  await assertNotFlooding(session.email);
  const id = newId("cm");
  const now = Date.now();
  await execute(
    "insert into br_chat_messages (id, order_id, sender_email, sender_name, sender_role, body, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?)",
    [id, order.id, session.email, session.name, session.role, body, now],
  );
  // Campanita (migración 0030): la otra parte del chat se entera sin recargar.
  const targets = new Set<string>();
  if (order.customer !== session.email) targets.add(order.customer);
  if (order.courier && order.courier !== session.email) targets.add(order.courier);
  if (session.role !== "admin") {
    const admins = await query<{ email: string }>(
      "select email from br_users where role = 'admin' limit 10",
    );
    for (const a of admins) if (a.email !== session.email) targets.add(a.email);
  }
  const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;
  for (const t of targets) {
    void pushNotification(
      t,
      "mensaje",
      `💬 Mensaje nuevo en el pedido ${order.code}`,
      `${session.name}: ${preview}`,
      `/mensajes?order=${order.id}`,
    );
  }
  return {
    id,
    orderCode: order.code,
    senderEmail: session.email,
    senderName: session.name,
    senderRole: session.role,
    body,
    createdAt: now,
  };
}

/* ---------------------------------------------------------------- facturas */

type InvoiceRow = {
  id: string;
  seq: number;
  number: string;
  order_id: string;
  order_code: string;
  customer_email: string;
  items_total: number;
  shipping_cost: number;
  total: number;
  issued_by_email: string;
  issued_by_name: string;
  issued_by_role: Role;
  created_at: number;
};

/** Pedido por id o código (sin exponer aún datos al navegador). */
async function loadOrderRef(orderIdOrCode: string) {
  const rows = await query<OrderRow>("select * from br_orders where id = ? or code = ? limit 1", [
    orderIdOrCode,
    orderIdOrCode,
  ]);
  return rows[0];
}

function invoiceFrom(r: InvoiceRow, customerName: string, items: InvoiceItem[]): Invoice {
  return {
    id: r.id,
    number: r.number,
    orderCode: r.order_code,
    customerEmail: r.customer_email,
    customerName,
    items,
    itemsTotal: Number(r.items_total),
    shippingCost: Number(r.shipping_cost),
    total: Number(r.total),
    issuedByEmail: r.issued_by_email,
    issuedByName: r.issued_by_name,
    issuedByRole: r.issued_by_role,
    createdAt: r.created_at,
  };
}

/**
 * Emite la factura de un pedido entregado. Server-only y anti-fraude:
 *  - solo admin o el repartidor ASIGNADO al pedido;
 *  - el pedido debe estar `entregado`;
 *  - un pedido, una factura (unicidad en BD + chequeo en transacción);
 *  - importe recalculado desde `br_order_items`, nunca del navegador;
 *  - número correlativo generado por AUTO_INCREMENT (sin carreras).
 */
export async function issueInvoice(sid: string | undefined, orderId: string): Promise<Invoice> {
  const session = await requireSession(sid, ["admin", "repartidor"]);
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = (await conn.query(
      "select * from br_orders where id = ? or code = ? limit 1 for update",
      [orderId, orderId],
    )) as [OrderRow[], unknown];
    const order = rows[0];
    if (!order) {
      await conn.rollback();
      throw new Error("Pedido no encontrado.");
    }
    if (session.role !== "admin" && order.courier !== session.email) {
      await conn.rollback();
      throw new Error("Solo el repartidor asignado o el admin pueden facturar este pedido.");
    }
    if (order.status !== "entregado") {
      await conn.rollback();
      throw new Error("Solo se pueden facturar pedidos entregados.");
    }
    const [dup] = (await conn.query("select id from br_invoices where order_id = ? limit 1", [
      order.id,
    ])) as [{ id: string }[], unknown];
    if (dup.length) {
      await conn.rollback();
      throw new Error("Este pedido ya tiene factura.");
    }

    // Recalculamos el importe contra las líneas guardadas en la BD:
    const [items] = (await conn.query(
      "select name, qty, price from br_order_items where order_id = ?",
      [order.id],
    )) as [ItemRow[], unknown];
    let itemsTotal = 0;
    for (const it of items) itemsTotal += Number(it.price) * it.qty;
    itemsTotal = round2(itemsTotal);
    const shipping = round2(Number(order.shipping_cost));
    // La factura debe cuadrar CON LO COBRADO: `createOrder` guardó
    // max(0, subtotal - descuento) + envío + recargo de madrugada + propina.
    // Ignorar esas columnas hacía que toda venta con cupón se facturase de más
    // (y con propina/madrugada, de menos): discrepancia fiscal sistemática.
    const discount = round2(Number(order.discount ?? 0));
    const night = round2(Number(order.night_surcharge ?? 0));
    const tip = round2(Number(order.tip ?? 0));
    const total = round2(Math.max(0, itemsTotal - discount) + shipping + night + tip);

    const id = newId("inv");
    const now = Date.now();
    const [ins] = (await conn.query(
      "insert into br_invoices (id, order_id, order_code, customer_email, items_total, shipping_cost, " +
        "total, issued_by_email, issued_by_name, issued_by_role, created_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        order.id,
        order.code,
        order.customer,
        itemsTotal,
        shipping,
        total,
        session.email,
        session.name,
        session.role,
        now,
      ],
    )) as [{ insertId: number }, unknown];
    const number = `FAC-${new Date(now).getFullYear()}-${String(ins.insertId).padStart(5, "0")}`;
    await conn.query("update br_invoices set number = ? where id = ?", [number, id]);
    await conn.commit();

    return invoiceFrom(
      {
        id,
        seq: ins.insertId,
        number,
        order_id: order.id,
        order_code: order.code,
        customer_email: order.customer,
        items_total: itemsTotal,
        shipping_cost: shipping,
        total,
        issued_by_email: session.email,
        issued_by_name: session.name,
        issued_by_role: session.role,
        created_at: now,
      },
      order.customer_name,
      items.map((i) => ({ name: i.name, qty: i.qty, price: Number(i.price) })),
    );
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** ¿Puede esta sesión ver la factura? dueño, repartidor asignado o admin. */
function canReadInvoice(session: SessionInfo, order: OrderRow): boolean {
  return (
    session.role === "admin" ||
    order.customer === session.email ||
    (Boolean(order.courier) && order.courier === session.email)
  );
}

/** Devuelve la factura del pedido si existe y la sesión puede verla. */
export async function getInvoice(
  sid: string | undefined,
  orderIdOrCode: string,
): Promise<Invoice | null> {
  const session = await requireSession(sid);
  const order = await loadOrderRef(orderIdOrCode);
  if (!order || !canReadInvoice(session, order)) return null;
  const rows = await query<InvoiceRow>("select * from br_invoices where order_id = ? limit 1", [
    order.id,
  ]);
  const inv = rows[0];
  if (!inv) return null;
  const items = await query<ItemRow>(
    "select order_id, product_id, name, qty, price from br_order_items where order_id = ?",
    [order.id],
  );
  return invoiceFrom(
    inv,
    order.customer_name,
    items.map((i) => ({ name: i.name, qty: i.qty, price: Number(i.price) })),
  );
}

/**
 * Facturas visibles: admin todas (comprobante central), repartidor las que él
 * emitió, cliente las de sus pedidos. Carga las líneas en una sola consulta.
 */
export async function listInvoices(sid: string | undefined): Promise<Invoice[]> {
  const session = await requireSession(sid);
  let rows: InvoiceRow[];
  if (session.role === "admin") {
    rows = await query<InvoiceRow>("select * from br_invoices order by created_at desc limit 500");
  } else if (session.role === "repartidor") {
    rows = await query<InvoiceRow>(
      "select * from br_invoices where issued_by_email = ? order by created_at desc limit 300",
      [session.email],
    );
  } else {
    rows = await query<InvoiceRow>(
      "select * from br_invoices where customer_email = ? order by created_at desc limit 300",
      [session.email],
    );
  }
  if (!rows.length) return [];
  const orderIds = rows.map((r) => r.order_id);
  const marks = orderIds.map(() => "?").join(",");
  const items = await query<ItemRow>(
    `select order_id, product_id, name, qty, price from br_order_items where order_id in (${marks})`,
    orderIds,
  );
  const byOrder = new Map<string, InvoiceItem[]>();
  for (const it of items) {
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push({ name: it.name, qty: it.qty, price: Number(it.price) });
    byOrder.set(it.order_id, arr);
  }
  const nameRows = await query<{ id: string; customer_name: string }>(
    `select id, customer_name from br_orders where id in (${marks})`,
    orderIds,
  );
  const names = new Map(nameRows.map((n) => [n.id, n.customer_name]));
  return rows.map((r) =>
    invoiceFrom(r, names.get(r.order_id) ?? "", byOrder.get(r.order_id) ?? []),
  );
}

/* ------------------------------------------------------------ reclamaciones */

export async function listClaims(sid: string | undefined): Promise<Claim[]> {
  const session = await requireSession(sid);
  const scoped =
    session.role === "admin"
      ? "select * from br_claims order by created_at desc limit 300"
      : "select * from br_claims where email = ? order by created_at desc limit 100";
  const rows = await query<ClaimRow>(scoped, session.role === "admin" ? [] : [session.email]);
  return rows.map(toClaim);
}

type ClaimRow = {
  id: string;
  order_code: string;
  email: string;
  type: string;
  text: string;
  status: "abierta" | "resuelta";
  answer: string | null;
  created_at: number;
};

function toClaim(r: ClaimRow): Claim {
  return {
    id: r.id,
    orderCode: r.order_code,
    email: r.email,
    type: r.type,
    text: r.text,
    status: r.status,
    answer: r.answer ?? "",
    createdAt: r.created_at,
  };
}

export async function addClaim(
  sid: string | undefined,
  input: { orderCode: string; type: string; text: string },
): Promise<Claim> {
  const session = await requireSession(sid, ["user"]);
  assertThrottle(
    `claim:${session.email}`,
    5,
    60 * 60_000,
    "Has enviado muchas reclamaciones seguidas. Espera un momento.",
  );
  // El codigo lo manda el navegador: NUNCA se inserta a ciegas. Se verifica en
  // BD que el pedido EXISTE y es del cliente de esta sesion (antes cualquiera
  // con cuenta podia ensuciar el panel con reclamaciones contra codigos ajenos).
  const rawCode = input.orderCode.trim();
  if (!rawCode) throw new Error("Indica el código del pedido (BR-…).");
  const own = await query<{ id: string }>(
    "select id from br_orders where (id = ? or code = ? or code = ?) and customer = ? limit 1",
    [rawCode, rawCode, rawCode.toUpperCase(), session.email],
  );
  if (own.length === 0) throw new Error("Ese pedido no existe o no es tuyo.");
  const text = input.text.trim().slice(0, 1000);
  if (!text) throw new Error("Cuéntanos qué ha pasado.");
  const type = ["retraso", "faltante", "roto", "otro"].includes(input.type) ? input.type : "otro";
  const id = newId("c");
  const now = Date.now();
  await execute(
    "insert into br_claims (id, order_code, email, type, text, status, answer, created_at) " +
      "values (?, ?, ?, ?, ?, 'abierta', null, ?)",
    [id, rawCode.toUpperCase(), session.email, type, text, now],
  );
  return {
    id,
    orderCode: rawCode.toUpperCase(),
    email: session.email,
    type,
    text,
    status: "abierta",
    answer: "",
    createdAt: now,
  };
}

export async function resolveClaim(
  sid: string | undefined,
  id: string,
  answer: string,
): Promise<{ ok: boolean }> {
  const admin = await requireSession(sid, ["admin"]);
  if (!answer.trim()) throw new Error("La respuesta no puede estar vacía.");
  const res = await execute(
    "update br_claims set status = 'resuelta', answer = ? where id = ? and status = 'abierta'",
    [answer.trim(), id],
  );
  if (res.affectedRows > 0) void audit(admin.email, "reclamacion.resolver", id);
  return { ok: res.affectedRows > 0 };
}

/* ------------------------------------------------------------------ soporte */

export async function listMessages(sid: string | undefined): Promise<SupportMessage[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<MessageRow>(
    "select * from br_support_messages order by created_at desc limit 300",
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    text: r.text,
    answer: r.answer ?? "",
    status: r.status,
    createdAt: r.created_at,
  }));
}

type MessageRow = {
  id: string;
  email: string;
  text: string;
  answer: string | null;
  status: "abierto" | "respondido";
  created_at: number;
};

/** Soporte sin cuenta: no requiere sesión, pero el email es obligatorio. */
export async function sendMessage(input: { email: string; text: string }): Promise<SupportMessage> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email no válido.");
  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new Error("El mensaje está vacío.");
  // Buzon publico: unico endpoint sin sesion, asi que el ritmo se mide por
  // email+IP (no basta el email: el spammer cambia de correo a coste cero).
  assertThrottle(
    `sup:${email}:${clientIp()}`,
    4,
    10 * 60_000,
    "Demasiados mensajes seguidos. Espera unos minutos.",
  );
  const id = newId("m");
  const now = Date.now();
  await execute(
    "insert into br_support_messages (id, email, text, answer, status, created_at) " +
      "values (?, ?, ?, null, 'abierto', ?)",
    [id, email, text, now],
  );
  return { id, email, text, answer: "", status: "abierto", createdAt: now };
}

export async function replyMessage(
  sid: string | undefined,
  id: string,
  answer: string,
): Promise<{ ok: boolean }> {
  const admin = await requireSession(sid, ["admin"]);
  if (!answer.trim()) throw new Error("La respuesta no puede estar vacía.");
  const res = await execute(
    "update br_support_messages set status = 'respondido', answer = ? where id = ?",
    [answer.trim(), id],
  );
  if (res.affectedRows > 0) void audit(admin.email, "soporte.responder", id);
  return { ok: res.affectedRows > 0 };
}

/* ---------------------------------------------------------------- catálogo */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function listCustomProductsRaw(): Promise<Product[]> {
  const rows = await query<{ id: string; payload: string | Product }>(
    "select id, payload from br_custom_products order by created_at asc",
  );
  const list = rows.map((r) => {
    const payload = typeof r.payload === "string" ? (JSON.parse(r.payload) as Product) : r.payload;
    return { ...payload, id: r.id };
  });
  // Orden manual (`pos` del panel): estable, los sin `pos` quedan detrás en su
  // orden de creación. `Array#sort` es estable en Node, así que no se baraja nada.
  return list.sort(
    (a, b) => (a.pos ?? Number.MAX_SAFE_INTEGER) - (b.pos ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Catálogo = statico (`src/data/catalog.ts`, con overrides del editor) + altas. */
export async function listProducts(): Promise<Product[]> {
  const { CATALOG } = await import("@/data/catalog");
  const overrides = await getProductOverridesMap();
  const base = CATALOG.map((p) => {
    const o = overrides[p.id];
    // Merge superficial: el override solo sustituye los campos que traiga; el
    // `id` nunca se pisa (enlaces e históricos de pedido dependen de él).
    return o ? ({ ...p, ...o, id: p.id } as Product) : p;
  });
  // `hidden` (marca del admin) saca el producto de la tienda pública sin
  // borrarlo: el panel sigue viéndolo a través de `listCustomProducts`.
  return [...base, ...(await listCustomProductsRaw())].filter((p) => !p.hidden);
}

/** Solo las altas del admin (lo que el panel puede quitar). Público. */
export async function listCustomProducts(): Promise<Product[]> {
  return listCustomProductsRaw();
}

export async function addCustomProduct(
  sid: string | undefined,
  product: Product,
): Promise<{ ok: boolean }> {
  const admin = await requireSession(sid, ["admin"]);
  if (!product.id || !product.name) throw new Error("Producto sin id o nombre.");
  if (!(product.price > 0)) throw new Error("El precio debe ser mayor que 0.");
  // Sanizado del stock y la oferta flash antes de persistir: enteros ≥ 0 o
  // `null` (sin control), y `flashUntil` solo si es un instante válido futuro
  // o pasado — nunca texto suelto. Todo vive dentro del payload JSON.
  const clean: Product = { ...product };
  // Foto remota: si viene en `http://` se guarda en `https://`. La web real se
  // sirve por HTTPS y iOS/Android BLOQUEAN la imagen como contenido mixto sin
  // avisar: el alta con importación del proveedor la dejaba inservible en móvil.
  if (typeof clean.image === "string" && clean.image.startsWith("http://")) {
    clean.image = `https://${clean.image.slice(7)}`;
  }
  if (clean.stock != null) {
    const n = Math.floor(Number(clean.stock));
    clean.stock = Number.isFinite(n) ? Math.max(0, n) : null;
  }
  if (clean.flashUntil != null) {
    const t = Number(clean.flashUntil);
    clean.flashUntil = Number.isFinite(t) && t > 0 ? t : null;
  }
  if (clean.coste != null) {
    const c = Number(clean.coste);
    clean.coste = Number.isFinite(c) && c >= 0 ? Math.round(c * 100) / 100 : null;
  }
  if (!clean.hidden) delete clean.hidden;
  // SEO automático (Fase 12): al dar de alta un producto sin descripción se
  // redacta una breve a partir de su nombre, y SIEMPRE se le derivan etiquetas
  // buscables («bebida», «frío», «energética»…). No pisa lo que el admin ya
  // escribió: solo rellena huecos y amplia las tags existentes.
  if (!clean.desc?.trim()) clean.desc = autoSeoDescription(clean);
  const derivedTags = autoSeoTags(clean);
  clean.tags = [...new Set([...(clean.tags ?? []), ...derivedTags])].slice(0, 16);
  await execute(
    "insert into br_custom_products (id, payload, created_at) values (?, ?, ?) " +
      "on duplicate key update payload = values(payload), created_at = values(created_at)",
    [clean.id, JSON.stringify(clean), Date.now()],
  );
  void audit(admin.email, "producto.alta", clean.id, { name: clean.name });
  return { ok: true };
}

export async function removeCustomProduct(
  sid: string | undefined,
  id: string,
): Promise<{ ok: boolean }> {
  const admin = await requireSession(sid, ["admin"]);
  const res = await execute("delete from br_custom_products where id = ?", [id]);
  if (res.affectedRows > 0) void audit(admin.email, "producto.eliminar", id);
  return { ok: res.affectedRows > 0 };
}

/**
 * Guarda el orden manual del admin: `ids` es la lista completa de ids de
 * altas en el orden deseado; a cada uno se le escribe `pos = índice` dentro de
 * su propio payload JSON (sin columnas nuevas: la tabla ya guarda JSON). Los
 * productos del catálogo estático no participan (no hay migración que hacer).
 */
export async function reorderCustomProducts(
  sid: string | undefined,
  ids: string[],
): Promise<{ ok: boolean }> {
  await requireSession(sid, ["admin"]);
  const rows = await query<{ id: string; payload: string | Product }>(
    "select id, payload from br_custom_products",
  );
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  let changed = 0;
  for (let i = 0; i < ids.length; i++) {
    const row = byId.get(ids[i]);
    if (!row) continue;
    const payload = (
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
    ) as Product;
    if (payload.pos === i) continue; // ya en esa posición: no se escribe
    payload.pos = i;
    await execute("update br_custom_products set payload = ? where id = ?", [
      JSON.stringify(payload),
      row.id,
    ]);
    changed++;
  }
  return { ok: changed > 0 };
}

/* ------------------------------------------------ base española (Open Food Facts) */

/**
 * Búsqueda en la mayor base abierta de productos españoles (Open Food Facts,
 * filtro `countries_tags=es`: todos los productos comercializados en España).
 * Dos vías: EAN exacto (endpoint de producto) y texto (búsqueda legacy con
 * filtro de país, la que sigue operativa). Server-side (sin CORS) y con
 * degradación elegante: si la base remota no responde, el panel sigue
 * ofreciendo la base local `productdb.ts` — nunca rompe el alta.
 */
const OFF_FIELDS =
  "code,product_name,product_name_es,brands,quantity,price,image_url,image_front_small_url,nutriments,alcohol_tags";

function offNutriments(n: Record<string, unknown> | undefined): Nutrition {
  const out: Nutrition = {};
  if (!n) return out;
  const put = (key: string, label: string, unit: string) => {
    const v = n[key];
    if (typeof v === "number" && Number.isFinite(v))
      out[label] = `${Math.round(v * 100) / 100}${unit}`;
  };
  put("energy-kcal_100g", "Valor energético", " kcal");
  put("fat_100g", "Grasas", " g");
  put("saturated-fat_100g", "— saturadas", " g");
  put("carbohydrates_100g", "Hidratos de carbono", " g");
  put("sugars_100g", "— de los cuales azúcares", " g");
  put("fiber_100g", "Fibra", " g");
  put("protein_100g", "Proteínas", " g");
  put("salt_100g", "Sal", " g");
  return out;
}

type OffProduct = {
  code?: unknown;
  product_name?: unknown;
  product_name_es?: unknown;
  brands?: unknown;
  quantity?: unknown;
  price?: unknown;
  image_url?: unknown;
  image_front_small_url?: unknown;
  nutriments?: Record<string, unknown>;
  alcohol_tags?: unknown;
};

function offToHit(p: OffProduct): EanSearchHit | null {
  const code = String(p.code ?? "").trim();
  if (!/^\d{8,14}$/.test(code)) return null;
  const name = String(p.product_name_es || p.product_name || p.brands || code).trim();
  if (!name) return null;
  const brand =
    String(p.brands ?? "")
      .split(",")[0]
      ?.trim() ?? "";
  const tags = Array.isArray(p.alcohol_tags) ? (p.alcohol_tags as unknown[]) : [];
  const isAlcohol = tags.length > 0 || typeof p.nutriments?.["alcohol_100g"] === "number";
  const priceNum = Number.parseFloat(String(p.price ?? ""));
  const img = String(p.image_front_small_url || p.image_url || "");
  return {
    ean: code.slice(0, 64),
    name: name.slice(0, 200),
    brand: (brand || "—").slice(0, 120),
    unit: String(p.quantity ?? "").slice(0, 80),
    price:
      Number.isFinite(priceNum) && priceNum > 0 && priceNum < 10000
        ? Math.round(priceNum * 100) / 100
        : null,
    image: img.startsWith("http") ? img.slice(0, 500) : null,
    nutrition: offNutriments(p.nutriments),
    alcohol: isAlcohol,
  };
}

async function offFetch(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "BotellaRapida/1.0 (admin product lookup)",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null; // base remota caída: el panel sigue con la base local
  }
}

export async function searchSpanishProducts(
  sid: string | undefined,
  q: string,
): Promise<EanSearchHit[]> {
  await requireSession(sid, ["admin"]);
  const term = q.trim();
  if (term.length < 2) return [];
  const hits: EanSearchHit[] = [];
  // 1) EAN exacto: ficha completa garantizada si el código existe.
  if (/^\d{8,14}$/.test(term)) {
    const j = await offFetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(term)}.json?fields=${OFF_FIELDS}`,
    );
    if (j && j.status === 1 && j.product) {
      const h = offToHit(j.product as OffProduct);
      if (h) hits.push(h);
    }
  }
  // 2) Búsqueda de texto filtrada a España (la vía que hoy funciona).
  const j = await offFetch(
    "https://world.openfoodfacts.org/cgi/search.pl?" +
      `search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=14` +
      `&countries_tags=es&fields=${OFF_FIELDS}`,
  );
  const products = Array.isArray(j?.products) ? (j!.products as OffProduct[]) : [];
  for (const p of products) {
    const h = offToHit(p);
    if (h && !hits.some((x) => x.ean === h.ean)) hits.push(h);
  }
  return hits.slice(0, 12);
}

/* ------------------------ importación de producto por URL (tienda proveedor) */

/** Resultado de leer la ficha de un producto en la web de un proveedor. */
export type ImportHit = {
  name: string;
  brand: string;
  price: number | null;
  image: string | null;
  desc: string;
  ean: string;
};

const IMPORT_MAX_BYTES = 1_500_000; // 1,5 MB: de sobra para una ficha de producto
const IMPORT_TIMEOUT_MS = 12_000;

// Guardas SSRF: la petición la hace NUESTRO servidor, nunca pidamos direcciones
// internas (localhost, redes privadas, link-local) ni por saltos de redirección.
function isPrivateHostname(h: string): boolean {
  const s = h.replace(/^\[|\]$/g, "").toLowerCase();
  if (s === "localhost" || s.endsWith(".localhost") || s.endsWith(".local") || s === "::1")
    return true;
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  return s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd");
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pickStr = (v: unknown): string => (typeof v === "string" ? decodeEntities(v) : "");

const asRec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// "12,90 €" | "1.234,56" | 12.9 → número (formato español incluido).
function parsePriceNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function absUrl(u: string, base: string): string | null {
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

// Bloques <script type="application/ld+json"> (datos estructurados schema.org):
// lo publican Shopify, WooCommerce, Amazon y la mayoría de tiendas online.
function ldNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/<!--|-->/g, "").trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        const rec = asRec(item);
        if (Object.keys(rec).length) out.push(rec);
        const graph = rec["@graph"];
        if (Array.isArray(graph)) for (const g of graph) out.push(asRec(g));
      }
    } catch {
      /* alguna página trae JSON-LD malformado: se ignora ese bloque */
    }
  }
  return out;
}

function findLdProduct(nodes: Record<string, unknown>[]): Record<string, unknown> | null {
  // Puede haber varios nodos Product (p. ej. uno con reseñas y otro con la
  // oferta real): preferimos el que traiga precio; si ninguno lo trae, el
  // primero con nombre.
  let fallback: Record<string, unknown> | null = null;
  for (const n of nodes) {
    const t = n["@type"];
    const types = (Array.isArray(t) ? t : [t]).filter((x) => typeof x === "string") as string[];
    if (!types.some((x) => /product/i.test(x))) continue;
    if (!fallback) fallback = n;
    const offersV = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const offers = asRec(offersV);
    if (parsePriceNum(offers.price ?? offers.lowPrice) != null) return n;
  }
  return fallback;
}

function ldImage(p: Record<string, unknown>): string | null {
  const img = p.image;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    const first = img[0];
    if (typeof first === "string") return first;
    return pickStr(asRec(first).url) || null;
  }
  const rec = asRec(img);
  const u = rec.url;
  if (typeof u === "string") return u;
  if (Array.isArray(u) && typeof u[0] === "string") return u[0];
  return null;
}

// <meta property="og:..." content="...">: el plan B cuando no hay JSON-LD.
function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const val = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && val && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decodeEntities(val);
  }
  return out;
}

const titleTag = (html: string): string =>
  decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");

// Dos perfiles de cabeceras. El primero imita a un Chrome completo (con
// Sec-Fetch-* y compañía) porque muchas tiendas (p. ej. DIA) tienen un WAF que
// redirige a una página de error frente a peticiones con cabeceras pobres: si
// solo llevamos User-Agent + Accept devuelven 200… desde /error, y el
// importador acababa cogiendo el título genérico de la home en vez de la ficha.
// Si el primer perfil no pasa, se reintenta con el segundo (Firefox).
const IMPORT_PROFILES: Record<string, string>[] = [
  {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  },
  {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  },
];

// Páginas de bloqueo/error que ciertos WAF sirven con HTTP 200: si la URL final
// cae aquí, la ficha NO se leyó aunque el fetch pareciera exitoso.
const BLOCKED_PATH_RE =
  /\/(error|error-?40[0-9]|forbidden|denied|blocked|bloqueo|no-autorizado|unauthorized|captcha|challenge|puzzle)/i;

type ImportFetch = { ok: true; html: string; finalUrl: string } | { ok: false; msg: string };

// Lee la página siguiendo redirecciones a mano (guarda SSRF en cada salto).
async function fetchImportPage(start: URL, headers: Record<string, string>): Promise<ImportFetch> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMPORT_TIMEOUT_MS);
  try {
    let target = new URL(start.href);
    let res: Response | null = null;
    let hops = 0;
    for (;;) {
      if (isPrivateHostname(target.hostname)) {
        return { ok: false, msg: "No se puede importar una dirección interna" };
      }
      res = await fetch(target.href, { signal: ctrl.signal, redirect: "manual", headers });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      if (hops++ >= 3) return { ok: false, msg: "La página redirige demasiado: pégala directa" };
      target = new URL(loc, target);
    }
    if (!res.ok) return { ok: false, msg: `La tienda respondió ${res.status}` };
    const ctype = res.headers.get("content-type") || "";
    if (!/html|text|xml/i.test(ctype)) return { ok: false, msg: "La página no es HTML" };
    const buf = await res.arrayBuffer();
    const clipped = buf.byteLength > IMPORT_MAX_BYTES ? buf.slice(0, IMPORT_MAX_BYTES) : buf;
    const html = new TextDecoder("utf-8", { fatal: false }).decode(clipped);
    return { ok: true, html, finalUrl: target.href };
  } catch {
    return { ok: false, msg: "No se pudo abrir la página (sin conexión o bloqueada)" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Importa la ficha de un producto desde la web de un proveedor: el servidor lee
 * la página y extrae nombre, marca, precio, foto, descripción y EAN/código.
 * Solo http/https, con tope de tamaño/tiempo, redirecciones vigiladas y sin
 * direcciones internas (guarda SSRF). Prueba con dos perfiles de navegador y
 * detecta páginas de bloqueo del WAF (redirección a /error con 200). Si la
 * tienda sigue sin dejar leer, avisa y el admin lo pega a mano.
 */
export async function importProductFromUrl(
  sid: string | undefined,
  url: string,
): Promise<{ ok: boolean; hit?: ImportHit; msg: string; note?: string }> {
  await requireSession(sid, ["admin"]);

  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return { ok: false, msg: "La URL no es válida" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:")
    return { ok: false, msg: "Solo enlaces http/https" };

  let html = "";
  let finalUrl = target.href;
  let lastMsg = "";
  for (const headers of IMPORT_PROFILES) {
    const r = await fetchImportPage(target, headers);
    if (!r.ok) {
      lastMsg = r.msg;
      continue;
    }
    let blocked = false;
    try {
      blocked = BLOCKED_PATH_RE.test(new URL(r.finalUrl).pathname);
    } catch {
      /* URL final rara: se trata como válida y el extractor decidirá */
    }
    if (blocked) {
      lastMsg = "La tienda devolvió una página de error/bloqueo en vez de la ficha";
      continue;
    }
    html = r.html;
    finalUrl = r.finalUrl;
    break;
  }
  if (!html)
    return {
      ok: false,
      msg: `${lastMsg || "No se pudo abrir la página"}. Puede que la tienda bloquee la lectura automática: rellena los datos a mano.`,
    };

  const hit: ImportHit = { name: "", brand: "", price: null, image: null, desc: "", ean: "" };
  let currency = "EUR";

  // 1) JSON-LD (schema.org/Product): lo más fiable — trae hasta el EAN (gtin13).
  const lp = findLdProduct(ldNodes(html));
  if (lp) {
    hit.name = pickStr(lp.name);
    hit.desc = pickStr(lp.description);
    hit.brand = pickStr(lp.brand) || pickStr(asRec(lp.brand).name);
    const offersV = Array.isArray(lp.offers) ? lp.offers[0] : lp.offers;
    const offers = asRec(offersV);
    hit.price = parsePriceNum(offers.price ?? offers.lowPrice);
    currency = pickStr(offers.priceCurrency) || currency;
    hit.ean = pickStr(lp.sku) || pickStr(lp.mpn) || pickStr(lp.gtin13) || pickStr(lp.gtin);
    const img = ldImage(lp);
    if (img) hit.image = absUrl(img, finalUrl);
  }

  // 2) Open Graph / meta tags: plan B (y complemento campo a campo).
  const meta = metaTags(html);
  if (!hit.name) hit.name = meta["og:title"] || meta["twitter:title"] || titleTag(html);
  if (!hit.desc)
    hit.desc = meta["og:description"] || meta["description"] || meta["twitter:description"] || "";
  if (!hit.image) {
    const ogImg = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || "";
    if (ogImg) hit.image = absUrl(ogImg, finalUrl);
  }
  if (hit.price == null) {
    hit.price = parsePriceNum(
      meta["product:price:amount"] || meta["og:price:amount"] || meta["product:sale_price"],
    );
    currency = pickStr(meta["product:price:currency"]) || currency;
  }
  if (!hit.brand) hit.brand = meta["og:site_name"] || "";
  if (!hit.ean) hit.ean = pickStr(meta["product:id"]) || "";

  hit.name = hit.name.slice(0, 80);
  hit.brand = hit.brand.slice(0, 40);
  hit.desc = hit.desc.slice(0, 480);
  hit.ean = hit.ean.slice(0, 18);
  if (!hit.name)
    return { ok: false, msg: "La página no tiene datos de producto legibles: rellénalos a mano" };

  const note =
    hit.price != null && currency !== "EUR" && /^[A-Z]{3}$/.test(currency)
      ? `Importado con precio en ${currency}: revisa la conversión.`
      : undefined;
  return { ok: true, hit, msg: `Importado: ${hit.name}`, note };
}

/**
 * Descarga una foto remota (p. ej. la enlazada al importar del proveedor) y la
 * devuelve como data URL para el editor de recorte del panel. Hace falta porque
 * un canvas del navegador NO puede procesar imágenes de otro dominio sin cabeceras
 * CORS (dia.es y compañía no las envían): la baja nuestro servidor, con las
 * mismas guardas SSRF y topes de tamaño que el importador. Solo admin.
 */
const IMAGE_PROXY_MAX_BYTES = 4_000_000; // 4 MB de entrada: una foto de ficha sobra

/**
 * Núcleo del proxy de imágenes (sin comprobar sesión): descarga una foto
 * remota y la devuelve como data URL. Las guardas son las mismas que el
 * importador: solo http/https, jamás hosts privados (SSRF), topes de saltos,
 * de tamaño y `Content-Type` estrictamente imagen.
 */
async function downloadImageAsDataUrl(
  url: string,
): Promise<{ ok: boolean; dataUrl?: string; msg: string }> {
  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return { ok: false, msg: "La URL de la imagen no es válida" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:")
    return { ok: false, msg: "Solo enlaces http/https" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMPORT_TIMEOUT_MS);
    let res: Response | null = null;
    let hops = 0;
    for (;;) {
      if (isPrivateHostname(target.hostname)) {
        clearTimeout(timer);
        return { ok: false, msg: "No se puede descargar una dirección interna" };
      }
      res = await fetch(target.href, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: IMPORT_PROFILES[0],
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      if (hops++ >= 3) {
        clearTimeout(timer);
        return { ok: false, msg: "La imagen redirige demasiado" };
      }
      target = new URL(loc, target);
    }
    clearTimeout(timer);
    if (!res || !res.ok)
      return { ok: false, msg: `El servidor de la imagen respondió ${res?.status ?? "error"}` };
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!ctype.startsWith("image/")) return { ok: false, msg: "La URL no apunta a una imagen" };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > IMAGE_PROXY_MAX_BYTES)
      return { ok: false, msg: "La imagen pesa demasiado para procesarla" };
    const b64 = Buffer.from(buf).toString("base64");
    return { ok: true, dataUrl: `data:${ctype};base64,${b64}`, msg: "Descargada" };
  } catch {
    return { ok: false, msg: "No se pudo descargar la imagen (sin conexión o bloqueada)" };
  }
}

/**
 * Proxy PÚBLICO de socorro para fotos remotas de producto: iOS/Safari y las
 * protecciones anti-hotlink de los proveedores revientan las URLs directas en
 * el `<img>` del navegador; el servidor, en cambio, suele poder bajarlas. Lo
 * llama `recoverImgError` (@/lib/product-img) SOLO cuando la carga directa ya
 * falló. Sin sesión: solo sirve imágenes públicas, con las guardas de arriba.
 */
export async function proxyProductImage(
  url: string,
): Promise<{ ok: boolean; dataUrl?: string; msg: string }> {
  return downloadImageAsDataUrl(url);
}

export async function fetchImageAsDataUrl(
  sid: string | undefined,
  url: string,
): Promise<{ ok: boolean; dataUrl?: string; msg: string }> {
  await requireSession(sid, ["admin"]);
  return downloadImageAsDataUrl(url);
}

/* ------------------------------------------------------- contenido editable */

/**
 * Mapa de overrides de producto por id (tabla `br_product_overrides`). Si la
 * tabla aún no existe (BD sin migrar) se tolera vacío: el catálogo estático
 * sigue funcionando y la página se ve idéntica a hoy.
 */
async function getProductOverridesMap(): Promise<Record<string, Partial<Product>>> {
  try {
    const rows = await query<{ id: string; payload: string | Partial<Product> }>(
      "select id, payload from br_product_overrides",
    );
    const map: Record<string, Partial<Product>> = {};
    for (const r of rows) {
      map[r.id] =
        typeof r.payload === "string" ? (JSON.parse(r.payload) as Partial<Product>) : r.payload;
    }
    return map;
  } catch {
    return {};
  }
}

/** Todos los overrides de contenido guardados, por sección. Público. */
export async function getSiteContent(): Promise<Record<string, Record<string, object>>> {
  try {
    const rows = await query<{ section: string; payload: string | Record<string, unknown> }>(
      "select section, payload from br_content",
    );
    const out: Record<string, Record<string, object>> = {};
    for (const r of rows) {
      out[r.section] =
        typeof r.payload === "string"
          ? (JSON.parse(r.payload) as Record<string, object>)
          : (r.payload as Record<string, object>);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * ¿Mantenimiento activo? Se lee la sección `mantenimiento` del CMS: fail-open
 * como el resto del contenido (BD sin tabla o sección vacía => tienda abierta).
 * La pantalla de cierre es el aviso visual; la prohibición REAL es esta función,
 * que corta `createOrder` en servidor aunque alguien manipule el navegador.
 */
export async function maintenanceActive(): Promise<boolean> {
  try {
    const rows = await query<{ payload: string | Record<string, unknown> }>(
      "select payload from br_content where section = 'mantenimiento' limit 1",
    );
    if (!rows.length) return false;
    const p =
      typeof rows[0].payload === "string"
        ? (JSON.parse(rows[0].payload) as Record<string, unknown>)
        : rows[0].payload;
    return p.activo === true;
  } catch {
    return false;
  }
}

export async function saveSiteSection(
  sid: string | undefined,
  section: SiteSectionKey,
  payload: unknown,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  let clean = payload ?? {};
  if (section === "reparto") {
    // Fase 11: solo índices de día válidos (0–6) y sin duplicados; cualquier
    // otra forma se rechaza en vez de guardarse (la lee también el servidor al
    // decidir si un pedido es reserva).
    const raw = (payload as { dias?: unknown } | null)?.dias;
    if (!Array.isArray(raw)) throw new Error("Formato de días de reparto inválido.");
    const dias = [
      ...new Set(raw.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6)),
    ];
    clean = { dias };
  }
  await execute(
    "insert into br_content (section, payload, updated) values (?, ?, ?) " +
      "on duplicate key update payload = values(payload), updated = values(updated)",
    [section, JSON.stringify(clean), Date.now()],
  );
  void audit(admin.email, "contenido.guardar", section);
  return { ok: true };
}

export async function resetSiteSection(
  sid: string | undefined,
  section: SiteSectionKey,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_content where section = ?", [section]);
  void audit(admin.email, "contenido.restaurar", section);
  return { ok: true };
}

/** Parchea campos sueltos de un producto del catálogo estático (admin). */
export async function saveProductOverride(
  sid: string | undefined,
  id: string,
  patch: Partial<Product>,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const { CATALOG } = await import("@/data/catalog");
  if (!CATALOG.some((p) => p.id === id)) throw new Error("Ese producto del catálogo no existe.");
  const allowed: (keyof Product)[] = [
    "name",
    "cat",
    "brand",
    "price",
    "unit",
    "desc",
    "long",
    "nutrition",
    "image",
    "alcohol",
    "grad",
    "oferta",
    "oldPrice",
    "stock",
    "hidden",
    "flashUntil",
    "coste",
  ];
  const clean: Partial<Product> = {};
  for (const k of allowed) {
    if (k in patch && (patch as Record<string, unknown>)[k] !== undefined) {
      (clean as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
    }
  }
  // El id no se parchea nunca; se ignora si viniera en el patch.
  delete clean.id;
  // Misma normalización que el alta: fotos `http://` subidas a `https://`.
  if (typeof clean.image === "string" && clean.image.startsWith("http://")) {
    clean.image = `https://${clean.image.slice(7)}`;
  }
  await execute(
    "insert into br_product_overrides (id, payload, updated) values (?, ?, ?) " +
      "on duplicate key update payload = values(payload), updated = values(updated)",
    [id, JSON.stringify(clean), Date.now()],
  );
  void audit(admin.email, "producto.override", id, { campos: Object.keys(clean) });
  return { ok: true };
}

export async function resetProductOverride(
  sid: string | undefined,
  id: string,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_product_overrides where id = ?", [id]);
  void audit(admin.email, "producto.override_reset", id);
  return { ok: true };
}

/* --------------------------------------------------------------------- pagos */

/**
 * Pasarela de tarjeta (Stripe) PREPARADA, no activada: sin `STRIPE_SECRET_KEY`
 * en el entorno no se crea ningún checkout y la UI muestra «Tarjeta» como
 * método próximo a llegar. En cuanto se añada la clave (y `PUBLIC_APP_URL`) en
 * Render, el flujo queda vivo sin tocar código:
 *   pedido -> Checkout de Stripe -> vuelta a /gracias -> confirmación
 *   server-side contra la API de Stripe (en beta sin webhooks: la URL de
 *   regreso NO es prueba de pago, se consulta `payment_status`).
 */
export async function stripeEnabled(): Promise<boolean> {
  return Boolean((await payKeys()).stripeKey);
}

/**
 * Migración 0029/0030 — pasarela controlable. El titular eligió PAYPAL para
 * RECIBIR dinero; las credenciales pueden venir del entorno (`PAYPAL_CLIENT_ID`
 * / `PAYPAL_SECRET`) o, desde la 0030, escritas a mano en Panel → Pagos.
 * Con `''` en la BD la clave queda BORRADA a propósito (no cae al entorno).
 * Sin claves, el modo pruebas permite simular el pago completo desde
 * /pago-demo sin que salga un céntimo fuera.
 */
export async function paypalConfigured(): Promise<boolean> {
  const k = await payKeys();
  return Boolean(k.paypalId && k.paypalSecret);
}

/**
 * Claves efectivas de la pasarela (migración 0030): manda la BD si el admin
 * las puso ahí; NULL = se usa la variable de entorno de siempre; `''` =
 * borrada explícitamente desde el panel (método retirado).
 */
async function payKeys(): Promise<{
  paypalId: string | null;
  paypalSecret: string | null;
  stripeKey: string | null;
}> {
  let row:
    | {
        paypal_client_id: string | null;
        paypal_secret: string | null;
        stripe_secret_key: string | null;
      }
    | undefined;
  try {
    row = (
      await query<{
        paypal_client_id: string | null;
        paypal_secret: string | null;
        stripe_secret_key: string | null;
      }>(
        "select paypal_client_id, paypal_secret, stripe_secret_key from br_payment_settings where id = 1 limit 1",
      )
    )[0];
  } catch {
    row = undefined; // tabla/columnas aún sin migrar: entorno puro
  }
  const pick = (db: string | null | undefined, envKey?: string): string | null =>
    db === null || db === undefined ? envKey?.trim() || null : db.trim() || null;
  return {
    paypalId: pick(row?.paypal_client_id, process.env.PAYPAL_CLIENT_ID),
    paypalSecret: pick(row?.paypal_secret, process.env.PAYPAL_SECRET),
    stripeKey: pick(row?.stripe_secret_key, process.env.STRIPE_SECRET_KEY),
  };
}

/** Ajustes de la pasarela (`br_payment_settings`, fila única; defaults seguros). */
async function getPaymentSettings(): Promise<PaymentSettings> {
  try {
    const rows = await query<{ provider: string; test_mode: number; enabled: number }>(
      "select provider, test_mode, enabled from br_payment_settings where id = 1 limit 1",
    );
    const r = rows[0];
    return {
      provider: r?.provider === "stripe" ? "stripe" : "paypal",
      testMode: Number(r?.test_mode ?? 0) === 1,
      enabled: Number(r?.enabled ?? 1) === 1,
    };
  } catch {
    // BD sin la migración 0030 todavía: comportamiento viejo (siempre activo).
    const rows = await query<{ provider: string; test_mode: number }>(
      "select provider, test_mode from br_payment_settings where id = 1 limit 1",
    );
    const r = rows[0];
    return {
      provider: r?.provider === "stripe" ? "stripe" : "paypal",
      testMode: Number(r?.test_mode ?? 0) === 1,
      enabled: true,
    };
  }
}

/** Lo que la UI pública necesita saber (jamás las claves, solo booleanos). */
export async function paymentPublicStatus(): Promise<PaymentPublicStatus> {
  const settings = await getPaymentSettings();
  const [stripeConfigured, paypalLive] = await Promise.all([stripeEnabled(), paypalConfigured()]);
  return {
    enabled:
      settings.enabled &&
      (settings.testMode || (settings.provider === "stripe" ? stripeConfigured : paypalLive)),
    provider: settings.provider,
    testMode: settings.testMode,
    stripeConfigured,
    paypalConfigured: paypalLive,
    masterEnabled: settings.enabled,
  };
}

/**
 * Guardar proveedor / modo pruebas / interruptor / claves (solo admin, desde
 * Panel → Pagos). Las claves nunca vuelven al navegador: `undefined` deja la
 * guardada intacta, `''` la borra (retirar el método de cobro actual).
 */
export async function savePaymentSettings(
  sid: string | undefined,
  patch: PaymentSettingsPatch,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const current = await getPaymentSettings();
  const merged: PaymentSettings = {
    provider:
      patch.provider === "stripe" || patch.provider === "paypal"
        ? patch.provider
        : current.provider,
    testMode: patch.testMode ?? current.testMode,
    enabled: patch.enabled ?? current.enabled,
  };
  await execute(
    "insert into br_payment_settings (id, provider, test_mode, enabled, updated_at) values (1, ?, ?, ?, ?) " +
      "on duplicate key update provider = values(provider), test_mode = values(test_mode), " +
      "enabled = values(enabled), updated_at = values(updated_at)",
    [merged.provider, merged.testMode ? 1 : 0, merged.enabled ? 1 : 0, Date.now()],
  );
  // Claves opcionales: solo se tocan las que llegaron en el parche.
  const sets: string[] = [];
  const args: string[] = [];
  const touched: string[] = [];
  const keyOf = (v: string | undefined, col: string) => {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    args.push(v.trim()); // '' = borrada a propósito; texto = fijada
    touched.push(col);
  };
  keyOf(patch.paypalClientId, "paypal_client_id");
  keyOf(patch.paypalSecret, "paypal_secret");
  keyOf(patch.stripeSecretKey, "stripe_secret_key");
  if (sets.length) {
    await execute(`update br_payment_settings set ${sets.join(", ")} where id = 1`, args);
  }
  // En auditoría SOLO los nombres de campo tocados, jamás el secreto.
  void audit(admin.email, "pagos.config", "br_payment_settings", { ...merged, claves: touched });
  return { ok: true };
}

/* ------------------------------------------------------- PayPal REST (v2) */

/** Sandbox mientras el modo pruebas está activo; live en cuanto se apague. */
function paypalRestBase(testMode: boolean): string {
  return testMode ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function paypalAccessToken(testMode: boolean): Promise<string> {
  const { paypalId: id, paypalSecret: secret } = await payKeys();
  if (!id || !secret)
    throw new Error(
      "Faltan las claves de PayPal: añade el Client ID y el Secret en Panel → Pagos (o activa el modo pruebas).",
    );
  const res = await fetch(`${paypalRestBase(testMode)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(
      "PayPal ha rechazado las credenciales (¿claves de sandbox en modo producción?).",
    );
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("PayPal no devolvió token de acceso.");
  return j.access_token;
}

/** Crea una orden de captura y devuelve la URL a la que llevar al cliente. */
async function paypalCreateOrder(
  testMode: boolean,
  cents: number,
  description: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ id: string; approve: string }> {
  const token = await paypalAccessToken(testMode);
  const res = await fetch(`${paypalRestBase(testMode)}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: description.slice(0, 127),
          amount: { currency_code: "EUR", value: (cents / 100).toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: "PAY_NOW",
          },
        },
      },
    }),
  });
  if (!res.ok)
    throw new Error("PayPal no pudo iniciar el pago; inténtalo de nuevo o paga en mano.");
  const j = (await res.json()) as { id?: string; links?: { rel?: string; href?: string }[] };
  const approve =
    j.links?.find((l) => l.rel === "payer-action")?.href ??
    j.links?.find((l) => l.rel === "approve")?.href;
  if (!j.id || !approve) throw new Error("La pasarela no devolvió la URL de pago.");
  return { id: j.id, approve };
}

/** Captura (o comprueba) una orden: true solo con COMPLETED. Idempotente. */
async function paypalCaptureOrder(testMode: boolean, orderId: string): Promise<boolean> {
  try {
    const token = await paypalAccessToken(testMode);
    const res = await fetch(
      `${paypalRestBase(testMode)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return false;
    const j = (await res.json()) as { status?: string };
    return j.status === "COMPLETED";
  } catch {
    return false;
  }
}

/** SDK cargado perezoso: sin clave nunca se importa, y el build no lo necesita. */
async function getStripe() {
  const key = (await payKeys()).stripeKey;
  if (!key) throw new Error("El pago con tarjeta no está disponible todavía.");
  const { default: Stripe } = await import("stripe");
  return new Stripe(key);
}

/** Dominio público del sitio: Stripe lo necesita para volver a /gracias. */
function appBaseUrl(): string {
  const base = normalizePublicUrl(process.env.PUBLIC_APP_URL || "");
  if (!base) {
    throw new Error(
      "Falta PUBLIC_APP_URL en el servidor: sin el dominio del sitio no se puede abrir el pago.",
    );
  }
  return base;
}

/** Crea (o reutiliza) el Checkout de Stripe para un pedido del propio cliente. */
export async function createStripeCheckout(
  sid: string | undefined,
  orderId: string,
): Promise<{ url: string }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<OrderRow>("select * from br_orders where id = ? limit 1", [orderId]);
  const order = rows[0];
  if (!order) throw new Error("Pedido no encontrado.");
  if (order.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese pedido no es tuyo.");
  }
  if (order.status === "cancelado") throw new Error("Este pedido está cancelado.");
  // Anti doble cobro: si el pedido YA está pagado, no se abre otro Checkout.
  // Sin esto, dos pestañas en /gracias (o un «Reintentar el pago») podían
  // cobrar dos veces el mismo pedido y — peor aún — el upsert de abajo
  // sobrescribía el `cs_...` pagado, perdiendo la trazabilidad del cobro.
  const paid = await query<{ status: string }>(
    "select status from br_payments where order_id = ? limit 1",
    [order.id],
  );
  if (paid[0]?.status === "pagado") throw new Error("Este pedido ya está pagado.");
  // El importe se toma SIEMPRE de la BD (recalculado al crear el pedido), nunca
  // de lo que mande el navegador.
  const cents = Math.round(Number(order.total) * 100);
  if (cents <= 0) throw new Error("El importe del pedido es 0.");

  // Ruta del cobro según Panel → Pagos (migración 0029/0030): interruptor
  // maestro, modo pruebas (demo, sin cargo), PayPal con claves o Stripe.
  const settings = await getPaymentSettings();
  if (!settings.enabled) {
    throw new Error("El cobro online está apagado ahora mismo: paga en mano al repartidor.");
  }
  const now = Date.now();
  if (settings.testMode) {
    const token = newId("demo");
    await execute(
      "insert into br_payments (order_id, provider, demo_token, status, created_at, updated_at) " +
        "values (?, 'demo', ?, 'abierto', ?, ?) " +
        "on duplicate key update provider = 'demo', demo_token = values(demo_token), " +
        "status = if(status = 'pagado', status, 'abierto'), updated_at = values(updated_at)",
      [order.id, token, now, now],
    );
    return { url: `/pago-demo?token=${token}` };
  }
  if (settings.provider === "paypal") {
    if (!(await paypalConfigured())) {
      throw new Error(
        "PayPal no está configurado todavía: añade las claves en Panel → Pagos " +
          "(o activa el modo pruebas).",
      );
    }
    const base = appBaseUrl();
    const { id, approve } = await paypalCreateOrder(
      false,
      cents,
      `Botella Rápida · Pedido ${order.code}`,
      `${base}/gracias?order=${order.id}&estado=pago`,
      `${base}/gracias?order=${order.id}&estado=pendiente`,
    );
    await execute(
      "insert into br_payments (order_id, provider, paypal_order_id, status, created_at, updated_at) " +
        "values (?, 'paypal', ?, 'abierto', ?, ?) " +
        "on duplicate key update provider = 'paypal', " +
        "paypal_order_id = if(status = 'pagado', paypal_order_id, values(paypal_order_id)), " +
        "status = if(status = 'pagado', status, 'abierto'), updated_at = values(updated_at)",
      [order.id, id, now, now],
    );
    return { url: approve };
  }

  const stripe = await getStripe();
  const cs = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: order.id,
    customer_email: order.customer,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: cents,
          product_data: { name: `Botella Rápida · Pedido ${order.code}` },
        },
      },
    ],
    success_url: `${appBaseUrl()}/gracias?order=${order.id}&estado=pago`,
    cancel_url: `${appBaseUrl()}/gracias?order=${order.id}&estado=pendiente`,
  });
  if (!cs.url) throw new Error("La pasarela no devolvió la URL de pago.");

  // El upsert NUNCA pisa un pago confirmado: si la fila dijera `pagado`, se
  // conservan la sesión y el estado tal cual (doble seguridad junto al check
  // de arriba). Solo se reemplaza el `cs_...` de un intento aún abierto.
  await execute(
    "insert into br_payments (order_id, stripe_session_id, status, created_at, updated_at) " +
      "values (?, ?, 'abierto', ?, ?) " +
      "on duplicate key update " +
      "stripe_session_id = if(status = 'pagado', stripe_session_id, values(stripe_session_id)), " +
      "status = if(status = 'pagado', status, 'abierto'), " +
      "updated_at = values(updated_at)",
    [order.id, cs.id, now, now],
  );
  return { url: cs.url };
}

/**
 * Estado real del pago: pregunta a Stripe (fuente autoritativa) y, si está
 * cobrado, marca `br_payments` y anota el hito en el historial del pedido.
 * Idempotente: se puede consultar desde /gracias tantas veces como haga falta.
 */
export async function getPaymentStatus(
  sid: string | undefined,
  orderId: string,
): Promise<{ paid: boolean }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const owner = await query<{ customer: string }>(
    "select customer from br_orders where id = ? limit 1",
    [orderId],
  );
  if (!owner.length) throw new Error("Pedido no encontrado.");
  if (owner[0].customer !== session.email && session.role !== "admin") {
    throw new Error("Ese pedido no es tuyo.");
  }
  const rec = await query<{
    stripe_session_id: string;
    status: string;
    provider: string;
    paypal_order_id: string;
  }>(
    "select stripe_session_id, status, provider, paypal_order_id from br_payments where order_id = ? limit 1",
    [orderId],
  );
  const p = rec[0];
  if (!p) return { paid: false };
  if (p.status === "pagado") return { paid: true };
  if (p.provider === "paypal" && p.paypal_order_id && (await paypalConfigured())) {
    // El retorno de PayPal NO es prueba de pago: se CAPTURA en servidor y solo
    // se confirma con COMPLETED (idempotente: reintenta sin doble cobro).
    if (await paypalCaptureOrder(false, p.paypal_order_id)) {
      await execute("update br_payments set status = 'pagado', updated_at = ? where order_id = ?", [
        Date.now(),
        orderId,
      ]);
      await execute(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [orderId, Date.now(), "sistema", "Pago con PayPal confirmado"],
      );
      void pushNotification(
        owner[0].customer,
        "pedido",
        "💳 Pago confirmado",
        "PayPal ha confirmado el pago de tu pedido. Ya lo preparamos.",
        "/cuenta",
      );
      return { paid: true };
    }
    return { paid: false };
  }
  if (p.stripe_session_id && (await stripeEnabled())) {
    const stripe = await getStripe();
    const cs = await stripe.checkout.sessions.retrieve(p.stripe_session_id);
    if (cs.payment_status === "paid") {
      await execute("update br_payments set status = 'pagado', updated_at = ? where order_id = ?", [
        Date.now(),
        orderId,
      ]);
      await execute(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [orderId, Date.now(), "sistema", "Pago con tarjeta confirmado (Stripe)"],
      );
      void pushNotification(
        owner[0].customer,
        "pedido",
        "💳 Pago confirmado",
        "Tu pago con tarjeta se ha confirmado. Ya lo preparamos.",
        "/cuenta",
      );
      return { paid: true };
    }
  }
  return { paid: false };
}

/* ------------------------------------------------- pasarela simulada (demo) */

/**
 * Datos de un pago SIMULADO para pintar /pago-demo (migración 0029). Solo el
 * dueño del pedido/premio (o un admin) puede verlo: el token no es una clave.
 */
export async function demoPaymentInfo(
  sid: string | undefined,
  token: string,
): Promise<DemoPaymentInfo> {
  const session = await requireSession(sid, ["user", "admin"]);
  const ord = await query<{
    order_id: string;
    code: string;
    customer: string;
    total: string | number;
    status: DemoPaymentInfo["status"];
  }>(
    "select p.order_id, o.code, o.customer, o.total, p.status " +
      "from br_payments p join br_orders o on o.id = p.order_id " +
      "where p.demo_token = ? limit 1",
    [token],
  );
  if (ord[0]) {
    if (ord[0].customer !== session.email && session.role !== "admin") {
      throw new Error("Ese pago no es tuyo.");
    }
    return {
      kind: "pedido",
      ref: ord[0].order_id,
      code: ord[0].code,
      amount: round2(Number(ord[0].total)),
      status: ord[0].status,
    };
  }
  const raf = await query<{
    entry_id: string;
    code: string;
    customer: string;
    amount: string | number;
    status: DemoPaymentInfo["status"];
  }>(
    "select r.entry_id, e.code, e.customer, e.amount, r.status " +
      "from br_raffle_payments r join br_raffle_entries e on e.id = r.entry_id " +
      "where r.demo_token = ? limit 1",
    [token],
  );
  if (raf[0]) {
    if (raf[0].customer !== session.email && session.role !== "admin") {
      throw new Error("Ese pago no es tuyo.");
    }
    return {
      kind: "ruleta",
      ref: raf[0].entry_id,
      code: raf[0].code,
      amount: round2(Number(raf[0].amount)),
      status: raf[0].status,
    };
  }
  throw new Error("Pago de prueba no encontrado (¿caducó la sesión?).");
}

/**
 * Aprobar el pago SIMULADO: marca `pagado` + hito honesto en el historial
 * («no se ha cobrado nada») y, si era de la ruleta, descubre el premio igual
 * que haría la pasarela real. Nunca cobra nada: eso solo pasa con el modo
 * pruebas apagado y claves configuradas.
 */
export async function approveDemoPayment(
  sid: string | undefined,
  token: string,
): Promise<{ ok: true; kind: DemoPaymentInfo["kind"]; ref: string }> {
  const info = await demoPaymentInfo(sid, token);
  if (info.status === "pagado") return { ok: true, kind: info.kind, ref: info.ref };
  if (info.status === "cancelado")
    throw new Error("Este pago de prueba fue cancelado: vuelve a iniciarlo.");
  const session = await requireSession(sid, ["user", "admin"]);
  const now = Date.now();
  if (info.kind === "pedido") {
    await execute(
      "update br_payments set status = 'pagado', updated_at = ? where demo_token = ? and status = 'abierto'",
      [now, token],
    );
    await execute("insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)", [
      info.ref,
      now,
      "sistema",
      "Pago SIMULADO (modo pruebas) — no se ha cobrado nada",
    ]);
    const own = await query<{ customer: string }>(
      "select customer from br_orders where id = ? limit 1",
      [info.ref],
    );
    if (own[0]) {
      void pushNotification(
        own[0].customer,
        "pedido",
        `💳 Pago de prueba confirmado (${info.code})`,
        "Pago SIMULADO del modo pruebas: no se ha cobrado nada de verdad.",
        "/cuenta",
      );
    }
  } else {
    await execute(
      "update br_raffle_payments set status = 'pagado', updated_at = ? where demo_token = ? and status = 'abierto'",
      [now, token],
    );
    const ent = await query<{
      customer: string;
      customer_name: string;
      prize_id: string;
      code: string;
    }>(
      "select customer, customer_name, prize_id, code from br_raffle_entries where id = ? limit 1",
      [info.ref],
    );
    await execute(
      "update br_raffle_entries set paid = 1, revealed = 1, revealed_at = ? where id = ?",
      [now, info.ref],
    );
    if (ent[0]) {
      void sendWinnerRaffleMail(
        ent[0].customer,
        ent[0].customer_name,
        ent[0].code,
        ent[0].prize_id,
      ).catch(() => undefined);
      void pushWinnerPrizeNotification(ent[0].customer, ent[0].prize_id, ent[0].code).catch(
        () => undefined,
      );
    }
  }
  void audit(session.email, "pagos.demo.aprobar", info.ref, { kind: info.kind, code: info.code });
  return { ok: true, kind: info.kind, ref: info.ref };
}

/** Cancelar el pago simulado (el cliente cierra /pago-demo sin aprobar). */
export async function cancelDemoPayment(
  sid: string | undefined,
  token: string,
): Promise<{ ok: true }> {
  const info = await demoPaymentInfo(sid, token);
  if (info.status === "abierto") {
    const now = Date.now();
    if (info.kind === "pedido") {
      await execute(
        "update br_payments set status = 'cancelado', updated_at = ? where demo_token = ?",
        [now, token],
      );
    } else {
      await execute(
        "update br_raffle_payments set status = 'cancelado', updated_at = ? where demo_token = ?",
        [now, token],
      );
    }
  }
  return { ok: true };
}

/** Todo lo que la pestaña «Pagos» del panel necesita (solo admin). */
export async function adminPaymentsState(sid: string | undefined): Promise<AdminPaymentsState> {
  await requireSession(sid, ["admin"]);
  const settings = await getPaymentSettings();
  const rows = await query<{
    kind: "pedido" | "ruleta";
    id: string;
    code: string;
    amount: string | number;
    provider: string;
    status: "abierto" | "pagado" | "cancelado";
    created_at: number | string;
  }>(
    "select 'pedido' as kind, p.order_id as id, o.code, o.total as amount, p.provider, p.status, p.created_at " +
      "from br_payments p join br_orders o on o.id = p.order_id " +
      "union all " +
      "select 'ruleta' as kind, r.entry_id as id, e.code, e.amount, r.provider, r.status, r.created_at " +
      "from br_raffle_payments r join br_raffle_entries e on e.id = r.entry_id " +
      "order by created_at desc limit 60",
  );
  const [stripeConfigured, paypalLive, rawKeys] = await Promise.all([
    stripeEnabled(),
    paypalConfigured(),
    query<{
      paypal_client_id: string | null;
      paypal_secret: string | null;
      stripe_secret_key: string | null;
    }>(
      "select paypal_client_id, paypal_secret, stripe_secret_key from br_payment_settings where id = 1 limit 1",
    ).catch(
      () =>
        [] as {
          paypal_client_id: string | null;
          paypal_secret: string | null;
          stripe_secret_key: string | null;
        }[],
    ),
  ] as const);
  const raw = rawKeys[0];
  return {
    settings,
    stripeConfigured,
    paypalConfigured: paypalLive,
    // Claves escritas EN EL PANEL (NULL = vive en el entorno; '' = retirada).
    keysInDb: {
      paypalId: Boolean(raw?.paypal_client_id?.trim()),
      paypalSecret: Boolean(raw?.paypal_secret?.trim()),
      stripe: Boolean(raw?.stripe_secret_key?.trim()),
    },
    hasPublicUrl: Boolean(process.env.PUBLIC_APP_URL),
    payments: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      code: r.code,
      amount: round2(Number(r.amount)),
      provider: r.provider,
      status: r.status,
      createdAt: Number(r.created_at),
    })),
  };
}

/* ------------------------------------------------------------------ estado */

/**
 * Estado de la BD para la pantalla de arranque. Público por necesidad (lo
 * consulta el monitor de Render), así que NO debe revelar nada: ni cuántas
 * cuentas hay ni el mensaje crudo del driver (nombres de host/usuario viven
 * en el log del servidor, no en la respuesta).
 */
export async function dbHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    await query<{ n: number }>("select 1 as n");
    return { ok: true, detail: "ok" };
  } catch {
    return { ok: false, detail: "sin conexión" };
  }
}

/* --------------------------------------------------------- auditoría de accesos */

/**
 * Lista de ACCESS registrados (filas de `br_sessions`) para que el admin
 * audite quién ha entrado. Cada login genera una fila nueva con su own
 * `created_at`; nunca se expone el token: `key` es un trozo del hash SHA-256,
 * solo para poder desambiguar visualmente sesiones del mismo usuario.
 * Se limita a 500 filas para no reventar el payload; el orden lo decide la
 * UI del admin (fecha, nombre, rol…).
 */
export async function listSessions(sid: string | undefined): Promise<LoginSession[]> {
  await requireSession(sid, ["admin"]);
  const now = Date.now();
  const rows = await query<{
    token_hash: string;
    user_email: string;
    role: Role;
    created_at: number;
    expires_at: number;
    name: string | null;
  }>(
    "select s.token_hash, s.user_email, s.role, s.created_at, s.expires_at, u.name " +
      "from br_sessions s left join br_users u on u.email = s.user_email " +
      "order by s.created_at desc limit 500",
  );
  return rows.map((r) => ({
    key: r.token_hash.slice(0, 8),
    email: r.user_email,
    name: r.name || r.user_email,
    role: r.role,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    active: Number(r.expires_at) > now,
  }));
}

/* ------------------------------------------------- reinicio de lanzamiento */

/**
 * REINICIO DE LANZAMIENTO (un solo uso, para el día de la apertura): borra TODA
 * la data transaccional de pruebas — pedidos (activos y archivados), líneas,
 * historiales, facturas, pagos Stripe, reclamaciones, chats de pedido, reseñas
 * y posiciones GPS — para que las estadísticas del panel arranquen a cero.
 *
 * NO toca: cuentas, sesiones, catálogo/overrides, contenido del sitio, cupones
 * (solo su contador de usos), donaciones, incidencias de repartidores, soporte
 * ni la bitácora de auditoría. Todo en UNA transacción: o se borra completo, o
 * nada. La UI del panel pide triple confirmación, pero el servidor NO se fía
 * del navegador: sin la frase exacta no borra ni una fila, y cada ejecución
 * queda registrada en `br_audit` con los conteos borrados.
 */
export async function resetLaunchData(
  sid: string | undefined,
  confirmText: string,
): Promise<{ ok: true; deleted: Record<string, number> }> {
  const admin = await requireSession(sid, ["admin"]);
  if (confirmText.trim().toUpperCase() !== "REINICIAR") {
    throw new Error("Frase de confirmación incorrecta. Escribe REINICIAR en el último paso.");
  }
  // Nombres de tabla HARDCODED (nunca interpolados desde el cliente).
  const tables = [
    "br_order_items",
    "br_order_history",
    "br_chat_messages",
    "br_reviews",
    "br_invoices",
    "br_payments",
    "br_claims",
    "br_courier_locations",
    "br_customer_locations",
    "br_orders",
  ] as const;
  const pool = await getDb();
  const conn = await pool.getConnection();
  const deleted: Record<string, number> = {};
  try {
    await conn.beginTransaction();
    for (const t of tables) {
      const [res] = (await conn.query(`delete from ${t}`)) as [{ affectedRows: number }, unknown];
      deleted[t] = Number(res.affectedRows);
    }
    // Los cupones se conservan (son configuración), pero su contador vuelve a
    // cero: la regla «solo primera compra» y los topes de usos arrancan limpios.
    await conn.query("update br_coupons set used_count = 0");
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
  void audit(admin.email, "lanzamiento.reset", "data transaccional", deleted);
  return { ok: true, deleted };
}

/* ================================================================== chapas */

/**
 * CHAPAS — programa de fidelización (migración 0026). Tablas NUEVAS y apagado
 * por defecto: sin configuración del admin, el apartado público avisa de que
 * no está disponible y ningún pedido suma chapas (la logística no cambia).
 *
 * Mecánica: al ENTREGARSE un pedido se suman chapas (override por producto si
 * el admin lo puso; si no, la EQUIVALENCIA de equilibrio de la migración 0028:
 * 1 chapa por cada `euros_per_chapa` (12) euros gastados — pocas, a propósito:
 * 100 chapas cuestan ~1200 € de compra y valen 12 € de regalo). Las chapas se
 * canjean por ofertas publicadas por el admin — se pagan en chapas, nunca en
 * dinero, y la fuente de verdad del saldo es el libro `br_chapa_ledger`.
 */

/** Equivalencia del programa (migración 0028): 100 chapas = 12 € de regalo. */
const CHAPA_EQUIV_CHAPAS = 100;
const CHAPA_EQUIV_EURO = 12;

/** Coste en chapas que corresponde a un regalo de `valueEuro` euros. */
function chapaCostFromValue(valueEuro: number): number {
  return Math.max(1, Math.round((valueEuro * CHAPA_EQUIV_CHAPAS) / CHAPA_EQUIV_EURO));
}

async function getChapaConfig(): Promise<ChapaConfig> {
  const rows = await query<{
    enabled: number;
    title: string;
    subtitle: string;
    how_it_works: string | null;
    redeem_note: string | null;
    euros_per_chapa: string | number;
  }>("select * from br_chapa_config where id = 1 limit 1");
  const r = rows[0];
  if (!r) {
    return {
      enabled: false,
      title: "Chapas Botella Rápida",
      subtitle: "Acumula chapas con cada compra y cámbialas por regalos.",
      howItWorks: "",
      redeemNote: "",
      eurosPerChapa: 12,
    };
  }
  return {
    enabled: Number(r.enabled) === 1,
    title: r.title,
    subtitle: r.subtitle,
    howItWorks: r.how_it_works ?? "",
    redeemNote: r.redeem_note ?? "",
    eurosPerChapa: round2(Number(r.euros_per_chapa)),
  };
}

/**
 * Sumar chapas de un pedido RECIN ENTREGADO (la llama `markDelivered`, fuera
 * de la transacción y best-effort). Idempotente por `ref` = id del pedido: un
 * pedido solo suma una vez aunque se vuelva a marcar. Con el programa apagado
 * no hace absolutamente nada.
 */
export async function awardChapasForOrder(order: Order): Promise<void> {
  const cfg = await getChapaConfig();
  if (!cfg.enabled) return;
  const seen = await query<{ id: string }>(
    "select id from br_chapa_ledger where ref = ? and delta > 0 limit 1",
    [order.id],
  );
  if (seen.length) return;
  const overrides = await query<{ product_id: string; chapas: number }>(
    "select product_id, chapas from br_chapa_products",
  );
  const perProduct = new Map(overrides.map((o) => [o.product_id, Number(o.chapas)]));
  let chapas = 0;
  let genericEuro = 0;
  for (const item of order.items) {
    const fixed = perProduct.get(item.id);
    if (fixed !== undefined) chapas += Math.max(0, fixed) * Math.max(0, item.qty);
    else genericEuro += Math.max(0, Number(item.price)) * Math.max(0, item.qty);
  }
  chapas += cfg.eurosPerChapa > 0 ? Math.floor(genericEuro / cfg.eurosPerChapa) : 0;
  if (chapas <= 0) return;
  // Sin catch aquí: el error debe subir a `markDelivered`, que lo registra y
  // decide; antes se tragaba en silencio y el saldo no cuadraba nunca.
  await applyChapaDelta(order.customer, chapas, `Pedido ${order.code}`, order.id);
  // Campanita (0030): el cliente ve sus chapas nuevas sin recargar la página.
  void pushNotification(
    order.customer,
    "chapa",
    `🪙 +${chapas} chapas`,
    `Por tu pedido ${order.code}. Ya puedes canjearlas por regalos.`,
    "/chapas",
  );
}

/**
 * Movimiento de chapas EN UNA transacción: banco atómico (`for update`) +
 * libro. Nunca se deja un saldo sin su reflejo en el ledger ni viceversa.
 */
async function applyChapaDelta(
  customer: string,
  delta: number,
  reason: string,
  ref: string | null,
): Promise<number> {
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [balRows] = (await conn.query(
      "select balance from br_chapa_balances where customer = ? for update",
      [customer],
    )) as [{ balance: number }[], unknown];
    const current = balRows.length ? Number(balRows[0].balance) : 0;
    const next = Math.max(0, current + delta);
    const signed = next - current; // delta real tras el clamp 0
    if (signed === 0) {
      await conn.commit();
      return current;
    }
    await conn.query(
      "insert into br_chapa_balances (customer, balance, updated_at) values (?, ?, ?) " +
        "on duplicate key update balance = values(balance), updated_at = values(updated_at)",
      [customer, next, Date.now()],
    );
    await conn.query(
      "insert into br_chapa_ledger (id, customer, delta, reason, ref, created_at) values (?, ?, ?, ?, ?, ?)",
      [newId("cl"), customer, signed, reason.slice(0, 160), ref, Date.now()],
    );
    await conn.commit();
    return next;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** Código de canje legible CH-XXXX. */
function freshChapaCode(): string {
  return "CH-" + randomBytes(2).toString("hex").toUpperCase();
}

/**
 * Estado público de Chapas: configuración, saldo + movimientos + canjes propios
 * (si hay sesión de cliente) y las ofertas activas. Anónimos ven las ofertas
 * pero sin saldo — el canje exige registro.
 */
export async function chapaPublicState(sid: string | undefined) {
  const config = await getChapaConfig();
  const rewardRows = await query<{
    id: string;
    title: string;
    description: string | null;
    image: string | null;
    cost: string | number;
    value_euro: string | number;
    stock: number;
    product_id: string | null;
  }>(
    "select id, title, description, image, cost, value_euro, stock, product_id from br_chapa_rewards " +
      "where active = 1 order by sort asc, id asc",
  );
  const rewards: ChapaReward[] = rewardRows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    image: r.image,
    cost: Math.max(0, Math.round(Number(r.cost))),
    valueEuro: round2(Number(r.value_euro)),
    stock: Number(r.stock),
    productId: r.product_id,
    active: true,
    sort: 0,
  }));
  const session = await readSession(sid);
  const isCustomer = session?.role === "user" || session?.role === "admin";
  let balance: number | null = null;
  let ledger: ChapaLedgerEntry[] = [];
  let myRedemptions: ChapaRedemption[] = [];
  if (isCustomer && session) {
    const b = await query<{ balance: number }>(
      "select balance from br_chapa_balances where customer = ? limit 1",
      [session.email],
    );
    balance = b.length ? Number(b[0].balance) : 0;
    const led = await query<{
      id: string;
      delta: number;
      reason: string;
      created_at: number;
    }>(
      "select id, delta, reason, created_at from br_chapa_ledger where customer = ? " +
        "order by created_at desc limit 40",
      [session.email],
    );
    ledger = led.map((l) => ({
      id: l.id,
      delta: Number(l.delta),
      reason: l.reason,
      createdAt: Number(l.created_at),
    }));
    const reds = await query<{
      id: string;
      code: string;
      customer: string;
      customer_name: string;
      reward_id: string;
      reward_title: string;
      cost: number;
      status: "pendiente" | "entregado" | "cancelado";
      created_at: number;
    }>("select * from br_chapa_redemptions where customer = ? order by created_at desc limit 60", [
      session.email,
    ]);
    myRedemptions = reds.map((r) => ({
      id: r.id,
      code: r.code,
      customer: r.customer,
      customerName: r.customer_name,
      rewardId: r.reward_id,
      rewardTitle: r.reward_title,
      cost: Number(r.cost),
      status: r.status,
      createdAt: Number(r.created_at),
    }));
  }
  return { config, rewards, balance, ledger, myRedemptions };
}

/**
 * Canjear una oferta por chapas. TODO en una transacción con banco atómico:
 * saldo suficiente, stock (si no es ilimitado) y canje registrado no pueden
 * solaparse entre dos dispositivos del mismo cliente.
 */
export async function redeemChapaReward(
  sid: string | undefined,
  rewardId: string,
): Promise<{ ok: true; code: string; balance: number }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const cfg = await getChapaConfig();
  if (!cfg.enabled) throw new Error("Las chapas todavía no están activas.");
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rewards] = (await conn.query(
      "select id, title, cost, stock from br_chapa_rewards where id = ? and active = 1 limit 1 for update",
      [rewardId],
    )) as [{ id: string; title: string; cost: number; stock: number }[], unknown];
    const reward = rewards[0];
    if (!reward) throw new Error("Esa oferta ya no está disponible.");
    const cost = Math.max(0, Math.round(Number(reward.cost)));
    const [balRows] = (await conn.query(
      "select balance from br_chapa_balances where customer = ? for update",
      [session.email],
    )) as [{ balance: number }[], unknown];
    const balance = balRows.length ? Number(balRows[0].balance) : 0;
    if (balance < cost)
      throw new Error("No te llegan las chapas: te falta " + (cost - balance) + ".");
    if (Number(reward.stock) >= 0) {
      const [stockRes] = (await conn.query(
        "update br_chapa_rewards set stock = stock - 1 where id = ? and stock > 0",
        [reward.id],
      )) as [{ affectedRows: number }, unknown];
      if (stockRes.affectedRows === 0) throw new Error("Esta oferta se ha agotado justo ahora.");
    }
    const now = Date.now();
    const redId = newId("cr");
    const code = freshChapaCode();
    await conn.query(
      "insert into br_chapa_redemptions (id, code, customer, customer_name, reward_id, reward_title, cost, status, created_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)",
      [redId, code, session.email, session.name, reward.id, reward.title, cost, now],
    );
    await conn.query(
      "insert into br_chapa_ledger (id, customer, delta, reason, ref, created_at) values (?, ?, ?, ?, ?, ?)",
      [newId("cl"), session.email, -cost, `Canje ${reward.title}`, redId, now],
    );
    await conn.query(
      "update br_chapa_balances set balance = balance - ?, updated_at = ? where customer = ?",
      [cost, now, session.email],
    );
    await conn.commit();
    void audit(session.email, "chapas.canje", redId, { oferta: reward.title, cost });
    return { ok: true, code, balance: balance - cost };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/* ----------------------------------------------------------- chapas: admin */

/** Todo lo que necesita la pestaña Chapas del panel. */
export async function adminChapaState(sid: string | undefined) {
  await requireSession(sid, ["admin"]);
  const config = await getChapaConfig();
  const rewardRows = await query<{
    id: string;
    title: string;
    description: string | null;
    image: string | null;
    cost: string | number;
    value_euro: string | number;
    stock: number;
    product_id: string | null;
    active: number;
    sort: number;
  }>("select * from br_chapa_rewards order by sort asc, id asc");
  const rewards: ChapaReward[] = rewardRows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    image: r.image,
    cost: Math.max(0, Math.round(Number(r.cost))),
    valueEuro: round2(Number(r.value_euro)),
    stock: Number(r.stock),
    productId: r.product_id,
    active: Number(r.active) === 1,
    sort: Number(r.sort),
  }));
  const overrides = await query<{ product_id: string; chapas: number }>(
    "select product_id, chapas from br_chapa_products",
  );
  const redRows = await query<{
    id: string;
    code: string;
    customer: string;
    customer_name: string;
    reward_id: string;
    reward_title: string;
    cost: number;
    status: "pendiente" | "entregado" | "cancelado";
    created_at: number;
  }>("select * from br_chapa_redemptions order by created_at desc limit 300");
  const redemptions: ChapaRedemption[] = redRows.map((r) => ({
    id: r.id,
    code: r.code,
    customer: r.customer,
    customerName: r.customer_name,
    rewardId: r.reward_id,
    rewardTitle: r.reward_title,
    cost: Number(r.cost),
    status: r.status,
    createdAt: Number(r.created_at),
  }));
  const balances = await query<{ customer: string; balance: number }>(
    "select customer, balance from br_chapa_balances order by balance desc limit 200",
  );
  return {
    config,
    rewards,
    overrides: overrides.map((o) => ({ productId: o.product_id, chapas: Number(o.chapas) })),
    redemptions,
    balances: balances.map((b) => ({ customer: b.customer, balance: Number(b.balance) })),
  };
}

export type ChapaConfigPatch = Partial<ChapaConfig>;

export async function saveChapaConfig(
  sid: string | undefined,
  patch: ChapaConfigPatch,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const current = await getChapaConfig();
  const merged: ChapaConfig = {
    enabled: patch.enabled ?? current.enabled,
    title: (patch.title ?? current.title).slice(0, 120),
    subtitle: (patch.subtitle ?? current.subtitle).slice(0, 240),
    howItWorks: (patch.howItWorks ?? current.howItWorks).slice(0, 4000),
    redeemNote: (patch.redeemNote ?? current.redeemNote).slice(0, 400),
    eurosPerChapa: Math.max(
      0,
      Math.min(100000, round2(Number(patch.eurosPerChapa ?? current.eurosPerChapa))),
    ),
  };
  await execute(
    "insert into br_chapa_config (id, enabled, title, subtitle, how_it_works, redeem_note, " +
      "euros_per_chapa, updated_at) values (1, ?, ?, ?, ?, ?, ?, ?) " +
      "on duplicate key update enabled = values(enabled), title = values(title), " +
      "subtitle = values(subtitle), how_it_works = values(how_it_works), " +
      "redeem_note = values(redeem_note), euros_per_chapa = values(euros_per_chapa), " +
      "updated_at = values(updated_at)",
    [
      merged.enabled ? 1 : 0,
      merged.title,
      merged.subtitle,
      merged.howItWorks,
      merged.redeemNote,
      merged.eurosPerChapa,
      Date.now(),
    ],
  );
  void audit(admin.email, "chapas.config", "br_chapa_config");
  return { ok: true };
}

/** Chapa fija por producto (override del pack). null = vuelve a la tasa base. */
export async function setChapaProduct(
  sid: string | undefined,
  productId: string,
  chapas: number | null,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  if (chapas === null) {
    await execute("delete from br_chapa_products where product_id = ?", [productId]);
  } else {
    await execute(
      "insert into br_chapa_products (product_id, chapas, updated_at) values (?, ?, ?) " +
        "on duplicate key update chapas = values(chapas), updated_at = values(updated_at)",
      [productId, Math.max(0, Math.min(100000, Math.floor(chapas))), Date.now()],
    );
  }
  void audit(admin.email, "chapas.producto", productId, { chapas });
  return { ok: true };
}

export type ChapaRewardInput = {
  id?: string;
  title: string;
  description?: string | null;
  image?: string | null;
  cost: number;
  /** Valor en € del regalo; > 0 ⇒ el coste en chapas se deriva (100 = 12 €). */
  valueEuro?: number;
  stock: number;
  productId?: string | null;
  active: boolean;
  sort: number;
};

export async function upsertChapaReward(
  sid: string | undefined,
  input: ChapaRewardInput,
): Promise<{ ok: true; id: string }> {
  const admin = await requireSession(sid, ["admin"]);
  if (!input.title.trim()) throw new Error("La oferta necesita un título.");
  const id = input.id || newId("cw");
  const valueEuro = Math.max(0, Math.min(1000000, round2(Number(input.valueEuro) || 0)));
  // Con valor en € fijado, el coste NO se inventa: sale de la equivalencia del
  // programa (100 chapas = 12 €). Sin valor, manda el coste escrito a mano.
  const cost =
    valueEuro > 0
      ? chapaCostFromValue(valueEuro)
      : Math.max(1, Math.min(10000000, Math.floor(input.cost)));
  await execute(
    "insert into br_chapa_rewards (id, title, description, image, cost, value_euro, stock, " +
      "product_id, active, sort, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "on duplicate key update title = values(title), description = values(description), " +
      "image = values(image), cost = values(cost), value_euro = values(value_euro), " +
      "stock = values(stock), product_id = values(product_id), active = values(active), " +
      "sort = values(sort)",
    [
      id,
      input.title.slice(0, 160),
      input.description?.slice(0, 400) || null,
      // Fase 10 (migración 0031): mediumtext guarda la data URL completa; el
      // recorte de 600 caracteres rompía la foto subida desde el panel.
      input.image?.slice(0, 2_000_000) || null,
      cost,
      valueEuro,
      Math.round(input.stock) === -1 ? -1 : Math.max(0, Math.min(1000000, Math.floor(input.stock))),
      input.productId || null,
      input.active ? 1 : 0,
      Math.floor(Number(input.sort) || 0),
      Date.now(),
    ],
  );
  void audit(admin.email, "chapas.oferta.upsert", id);
  return { ok: true, id };
}

export async function deleteChapaReward(
  sid: string | undefined,
  id: string,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  await execute("delete from br_chapa_rewards where id = ?", [id]);
  void audit(admin.email, "chapas.oferta.delete", id);
  return { ok: true };
}

/**
 * Gestionar un canje: 'entregado' es definitivo (se entrega en el próximo
 * pedido); 'cancelado' DEVUELVE las chapas al cliente (solo si estaba
 * pendiente — un canje ya entregado no se puede devolver sin más).
 */
export async function setChapaRedemptionStatus(
  sid: string | undefined,
  id: string,
  status: "entregado" | "cancelado",
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const rows = await query<{ customer: string; cost: number; status: string; reward_id: string }>(
    "select customer, cost, status, reward_id from br_chapa_redemptions where id = ? limit 1",
    [id],
  );
  const r = rows[0];
  if (!r) throw new Error("Canje no encontrado.");
  if (r.status === status) return { ok: true };
  if (r.status !== "pendiente") {
    throw new Error("Este canje ya está cerrado (" + r.status + ").");
  }
  await execute("update br_chapa_redemptions set status = ? where id = ?", [status, id]);
  if (status === "cancelado") {
    // Devolver las chapas y reponer el stock consumido si la oferta aún existe.
    await applyChapaDelta(
      r.customer,
      Math.max(0, Number(r.cost)),
      "Devolución canje cancelado",
      id,
    );
    await execute("update br_chapa_rewards set stock = stock + 1 where id = ? and stock >= 0", [
      r.reward_id,
    ]).catch(() => undefined);
  }
  void audit(admin.email, "chapas.canje.status", id, { status });
  return { ok: true };
}

/** Ajuste manual de saldo (regalo o corrección del admin; queda en el libro). */
export async function adjustChapaBalance(
  sid: string | undefined,
  customer: string,
  delta: number,
  reason: string,
): Promise<{ ok: true; balance: number }> {
  const admin = await requireSession(sid, ["admin"]);
  const email = customer.trim().toLowerCase();
  const user = await query<{ email: string }>(
    "select email from br_users where email = ? and role = 'user' limit 1",
    [email],
  );
  if (!user.length) throw new Error("Ese cliente no existe.");
  const d = Math.trunc(delta);
  if (d === 0) throw new Error("El ajuste no puede ser 0.");
  const balance = await applyChapaDelta(
    email,
    d,
    reason.trim().slice(0, 160) || "Ajuste admin",
    null,
  );
  void audit(admin.email, "chapas.ajuste", email, { delta: d, reason });
  return { ok: true, balance };
}

/* ================================================================== sorteo */

/**
 * RULETA BOTELLA RÁPIDA (migración 0025). Todo vive en tablas NUEVAS y nace
 * APAGADO: si `enabled = 0` o no hay premios, la página pública muestra «no
 * disponible» y la tienda de hoy no cambia en absoluto.
 *
 * El resultado de cada giro lo decide el SERVIDOR por pesos (`weight`): los
 * pesos NUNCA viajan al navegador — el cliente solo recibe el índice del
 * segmento para animar la ruleta. El premio queda oculto con `?` hasta pagar
 * la reclamación (`reveal_price`; 0 = se revela sin cobro).
 */

/** Columnas comunes de `br_raffle_prizes` para lectura tipada. */
type RafflePrizeRow = {
  id: string;
  kind: "premio" | "perdedor" | "chapas";
  wheel_label: string;
  name: string;
  description: string | null;
  image: string | null;
  product_id: string | null;
  reveal_price: string | number;
  weight: number;
  /** Migración 0030: chapas que regala un segmento de tipo `chapas`. */
  chapas: number;
  win_message: string | null;
  active: number;
  sort: number;
  /** Migración 0027: 1 = el detalle no se revela hasta pagar. */
  secret: number;
};

async function getRaffleConfig(): Promise<RaffleConfig> {
  const rows = await query<{
    enabled: number;
    title: string;
    subtitle: string;
    how_it_works: string | null;
    win_message: string;
    lose_message: string;
    ticket_min_euro: string | number;
    unlimited_test: number;
  }>("select * from br_raffle_config where id = 1 limit 1");
  const r = rows[0];
  if (!r) {
    return {
      enabled: false,
      title: "Ruleta Botella Rápida",
      subtitle: "Prueba tu suerte: gira y llévate premios.",
      howItWorks: "",
      winMessage: "¡Enhorabuena! Has ganado un premio.",
      loseMessage: "No ha podido ser. Vuelve a intentarlo pronto.",
      ticketMinEuro: 10,
      unlimitedTest: false,
    };
  }
  return {
    enabled: Number(r.enabled) === 1,
    title: r.title,
    subtitle: r.subtitle,
    howItWorks: r.how_it_works ?? "",
    winMessage: r.win_message,
    loseMessage: r.lose_message,
    ticketMinEuro: round2(Number(r.ticket_min_euro)),
    unlimitedTest: Number(r.unlimited_test) === 1,
  };
}

/**
 * Segmentos visibles (activos) en el orden determinista de la rueda. El índice
 * de este listado es EL que anima el cliente: público y giro comparten orden.
 */
async function rafflePublicPrizes(): Promise<RafflePrizePublic[]> {
  const rows = await query<{
    id: string;
    kind: "premio" | "perdedor" | "chapas";
    wheel_label: string;
    reveal_price: string | number;
    chapas: number;
    secret: number;
    name: string;
    image: string | null;
  }>(
    "select id, kind, wheel_label, reveal_price, chapas, secret, name, image from br_raffle_prizes " +
      "where active = 1 order by sort asc, id asc",
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    wheelLabel: r.wheel_label,
    revealPrice: Number(r.reveal_price),
    chapas: Math.max(0, Math.round(Number(r.chapas ?? 0))),
    // Un premio secreto NO filtra nunca su nombre real ni su imagen: el
    // navegador solo ve el rótulo genérico de la casilla.
    secret: Number(r.secret) === 1,
    publicName: Number(r.secret) === 1 ? "" : r.name,
    publicImage: Number(r.secret) === 1 ? null : r.image,
  }));
}

/** Código de participación legible SF-XXXX (espacio propio: colisión casi imposible). */
function freshRaffleCode(): string {
  return "SF-" + randomBytes(2).toString("hex").toUpperCase();
}

/**
 * Regalar 1 ticket de ruleta al cerrarse un pedido (migración 0028): solo si
 * el sorteo está activo y el TOTAL del pedido supera el mínimo configurado
 * (10 € por defecto). Idempotente: la UNIQUE por pedido hace que un `insert
 * ignore` repetido no dé doble ticket aunque la entrega se re-procese.
 */
async function awardRaffleTicketForOrder(order: Order): Promise<void> {
  const cfg = await getRaffleConfig();
  if (!cfg.enabled) return;
  if (!(round2(Number(order.total)) > cfg.ticketMinEuro)) return;
  await execute(
    "insert ignore into br_raffle_tickets (id, customer, order_id, order_code, created_at) " +
      "values (?, ?, ?, ?, ?)",
    [newId("rt"), order.customer, order.id, order.code, Date.now()],
  );
}

/**
 * Estado de la ruleta para la página pública: anónimos incluyen (ven la rueda
 * y los premios, pero sin tickets no giran). Con sesión de cliente trae los
 * TICKETS sin usar y el último premio sin reclamar para reanudar el
 * pago/reveal al volver.
 */
export async function rafflePublicState(sid: string | undefined): Promise<RafflePublicState> {
  const config = await getRaffleConfig();
  const prizes = await rafflePublicPrizes();
  const session = await readSession(sid);
  const isCustomer = session?.role === "user" || session?.role === "admin";
  let spinsLeft: number | null = null;
  let pending: RaffleSpinResult | null = null;
  let claims: RaffleClaimSummary[] | null = null;
  if (isCustomer && session) {
    // Giros disponibles = tickets pendientes de usar (migración 0028): nada de
    // límites por días, se gira lo que se ha ganado comprando. Con el modo
    // pruebas de la 0029 activo, las cuentas registradas giran sin límite.
    const tickets = await query<{ n: number | string }>(
      "select count(*) as n from br_raffle_tickets where customer = ? and used_at is null",
      [session.email],
    );
    spinsLeft = config.unlimitedTest ? 999 : Math.max(0, Number(tickets[0]?.n ?? 0));
    const pend = await query<{
      id: string;
      code: string;
      prize_id: string;
      outcome: "premio" | "perdedor" | "chapas";
      revealed: number;
      amount: string | number;
      win_message: string | null;
    }>(
      "select e.id, e.code, e.prize_id, e.outcome, e.revealed, e.amount, p.win_message " +
        "from br_raffle_entries e left join br_raffle_prizes p on p.id = e.prize_id " +
        "where e.customer = ? and e.outcome = 'premio' and e.claimed = 0 " +
        "order by e.created_at desc limit 1",
      [session.email],
    );
    const pe = pend[0];
    if (pe) {
      pending = {
        entryId: pe.id,
        code: pe.code,
        index: Math.max(
          0,
          prizes.findIndex((x) => x.id === pe.prize_id),
        ),
        outcome: pe.outcome,
        revealed: Number(pe.revealed) === 1,
        amount: round2(Number(pe.amount)),
        chapaAwarded: 0,
        winMessage: pe.win_message?.trim() || config.winMessage,
        loseMessage: config.loseMessage,
      };
    }
    // Fase 12: premios ya RECLAMADOS por este cliente. Cada uno es un hilo de
    // chat (`/mensajes`) para coordinar la entrega con la tienda.
    const claimed = await query<{
      id: string;
      code: string;
      created_at: number;
      prize_name: string | null;
    }>(
      "select e.id, e.code, e.created_at, p.name as prize_name " +
        "from br_raffle_entries e left join br_raffle_prizes p on p.id = e.prize_id " +
        "where e.customer = ? and e.outcome = 'premio' and e.claimed = 1 " +
        "order by e.created_at desc limit 20",
      [session.email],
    );
    claims = claimed.map((c) => ({
      entryId: c.id,
      code: c.code,
      prizeName: c.prize_name?.trim() || "Premio",
      createdAt: Number(c.created_at),
    }));
  }
  return { config, prizes, spinsLeft, pending, claims };
}

/**
 * Un giro: exige UN TICKET sin usar (migración 0028: ya no hay límite diario,
 * se gira lo que se ha ganado comprando) y el servidor elige el segmento por
 * pesos acumulados con `randomInt` (crate seguro). Ticket gastado + entry se
 * escriben EN LA MISMA transacción con banco atómico: dos giros simultáneos
 * nunca gastan el mismo ticket. Nunca se envía el peso al navegador.
 */
export async function spinRaffle(sid: string | undefined): Promise<RaffleSpinResult> {
  const config = await getRaffleConfig();
  if (!config.enabled) throw new Error("El sorteo no está disponible ahora mismo.");
  const rows = await query<RafflePrizeRow>(
    "select * from br_raffle_prizes where active = 1 order by sort asc, id asc",
  );
  if (rows.length === 0) throw new Error("El sorteo no tiene premios configurados todavía.");
  const session = await requireSession(sid, ["user", "admin"]);
  const minTxt = config.ticketMinEuro.toFixed(2).replace(/\.00$/, "");
  const noTicket = () =>
    new Error(
      `No tienes tickets de ruleta: cada pedido entregado de más de ${minTxt} € te regala 1. ` +
        "Haz tu compra y vuelve a girar. 🛒",
    );
  // Modo pruebas (migración 0029): con la casilla marcada, las cuentas
  // registradas giran sin gastar ticket; el público sigue necesitando uno.
  const unlimited = config.unlimitedTest;
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // El ticket se banca antes de decidir nada: sin ticket no hay giro.
    let ticketId: string | null = null;
    if (!unlimited) {
      const [tickets] = (await conn.query(
        "select id from br_raffle_tickets where customer = ? and used_at is null " +
          "order by created_at asc limit 1 for update",
        [session.email],
      )) as [{ id: string }[], unknown];
      const ticket = tickets[0];
      if (!ticket) {
        await conn.rollback();
        throw noTicket();
      }
      ticketId = ticket.id;
    }
    // Sorteo ponderado en servidor: los pesos solo viven aquí, jamás en el cliente.
    const poolTotal = rows.reduce((sum, r) => sum + Math.max(0, Number(r.weight)), 0);
    if (poolTotal <= 0) throw new Error("El sorteo no tiene segmentos jugables.");
    let pick = randomInt(poolTotal);
    let idx = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const w = Math.max(0, Number(rows[i].weight));
      if (pick < w) {
        idx = i;
        break;
      }
      pick -= w;
    }
    const won = rows[idx];
    const isPrize = won.kind === "premio";
    // Segmento de chapas (migración 0030): se cobran al instante, no hay
    // reveal ni reclamación — nada que pagar ni que entregar.
    const isChapas = won.kind === "chapas";
    const chapaAwarded = isChapas ? Math.max(0, Math.round(Number(won.chapas ?? 0))) : 0;
    const amount = isPrize ? round2(Number(won.reveal_price)) : 0;
    // Sin cobro, el premio se revela al instante (no hay pago pendiente).
    const revealed = isChapas ? 1 : !isPrize ? 0 : amount <= 0 ? 1 : 0;
    const entryId = newId("sf");
    const code = freshRaffleCode();
    const now = Date.now();
    await conn.query(
      "insert into br_raffle_entries (id, code, customer, customer_name, prize_id, outcome, " +
        "revealed, paid, claimed, amount, chapa_amount, created_at, revealed_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
      [
        entryId,
        code,
        session.email,
        session.name,
        won.id,
        won.kind,
        revealed,
        revealed ? 1 : 0,
        amount,
        chapaAwarded,
        now,
        revealed ? now : null,
      ],
    );
    // Consume el ticket (el `for update` de arriba ya impide el doble gasto;
    // el guard `used_at is null` es la segunda red de seguridad). En modo
    // pruebas no hay ticket que gastar.
    if (ticketId !== null) {
      const [used] = (await conn.query(
        "update br_raffle_tickets set used_at = ?, entry_id = ? where id = ? and used_at is null",
        [now, entryId, ticketId],
      )) as [{ affectedRows: number }, unknown];
      if (used.affectedRows !== 1) throw noTicket();
    }
    await conn.commit();
    // Fuera de la transacción solo quedan el registro y los avisos: un fallo
    // de auditoría/correo NO debe revertir un giro ya gastado.
    void audit(session.email, "sorteo.girar", entryId, {
      premio: won.wheel_label,
      outcome: won.kind,
      pruebas: unlimited,
    });
    if (isPrize) void notifyAdminsOfRaffleWin(session.name, code, won.wheel_label, won.name);
    if (isChapas && chapaAwarded > 0) {
      // Las chapas caen en la cuenta al instante, con el giro ya commiteado:
      // si el saldo falla, el giro sigue válido (el admin puede sumárselas).
      try {
        await applyChapaDelta(session.email, chapaAwarded, `Chapas de la ruleta ${code}`, entryId);
        void pushNotification(
          session.email,
          "chapa",
          `🪙 +${chapaAwarded} chapas en la ruleta`,
          "¡Enhorabuena! Las hemos sumado ya a tu cuenta.",
          "/chapas",
        );
      } catch (err) {
        console.warn(
          "[sorteo] no se pudieron sumar las chapas del giro:",
          (err as Error)?.message || err,
        );
      }
    }
    return {
      entryId,
      code,
      index: idx,
      outcome: won.kind,
      revealed: revealed === 1,
      amount,
      chapaAwarded,
      winMessage: won.win_message?.trim() || config.winMessage,
      loseMessage: config.loseMessage,
    };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Reclamar (pedir entrega) un premio ya revelado: lo marca para que el admin
 * lo entregue en el próximo pedido. Requiere sesión dueña o admin.
 */
export async function claimRafflePrize(
  sid: string | undefined,
  entryId: string,
): Promise<{ ok: true }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{
    customer: string;
    customer_name: string;
    revealed: number;
    outcome: string;
    code: string;
    prize_name: string | null;
  }>(
    "select e.customer, e.customer_name, e.revealed, e.outcome, e.code, p.name as prize_name " +
      "from br_raffle_entries e left join br_raffle_prizes p on p.id = e.prize_id " +
      "where e.id = ? limit 1",
    [entryId],
  );
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese premio no es tuyo.");
  }
  if (e.outcome !== "premio" || Number(e.revealed) !== 1) {
    throw new Error("El premio todavía no se ha revelado.");
  }
  await execute("update br_raffle_entries set claimed = 1 where id = ?", [entryId]);
  void audit(session.email, "sorteo.reclamar", entryId);
  // Campanita del ganador: su premio está en camino. Enlaza DIRECTO al hilo de
  // chat del premio (`/mensajes` lo resalta y lo abre; Fase 12).
  void pushNotification(
    e.customer,
    "premio",
    "🎁 Premio reclamado",
    "Lo entregaremos con tu próximo pedido. Escríbenos aquí si quieres coordinar la entrega.",
    `/mensajes?order=${entryId}`,
  );
  // Fase 12: aviso a los admin de que un cliente HA RECLAMADO un premio, con
  // enlace directo al hilo de chat (Panel → Sorteos) para hablar con él y
  // coordinar la entrega. Best-effort: un fallo aquí no revierte la reclamación.
  void notifyAdminsOfRaffleClaim(e.customer_name || e.customer, e.code, e.prize_name, entryId);
  return { ok: true };
}

/**
 * Aviso (best-effort) a los admin de que un cliente ha RECLAMADO un premio de la
 * ruleta. Enlaza a Panel → Sorteos, donde cada reclamación tiene su botón de
 * chat con el cliente (mismo hilo que un pedido, ver `chatAccess`).
 */
async function notifyAdminsOfRaffleClaim(
  customerName: string,
  code: string,
  prizeName: string | null,
  entryId: string,
): Promise<void> {
  try {
    const admins = await query<{ email: string }>(
      "select email from br_users where role = 'admin' and status = 'activo' limit 20",
    );
    const premio = prizeName?.trim() || "su premio";
    for (const a of admins) {
      void pushNotification(
        a.email,
        "premio",
        `🎁 Reclaman un premio (${code})`,
        `${customerName || "un cliente"} ha reclamado «${premio}». Ábrele chat en Panel → Sorteos ` +
          "para coordinar la entrega.",
        `/admin?chat=${entryId}`,
      );
    }
  } catch (err) {
    console.warn(
      "[sorteo] no se pudo avisar a los admin de la reclamación:",
      (err as Error)?.message || err,
    );
  }
}

/** Lo que muestra la tarjeta de consuelo al perder (Fase 10). */
export type RaffleConsolation = {
  entryId: string;
  code: string;
  name: string;
  description: string | null;
  image: string | null;
  /** Precio de reclamación original del premio ofrecido. */
  originalPrice: number;
  /** Importe CONGELADO en el entry: 90 % del original (el -10 % del consuelo). */
  discountedPrice: number;
  /** Estado real del entry al reentregar la oferta (campanita → saber qué acción ofrecer). */
  revealed: boolean;
  claimed: boolean;
};

/**
 * PREMIO DE CONSUELO («¡aún puedes conseguirlo!»): al perder, la ruleta
 * descubre el premio secreto que podría haber caído y lo ofrece al 90 % de su
 * precio de reclamación. La oferta es un entry «premio» CORRIENTE con el
 * importe descontado congelado en BD: el pago, el revelado y la reclamación
 * usan el flujo que ya existe (`createRaffleClaimCheckout`, `revealRafflePrize`,
 * `claimRafflePrize`), sin inventar una segunda contabilidad. UN solo consuelo
 * por giro perdedor: `consolation_of` liga la oferta con el giro y una segunda
 * llamada devuelve la misma. Si la rueda no tiene ningún premio real, null.
 */
export async function revealConsolationPrize(
  sid: string | undefined,
  loserEntryId: string,
): Promise<RaffleConsolation | null> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{ customer: string; outcome: string }>(
    "select customer, outcome from br_raffle_entries where id = ? limit 1",
    [loserEntryId],
  );
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese giro no es tuyo.");
  }
  if (e.outcome !== "perdedor") throw new Error("Este giro no tiene premio de consuelo.");
  // Si este giro ya tuvo su oferta, no se elige otro premio: se reentrega.
  type OfferRow = {
    id: string;
    code: string;
    prize_id: string;
    amount: string | number;
    revealed: number;
    claimed: number;
  };
  const offer = await query<OfferRow>(
    "select id, code, prize_id, amount, revealed, claimed from br_raffle_entries " +
      "where consolation_of = ? limit 1",
    [loserEntryId],
  );
  let entry: OfferRow = offer[0];
  if (!entry) {
    // Primero los premios SECRETOS (son «lo que había dentro de la ??»); si la
    // rueda no tiene secretos, cualquier premio activo sirve de consuelo.
    const pick = await query<RafflePrizeRow>(
      "select * from br_raffle_prizes where active = 1 and kind = 'premio' " +
        "and weight > 0 order by secret desc, rand() limit 1",
    );
    const prize = pick[0];
    if (!prize) return null;
    const discounted = round2(round2(Number(prize.reveal_price)) * 0.9);
    // Sin cobro (premio gratis), el entry nace ya revelado y pagado: se
    // reclama directo, igual que un giro normal con precio 0.
    const revealed = discounted <= 0 ? 1 : 0;
    const id = newId("sf");
    const code = freshRaffleCode();
    const now = Date.now();
    await execute(
      "insert into br_raffle_entries (id, code, customer, customer_name, prize_id, outcome, " +
        "revealed, paid, claimed, amount, chapa_amount, created_at, revealed_at, consolation_of) " +
        "values (?, ?, ?, ?, ?, 'premio', ?, ?, 0, ?, 0, ?, ?, ?)",
      [
        id,
        code,
        session.email,
        session.name,
        prize.id,
        revealed,
        revealed ? 1 : 0,
        discounted,
        now,
        revealed ? now : null,
        loserEntryId,
      ],
    );
    entry = { id, code, prize_id: prize.id, amount: discounted, revealed, claimed: 0 };
    void audit(session.email, "sorteo.consuelo", id, { giro: loserEntryId, premio: prize.name });
    // Deep-link: la campanita lleva al giro perdedor; `/sorteo?consuelo=` reabre
    // la tarjeta de la oferta sin tener que volver a girar la ruleta.
    void pushNotification(
      session.email,
      "premio",
      "🎗️ Premio de consuelo: −10 %",
      `Te ofrecemos «${prize.name}» con un 10 % de descuento por haber perdido. ¡Aún puedes conseguirlo!`,
      `/sorteo?consuelo=${loserEntryId}`,
    );
  }
  const p = await query<{
    name: string;
    description: string | null;
    image: string | null;
    reveal_price: string | number;
  }>("select name, description, image, reveal_price from br_raffle_prizes where id = ? limit 1", [
    entry.prize_id,
  ]);
  return {
    entryId: entry.id,
    code: entry.code,
    name: p[0]?.name ?? "Premio secreto",
    description: p[0]?.description ?? null,
    image: p[0]?.image ?? null,
    originalPrice: round2(Number(p[0]?.reveal_price ?? 0)),
    discountedPrice: round2(Number(entry.amount)),
    revealed: Number(entry.revealed) === 1,
    claimed: Number(entry.claimed) === 1,
  };
}

/** Detalle de un entry propio (o de admin) para pintar el estado del premio. */
export async function getRaffleEntry(sid: string | undefined, entryId: string) {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{
    id: string;
    code: string;
    customer: string;
    prize_id: string;
    outcome: "premio" | "perdedor" | "chapas";
    revealed: number;
    paid: number;
    claimed: number;
    amount: string | number;
  }>("select * from br_raffle_entries where id = ? limit 1", [entryId]);
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese premio no es tuyo.");
  }
  const p = await query<{ name: string; description: string | null; image: string | null }>(
    "select name, description, image from br_raffle_prizes where id = ? limit 1",
    [e.prize_id],
  );
  return {
    entryId: e.id,
    code: e.code,
    outcome: e.outcome,
    revealed: Number(e.revealed) === 1,
    paid: Number(e.paid) === 1,
    claimed: Number(e.claimed) === 1,
    amount: round2(Number(e.amount)),
    revealedName: Number(e.revealed) === 1 ? (p[0]?.name ?? "") : "",
    revealedDescription: Number(e.revealed) === 1 ? (p[0]?.description ?? null) : null,
    revealedImage: Number(e.revealed) === 1 ? (p[0]?.image ?? null) : null,
  };
}

/**
 * Revelar un premio SIN cobro (precio 0) o tras confirmarse el pago manual del
 * admin. Fija `revealed` y manda al ganador el mensaje personalizado + aviso
 * de cuándo se entrega. Idempotente.
 */
export async function revealRafflePrize(sid: string | undefined, entryId: string) {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{
    customer: string;
    customer_name: string;
    prize_id: string;
    code: string;
    outcome: string;
    amount: string | number;
    paid: number;
    revealed: number;
  }>("select * from br_raffle_entries where id = ? limit 1", [entryId]);
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese premio no es tuyo.");
  }
  if (e.outcome !== "premio") throw new Error("Este giro no tenía premio que revelar.");
  if (round2(Number(e.amount)) > 0 && Number(e.paid) !== 1 && session.role !== "admin") {
    throw new Error("Hay que completar el pago antes de descubrir el premio.");
  }
  if (Number(e.revealed) !== 1) {
    await execute("update br_raffle_entries set revealed = 1, revealed_at = ? where id = ?", [
      Date.now(),
      entryId,
    ]);
    void sendWinnerRaffleMail(e.customer, e.customer_name, e.code, e.prize_id).catch(
      () => undefined,
    );
    void pushWinnerPrizeNotification(e.customer, e.prize_id, e.code).catch(() => undefined);
  }
  return getRaffleEntry(session.sid, entryId);
}

/** Correo (best-effort) al ganador con el premio descubierto y su mensaje. */
async function sendWinnerRaffleMail(
  customer: string,
  customerName: string,
  code: string,
  prizeId: string,
): Promise<void> {
  const p = await query<{ name: string; win_message: string | null }>(
    "select name, win_message from br_raffle_prizes where id = ? limit 1",
    [prizeId],
  );
  const config = await getRaffleConfig();
  const msg = p[0]?.win_message?.trim() || config.winMessage;
  const base = publicBaseUrl();
  const link = base ? `${base}/sorteo` : "";
  await sendEmailBestEffort(
    customer,
    `🎉 ¡Has ganado en la Ruleta Botella Rápida! (${code})`,
    `Hola ${customerName || ""}:\n\n${msg}\n\nTu premio: ${p[0]?.name ?? "premio"}.\n\n` +
      `Reclámalo desde tu cuenta${link ? `: ${link}` : ""} — lo entregamos con tu próximo pedido.`,
  );
}

/** Campanita de premio revelado (0030), con el nombre real del segmento. */
async function pushWinnerPrizeNotification(
  customer: string,
  prizeId: string,
  code: string,
): Promise<void> {
  const pz = await query<{ name: string }>(
    "select name from br_raffle_prizes where id = ? limit 1",
    [prizeId],
  );
  await pushNotification(
    customer,
    "premio",
    `🎉 ¡Has ganado: ${pz[0]?.name?.trim() || code}!`,
    "Reclámalo desde tu cuenta y lo entregamos con tu próximo pedido.",
    "/sorteo",
  );
}

/**
 * Aviso (best-effort) a los admin de que un cliente ha ganado. El texto imita
 * el mensaje que pediría el titular: «he ganado!: este premio: (nombre)».
 */
async function notifyAdminsOfRaffleWin(
  winnerName: string,
  code: string,
  wheelLabel: string,
  prizeName: string,
): Promise<void> {
  const admins = await query<{ email: string }>(
    "select email from br_users where role = 'admin' limit 20",
  );
  const premio = prizeName?.trim() || wheelLabel;
  for (const a of admins) {
    void pushNotification(
      a.email,
      "premio",
      `🎉 ¡He ganado! — premio ${code}`,
      `${winnerName || "un cliente"} ha ganado: ${premio} (casilla «${wheelLabel}»). Gestiona en Panel → Sorteos.`,
      "/admin",
    );
    await sendEmailBestEffort(
      a.email,
      `🎉 ¡He ganado! — premio ${code}`,
      `${winnerName || "un cliente"} ha ganado en la ruleta: este premio: ${premio} ` +
        `(casilla «${wheelLabel}», código ${code}). ` +
        "Gestiona reclamaciones en Panel → Sorteos.",
    ).catch(() => undefined);
  }
}

/**
 * Checkout de Stripe para PAGAR la reclamación de un premio (espejo de
 * `createStripeCheckout`, sobre `br_raffle_payments`). El importe se toma SIEMPRE
 * del entry congelado en BD, nunca del navegador. Anti doble cobro igual.
 */
export async function createRaffleClaimCheckout(
  sid: string | undefined,
  entryId: string,
): Promise<{ url: string }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{
    id: string;
    customer: string;
    amount: string | number;
    paid: number;
    revealed: number;
    outcome: string;
    code: string;
  }>("select * from br_raffle_entries where id = ? limit 1", [entryId]);
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese premio no es tuyo.");
  }
  if (e.outcome !== "premio") throw new Error("Este giro no tiene premio que pagar.");
  if (Number(e.paid) === 1 || Number(e.revealed) === 1) {
    throw new Error("Este premio ya está pagado o descubierto.");
  }
  const cents = Math.round(Number(e.amount) * 100);
  if (cents <= 0) throw new Error("Este premio no requiere pago: descúbrelo directamente.");
  // Mismo enrutador que los pedidos (Panel → Pagos): maestro/demo/PayPal/Stripe.
  const settings = await getPaymentSettings();
  if (!settings.enabled) {
    throw new Error("El cobro online está apagado ahora mismo: contacta con el admin.");
  }
  const now = Date.now();
  if (settings.testMode) {
    const token = newId("demo");
    await execute(
      "insert into br_raffle_payments (entry_id, provider, demo_token, status, created_at, updated_at) " +
        "values (?, 'demo', ?, 'abierto', ?, ?) " +
        "on duplicate key update provider = 'demo', demo_token = values(demo_token), " +
        "status = if(status = 'pagado', status, 'abierto'), updated_at = values(updated_at)",
      [e.id, token, now, now],
    );
    return { url: `/pago-demo?token=${token}` };
  }
  if (settings.provider === "paypal") {
    if (!(await paypalConfigured())) {
      throw new Error(
        "PayPal no está configurado todavía: pide al admin que active las claves o el modo pruebas.",
      );
    }
    const base = appBaseUrl();
    const { id, approve } = await paypalCreateOrder(
      false,
      cents,
      `Botella Rápida · Reclamación ruleta ${e.code}`,
      `${base}/sorteo?entry=${e.id}&estado=pago`,
      `${base}/sorteo?entry=${e.id}&estado=pendiente`,
    );
    await execute(
      "insert into br_raffle_payments (entry_id, provider, paypal_order_id, status, created_at, updated_at) " +
        "values (?, 'paypal', ?, 'abierto', ?, ?) " +
        "on duplicate key update provider = 'paypal', " +
        "paypal_order_id = if(status = 'pagado', paypal_order_id, values(paypal_order_id)), " +
        "status = if(status = 'pagado', status, 'abierto'), updated_at = values(updated_at)",
      [e.id, id, now, now],
    );
    return { url: approve };
  }
  const stripe = await getStripe();
  const cs = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: e.id,
    customer_email: e.customer,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: cents,
          product_data: { name: `Botella Rápida · Reclamación ruleta ${e.code}` },
        },
      },
    ],
    success_url: `${appBaseUrl()}/sorteo?entry=${e.id}&estado=pago`,
    cancel_url: `${appBaseUrl()}/sorteo?entry=${e.id}&estado=pendiente`,
  });
  if (!cs.url) throw new Error("La pasarela no devolvió la URL de pago.");
  await execute(
    "insert into br_raffle_payments (entry_id, stripe_session_id, status, created_at, updated_at) " +
      "values (?, ?, 'abierto', ?, ?) " +
      "on duplicate key update " +
      "stripe_session_id = if(status = 'pagado', stripe_session_id, values(stripe_session_id)), " +
      "status = if(status = 'pagado', status, 'abierto'), " +
      "updated_at = values(updated_at)",
    [e.id, cs.id, now, now],
  );
  return { url: cs.url };
}

/**
 * Estado real del pago de la reclamación (espejo de `getPaymentStatus`): al
 * confirmarse en Stripe marca el entry pagado + revelado, descubre el premio y
 * avisa al ganador. Idempotente (se puede consultar al volver de /sorteo).
 */
export async function checkRaffleClaim(
  sid: string | undefined,
  entryId: string,
): Promise<{ paid: boolean; revealed: boolean }> {
  const session = await requireSession(sid, ["user", "admin"]);
  const rows = await query<{
    customer: string;
    customer_name: string;
    prize_id: string;
    code: string;
    paid: number;
    revealed: number;
  }>("select * from br_raffle_entries where id = ? limit 1", [entryId]);
  const e = rows[0];
  if (!e) throw new Error("Giro no encontrado.");
  if (e.customer !== session.email && session.role !== "admin") {
    throw new Error("Ese premio no es tuyo.");
  }
  if (Number(e.paid) === 1) {
    return { paid: true, revealed: Number(e.revealed) === 1 };
  }
  const rec = await query<{
    stripe_session_id: string;
    status: string;
    provider: string;
    paypal_order_id: string;
  }>(
    "select stripe_session_id, status, provider, paypal_order_id from br_raffle_payments where entry_id = ? limit 1",
    [entryId],
  );
  const p = rec[0];
  let paidNow = false;
  if (p?.status === "pagado") paidNow = true;
  if (!paidNow && p?.provider === "paypal" && p.paypal_order_id && (await paypalConfigured())) {
    paidNow = await paypalCaptureOrder(false, p.paypal_order_id);
  }
  if (!paidNow && p?.stripe_session_id && (await stripeEnabled())) {
    const stripe = await getStripe();
    const cs = await stripe.checkout.sessions.retrieve(p.stripe_session_id);
    if (cs.payment_status === "paid") paidNow = true;
  }
  if (!paidNow) return { paid: false, revealed: Number(e.revealed) === 1 };
  const now = Date.now();
  if (p) {
    await execute(
      "update br_raffle_payments set status = 'pagado', updated_at = ? where entry_id = ?",
      [now, entryId],
    );
  }
  await execute(
    "update br_raffle_entries set paid = 1, revealed = 1, revealed_at = ? where id = ?",
    [now, entryId],
  );
  void sendWinnerRaffleMail(e.customer, e.customer_name, e.code, e.prize_id).catch(() => undefined);
  void pushWinnerPrizeNotification(e.customer, e.prize_id, e.code).catch(() => undefined);
  void audit(session.email, "sorteo.pago", entryId);
  return { paid: true, revealed: true };
}

/* ----------------------------------------------------------- sorteo: admin */

/** Todo lo que necesita la pestaña Sorteos del panel. */
export async function adminRaffleState(sid: string | undefined) {
  await requireSession(sid, ["admin"]);
  const config = await getRaffleConfig();
  const prizeRows = await query<RafflePrizeRow>(
    "select * from br_raffle_prizes order by sort asc, id asc",
  );
  const prizes: RafflePrizeAdmin[] = prizeRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    wheelLabel: r.wheel_label,
    revealPrice: Number(r.reveal_price),
    chapas: Math.max(0, Math.round(Number(r.chapas ?? 0))),
    name: r.name,
    description: r.description,
    image: r.image,
    productId: r.product_id,
    weight: Number(r.weight),
    winMessage: r.win_message,
    active: Number(r.active) === 1,
    sort: Number(r.sort),
    secret: Number(r.secret) === 1,
    publicName: Number(r.secret) === 1 ? "" : r.name,
    publicImage: Number(r.secret) === 1 ? null : r.image,
  }));
  const entryRows = await query<{
    id: string;
    code: string;
    customer: string;
    customer_name: string;
    prize_id: string;
    prize_name: string | null;
    wheel_label: string | null;
    outcome: "premio" | "perdedor" | "chapas";
    revealed: number;
    paid: number;
    claimed: number;
    amount: string | number;
    created_at: number;
    revealed_at: number | null;
  }>(
    "select e.*, p.name as prize_name, p.wheel_label from br_raffle_entries e " +
      "left join br_raffle_prizes p on p.id = e.prize_id " +
      "order by e.created_at desc limit 300",
  );
  const entries: RaffleEntry[] = entryRows.map((r) => ({
    id: r.id,
    code: r.code,
    customer: r.customer,
    customerName: r.customer_name,
    prizeId: r.prize_id,
    prizeName: r.prize_name ?? "(premio borrado)",
    wheelLabel: r.wheel_label ?? "?",
    outcome: r.outcome,
    revealed: Number(r.revealed) === 1,
    paid: Number(r.paid) === 1,
    claimed: Number(r.claimed) === 1,
    amount: round2(Number(r.amount)),
    createdAt: Number(r.created_at),
    revealedAt: r.revealed_at === null ? null : Number(r.revealed_at),
  }));
  return { config, prizes, entries, stripeAvailable: await stripeEnabled() };
}

export type RaffleConfigPatch = Partial<RaffleConfig>;

/** Guardar la configuración global de la ruleta (upsert de la fila única). */
export async function saveRaffleConfig(
  sid: string | undefined,
  patch: RaffleConfigPatch,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const current = await getRaffleConfig();
  const merged: RaffleConfig = {
    enabled: patch.enabled ?? current.enabled,
    title: (patch.title ?? current.title).slice(0, 120),
    subtitle: (patch.subtitle ?? current.subtitle).slice(0, 240),
    howItWorks: (patch.howItWorks ?? current.howItWorks).slice(0, 4000),
    winMessage: (patch.winMessage ?? current.winMessage).slice(0, 400),
    loseMessage: (patch.loseMessage ?? current.loseMessage).slice(0, 400),
    ticketMinEuro: Math.max(
      0,
      Math.min(9999, round2(Number(patch.ticketMinEuro ?? current.ticketMinEuro))),
    ),
    unlimitedTest: patch.unlimitedTest ?? current.unlimitedTest,
  };
  await execute(
    "insert into br_raffle_config (id, enabled, title, subtitle, how_it_works, win_message, " +
      "lose_message, ticket_min_euro, unlimited_test, updated_at) values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "on duplicate key update enabled = values(enabled), title = values(title), " +
      "subtitle = values(subtitle), how_it_works = values(how_it_works), " +
      "win_message = values(win_message), lose_message = values(lose_message), " +
      "ticket_min_euro = values(ticket_min_euro), unlimited_test = values(unlimited_test), " +
      "updated_at = values(updated_at)",
    [
      merged.enabled ? 1 : 0,
      merged.title,
      merged.subtitle,
      merged.howItWorks,
      merged.winMessage,
      merged.loseMessage,
      merged.ticketMinEuro,
      merged.unlimitedTest ? 1 : 0,
      Date.now(),
    ],
  );
  void audit(admin.email, "sorteo.config", "br_raffle_config");
  return { ok: true };
}

export type RafflePrizeInput = {
  id?: string;
  kind: "premio" | "perdedor" | "chapas";
  wheelLabel: string;
  name: string;
  description?: string | null;
  image?: string | null;
  productId?: string | null;
  revealPrice: number;
  /** Migración 0030: chapas que regala un segmento `kind = 'chapas'`. */
  chapas?: number;
  weight: number;
  winMessage?: string | null;
  active: boolean;
  sort: number;
  /** true = la rueda muestra «???» y el detalle se revela tras pagar. */
  secret?: boolean;
};

/** Crear/actualizar un segmento de la rueda (el admin edita TODA la ruleta). */
export async function upsertRafflePrize(
  sid: string | undefined,
  input: RafflePrizeInput,
): Promise<{ ok: true; id: string }> {
  const admin = await requireSession(sid, ["admin"]);
  const id = input.id || newId("rp");
  const kind =
    input.kind === "perdedor" ? "perdedor" : input.kind === "chapas" ? "chapas" : "premio";
  await execute(
    "insert into br_raffle_prizes (id, kind, wheel_label, name, description, image, product_id, " +
      "reveal_price, weight, win_message, active, sort, secret, chapas, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "on duplicate key update kind = values(kind), wheel_label = values(wheel_label), " +
      "name = values(name), description = values(description), image = values(image), " +
      "product_id = values(product_id), reveal_price = values(reveal_price), " +
      "weight = values(weight), win_message = values(win_message), active = values(active), " +
      "sort = values(sort), secret = values(secret), chapas = values(chapas)",
    [
      id,
      kind,
      input.wheelLabel.slice(0, 48),
      input.name.slice(0, 160),
      input.description?.slice(0, 400) || null,
      // Fase 10 (migración 0031): la columna es mediumtext y el validator
      // permite data URLs de 2 MB; recortar a 600 caracteres truncaba la
      // imagen y el navegador no podía pintarla (premio «sin foto»).
      input.image?.slice(0, 2_000_000) || null,
      input.productId || null,
      Math.max(0, Math.min(999999, round2(Number(input.revealPrice) || 0))),
      Math.max(0, Math.min(1000000, Math.floor(Number(input.weight) || 0))),
      input.winMessage?.slice(0, 400) || null,
      input.active ? 1 : 0,
      Math.floor(Number(input.sort) || 0),
      input.secret ? 1 : 0,
      Math.max(0, Math.min(100000, Math.floor(Number(input.chapas) || 0))),
      Date.now(),
    ],
  );
  void audit(admin.email, "sorteo.premio.upsert", id);
  return { ok: true, id };
}

export async function deleteRafflePrize(
  sid: string | undefined,
  id: string,
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  // Los entries históricos sobreviven: `getRaffleEntry` muestra «(premio borrado)».
  await execute("delete from br_raffle_prizes where id = ?", [id]);
  void audit(admin.email, "sorteo.premio.delete", id);
  return { ok: true };
}

/**
 * El admin confirma un pago RECOLLECTADO EN MANO/transferencia (sin Stripe) y
 * descubre el premio; o marca un premio ya repartido. Solo admin.
 */
export async function adminSetRaffleEntryFlags(
  sid: string | undefined,
  entryId: string,
  flags: { paid?: boolean; revealed?: boolean; claimed?: boolean },
): Promise<{ ok: true }> {
  const admin = await requireSession(sid, ["admin"]);
  const sets: string[] = [];
  const args: (number | string)[] = [];
  if (flags.paid !== undefined) {
    sets.push("paid = ?");
    args.push(flags.paid ? 1 : 0);
  }
  if (flags.revealed !== undefined) {
    sets.push("revealed = ?");
    args.push(flags.revealed ? 1 : 0);
    if (flags.revealed) {
      sets.push("revealed_at = ?");
      args.push(Date.now());
    }
  }
  if (flags.claimed !== undefined) {
    sets.push("claimed = ?");
    args.push(flags.claimed ? 1 : 0);
  }
  if (!sets.length) return { ok: true };
  args.push(entryId);
  await execute(`update br_raffle_entries set ${sets.join(", ")} where id = ?`, args);
  void audit(admin.email, "sorteo.entry.flags", entryId, flags);
  return { ok: true };
}

/* ================================================================ afiliados */

/**
 * ENLACES DE INVITACIÓN (migración 0030): cualquier cuenta registrada (cliente o
 * repartidor) genera un enlace de UN solo uso. Si quien lo recibe completa su
 * PRIMERA compra entregada, ambas partes suman `reward` chapas. Nada más: ni
 * segundas compras ni terceros por el mismo código.
 */

/** Chapas de regalo por defecto al invitar con enlace. */
const AFFILIATE_REWARD_CHAPAS = 20;

/** Código público de invitación AF-XXXXXX (colisión practicamente imposible). */
function freshAffiliateCode(): string {
  return "AF-" + randomBytes(3).toString("hex").toUpperCase();
}

type AffiliateRow = {
  id: string;
  code: string;
  owner_email: string;
  owner_name: string;
  reward: number;
  used_by: string | null;
  used_at: number | null;
  created_at: number;
};

function toAffiliate(r: AffiliateRow): AffiliateLink {
  return {
    id: r.id,
    code: r.code,
    reward: Number(r.reward),
    createdAt: Number(r.created_at),
    usedBy: r.used_by,
    usedAt: r.used_at === null ? null : Number(r.used_at),
  };
}

/**
 * Crear el enlace de invitación propio. Si ya existe uno SIN usar, se reutiliza:
 * la pantalla siempre muestra el mismo enlace y no se acumulan códigos muertos.
 */
export async function createAffiliateLink(sid: string | undefined): Promise<AffiliateLink> {
  const session = await requireSession(sid, ["user", "repartidor", "admin"]);
  const open = await query<AffiliateRow>(
    "select * from br_affiliates where owner_email = ? and used_by is null " +
      "order by created_at desc limit 1",
    [session.email],
  );
  if (open.length) return toAffiliate(open[0]);
  const id = newId("af");
  const code = freshAffiliateCode();
  const now = Date.now();
  await execute(
    "insert into br_affiliates (id, code, owner_email, owner_name, reward, created_at) " +
      "values (?, ?, ?, ?, ?, ?)",
    [id, code, session.email, session.name, AFFILIATE_REWARD_CHAPAS, now],
  );
  void audit(session.email, "afiliado.crear", id, { code });
  return { id, code, reward: AFFILIATE_REWARD_CHAPAS, createdAt: now, usedBy: null, usedAt: null };
}

/** Enlaces propios: el activo primero y el histórico de los ya gastados. */
export async function listAffiliateLinks(sid: string | undefined): Promise<AffiliateLink[]> {
  const session = await requireSession(sid, ["user", "repartidor", "admin"]);
  const rows = await query<AffiliateRow>(
    "select * from br_affiliates where owner_email = ? order by used_by is null desc, created_at desc limit 50",
    [session.email],
  );
  return rows.map(toAffiliate);
}

/** Lo que ve quien ABRE el enlace (página pública /afiliado/AF-XXXXXX). */
export async function affiliateInfo(code: string): Promise<AffiliateInfo> {
  const c = (code || "").trim().toUpperCase();
  const rows = await query<AffiliateRow>("select * from br_affiliates where code = ? limit 1", [c]);
  const r = rows[0];
  if (!r) return { ok: false, ownerName: "", reward: 0, available: false };
  return {
    ok: true,
    ownerName: r.owner_name?.trim() || "un cliente de Botella Rápida",
    reward: Number(r.reward),
    available: r.used_by === null,
  };
}

/** El usuario registrado que llega con el enlace abierto: se autoadjunta la ref. */
export async function attachReferral(
  sid: string | undefined,
  code: string,
): Promise<{ ok: boolean }> {
  const session = await requireSession(sid);
  const c = (code || "").trim().toUpperCase();
  if (!c) return { ok: false };
  await attachReferralOnOrder(session.email, c);
  return { ok: true };
}

/** Fija `referred_by` si el código vale y la cuenta aún no tiene referidor. */
async function attachReferralOnOrder(customer: string, code: string): Promise<void> {
  const u = await query<{ referred_by: string | null }>(
    "select referred_by from br_users where email = ? limit 1",
    [customer],
  );
  if (!u.length || u[0].referred_by) return; // desconocida o ya referida: no se pisa
  const af = await query<{ owner_email: string }>(
    "select owner_email from br_affiliates where code = ? and used_by is null limit 1",
    [code],
  );
  if (!af.length || af[0].owner_email === customer) return; // inválido o autorferencia
  await execute("update br_users set referred_by = ? where email = ?", [
    af[0].owner_email,
    customer,
  ]);
}

/**
 * Cerrar el enlace y premiar en la PRIMERA compra ENTREGADA del invitado. El
 * cierre es atómico (`where used_by is null` + affectedRows): dos entregas
 * simultáneas jamás pagan doble. Con el programa de chapas apagado NO se gasta
 * el enlace: se premiera cuando esté activo.
 */
async function awardAffiliateForOrder(order: Order): Promise<void> {
  const cfg = await getChapaConfig();
  if (!cfg.enabled) return;
  // ¿Primer pedido entregado del cliente? (el de ahora ya está commiteado: se
  // excluye por id para no contarse a sí mismo).
  const prev = await query<{ n: number | string }>(
    "select count(*) as n from br_orders where customer = ? and status = 'entregado' " +
      "and archived = 0 and id <> ?",
    [order.customer, order.id],
  );
  if (Number(prev[0]?.n ?? 0) > 0) return;
  const u = await query<{ referred_by: string | null; name: string }>(
    "select referred_by, name from br_users where email = ? limit 1",
    [order.customer],
  );
  const owner = u[0]?.referred_by?.trim();
  if (!owner) return;
  // Si ya gastó algún enlace, no hay segundo premio (aunque cambie de referidor).
  const spent = await query<{ id: string }>(
    "select id from br_affiliates where used_by = ? limit 1",
    [order.customer],
  );
  if (spent.length) return;
  const links = await query<AffiliateRow>(
    "select * from br_affiliates where owner_email = ? and used_by is null " +
      "order by created_at asc limit 1",
    [owner],
  );
  const link = links[0];
  if (!link) return;
  const reward = Math.max(1, Math.round(Number(link.reward) || AFFILIATE_REWARD_CHAPAS));
  const closed = await execute(
    "update br_affiliates set used_by = ?, used_at = ? where id = ? and used_by is null",
    [order.customer, Date.now(), link.id],
  );
  if (!closed || closed.affectedRows !== 1) return; // otro proceso lo cerró primero
  const guestName = u[0]?.name?.trim() || order.customerName || "Tu invitado";
  try {
    await applyChapaDelta(owner, reward, `Invitación · 1ª compra ${order.code}`, order.id);
    await applyChapaDelta(order.customer, reward, "Por tu primera compra con invitación", order.id);
  } catch (err) {
    console.warn(
      "[afiliados] enlace cerrado pero las chapas fallaron:",
      (err as Error)?.message || err,
    );
  }
  void pushNotification(
    owner,
    "afiliado",
    `🎉 ¡Tu invitación funcionó! +${reward} chapas`,
    `${guestName} completó su primera compra (${order.code}). ${reward} chapas para ti.`,
    "/cuenta",
  );
  void pushNotification(
    order.customer,
    "afiliado",
    `🎁 +${reward} chapas por tu primera compra`,
    "Gracias por venir con enlace de invitación: el regalo también es para ti.",
    "/chapas",
  );
  void audit("sistema", "afiliado.premiar", link.id, { owner, guest: order.customer, reward });
}
