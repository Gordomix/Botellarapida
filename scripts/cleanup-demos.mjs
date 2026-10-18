// @ts-check
/**
 * Limpieza SEGURA de cuentas demo en cualquier base (local o producción).
 *
 * Reglas duras (no negociables) para no cargar cuentas reales por error:
 *   1. Solo borra los emails que le pases EXPLÍCITAMENTE con --email.
 *      Todo lo que no nombres NO se toca (tus cuentas reales están a salvo
 *      por defecto: josecabrerizoma@gmail.com, angelgfroce@gmail.com, etc.).
 *   2. NUNCA borra una cuenta de la LISTA BLANCA de protección (abajo).
 *      Si intentas pasarla, aborta sin tocar nada.
 *   3. CANDADO ANTI-BLOQUEO: no permite borrar el ÚNICO administrador, porque
 *      sin admin el arranque volvería a crear admin@local.dev desde ADMIN_EMAIL
 *      (ver ensureAdminFromEnv). Deja siempre otro admin (p. ej.
 *      botellarapidadmin@gmail.com) antes de borrar el admin de desarrollo.
 *   4. Por defecto hace DRY-RUN: enseña qué borraría y NO borra. Hay que
 *      añadir --apply para que ejecute de verdad.
 *
 * Uso (muestra primero, sin borrar):
 *   node scripts/cleanup-demos.mjs --list
 *   node scripts/cleanup-demos.mjs --email admin@local.dev --email cliente@demo.es
 * Cuando la lista sea exacta, ejecuta el borrado real:
 *   node scripts/cleanup-demos.mjs --apply --email admin@local.dev --email cliente@demo.es
 *
 * Contra producción: ejecútalo desde el Shell de Render (ahí ya están las
 * variables MYSQL_* / DATABASE_URL) o con esas variables apuntando a la BD real.
 */
import { createConnection } from "./mysql-connection.mjs";

// Lista blanca: estas cuentas NO se borran jamás con este script, aunque se
// las pase por --email. Son las cuentas reales del titular y del equipo.
// OJO: admin@local.dev NO está aquí a propósito — es el admin de desarrollo que
// el titular quiere eliminar (el candado anti-bloqueo de abajo protege el caso
// en que fuera el único admin).
const PROTECTED = new Set(
  [
    "botellarapidadmin@gmail.com", // admin del titular
    "josecabrerizoma@gmail.com", // cuenta real creada
    "angelgfroce@gmail.com", // cuenta real creada
  ]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ emails: string[]; apply: boolean; list: boolean }} */
  const out = { emails: [], apply: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.emails.push(String(argv[++i] || "").trim().toLowerCase());
    else if (a === "--apply") out.apply = true;
    else if (a === "--list") out.list = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const conn = await createConnection();

/** @returns {Promise<Array<{t: string}>>} */
async function tableNames() {
  const [rows] = await conn.query(
    "select table_name t from information_schema.tables where table_schema = database()",
  );
  return rows;
}

const tables = await tableNames();
const has = (/** @type {string} */ t) =>
  tables.some((r) => String(r.t).toLowerCase() === t);

async function listAccounts() {
  const [rows] = await conn.query(
    "select email, name, role, status from br_users order by role, created_at",
  );
  console.log("Cuentas en la base de datos:");
  for (const /** @type {{email:string;name:string;role:string;status:string}} */ r of rows) {
    const shield = PROTECTED.has(r.email.toLowerCase()) ? "  🔒PROTEGIDA" : "";
    console.log(`  ${r.role.padEnd(11)} ${String(r.status).padEnd(12)} ${r.email.padEnd(34)} ${r.name}${shield}`);
  }
}

/** Borra una cuenta y SOLO sus datos propios. Las órdenes que REPARTIÓ no se tocan. */
async function purgeOne(/** @type {string} */ email) {
  const [u] = await conn.query(
    "select email, role from br_users where email = ? limit 1",
    [email],
  );
  if (!u.length) {
    console.log(`  · ${email}: no existe → nada que borrar`);
    return;
  }
  const role = u[0].role;
  if (PROTECTED.has(email)) {
    throw new Error(`INTENTO DE BORRAR CUENTA PROTEGIDA: ${email}. Abortando sin tocar nada.`);
  }

  // Pedidos DE ESA CUENTA como cliente (no los que repartió un repartidor demo).
  const [orders] = await conn.query("select id from br_orders where customer = ?", [email]);
  const ids = orders.map((/** @type {{id:string}} */ o) => o.id);
  const inClause = ids.length ? `(${ids.map(() => "?").join(",")})` : "(null)";

  /** @type {Record<string, number>} */
  const counts = {};
  const run = async (/** @type {string} */ label, /** @type {string} */ sql, /** @type {any[]} */ params) => {
    if (!sql) return;
    const [res] = await conn.query(sql, params);
    counts[label] = Number(res.affectedRows);
  };

  if (ids.length) {
    if (has("br_payments")) await run("payments", `delete from br_payments where order_id in ${inClause}`, ids);
    if (has("br_customer_locations")) await run("cust_locations", `delete from br_customer_locations where order_id in ${inClause}`, ids);
    await run("order_items", `delete from br_order_items where order_id in ${inClause}`, ids);
    await run("order_history", `delete from br_order_history where order_id in ${inClause}`, ids);
    if (has("br_reviews")) await run("reviews", `delete from br_reviews where order_id in ${inClause}`, ids);
    await run("orders", `delete from br_orders where id in ${inClause}`, ids);
  }
  if (has("br_reviews")) await run("reviews_by_customer", "delete from br_reviews where customer = ?", [email]);
  if (has("br_donations")) await run("donations", "delete from br_donations where customer = ?", [email]);
  await run("claims", "delete from br_claims where email = ?", [email]);
  await run("support", "delete from br_support_messages where email = ?", [email]);
  await run("chat", "delete from br_chat_messages where sender_email = ?", [email]);
  if (has("br_invoices")) await run("invoices", "delete from br_invoices where customer_email = ?", [email]);
  if (role === "repartidor") {
    if (has("br_courier_locations")) await run("courier_locations", "delete from br_courier_locations where courier_email = ?", [email]);
    if (has("br_courier_faults")) await run("courier_faults", "delete from br_courier_faults where courier_email = ?", [email]);
  }
  await run("sessions", "delete from br_sessions where user_email = ?", [email]);
  if (has("br_email_verifications")) await run("email_verifications", "delete from br_email_verifications where email = ?", [email]);
  if (has("br_login_attempts")) await run("login_attempts", "delete from br_login_attempts where email = ?", [email]);
  if (has("br_password_resets")) await run("password_resets", "delete from br_password_resets where email = ?", [email]);
  await run("user", "delete from br_users where email = ?", [email]);

  console.log(`  ✓ ${email} [${role}] → ${JSON.stringify(counts)}`);
}

try {
  if (args.list) {
    await listAccounts();
  } else if (!args.emails.length) {
    console.error(
      "Indica al menos un email a borrar con --email <correo> (o usa --list para ver las cuentas).\n" +
        "Sin --apply solo MUESTRA lo que haría; añade --apply para borrar de verdad.",
    );
    process.exitCode = 1;
  } else {
    // Comprobación previa: aborta si alguna protegida se coló.
    const clash = args.emails.filter((e) => PROTECTED.has(e));
    if (clash.length) {
      throw new Error(`Negándome a borrar cuentas protegidas: ${clash.join(", ")}`);
    }
    // CANDADO ANTI-BLOQUEO: no dejar la base sin ningún administrador. Si se
    // borrase el único admin, el arranque lo recrearía (admin@local.dev) y el
    // titular perdería el control. Se exige otro admin superviviente.
    const [adminRows] = await conn.query(
      "select email from br_users where role = 'admin'",
    );
    const adminEmails = adminRows.map((r) => String(r.email).toLowerCase());
    const remainingAdmins = adminEmails.filter((e) => !args.emails.includes(e));
    if (adminEmails.length && remainingAdmins.length === 0) {
      throw new Error(
        "No se puede borrar el ÚNICO administrador de la base " +
          `(${adminEmails.join(", ")}). Primero crea o promociona otro admin ` +
          "(p. ej. botellarapidadmin@gmail.com) y repite el borrado.",
      );
    }
    console.log(`Cuentas protegidas (nunca se borrarán): ${[...PROTECTED].join(", ")}`);
    console.log(`Objetivo: ${args.emails.join(", ")}`);
    if (!args.apply) {
      console.log("\n[DRY-RUN] No se ha borrado nada. Repite con --apply para ejecutar.");
      // Muestra qué pedidos tiene cada cuenta para que veas el alcance.
      for (const e of args.emails) {
        const [o] = await conn.query("select count(*) n from br_orders where customer = ?", [e]);
        console.log(`  ${e}: ${o[0].n} pedido(s) propio(s) como cliente`);
      }
    } else {
      await conn.beginTransaction();
      for (const e of args.emails) await purgeOne(e);
      await conn.commit();
      console.log("\n[APPLY] Borrado completado y confirmado.");
    }
  }
} catch (err) {
  if (args.apply) await conn.rollback().catch(() => undefined);
  console.error("\nABORTADO sin cambios:", err?.message || err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
