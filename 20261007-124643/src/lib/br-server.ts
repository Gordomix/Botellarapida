import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolConnection } from "mysql2/promise";
import { execute, getDb, query } from "./db";
import { FREE_SHIPPING, SHIPPING_COST } from "@/data/types";
import { isWithinServiceArea, SERVICE_AREA_LABEL } from "@/data/service-area";
import type { OrderItem, Product } from "@/data/types";

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

export type Role = "user" | "repartidor" | "admin";
export type UserStatus = "activo" | "solicitud" | "rechazado" | "suspendido";
export type OrderStatus =
  | "pendiente"
  | "asignado"
  | "en_reparto"
  | "entregado"
  | "cancelado";
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
};

export type Session = {
  email: string;
  role: Role;
  name: string;
  dni: string | null;
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
  phone: string;
  notes: string | null;
  status: OrderStatus;
  courier: string | null;
  created_at: number;
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
  phone: string;
  notes: string;
  status: OrderStatus;
  courier: string | null;
  createdAt: number;
  history: { at: number; by: string; what: string }[];
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

/** Identificador corto y único por entidad (mismo formato que el cliente espera). */
function newId(prefix: string) {
  return prefix + Date.now().toString(36) + randomBytes(3).toString("hex");
}

/** Código de pedido legible BR-XXXX, reintentando si colisiona con el único. */
async function freshOrderCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = "BR-" + randomBytes(4).toString("hex").slice(0, 4).toUpperCase();
    const hit = await query<{ code: string }>(
      "select code from br_orders where code = ? limit 1",
      [code],
    );
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

/** Crea una sesión y devuelve el token en claro (solo una vez, para el cliente). */
async function createSession(user: UserRowDto): Promise<SessionInfo> {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const now = Date.now();
  await execute(
    "insert into br_sessions (token_hash, user_email, role, created_at, expires_at) values (?, ?, ?, ?, ?)",
    [tokenHash, user.email, user.role, now, now + SESSION_TTL_MS],
  );
  return {
    sid: raw,
    email: user.email,
    role: user.role,
    name: user.name,
    dni: user.dni,
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
};

const USER_COLUMNS =
  "id, email, name, role, status, dni, vehicle, created_at, pass_hash";

function toPublicUser(r: UserRowDto): PublicUser {
  return {
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    dni: r.dni,
    vehicle: r.vehicle,
    createdAt: r.created_at,
  };
}

/** Lee la sesión desde el token; `null` si no existe, caducó o el usuario cambió de estado. */
export async function readSession(sid: string | undefined): Promise<SessionInfo | null> {
  if (!sid) return null;
  const tokenHash = createHash("sha256").update(sid).digest("hex");
  const rows = await query<{
    token_hash: string;
    user_email: string;
    role: Role;
    expires_at: number;
    created_at: number;
    name: string;
    dni: string | null;
    user_status: UserStatus;
  }>(
    "select s.token_hash, s.user_email, s.role, s.created_at, s.expires_at, " +
      "u.name, u.dni, u.status as user_status " +
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
  return {
    sid,
    email: row.user_email,
    role: row.role,
    name: row.name,
    dni: row.dni,
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
};

export async function registerUser(
  input: RegisterInput,
): Promise<{ ok: boolean; msg: string }> {
  const email = input.email.trim().toLowerCase();
  const role: Role = input.role ?? "user";
  const dni = input.dni?.trim().toUpperCase() || null;

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
    if (input.pass.length < 6) {
      return { ok: false, msg: "La contraseña necesita al menos 6 caracteres." };
    }
    const dupDni = await query<{ email: string }>(
      "select email from br_users where dni = ? limit 1",
      [dni],
    );
    if (dupDni.length) return { ok: false, msg: "Ese DNI ya está registrado." };
  } else if (input.pass.length < 6) {
    return { ok: false, msg: "La contraseña necesita al menos 6 caracteres." };
  }

  // Un registro público nunca puede crear admin: el admin se sembró por entorno.
  const safeRole: Role = role === "admin" ? "user" : role;
  const status: UserStatus = safeRole === "repartidor" ? "solicitud" : "activo";

  try {
    await execute(
      "insert into br_users (id, name, email, pass_hash, role, status, dni, vehicle, created_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        newId("u"),
        input.name.trim(),
        email,
        await hashPassword(input.pass),
        safeRole,
        status,
        dni,
        safeRole === "repartidor" ? (input.vehicle ?? null) : null,
        Date.now(),
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      return { ok: false, msg: "Ese DNI o email ya están registrados." };
    }
    throw err;
  }

  return {
    ok: true,
    msg:
      safeRole === "repartidor"
        ? "Solicitud enviada. El admin debe aprobarla antes de que puedas aceptar repartos."
        : "Cuenta creada. Ya puedes entrar.",
  };
}

export async function login(
  email: string,
  pass: string,
): Promise<{ ok: boolean; msg: string; session?: SessionInfo }> {
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users where email = ? limit 1`,
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user || isLegacyHash(user.pass_hash)) {
    return { ok: false, msg: "Email o contraseña incorrectos." };
  }
  if (!(await verifyPassword(pass, user.pass_hash))) {
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
  return { ok: true, msg: "Bienvenido.", session: await createSession(user) };
}

/** Cierra la sesión pasada y todas las del usuario (cambio de estado, "Salir"). */
export async function logout(sid: string | undefined): Promise<{ ok: true }> {
  if (!sid) return { ok: true };
  const tokenHash = createHash("sha256").update(sid).digest("hex");
  await execute("delete from br_sessions where token_hash = ?", [tokenHash]);
  return { ok: true };
}

export async function listUsers(sid: string | undefined): Promise<PublicUser[]> {
  await requireSession(sid, ["admin"]);
  const rows = await query<UserRowDto>(
    `select ${USER_COLUMNS} from br_users order by created_at desc`,
  );
  return rows.map(toPublicUser);
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
  await requireSession(sid, ["admin"]);
  const target = await query<{ email: string; role: Role }>(
    "select email, role from br_users where email = ? limit 1",
    [email.trim().toLowerCase()],
  );
  if (!target.length) return { ok: false, msg: "Ese usuario no existe." };
  if (target[0].role === "admin" && status !== "activo") {
    return { ok: false, msg: "A otro admin no lo puedes suspender: usa una cuenta intermedia." };
  }
  await execute("update br_users set status = ? where email = ?", [
    status,
    target[0].email,
  ]);
  // Suspender o rechazar expulsa las sesiones activas de esa cuenta.
  if (status !== "activo") {
    await execute("delete from br_sessions where user_email = ?", [target[0].email]);
  }
  return { ok: true, msg: "Estado actualizado." };
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
    phone: row.phone,
    notes: row.notes ?? "",
    status: row.status,
    courier: row.courier,
    createdAt: row.created_at,
    history: history.map((h) => ({ at: h.at, by: h.actor, what: h.what })),
    items: items.map((i) => ({ id: i.product_id, name: i.name, qty: i.qty, price: Number(i.price) })),
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
  if (session.role === "admin") {
    rows = await query<OrderRow>("select * from br_orders order by created_at desc limit 500");
  } else if (session.role === "user") {
    rows = await query<OrderRow>(
      "select * from br_orders where customer = ? order by created_at desc limit 200",
      [session.email],
    );
  } else {
    rows = await query<OrderRow>(
      "select * from br_orders where status = 'pendiente' or courier = ? order by created_at desc limit 300",
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
   * Solo admin: el panel puede simular el pedido de un cliente concreto para
   * probar el flujo. Un cliente nunca puede poner aqui un email ajeno.
   */
  asCustomer?: { email: string; name: string };
};

/**
 * El cliente solo puede crear pedidos PARA SÍ: `customer` y `customerName` se
 * leen de la sesión, nunca del cuerpo de la petición.
 */
export async function createOrder(
  sid: string | undefined,
  input: CreateOrderInput,
): Promise<Order> {
  const session = await requireSession(sid, ["user", "admin"]);
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
  for (const p of catalog) priceOf.set(p.id, p.price);
  let subtotal = 0;
  for (const item of input.items) {
    const price = priceOf.get(item.id);
    if (price === undefined) throw new Error(`Producto fuera de catálogo: ${item.name}`);
    subtotal += price * item.qty;
  }
  subtotal = round2(subtotal);
  const shippingCost = subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
  const tip = round2(Math.max(0, Math.min(20, input.tip)));
  const total = round2(subtotal + shippingCost + tip);

  const id = newId("o");
  const code = await freshOrderCode();
  const now = Date.now();
  const pool = await getDb();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "insert into br_orders (id, code, customer, customer_name, subtotal, shipping_cost, tip, total, " +
        "payment_method, delivery_slot, address, phone, notes, status, courier, created_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', null, ?)",
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
        input.deliverySlot,
        input.address.trim(),
        input.phone.trim(),
        input.notes.trim(),
        now,
      ],
    );
    for (const item of input.items) {
      await conn.query(
        "insert into br_order_items (order_id, product_id, name, qty, price) values (?, ?, ?, ?, ?)",
        [id, item.id, item.name, item.qty, priceOf.get(item.id) as number],
      );
    }
    await conn.query(
      "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
      [id, now, "sistema", `Pedido creado (${input.paymentMethod})`],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
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
    return toOrder(
      {
        ...order,
        status: change.status,
        courier: change.courier === undefined ? order.courier : change.courier,
      },
      items,
      history,
    );
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
    async (_order, session) => ({ status: "en_reparto" as const, courier: session.email }),
    ["repartidor", "admin"],
  );
}

export function markDelivered(sid: string | undefined, orderId: string) {
  return mutateOrder(
    sid,
    orderId,
    ["en_reparto"],
    async () => ({ status: "entregado" as const }),
    ["repartidor", "admin"],
  );
}

export function cancelOrder(sid: string | undefined, orderId: string) {
  return mutateOrder(
    sid,
    orderId,
    ["pendiente", "asignado", "en_reparto"],
    async () => ({ status: "cancelado" as const }),
    ["admin"],
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
  if (!input.text.trim()) throw new Error("Cuéntanos qué ha pasado.");
  const id = newId("c");
  const now = Date.now();
  await execute(
    "insert into br_claims (id, order_code, email, type, text, status, answer, created_at) " +
      "values (?, ?, ?, ?, ?, 'abierta', null, ?)",
    [id, input.orderCode.trim(), session.email, input.type, input.text.trim(), now],
  );
  return {
    id,
    orderCode: input.orderCode.trim(),
    email: session.email,
    type: input.type,
    text: input.text.trim(),
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
  await requireSession(sid, ["admin"]);
  if (!answer.trim()) throw new Error("La respuesta no puede estar vacía.");
  const res = await execute(
    "update br_claims set status = 'resuelta', answer = ? where id = ? and status = 'abierta'",
    [answer.trim(), id],
  );
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
export async function sendMessage(input: {
  email: string;
  text: string;
}): Promise<SupportMessage> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email no válido.");
  if (!input.text.trim()) throw new Error("El mensaje está vacío.");
  const id = newId("m");
  const now = Date.now();
  await execute(
    "insert into br_support_messages (id, email, text, answer, status, created_at) " +
      "values (?, ?, ?, null, 'abierto', ?)",
    [id, email, input.text.trim(), now],
  );
  return { id, email, text: input.text.trim(), answer: "", status: "abierto", createdAt: now };
}

export async function replyMessage(
  sid: string | undefined,
  id: string,
  answer: string,
): Promise<{ ok: boolean }> {
  await requireSession(sid, ["admin"]);
  if (!answer.trim()) throw new Error("La respuesta no puede estar vacía.");
  const res = await execute(
    "update br_support_messages set status = 'respondido', answer = ? where id = ?",
    [answer.trim(), id],
  );
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
  return rows.map((r) => {
    const payload = typeof r.payload === "string" ? (JSON.parse(r.payload) as Product) : r.payload;
    return { ...payload, id: r.id };
  });
}

/** Catálogo = statico (`src/data/catalog.ts`) + altas del admin. Público. */
export async function listProducts(): Promise<Product[]> {
  const { CATALOG } = await import("@/data/catalog");
  return [...CATALOG, ...(await listCustomProductsRaw())];
}

/** Solo las altas del admin (lo que el panel puede quitar). Público. */
export async function listCustomProducts(): Promise<Product[]> {
  return listCustomProductsRaw();
}

export async function addCustomProduct(
  sid: string | undefined,
  product: Product,
): Promise<{ ok: boolean }> {
  await requireSession(sid, ["admin"]);
  if (!product.id || !product.name) throw new Error("Producto sin id o nombre.");
  if (!(product.price > 0)) throw new Error("El precio debe ser mayor que 0.");
  await execute(
    "insert into br_custom_products (id, payload, created_at) values (?, ?, ?) " +
      "on duplicate key update payload = values(payload), created_at = values(created_at)",
    [product.id, JSON.stringify(product), Date.now()],
  );
  return { ok: true };
}

export async function removeCustomProduct(
  sid: string | undefined,
  id: string,
): Promise<{ ok: boolean }> {
  await requireSession(sid, ["admin"]);
  const res = await execute("delete from br_custom_products where id = ?", [id]);
  return { ok: res.affectedRows > 0 };
}

/* ------------------------------------------------------------------ estado */

/** Estado de la BD para la pantalla de arranque (sin exponer secretos). */
export async function dbHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const rows = await query<{ n: number }>("select count(*) as n from br_users");
    return { ok: true, detail: `${Number(rows[0].n)} cuentas` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
