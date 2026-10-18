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
  .validator(
    z.object({ email, pass: z.string().min(1).max(256) }),
  )
  .handler(async ({ data }) => (await load()).login(data.email, data.pass));

export const registerFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: shortText.pipe(z.string().min(1)),
      email,
      pass: z.string().min(6).max(256),
      role: roleEnum.optional(),
      dni: z.string().trim().max(32).optional(),
      vehicle: vehicleEnum.optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).registerUser(data));

export const logoutFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).logout(data.sid));

export const listUsersFn = createServerFn({ method: "POST" })
  .validator(z.object(sid))
  .handler(async ({ data }) => (await load()).listUsers(data.sid));

export const setUserStatusFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, email, status: statusEnum }))
  .handler(async ({ data }) =>
    (await load()).setUserStatus(data.sid, data.email, data.status),
  );

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
      postalCode: z.string().trim().regex(/^\d{5}$/, "Código postal de 5 dígitos"),
      phone: z.string().trim().min(3).max(64),
      notes: z.string().trim().max(4000),
      asCustomer: z.object({ email, name: shortText }).optional(),
    }),
  )
  .handler(async ({ data }) => (await load()).createOrder(data.sid, data));

export const assignCourierFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...sid, id: z.string().min(1).max(64), courier: email }))
  .handler(async ({ data }) => (await load()).assignCourier(data.sid, data.id, data.courier));

export const courierAcceptFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).courierAccept(data.sid, data.id));

export const markDeliveredFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).markDelivered(data.sid, data.id));

export const cancelOrderFn = createServerFn({ method: "POST" })
  .validator(z.object(idArg))
  .handler(async ({ data }) => (await load()).cancelOrder(data.sid, data.id));

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

export const listProductsFn = createServerFn({ method: "POST" }).handler(
  async () => (await load()).listProducts(),
);

/** Solo las altas del admin (el panel las lista para poder quitarlas). */
export const listCustomProductsFn = createServerFn({ method: "POST" }).handler(
  async () => (await load()).listCustomProducts(),
);

const nutritionSchema = z.record(z.string(), z.string().max(120)).optional();

export const addCustomProductFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...sid,
      product: z.object({
        id: z.string().min(1).max(64),
        name: shortText.pipe(z.string().min(1)),
        cat: z.enum(["aperitivos", "snacks", "refrescos", "basicos", "alcohol"]),
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

/* -------------------------------------------------------------------- salud */

export const dbHealthFn = createServerFn({ method: "POST" }).handler(
  async () => (await load()).dbHealth(),
);
