#!/usr/bin/env node
// @ts-check
/**
 * Siembra de Botella Rápida sobre MySQL.
 *
 * Crea el admin desde `ADMIN_EMAIL` / `ADMIN_PASSWORD` del entorno (nunca
 * hardcodeado: la contraseña del panel ya no vive en el código). Con
 * `SEED_DEMO=1` añade además una cuenta de cliente y un repartidor aprobado,
 * útiles para probar el flujo entre dispositivos en local.
 *
 * Idempotente: si el email ya existe, no lo toca (no pisa la contraseña de un
 * admin real en cada despliegue). Requiere las tablas ya creadas: ejecuta antes
 * `npm run db:migrate`.
 *
 *   ADMIN_EMAIL=admin@midominio.es ADMIN_PASSWORD='...' npm run db:seed
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... SEED_DEMO=1 npm run db:seed
 */
import { randomBytes } from "node:crypto";
import { createConnection, env, hasDbConfig, hashPassword } from "./mysql-connection.mjs";

/** Id corto compatible con `br-server.newId` (prefijo + base36 + hex). */
function newId(prefix) {
  return prefix + Date.now().toString(36) + randomBytes(3).toString("hex");
}

/**
 * Inserta una cuenta si el email no existe ya.
 * @param {import("mysql2/promise").Connection} conn
 * @param {{ name: string; email: string; pass: string; role: string; status: string; dni?: string | null; vehicle?: string | null }} u
 */
async function upsertUser(conn, u) {
  const email = u.email.trim().toLowerCase();
  const [rows] = await conn.query(
    "select id from br_users where email = ? limit 1",
    [email],
  );
  if (rows.length) {
    console.log(`  · ${email} ya existe → sin cambios`);
    return false;
  }
  await conn.query(
    "insert into br_users (id, name, email, pass_hash, role, status, dni, vehicle, created_at) " +
      "values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId("u"),
      u.name,
      email,
      await hashPassword(u.pass),
      u.role,
      u.status,
      u.dni ?? null,
      u.vehicle ?? null,
      Date.now(),
    ],
  );
  console.log(`  ✓ ${u.role}: ${email}`);
  return true;
}

/**
 * Deja visible el flujo logístico: unos pocos pedidos en distintos estados, una
 * reclamación y un mensaje de soporte, para que admin, cliente y repartidor vean
 * contenido desde el primer arranque. Solo actúa si la tabla de pedidos está
 * vacía, así que no duplica datos si ya has estado pidiendo.
 */
async function seedDemoData(conn) {
  const [has] = await conn.query("select 1 from br_orders limit 1");
  if (has.length) {
    console.log("  · ya hay pedidos en la BD → no se siembran los de ejemplo");
    return;
  }
  const now = Date.now();
  const H = 3600_000;

  const orders = [
    {
      id: newId("o"), code: "BR-DEMO01", customer: "cliente@demo.es", customer_name: "Ana Cliente",
      subtotal: 7.35, shipping_cost: 2.9, tip: 0, total: 10.25,
      payment_method: "tarjeta", delivery_slot: "inmediata",
      address: "Calle Mayor 12, 3B, Madrid", phone: "600 111 222", notes: "Al timbre suena poco.",
      status: "pendiente", courier: null, created_at: now - 2 * H,
      items: [
        { pid: "palitos-pan-dia", name: "Palitos de Pan Crujiente", qty: 2, price: 1.2 },
        { pid: "cola-lata-pack", name: "Refresco Cola Latas", qty: 1, price: 4.95 },
      ],
      history: [{ at: now - 2 * H, actor: "sistema", what: "Pedido creado (tarjeta)" }],
    },
    {
      id: newId("o"), code: "BR-DEMO02", customer: "cliente@demo.es", customer_name: "Ana Cliente",
      subtotal: 12.9, shipping_cost: 2.9, tip: 1, total: 16.8,
      payment_method: "bizum", delivery_slot: "programada_hoy",
      address: "Avinguda del Port 5, València", phone: "600 333 444", notes: "Dejar en conserjería.",
      status: "en_reparto", courier: "demo@repartidor.br", created_at: now - 5 * H,
      items: [{ pid: "set-rayo-demo", name: "Set Rayo Express 🎁", qty: 1, price: 12.9 }],
      history: [
        { at: now - 5 * H, actor: "sistema", what: "Pedido creado (bizum)" },
        { at: now - 3 * H, actor: "demo@repartidor.br", what: "en_reparto" },
      ],
    },
    {
      id: newId("o"), code: "BR-DEMO03", customer: "cliente@demo.es", customer_name: "Ana Cliente",
      subtotal: 9.6, shipping_cost: 2.9, tip: 0, total: 12.5,
      payment_method: "tarjeta", delivery_slot: "inmediata",
      address: "Rúa do Sol 8, A Coruña", phone: "600 555 666", notes: "",
      status: "entregado", courier: "demo@repartidor.br", created_at: now - 26 * H,
      items: [{ pid: "frutos-secos-mix", name: "Mix de Frutos Secos Tostados", qty: 3, price: 3.2 }],
      history: [
        { at: now - 26 * H, actor: "sistema", what: "Pedido creado (tarjeta)" },
        { at: now - 25 * H, actor: "demo@repartidor.br", what: "en_reparto" },
        { at: now - 24 * H, actor: "demo@repartidor.br", what: "entregado" },
      ],
    },
  ];

  for (const o of orders) {
    await conn.query(
      "insert into br_orders (id, code, customer, customer_name, subtotal, shipping_cost, tip, total, " +
        "payment_method, delivery_slot, address, phone, notes, status, courier, created_at) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        o.id, o.code, o.customer, o.customer_name, o.subtotal, o.shipping_cost, o.tip, o.total,
        o.payment_method, o.delivery_slot, o.address, o.phone, o.notes, o.status, o.courier, o.created_at,
      ],
    );
    for (const it of o.items) {
      await conn.query(
        "insert into br_order_items (order_id, product_id, name, qty, price) values (?, ?, ?, ?, ?)",
        [o.id, it.pid, it.name, it.qty, it.price],
      );
    }
    for (const h of o.history) {
      await conn.query(
        "insert into br_order_history (order_id, at, actor, what) values (?, ?, ?, ?)",
        [o.id, h.at, h.actor, h.what],
      );
    }
  }

  await conn.query(
    "insert into br_claims (id, order_code, email, type, text, status, answer, created_at) " +
      "values (?, ?, ?, ?, ?, 'abierta', null, ?)",
    [
      newId("c"), "BR-DEMO03", "cliente@demo.es", "Producto dañado",
      "Uno de los paquetes de frutos secos llegó reventado. ¿Me lo podéis reponer?",
      now - 20 * H,
    ],
  );
  await conn.query(
    "insert into br_support_messages (id, email, text, answer, status, created_at) " +
      "values (?, ?, ?, null, 'abierto', ?)",
    [newId("m"), "maria@ejemplo.es", "¿Llegáis hasta mi pueblo fuera de Madrid capital?", now - 6 * H],
  );
  console.log("  ✓ 3 pedidos demo + reclamación + mensaje de soporte");
}

async function main() {
  if (!hasDbConfig()) {
    console.warn(
      "[seed] Sin variables de conexión MySQL (MYSQL_* o DATABASE_URL). Nada que sembrar.",
    );
    process.exitCode = 0;
    return;
  }

  const adminEmail = env("ADMIN_EMAIL");
  const adminPass = env("ADMIN_PASSWORD");
  if (!adminEmail || !adminPass) {
    console.error(
      "[seed] Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD en el entorno.\n" +
        "       Ponlos en tu .env local o en el panel del hosting y vuelve a lanzar:\n" +
        "         ADMIN_EMAIL=tu@email ADMIN_PASSWORD='clave' npm run db:seed",
    );
    process.exitCode = 1;
    return;
  }
  if (adminPass.length < 8) {
    console.error("[seed] ADMIN_PASSWORD debe tener al menos 8 caracteres.");
    process.exitCode = 1;
    return;
  }

  const conn = await createConnection();
  try {
    console.log("[seed] Sembrando cuentas…");
    await upsertUser(conn, {
      name: "Administrador",
      email: adminEmail,
      pass: adminPass,
      role: "admin",
      status: "activo",
    });

    if (env("SEED_DEMO") === "1") {
      const demoPass = env("DEMO_PASSWORD") || "demo1234";
      await upsertUser(conn, {
        name: "Ana Cliente",
        email: "cliente@demo.es",
        pass: demoPass,
        role: "user",
        status: "activo",
      });
      await upsertUser(conn, {
        name: "Leo Repartidor",
        email: "demo@repartidor.br",
        pass: demoPass,
        role: "repartidor",
        status: "activo",
        dni: "99999998R",
        vehicle: "patinete",
      });
      await seedDemoData(conn);
    } else {
      console.log("  (SEED_DEMO!=1: no se crean las cuentas de demostración)");
    }
    console.log("[seed] Listo.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[seed] fallo:", err?.message || err);
  process.exitCode = 1;
});
