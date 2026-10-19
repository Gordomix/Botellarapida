#!/usr/bin/env node
/**
 * Migrador de base de datos para despliegue (MySQL).
 *
 * Aplica los `.sql` pendientes de ../migrations sobre la BD del entorno, cada
 * fichero en su propia transacción y registrado en `_migrations`, de modo que
 * corre una sola vez y es seguro re-ejecutarlo en cada deploy.
 *
 * La lectura no es recursiva, así que `migrations/<subcarpeta>/` queda fuera.
 *
 * Sin variables de conexión -> avisa y sale 0 (permite construir una app sin BD
 * configurada todavía; el servidor aplica las mismas migraciones al arrancar).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pendingMigrations } from "./migration-plan.mjs";
import { createConnection, ensureDatabase, hasDbConfig, mysqlConfig, projectRoot } from "./mysql-connection.mjs";

if (!hasDbConfig()) {
  console.log(
    "[migrate] sin configuración de MySQL (MYSQL_HOST/MYSQL_DATABASE o DATABASE_URL) — omitido.",
  );
  process.exit(0);
}

const migrationsDir = join(projectRoot, "migrations");
const cfg = mysqlConfig();

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no hay carpeta migrations/ — nada que hacer.");
    return;
  }
  // Una app sin schema propio no debe pagar ni una conexión a la BD.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] sin migraciones — nada que hacer.");
    return;
  }

  // Crea la BD si falta: permite arrancar de cero (XAMPP recién instalado) sin
  // phpMyAdmin. Best-effort; si ya existe o no hay permiso, sigue adelante.
  await ensureDatabase();

  const conn = await createConnection();
  try {
    await conn.query(
      "create table if not exists _migrations (" +
        "name varchar(191) not null primary key, " +
        "applied_at datetime not null default current_timestamp)",
    );
    const [appliedRows] = await conn.query("select name from _migrations");
    const applied = appliedRows.map((r) => r.name);

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const sql = await readFile(join(migrationsDir, name), "utf8");
      try {
        await conn.beginTransaction();
        // multipleStatements: el fichero entero va en una sola ida.
        await conn.query(sql);
        await conn.query("insert into _migrations (name) values (?)", [name]);
        await conn.commit();
      } catch (err) {
        await conn.rollback().catch(() => undefined);
        console.error(`[migrate] error aplicando ${name}`);
        throw err;
      }
      console.log(`[migrate] aplicado ${name}`);
      count += 1;
    }
    console.log(
      count ? `[migrate] listo — ${count} migración(es) aplicada(s).` : "[migrate] al día.",
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(
    `[migrate] fallo con la BD ${cfg.database}@${cfg.host}:${cfg.port}:`,
    err?.message || err,
  );
  // Los errores de MySQL llevan el contexto necesario para depurar un .sql.
  for (const key of ["code", "errno", "sqlMessage", "sqlState"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
