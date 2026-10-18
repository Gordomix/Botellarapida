// @ts-check
/**
 * Asegura una cuenta de administrador REAL (crea o promociona). Es el paso
 * previo seguro a borrar admin@local.dev: así la base nunca se queda sin admin
 * y el arranque (ensureAdminFromEnv) no recrea el admin de desarrollo.
 *
 * NO borra nada. Solo:
 *   - si el email existe como usuario → le pone role='admin' y status='activo';
 *   - si NO existe → lo crea como admin con la contraseña indicada.
 *
 * Uso (contraseña por variable para no escribirla en la línea de comandos):
 *   ADMIN_NEW_PASSWORD='una-contra-larga' node scripts/set-admin.mjs \
 *       --email botellarapidadmin@gmail.com --name Administrador
 *
 * Contra producción: ejecútalo desde el Shell de Render (ahí ya están las
 * variables MYSQL_* / DATABASE_URL).
 */
import { createConnection, hashPassword } from "./mysql-connection.mjs";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ email: string; name: string }} */
  const out = { email: "", name: "Administrador" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = String(argv[++i] || "").trim().toLowerCase();
    else if (a === "--name") out.name = String(argv[++i] || "").trim() || "Administrador";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pass = (process.env.ADMIN_NEW_PASSWORD || "").trim();

if (!args.email) {
  console.error("Falta --email <correo-del-admin>.\n  Ej.: ADMIN_NEW_PASSWORD='...' node scripts/set-admin.mjs --email tu@email.com");
  process.exitCode = 1;
} else if (pass.length < 8) {
  console.error("Define ADMIN_NEW_PASSWORD con al menos 8 caracteres (es la contraseña del admin).");
  process.exitCode = 1;
} else {
  const conn = await createConnection();
  try {
    const [u] = await conn.query(
      "select email, role from br_users where email = ? limit 1",
      [args.email],
    );
    if (u.length) {
      await conn.query(
        "update br_users set role = 'admin', status = 'activo', pass_hash = ? where email = ?",
        [await hashPassword(pass), args.email],
      );
      console.log(`✓ ${args.email} promocionado a ADMIN (era ${u[0].role}). Contraseña actualizada.`);
    } else {
      const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await conn.query(
        "insert into br_users (id, name, email, pass_hash, role, status, created_at) values (?, ?, ?, ?, 'admin', 'activo', ?)",
        [id, args.name, args.email, await hashPassword(pass), Date.now()],
      );
      console.log(`✓ Administrador ${args.email} CREADO.`);
    }
    const [admins] = await conn.query("select email from br_users where role = 'admin'");
    console.log("Administradores ahora:", admins.map((r) => r.email).join(", "));
    console.log("\nYa puedes borrar admin@local.dev con seguridad:\n  node scripts/cleanup-demos.mjs --apply --email admin@local.dev");
  } catch (err) {
    console.error("ABORTADO:", err?.message || err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}
