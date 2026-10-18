import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * API expuesta al navegador. Cada función es una `createServerFn`: viaja como
 * POST y ejecuta `@/lib/br-server` en el servidor.
 *
 * Regla de oro: `sid` (token de sesión) se manda SIEMPRE desde el cliente, pero
 * lo valida el servidor contra `br_sessions`. Ninguna operación se fía del rol
 * que envía el navegador, y ninguna devuelve datos de otro usuario.
 */

const sid = { sid: z.string().max(256).optional() };
const idArg = { ...sid, id: z.string().min(1).max(64) };

const roleEnum = z.enum(["user", "repartidor", "admin"]);
const statusEnum = z.enum(["activo", "solicitud", "rechazado", "suspendido"]);
const paymentEnum = z.enum(["tarjeta", "bizum", "apple_google_pay", "efectivo"]);
const slotEnum = z.enum(["inmediata", "programada_hoy", "programada_noche"]);
const vehicleEnum = z.enum(["patinete", "bici", "moto", "coche"]);

const email = z.string().trim().email().max(191);
const shortText = z.string().trim().max(512);
const longText = z.string().trim().max(8000);
/**
 * Imagen de producto: URL de catálogo ("/products/x.webp") o data URL de un
 * WebP subido desde el panel ("data:image/webp;base64,..."). Las data URLs pesan
 * más, de ahí el límite de 2 MB; la subida cliente ya redimensiona a ~800 px.
 */
const imageUrl = z
  .string()
  .max(2_000_000)
  .refine(
    (v) => v.startsWith("/") || v.startsWith("http") || v.startsWith("data:image/"),
    "Imagen no válida (URL o data URL de imagen)",
  );

/** `br-server` es server-only (`node:crypto`, mysql2): se importa en el handler. */
const load = () => import("./br-server");

/* ------------------------------------------------------------------ cuentas */

export const loginFn = createServerFn({ method: "POST" })
  .validator(z.object({ email, pass: z.string().min(1).max(256) }))
  .handler(async ({ data }) => (await load()).login(data.email, data.pass));

/**
 * Segundo paso del acceso de admin (Fase 2): contraseña correcta + código de
 * la app autenticadora (o de recuperación). Solo lo llama el cliente cuando
 * `login` respondió `totpRequired: true`.
 */
export const loginAdminFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email,
      pass: z.string().min(1).max(256),
      code: z.string().trim().min(6).max(32),
    }),
  )
  .handler(async ({ data }) => (await load()).loginAdmin(data.email, data.pass, data.code));

export const registerFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: shortText.pipe(z.string().min(1)),
      email,
      pass: z.string().min(8).max(256),
      role: roleEnum.optional(),
      dni: z.string().trim().max(32).optional(),
      vehicle: vehicleEnum.optional(),
      phone: z.string().trim().max(64).optional(),
      /** Código de invitación `AF-...` del enlace por el que llegó (0030). */
      ref: z.string().trim().max(40).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).registerUser(data));

export const logoutFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).logout(data.sid));

/**
 * ¿Activo el «Continuar con Google»? Público: el client_id de OAuth NO es
 * secreto (va en el HTML de Google), lo secreto sería el client SECRET, que
 * aquí no existe: verificamos el ID token por firma, no con el secreto.
 */
export const googleStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const s = await load();
  return s.googleStatus();
});

/**
 * Login/alta con Google. El navegador entrega el ID token que firmó Google
 * (nunca su propio email dicho a mano); el servidor lo verifica y decide.
 */
export const googleSignInFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      credential: z.string().min(50).max(8000),
      intent: z.enum(["cliente", "repartidor"]),
    }),
  )
  .handler(async ({ data }) => (await load()).googleSignIn(data.credential, data.intent));

/**
 * Recupera la sesión vía cookie httpOnly: no manda `sid`, el servidor lee la
 * cookie. Se llama al arrancar en cliente si `sessionStorage` estaba vacío
 * (los navegadores móviles lo borran al descartar la pestaña).
 */
export const restoreSessionFn = createServerFn({ method: "POST" }).handler(async () =>
  (await load()).restoreSession(),
);

/** Recuperación de contraseña: no requiere sesión (quien la pide no puede entrar). */
export const requestResetFn = createServerFn({ method: "POST" })
  .validator(z.object({ email }))
  .handler(async ({ data }) => (await load()).requestPasswordReset(data.email));

export const resetPasswordFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string().min(8).max(256),
      pass: z.string().min(8).max(256),
    }),
  )
  .handler(async ({ data }) => (await load()).resetPassword(data.token, data.pass));

/**
 * Confirmación de email al registrarse con contraseña. No requiere sesión
 * (quien acaba de crear la cuenta aún no puede entrar): el token del enlace
 * es la credencial. Caduca y es de un solo uso (server-side lo comprueba).
 */
export const verifyEmailFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(8).max(256) }))
  .handler(async ({ data }) => (await load()).verifyEmail(data.token));

export const listUsersFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listUsers(data.sid));

export const setUserStatusFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email, status: statusEnum }))
  .handler(async ({ data }) => (await load()).setUserStatus(data.sid, data.email, data.status));

/** Baja definitiva de una cuenta (solo repartidores/clientes; jamás un admin). Exige código de admin. */
export const deleteUserFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ ...sid, email, code: z.string().trim().min(6).max(32) }),
  )
  .handler(async ({ data }) => (await load()).deleteUser(data.sid, data.email, data.code));

/* ------------------------------------------------- seguridad de accesos (IP) */

/**
 * Bloquea una IP de forma TOTAL (no entra, no pide, no usa el panel). Exige el
 * código de 2FA del admin. Solo admin.
 */
export const banIpFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      ip: z.string().trim().min(1).max(64),
      code: z.string().trim().min(6).max(32),
      note: z.string().trim().max(512).optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).banIp(data.sid, data.code, data.ip, data.note));

/** Levanta el bloqueo de una IP. También exige el 2FA. Solo admin. */
export const unbanIpFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      ip: z.string().trim().min(1).max(64),
      code: z.string().trim().min(6).max(32),
    }),
  )
  .handler(async ({ data }) => (await load()).unbanIp(data.sid, data.code, data.ip));

/** IPs ya bloqueadas (panel de admin). */
export const listIpBansFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listIpBans(data.sid));

/** IPs usadas en intentos de login (detector de «muchas IPs = ataque»). Solo admin. */
export const listSuspiciousIpsFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, withinHours: z.number().int().min(1).max(720).optional() }))
  .handler(async ({ data }) => (await load()).listSuspiciousIps(data.sid, data.withinHours));

/** Solicitudes de recuperación pendientes (solo admin; flujo mediado por persona). */
export const listResetRequestsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listResetRequests(data.sid));

/** El admin fija una contraseña nueva a una cuenta (recuperación sin SMTP). */
export const adminSetPasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email, pass: z.string().min(8).max(256) }))
  .handler(async ({ data }) => (await load()).adminSetPassword(data.sid, data.email, data.pass));

/* ------------------------------------------------- 2FA y auditoría (admin) */

/** Estado del segundo factor de la propia cuenta admin. */
export const twoFactorStatusFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).twoFactorStatus(data.sid));

/** Genera secreto + QR pendiente de confirmar (dynamic import de `qrcode`). */
export const beginTwoFactorFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).beginTwoFactor(data.sid));

/** Confirma el alta con un código válido; devuelve los códigos de respaldo. */
export const confirmTwoFactorFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      secret: z.string().trim().max(64),
      code: z.string().trim().min(6).max(12),
    }),
  )
  .handler(async ({ data }) => (await load()).confirmTwoFactor(data.sid, data.secret, data.code));

/** Desactiva el 2FA: exige un código válido en servidor. */
export const disableTwoFactorFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, code: z.string().trim().min(6).max(32) }))
  .handler(async ({ data }) => (await load()).disableTwoFactor(data.sid, data.code));

/** ¿Existe código maestro de emergencia? ¿Cuándo se rotó? (solo admin). */
export const masterCodeStatusFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).masterCodeStatus(data.sid));

/** Gira el código maestro: la respuesta trae el nuevo código EN CLARO (única vez). */
export const rotateMasterCodeFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).rotateMasterCode(data.sid));

/** Elimina el código maestro (el 2FA queda solo con la app y los respaldos). */
export const revokeMasterCodeFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).revokeMasterCode(data.sid));

/** Registro de acciones sensibles (solo admin): últimas 300. */
export const listAuditFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listAudit(data.sid));

/**
 * Reinicio de lanzamiento (solo admin): borra pedidos/archivados/estadísticas de
 * prueba. La UI confirma 3 veces; el servidor exige además la frase exacta.
 */
export const resetLaunchDataFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, confirmText: z.string().trim().max(64) }))
  .handler(async ({ data }) => (await load()).resetLaunchData(data.sid, data.confirmText));

/** El repartidor fija su jornada (hora de inicio 0-23; 8 h de duración). */
export const setCourierShiftFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, startHour: z.number().int().min(0).max(23) }))
  .handler(async ({ data }) => (await load()).setCourierShift(data.sid, data.startHour));

/** Lee la franja del propio repartidor para preseleccionar su selector. */
export const getCourierShiftFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).getCourierShift(data.sid));

/** El admin anota una falta a un repartidor. */
export const addCourierFaultFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email, reason: z.string().trim().min(1).max(512) }))
  .handler(async ({ data }) => (await load()).addCourierFault(data.sid, data.email, data.reason));

/** El admin retira una falta registrada por error. */
export const deleteCourierFaultFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteCourierFault(data.sid, data.id));

/** Todas las faltas (panel de admin). */
export const listFaultsAdminFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listFaultsAdmin(data.sid));

/** Faltas del propio repartidor (pop-up de aviso en su portal). */
export const myFaultsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).myFaults(data.sid));

/** El repartidor acusa recibo de sus faltas pendientes. */
export const ackFaultsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).ackFaults(data.sid));

/* ------------------------------------------------------------------ pedidos */

export const listOrdersFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listOrders(data.sid));

export const listCouriersFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listCouriers(data.sid));

export const createOrderFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      items: z
        .array(
          z.object({
            id: z.string().min(1).max(191),
            name: shortText,
            qty: z.number().int().min(1).max(999),
            price: z.number().min(0).max(10000),
          }),
        )
        .min(1)
        .max(100),
      subtotal: z.number().min(0).max(100000),
      shippingCost: z.number().min(0).max(1000),
      tip: z.number().min(0).max(100),
      total: z.number().min(0).max(100000),
      paymentMethod: paymentEnum,
      deliverySlot: slotEnum,
      address: shortText,
      postalCode: z
        .string()
        .trim()
        .regex(/^\d{5}$/, "Código postal de 5 dígitos"),
      phone: z.string().trim().min(3).max(64),
      notes: z.string().trim().max(4000),
      store: z.object({ id: z.string().trim().min(1).max(64) }).optional(),
      asCustomer: z.object({ email, name: shortText }).optional(),
      /** Código de cupón/afiliado escrito en el checkout (se revalida en servidor). */
      coupon: z.string().trim().max(64).optional(),
      /** Declaración +18 del checkout (se registra en servidor, migración 0023). */
      ageConfirmed: z.boolean().optional(),
      /** Código `AF-...` del enlace de invitación con el que llegó (0030). */
      ref: z.string().trim().max(40).nullable().optional(),
      // Fase 10: coordenadas de la calle elegida en el desplegable. Hay que
      // declarlas AQUÍ o zod las descartaría antes de llegar al servidor.
      destLat: z.number().min(-90).max(90).nullable().optional(),
      destLng: z.number().min(-180).max(180).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).createOrder(data.sid, data));

/**
 * Autocompletado de calles DENTRO del código postal (checkout, Fase 10):
 * evita que una calle homónima de otra ciudad acabe en el repartidor. Devuelve
 * como máximo 6 direcciones con sus coordenadas exactas.
 */
export const addressSuggestionsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      postalCode: z
        .string()
        .trim()
        .regex(/^\d{5}$/, "Código postal de 5 dígitos"),
      query: z.string().trim().min(3).max(80),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).addressSuggestions(data.sid, data.postalCode, data.query),
  );

/** Declara +18 ante el servidor (se llama al aceptar el age gate con sesión). */
export const declareAdultFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).declareAdult(data.sid));

export const assignCourierFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), courier: email }))
  .handler(async ({ data }) => (await load()).assignCourier(data.sid, data.id, data.courier));

/** Reactivar un pedido CANCELADO delegándolo a otro repartidor (Fase 10). */
export const reactivateAssignCourierFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), courier: email }))
  .handler(async ({ data }) =>
    (await load()).reactivateAndAssignCourier(data.sid, data.id, data.courier),
  );

export const courierAcceptFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).courierAccept(data.sid, data.id));

export const markDeliveredFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).markDelivered(data.sid, data.id));

export const cancelOrderFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).cancelOrder(data.sid, data.id));

/** El admin archiva (elimina del flujo) un pedido; queda en «Archivados». */
export const deleteOrderFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteOrder(data.sid, data.id));

/** Devuelve un pedido archivado al flujo normal. */
export const restoreOrderFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).restoreOrder(data.sid, data.id));

/** Lista de pedidos archivados (solo admin). */
export const listArchivedOrdersFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listArchivedOrders(data.sid));

/**
 * BORRADO DEFINITIVO de un pedido archivado (solo admin). Irreversible: borra la
 * fila y sus satélites. El servidor rechaza pedidos no archivados, así que nunca
 * se puede borrar de verdad un reparto en curso por error.
 */
export const purgeOrderFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).purgeOrder(data.sid, data.id));

/**
 * El repartidor cancela su reparto EN CURSO con motivo OBLIGATORIO. El servidor
 * valida que el pedido es suyo y está en juego, guarda el motivo y avisa al admin.
 */
export const courierCancelFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      id: z.string().min(1).max(64),
      reason: z.string().trim().min(1).max(512),
    }),
  )
  .handler(async ({ data }) => (await load()).courierCancel(data.sid, data.id, data.reason));

/** Estadísticas del panel de admin (solo admin): todo agregado en servidor. */
export const getStatsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).getStats(data.sid));

/**
 * Auditoría de accesos (solo admin): lista de sesiones registradas en
 * `br_sessions` con nombre, rol, fecha de entrada y si sigue viva. El token
 * real NUNCA viaja al navegador.
 */
export const listSessionsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listSessions(data.sid));

/* -------------------------------------------------------------------- pagos */

/**
 * ¿Se puede pagar online? Público (solo booleans y proveedor, jamás claves):
 * migrate 0029 — incluye el modo pruebas y el proveedor elegido (PayPal).
 */
export const paymentsStatusFn = createServerFn({ method: "GET" }).handler(async () =>
  (await load()).paymentPublicStatus(),
);

/** Crea el Checkout de Stripe del pedido y devuelve la URL a la que navegar. */
export const createCheckoutFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).createStripeCheckout(data.sid, data.id));

/** Estado real del pago (el servidor lo verifica contra Stripe, no por URL). */
export const paymentStatusFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).getPaymentStatus(data.sid, data.id));

/* -------------------------------------------------------------------- chat */

const chatOrderArg = {
  ...sid,
  orderId: z.string().trim().min(1).max(64),
};

export const listChatMessagesFn = createServerFn({ method: "POST" })
  .validator(z.object(chatOrderArg))
  .handler(async ({ data }) => (await load()).listChatMessages(data.sid, data.orderId));

export const sendChatMessageFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...chatOrderArg, body: z.string().max(4000) }))
  .handler(async ({ data }) =>
    (await load()).sendChatMessage(data.sid, { orderId: data.orderId, body: data.body }),
  );

/* ------------------------------------------- seguimiento y ubicación viva */

/**
 * El móvil del repartidor manda su fix de GPS (solo con reparto activo y con
 * su permiso). El servidor valida coordenadas y que el pedido indicado sea
 * realmente suyo; nadie publica su posición contra un pedido ajeno.
 */
export const pingCourierLocationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().min(0).max(100000).optional(),
      orderId: z.string().trim().max(64).optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).pingCourierLocation(data.sid, data));

/**
 * El cliente comparte SU ubicación con el repartidor y el admin (bidireccional),
 * solo mientras el pedido está en juego y con su permiso explícito. El
 * servidor autoriza contra la sesión: solo el dueño del pedido puede publicar.
 */
export const pingCustomerLocationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      orderRef: z.string().trim().min(1).max(64),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().min(0).max(100000).optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).pingCustomerLocation(data.sid, data));

/** Seguimiento por id o código BR-XXXX: solo dueño, repartidor o admin. */
export const orderTrackingFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, orderRef: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }) => (await load()).getOrderTracking(data.sid, data.orderRef));

/** Mapa en vivo del panel de admin (posición de los repartidores). */
export const liveLocationsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listLiveLocations(data.sid));

/* ---------------------------------------------------------------- cupones */

/**
 * Pre-visualización del cupón en el checkout (cliente con sesión): devuelve si
 * aplica y cuánto. No es la cifra final — al crear el pedido el servidor lo
 * recalcula contra el subtotal real del catálogo.
 */
export const validateCouponFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      code: z.string().trim().max(64),
      subtotal: z.number().min(0).max(100000),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).validateCoupon(data.sid, { code: data.code, subtotal: data.subtotal }),
  );

/** Listado completo de cupones (solo admin). */
export const listCouponsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listCoupons(data.sid));

/** Alta de cupón normal o de afiliado (solo admin). */
export const createCouponFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      draft: z.object({
        code: z.string().trim().min(3).max(24),
        kind: z.enum(["percent", "fixed"]),
        amount: z.number().min(0.5).max(500),
        minOrder: z.number().min(0).max(10000),
        firstOnly: z.boolean(),
        affiliate: z.boolean(),
        affiliateName: z.string().trim().max(120).optional(),
        maxUses: z.number().int().min(0).max(1000000).optional(),
        expiresAt: z.number().int().min(0).nullable().optional(),
      }),
    }),
  )
  .handler(async ({ data }) => (await load()).createCoupon(data.sid, data.draft));

/** Activar/desactivar un cupón sin borrarlo (solo admin). */
export const setCouponActiveFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...idArg, active: z.boolean() }))
  .handler(async ({ data }) => (await load()).setCouponActive(data.sid, data.id, data.active));

/** Borrado definitivo de un cupón (solo admin; los pedidos conservan su código). */
export const deleteCouponFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteCoupon(data.sid, data.id));

/* ------------------------------------------------------------ reseñas */

/**
 * Foto de reseña: data URL pequeño generado por `image-opt` en el navegador
 * del cliente. La cifra la limita también el servidor (`createReview`).
 */
const reviewPhoto = z.string().max(700_000).optional();

/** El cliente valora un pedido ENTREGADO propio: nace privada, nunca pública. */
export const createReviewFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      orderId: z.string().trim().min(1).max(64),
      stars: z.number().int().min(1).max(5),
      text: z.string().trim().max(600),
      image: reviewPhoto,
    }),
  )
  .handler(async ({ data }) => (await load()).createReview(data.sid, data));

/** Reseñas publicadas: público, sin sesión (es la vitrina de la portada). */
export const listPublishedReviewsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await load()).listPublishedReviews(),
);

/** Todas las reseñas, incluidas las privadas (solo admin). */
export const listAllReviewsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listAllReviews(data.sid));

/** Publicar/ocultar una reseña (solo admin). */
export const setReviewPublishedFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...idArg, published: z.boolean() }))
  .handler(async ({ data }) =>
    (await load()).setReviewPublished(data.sid, data.id, data.published),
  );

export const deleteReviewFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteReview(data.sid, data.id));

/** Qué pedidos YA valoró el cliente (oculta el formulario de reseña en /cuenta). */
export const listMyReviewedOrderIdsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listMyReviewedOrderIds(data.sid));

/* ------------------------------------------------------------ apoyos */

/**
 * Donación «Apóyanos» (1–999 €): queda REGISTRADA como agradecimiento, no se
 * cobra nada (la pasarela real dependerá de Stripe). Con sesión obligatoria.
 */
export const createDonationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      amount: z.number().min(1).max(999),
      message: z.string().trim().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).createDonation(data.sid, data));

/** Apoyos registrados (solo admin). */
export const listDonationsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listDonations(data.sid));

export const deleteDonationFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteDonation(data.sid, data.id));

/* ---------------------------------------------------------------- facturas */

const invoiceArg = {
  ...sid,
  orderId: z.string().trim().min(1).max(64),
};

export const issueInvoiceFn = createServerFn({ method: "POST" })
  .validator(z.object(invoiceArg))
  .handler(async ({ data }) => (await load()).issueInvoice(data.sid, data.orderId));

export const getInvoiceFn = createServerFn({ method: "POST" })
  .validator(z.object(invoiceArg))
  .handler(async ({ data }) => (await load()).getInvoice(data.sid, data.orderId));

export const listInvoicesFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listInvoices(data.sid));

/* --------------------------------------------------------- reclamaciones y soporte */

export const listClaimsFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listClaims(data.sid));

export const addClaimFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      orderCode: z.string().trim().max(32),
      type: z.enum(["retraso", "faltante", "roto", "otro"]),
      text: longText.pipe(z.string().min(1)),
    }),
  )
  .handler(async ({ data }) => (await load()).addClaim(data.sid, data));

export const resolveClaimFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), answer: longText }))
  .handler(async ({ data }) => (await load()).resolveClaim(data.sid, data.id, data.answer));

export const listMessagesFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listMessages(data.sid));

/** Buzón público: no lleva `sid` (el visitante puede no tener cuenta). */
export const sendMessageFn = createServerFn({ method: "POST" })
  .validator(z.object({ email, text: longText.pipe(z.string().min(1)) }))
  .handler(async ({ data }) => (await load()).sendMessage(data));

export const replyMessageFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), answer: longText }))
  .handler(async ({ data }) => (await load()).replyMessage(data.sid, data.id, data.answer));

/* ------------------------------------------------------------------ catálogo */

export const listProductsFn = createServerFn({ method: "POST" }).handler(async () =>
  (await load()).listProducts(),
);

/** Solo las altas del admin (el panel las lista para poder quitarlas). */
export const listCustomProductsFn = createServerFn({ method: "POST" }).handler(async () =>
  (await load()).listCustomProducts(),
);

const nutritionSchema = z.record(z.string(), z.string().max(120)).optional();

// Stock, visibilidad y coste (payload JSON de Product): `stock` null = sin
// control, 0 = agotado; `flashUntil` epoch ms o null; `coste` € para el Excel
// de rentabilidad. Zod recorta lo no declarado, así que van también en el
// `productPatch` del editor de catálogo fijo.
const stockFields = {
  stock: z.number().int().min(0).max(1000000).nullable().optional(),
  hidden: z.boolean().optional(),
  flashUntil: z.number().int().positive().max(4102444800000).nullable().optional(),
  coste: z.number().min(0).max(1000000).nullable().optional(),
};

export const addCustomProductFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      product: z.object({
        id: z.string().min(1).max(64),
        name: shortText.pipe(z.string().min(1)),
        cat: z.enum([
          "aperitivos",
          "snacks",
          "refrescos",
          "basicos",
          "alcohol",
          "parafarmacia",
          "ofertas",
          "packs",
        ]),
        brand: shortText,
        price: z.number().min(0.01).max(10000),
        unit: shortText,
        desc: longText,
        long: longText,
        nutrition: nutritionSchema,
        image: imageUrl,
        alcohol: z.boolean().optional(),
        grad: z.string().trim().max(32).optional(),
        oferta: z.boolean().optional(),
        oldPrice: z.number().min(0.01).max(10000).optional(),
        pos: z.number().int().min(0).max(100000).optional(),
        ...stockFields,
      }),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).addCustomProduct(data.sid, {
      ...data.product,
      nutrition: data.product.nutrition ?? {},
    }),
  );

export const removeCustomProductFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).removeCustomProduct(data.sid, data.id));

/** Orden manual del catálogo: lista completa de ids en el orden deseado. */
export const reorderCustomProductsFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, ids: z.array(z.string().min(1).max(64)).max(2000) }))
  .handler(async ({ data }) => (await load()).reorderCustomProducts(data.sid, data.ids));

/**
 * Base española (Open Food Facts) para precargar el alta: nombre o EAN. Solo
 * admin; si la base remota cae devuelve lo que haya (la UI conserva la local).
 */
export const searchSpanishProductsFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, q: z.string().trim().min(2).max(120) }))
  .handler(async ({ data }) => (await load()).searchSpanishProducts(data.sid, data.q));

/**
 * Importación por URL (tienda del proveedor): el servidor lee la ficha y
 * extrae nombre, marca, precio, foto y descripción. Solo admin.
 */
export const importProductFromUrlFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, url: z.string().trim().min(8).max(600) }))
  .handler(async ({ data }) => (await load()).importProductFromUrl(data.sid, data.url));

/**
 * Descarga una foto remota como data URL para el editor de recorte (solo admin):
 * evita el bloqueo CORS del canvas cuando la imagen vive en otro dominio.
 */
export const fetchImageAsDataUrlFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, url: z.string().trim().min(8).max(600) }))
  .handler(async ({ data }) => (await load()).fetchImageAsDataUrl(data.sid, data.url));

/**
 * Proxy PÚBLICO de fotos remotas de producto (fallback iOS/anti-hotlink): lo
 * llama el `<img>` solo cuando la carga directa falló. Sin sesión: el servidor
 * aplica las guardas SSRF/tamaño/tipo (br-server `proxyProductImage`).
 */
export const proxyImageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z
        .string()
        .trim()
        .min(8)
        .max(600)
        .refine((v) => /^https?:\/\//i.test(v), "Solo enlaces http/https"),
    }),
  )
  .handler(async ({ data }) => (await load()).proxyProductImage(data.url));

/* ------------------------------------------------------- contenido editable (CMS) */

/** Claves de sección: deben coincidir con `SiteSectionKey` de site-defaults.ts. */
const sectionEnum = z.enum([
  "hero",
  "home.order",
  "home.pasillos",
  "home.nevera",
  "home.casa",
  "home.como",
  "home.testimonios",
  "home.cobertura",
  "home.buzon",
  "categories",
  "brand",
  "nav",
  "footer",
  "agegate",
  "checkout",
  "meta",
  "legal.privacidad",
  "legal.terminos",
  "contacto",
  "portales",
  "aviso",
  "mantenimiento",
  "reparto",
]);

/** Todos los overrides guardados (el merge con defaults lo hace el cliente). */
export const getSiteContentFn = createServerFn({ method: "POST" }).handler(async () =>
  (await load()).getSiteContent(),
);

export const saveSiteSectionFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, section: sectionEnum, payload: z.unknown() }))
  .handler(async ({ data }) =>
    (await load()).saveSiteSection(data.sid, data.section, data.payload),
  );

export const resetSiteSectionFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, section: sectionEnum }))
  .handler(async ({ data }) => (await load()).resetSiteSection(data.sid, data.section));

/** Parche de un producto fijo: todos los campos opcionales (merge parcial). */
const productPatch = z.object({
  name: shortText.optional(),
  cat: z
    .enum([
      "aperitivos",
      "snacks",
      "refrescos",
      "basicos",
      "alcohol",
      "parafarmacia",
      "ofertas",
      "packs",
    ])
    .optional(),
  brand: shortText.optional(),
  price: z.number().min(0.01).max(10000).optional(),
  unit: shortText.optional(),
  desc: longText.optional(),
  long: longText.optional(),
  nutrition: nutritionSchema,
  image: imageUrl.optional(),
  alcohol: z.boolean().optional(),
  grad: z.string().trim().max(32).optional(),
  oferta: z.boolean().optional(),
  oldPrice: z.number().min(0.01).max(10000).optional(),
  ...stockFields,
});

export const saveProductOverrideFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), patch: productPatch }))
  .handler(async ({ data }) => (await load()).saveProductOverride(data.sid, data.id, data.patch));

export const resetProductOverrideFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).resetProductOverride(data.sid, data.id));

/* -------------------------------------------------------------------- salud */

export const dbHealthFn = createServerFn({ method: "POST" }).handler(async () =>
  (await load()).dbHealth(),
);

/* ------------------------------------------------------------------- sorteo */

/** Estado público de la ruleta (anónimos incluidos: la ven, no la giran). */
export const raffleStateFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).rafflePublicState(data.sid));

/** Girar: el resultado lo decide el servidor por pesos (nunca el navegador). */
export const raffleSpinFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).spinRaffle(data.sid));

export const raffleEntryFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).getRaffleEntry(data.sid, data.id));

/** Revelar un premio sin cobro (o ya pagado manualmente por el admin). */
export const raffleRevealFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).revealRafflePrize(data.sid, data.id));

/** Pedir la entrega del premio revelado (llega con el próximo pedido). */
export const raffleClaimFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).claimRafflePrize(data.sid, data.id));

/** Checkout de Stripe para pagar la reclamación del premio. */
export const raffleClaimPayFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).createRaffleClaimCheckout(data.sid, data.id));

/** Confirmación server-side del pago del premio (idempotente). */
export const raffleClaimStatusFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).checkRaffleClaim(data.sid, data.id));

/**
 * Premio de consuelo al perder (Fase 10): revela el secreto que podría haber
 * caído y crea la oferta con el -10 % congelado. Idempotente por giro.
 */
export const raffleConsolationFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).revealConsolationPrize(data.sid, data.id));

export const adminRaffleStateFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).adminRaffleState(data.sid));

const raffleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  title: shortText.max(120).optional(),
  subtitle: shortText.max(240).optional(),
  howItWorks: longText.optional(),
  winMessage: shortText.max(400).optional(),
  loseMessage: shortText.max(400).optional(),
  // Migración 0028: € mínimos del pedido entregado para regalar 1 ticket.
  ticketMinEuro: z.number().min(0).max(9999).optional(),
  // Migración 0029: giros ilimitados para cuentas registradas (probar).
  unlimitedTest: z.boolean().optional(),
});

export const saveRaffleConfigFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, patch: raffleConfigSchema }))
  .handler(async ({ data }) => (await load()).saveRaffleConfig(data.sid, data.patch));

const rafflePrizeSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  // Migración 0030: segmento «chapas» regala chapas directamente al girar.
  kind: z.enum(["premio", "perdedor", "chapas"]),
  /** Chapas que suma el segmento (solo con kind «chapas»; 0–100000). */
  chapas: z.number().int().min(0).max(100000).optional(),
  wheelLabel: z.string().trim().min(1).max(48),
  name: shortText.max(160),
  description: shortText.max(400).nullable().optional(),
  image: imageUrl.nullable().optional(),
  productId: z.string().trim().max(64).nullable().optional(),
  revealPrice: z.number().min(0).max(999999),
  weight: z.number().int().min(0).max(1000000),
  winMessage: shortText.max(400).nullable().optional(),
  active: z.boolean(),
  sort: z.number().int().min(-10000).max(10000),
  // Migración 0027: casilla con premio oculto («???») hasta revelarlo.
  secret: z.boolean().optional(),
});

export const upsertRafflePrizeFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, prize: rafflePrizeSchema }))
  .handler(async ({ data }) => (await load()).upsertRafflePrize(data.sid, data.prize));

export const deleteRafflePrizeFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteRafflePrize(data.sid, data.id));

export const setRaffleEntryFlagsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...idArg,
      flags: z.object({
        paid: z.boolean().optional(),
        revealed: z.boolean().optional(),
        claimed: z.boolean().optional(),
      }),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).adminSetRaffleEntryFlags(data.sid, data.id, data.flags),
  );

/* ------------------------------------------------------------- pagos (0029) */

const demoTokenArg = { ...sid, token: z.string().trim().min(4).max(64) };

/** Estado de la pasarela para la pestaña «Pagos» (solo admin). */
export const adminPaymentsStateFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).adminPaymentsState(data.sid));

/** Guardar proveedor / modo pruebas (solo admin). */
export const savePaymentSettingsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      patch: z.object({
        provider: z.enum(["paypal", "stripe"]).optional(),
        testMode: z.boolean().optional(),
        // Migración 0030: interruptor maestro de cobro online.
        enabled: z.boolean().optional(),
        // Claves editables desde el panel: `undefined` no toca, `''` retira el
        // método, texto fija. Nunca vuelven al navegador (server-side solo).
        paypalClientId: z.string().trim().max(256).optional(),
        paypalSecret: z.string().trim().max(256).optional(),
        stripeSecretKey: z.string().trim().max(256).optional(),
      }),
    }),
  )
  .handler(async ({ data }) => (await load()).savePaymentSettings(data.sid, data.patch));

/** Datos del pago simulado para pintar /pago-demo (dueño o admin). */
export const demoPaymentInfoFn = createServerFn({ method: "POST" })
  .validator(z.object(demoTokenArg))
  .handler(async ({ data }) => (await load()).demoPaymentInfo(data.sid, data.token));

/** Aprobar el pago simulado (marca pagado sin cobrar nada). */
export const approveDemoPaymentFn = createServerFn({ method: "POST" })
  .validator(z.object(demoTokenArg))
  .handler(async ({ data }) => (await load()).approveDemoPayment(data.sid, data.token));

/** Cancelar el pago simulado. */
export const cancelDemoPaymentFn = createServerFn({ method: "POST" })
  .validator(z.object(demoTokenArg))
  .handler(async ({ data }) => (await load()).cancelDemoPayment(data.sid, data.token));

/* ------------------------------------------------------------------- chapas */

/** Estado público de Chapas (ofertas visibles sin cuenta; canje exige login). */
export const chapaStateFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).chapaPublicState(data.sid));

export const chapaRedeemFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).redeemChapaReward(data.sid, data.id));

export const adminChapaStateFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).adminChapaState(data.sid));

const chapaConfigSchema = z.object({
  enabled: z.boolean().optional(),
  title: shortText.max(120).optional(),
  subtitle: shortText.max(240).optional(),
  howItWorks: longText.optional(),
  redeemNote: shortText.max(400).optional(),
  // Equilibrio (0028): € gastados por chapa regalada (12 por defecto).
  eurosPerChapa: z.number().min(0).max(100000).optional(),
});

export const saveChapaConfigFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, patch: chapaConfigSchema }))
  .handler(async ({ data }) => (await load()).saveChapaConfig(data.sid, data.patch));

export const setChapaProductFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      productId: z.string().min(1).max(64),
      chapas: z.number().int().min(0).max(100000).nullable(),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).setChapaProduct(data.sid, data.productId, data.chapas),
  );

const chapaRewardSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(160),
  description: shortText.max(400).nullable().optional(),
  image: imageUrl.nullable().optional(),
  cost: z.number().int().min(1).max(10000000),
  // Valor en € del regalo: > 0 ⇒ el servidor deriva el coste (100 chapas = 12 €).
  valueEuro: z.number().min(0).max(1000000).optional(),
  stock: z.number().int().min(-1).max(1000000),
  productId: z.string().trim().max(64).nullable().optional(),
  active: z.boolean(),
  sort: z.number().int().min(-10000).max(10000),
});

export const upsertChapaRewardFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, reward: chapaRewardSchema }))
  .handler(async ({ data }) => (await load()).upsertChapaReward(data.sid, data.reward));

export const deleteChapaRewardFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).deleteChapaReward(data.sid, data.id));

export const setChapaRedemptionStatusFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...idArg,
      status: z.enum(["entregado", "cancelado"]),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).setChapaRedemptionStatus(data.sid, data.id, data.status),
  );

export const adjustChapaBalanceFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      email,
      delta: z.number().int().min(-1000000).max(1000000),
      reason: shortText.max(160),
    }),
  )
  .handler(async ({ data }) =>
    (await load()).adjustChapaBalance(data.sid, data.email, data.delta, data.reason),
  );

/* ------------------------------------------------------- campanita (0030) */

/** Bandeja de notificaciones de la sesión: últimas + contador de no leídas. */
export const notificationsListFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, limit: z.number().int().min(1).max(100).optional() }))
  .handler(async ({ data }) => (await load()).listNotifications(data.sid, data.limit));

/** Marcar leídas: todas (sin `id`) o una sola. */
export const notificationsReadFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64).optional() }))
  .handler(async ({ data }) => (await load()).markNotificationsRead(data.sid, data.id));

/* ------------------------------------------------- enlaces de invitación */

/** Genera (o reutiliza) el enlace propio de chapas — cliente, repartidor o admin. */
export const createAffiliateLinkFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).createAffiliateLink(data.sid));

/** Mis enlaces: el activo primero y el histórico de gastados. */
export const listAffiliateLinksFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listAffiliateLinks(data.sid));

/** Página pública /afiliado/$code: quién invita y cuánto regala (sin sesión). */
export const affiliateInfoFn = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().trim().min(3).max(40) }))
  .handler(async ({ data }) => (await load()).affiliateInfo(data.code));

/** Cuenta ya registrada que abre el enlace: se autoadjunta como referida. */
export const attachReferralFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, code: z.string().trim().min(3).max(40) }))
  .handler(async ({ data }) => (await load()).attachReferral(data.sid, data.code));

/* -------------------------------------- gestión de correo de verificación */

/** El admin confirma el correo de una cuenta a mano (Panel → Cuentas). */
export const adminVerifyEmailFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email }))
  .handler(async ({ data }) => (await load()).adminVerifyEmail(data.sid, data.email));

/** El admin reenvía el enlace de activación (exige SMTP configurado). */
export const adminResendVerificationFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email }))
  .handler(async ({ data }) => (await load()).adminResendVerification(data.sid, data.email));

/** Diagnóstico SMTP: manda un correo de prueba y devuelve el error real si falla. */
export const testSmtpEmailFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, to: email.optional() }))
  .handler(async ({ data }) => (await load()).testSmtpEmail(data.sid, data.to));
