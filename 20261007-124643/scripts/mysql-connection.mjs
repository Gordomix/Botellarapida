// @ts-check
/**
 * Conexión MySQL compartida por los scripts de CLI (`migrate.mjs`, `seed.mjs`).
 *
 * Es el equivalente en JS puro de `src/lib/db.ts`, que no puede importarse desde
 * un `.mjs` de Node a pelo. La lectura de `.env` es mínima (KEY=VAL, sin
 * subprocesos ni variables de entorno interpoladas) para no depender de `dotenv`:
 * en despliegues reales las variables las inyecta el proveedor y este loader
 * simplemente no encuentra fichero y las respeta.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let dotenvDone = false;

/** Carga `/.env` de la raiz del proyecto una sola vez, sin pisar el entorno. */
export function loadDotenv(root = projectRoot) {
  if (dotenvDone) return;
  dotenvDone = true;
  let text;
  try {
    text = readFileSync(join(root, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Lee una variable de entorno tratando vacio/espacios como "no definida". */
export function env(key, root) {
  loadDotenv(root);
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}

/**
 * Parámetros de conexión: `DATABASE_URL` (`mysql://user:pass@host:port/db`) o
 * variables `MYSQL_*` separadas, que mandan si están presentes.
 *
 * @param {string} [root]
 * @returns {{host: string, port: number, user: string, password: string, database: string}}
 */
export function mysqlConfig(root) {
  const url = env("DATABASE_URL", root);
  /** @type {Partial<ReturnType<typeof mysqlConfig>>} */
  let parsed = {};
  if (url && /^mysql/i.test(url)) {
    const u = new URL(url);
    parsed = {
      host: decodeURIComponent(u.hostname),
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    };
  }
  return {
    host: env("MYSQL_HOST", root) ?? parsed.host ?? "127.0.0.1",
    port: Number(env("MYSQL_PORT", root) ?? parsed.port ?? 3306),
    user: env("MYSQL_USER", root) ?? parsed.user ?? "root",
    password: env("MYSQL_PASSWORD", root) ?? parsed.password ?? "",
    database: env("MYSQL_DATABASE", root) ?? parsed.database ?? "br_app",
  };
}

/** True si el entorno define alguna variable de conexión. */
export function hasDbConfig(root) {
  return Boolean(
    env("MYSQL_DATABASE", root) || env("MYSQL_HOST", root) || env("DATABASE_URL", root),
  );
}

/** Crea un pool mysql2 de un solo uso (los CLI no necesitan más). */
export async function createConnection(root) {
  const mysql = await import("mysql2/promise");
  const cfg = mysqlConfig(root);
  return mysql.createConnection({
    ...cfg,
    multipleStatements: true,
    supportBigNumbers: true,
    decimalNumbers: true,
  });
}

/** Conexión al servidor sin seleccionar BD (para poder crearla si falta). */
export async function createBareConnection(root) {
  const mysql = await import("mysql2/promise");
  const { database, ...rest } = mysqlConfig(root);
  return mysql.createConnection({
    ...rest,
    multipleStatements: true,
    supportBigNumbers: true,
    decimalNumbers: true,
  });
}

/**
 * Crea la base de datos si no existe. Es lo que permite que `npm run db:migrate`
 * funcione de cero en local (XAMPP/MySQL recién instalado) sin abrir phpMyAdmin.
 *
 * Es best-effort: en un hosting administrado la BD ya viene hecha y el usuario
 * quizá no tenga permiso `CREATE DATABASE`; en ese caso no abortamos, el paso
 * siguiente (conectar a la BD real) reportará el error que de verdad importe.
 */
export async function ensureDatabase(root) {
  const { database } = mysqlConfig(root);
  let conn;
  try {
    conn = await createBareConnection(root);
    await conn.query(
      `create database if not exists \`${database}\` character set utf8mb4 collate utf8mb4_unicode_ci`,
    );
    console.log(`[db] base de datos '${database}' verificada/creada.`);
  } catch (err) {
    console.warn(
      `[db] no se pudo crear la BD (probablemente ya existe o sin permiso): ${err?.message || err}`,
    );
  } finally {
    await conn?.end?.();
  }
}

/**
 * Hash de contraseña compatible con `src/lib/br-server.ts` (scrypt de
 * `node:crypto`, formato `scrypt$salt$hex`). Sin módulos nativos: compila e
 * instala igual en Windows, macOS y el VPS.
 *
 * @param {string} password
 * @param {string} [existing] reutiliza la sal si ya hay hash (no se usa en CLI)
 * @returns {Promise<string>}
 */
export async function hashPassword(password, existing) {
  const { randomBytes, scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const salt = existing?.split("$")[1] ?? randomBytes(16).toString("hex");
  const derived = await promisify(scrypt)(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
