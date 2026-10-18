import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "mysql2/promise";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";

/**
 * Capa de datos MySQL (server-only). Unica base de datos de la app: usuarios,
 * sesiones, pedidos, reclamaciones, soporte y altas de producto.
 *
 * Nomenclatura: `?` como placeholder (mysql2, no `$1`), filas como objetos,
 * tiempos como epoch milis. Todo acceso desde el navegador pasa por una
 * `createServerFn` (`@/lib/br-api`); este modulo nunca se importa en cliente.
 */

/**
 * Migraciones leidas en tiempo de compilacion.
 *
 * `import.meta.glob` no baja a subdirectorios y encaja con el contrato de
 * `scripts/migrate.mjs` (mismo conjunto de ficheros, misma clave por basename).
 * Inlinar el SQL aqui es lo que hace que el esquema viaje dentro del bundle de
 * produccion: buscar `migrations/` en disco tras el build falla segun donde se
 * arranique el servidor.
 */
const MIGRATION_FILES = import.meta.glob("/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Estado en globalThis: el HMR de Vite re-evalua el modulo en cada guardado. */
const globalRef = globalThis as typeof globalThis & {
  __mysqlPool__?: Promise<Pool>;
  __mysqlMigrate__: Promise<void> | null;
};

/**
 * Fallo reciente de una migración concreta (basename -> epoch ms). Una
 * migración rota NO debe reintentarse en cada petición (tormenta de DDL y log
 * inservible, visto en producción con la 0031): se reintenta como máximo cada
 * MIGRATION_RETRY_MS. Sobrevive al HMR via globalRef.
 */
const MIGRATION_RETRY_MS = 600_000;
const globalFailures = ((
  globalRef as typeof globalThis & {
    __mysqlMigrationFailures?: Map<string, number>;
  }
).__mysqlMigrationFailures ??= new Map<string, number>());

/**
 * Lee `process.env`, cargando antes `/.env` si hace falta.
 *
 * En `vite dev` y `vite build` Vite ya inyecta los `.env` en `process.env`; el
 * servidor de produccion de Nitro no, y ahi es este loader quien lo hace. Solo
 * variables `KEY=VAL` sin comillas anidadas: para secretos, `export` del
 * entorno o el panel del hosting sigue siendo la via recomendada.
 */
let dotenvDone = false;
async function loadDotenv(): Promise<void> {
  if (dotenvDone) return;
  dotenvDone = true;
  // `/.env` es la raiz del proyecto bajo Vite; en el bundle de produccion y en
  // los scripts de CLI el process cwd ya es la raiz desplegada.
  const candidates = ["/.env", ".env", join(process.cwd(), ".env")];
  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, key, rawValue] = m;
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    return;
  }
}

/**
 * Asegura que el `.env` está volcado en `process.env` antes de leer cualquier
 * variable de entorno desde otro módulo server-only (p. ej. el login con
 * Google). Idempotente: solo lee el fichero la primera vez.
 */
export async function ensureEnvLoaded(): Promise<void> {
  await loadDotenv();
}

/** Lee una variable de entorno tratando vacio/espacios como "no definida". */
async function envVar(key: string): Promise<string | undefined> {
  await loadDotenv();
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}

/**
 * Parámetros de conexión. `DATABASE_URL` (tipo `mysql://user:pass@host:port/db`)
 * es la forma compacta que suelen dar los paneles de hosting; las variables
 * separadas `MYSQL_*` mandan sobre ella si están también definidas.
 */
export async function mysqlConfig(): Promise<MysqlConfig> {
  const url = await envVar("DATABASE_URL");
  let parsed: Partial<MysqlConfig> = {};
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
  const cfg: MysqlConfig = {
    host: (await envVar("MYSQL_HOST")) ?? parsed.host ?? "127.0.0.1",
    port: Number((await envVar("MYSQL_PORT")) ?? parsed.port ?? 3306),
    user: (await envVar("MYSQL_USER")) ?? parsed.user ?? "root",
    password: (await envVar("MYSQL_PASSWORD")) ?? parsed.password ?? "",
    database: (await envVar("MYSQL_DATABASE")) ?? parsed.database ?? "br_app",
  };
  // TLS opcional con la base de datos. APAGADO por defecto: XAMPP local y la
  // mayoría de hosts (Koyun, Hetzner) aceptan conexión normal sin cifrar y así
  // el comportamiento es idéntico al de siempre. Actívalo SOLO para servicios
  // que exijan conexión cifrada (p. ej. TiDB Cloud) poniendo en el entorno:
  //   MYSQL_SSL=1          -> verifica el certificado del servidor
  //   MYSQL_SSL=no-verify  -> cifra sin exigir CA (TiDB/hosts con cert self-signed)
  const sslFlag = (await envVar("MYSQL_SSL"))?.toLowerCase();
  if (sslFlag && sslFlag !== "0" && sslFlag !== "false") {
    cfg.ssl =
      sslFlag === "no-verify" || sslFlag === "disable-verify"
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true };
  }
  return cfg;
}

export type MysqlConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: boolean };
};

/** True cuando hay configuración de BD (la app arranca sin ella: ver `query`). */
export async function isDbConfigured(): Promise<boolean> {
  return Boolean(
    (await envVar("MYSQL_DATABASE")) ||
    (await envVar("DATABASE_URL")) ||
    (await envVar("MYSQL_HOST")),
  );
}

/** Pool único por proceso; los cálidos de serverless/PM2 lo reutilizan. */
export async function getDb(): Promise<Pool> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db es server-only: llama a la BD desde una createServerFn o un loader " +
        "de servidor, nunca desde código de cliente.",
    );
  }
  globalRef.__mysqlPool__ ??= (async () => {
    const { createPool } = await import("mysql2/promise");
    const cfg = await mysqlConfig();
    return createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 10,
      // Devuelve BIGINT/DECIMAL como número: el modelo de datos de la app es
      // numérico (created_at en ms, precios en euros).
      supportBigNumbers: true,
      decimalNumbers: true,
      dateStrings: false,
      multipleStatements: true,
    });
  })();
  return globalRef.__mysqlPool__;
}

type DbError = Error & { code?: string; sqlMessage?: string };

/**
 * Los errores de mysql2 traen SQL crudo (tablas, columnas, fragmentos de
 * sentencia): eso NUNCA debe llegar al navegador de un atacante. Se registran
 * completos en el log del servidor y fuera solo sale un mensaje generico,
 * conservando `code` (`ER_DUP_ENTRY`, `ER_NO_SUCH_TABLE`...) porque el codigo
 * de la app decide con el codigo, no con el texto.
 */
function sanitizeDbError(err: unknown): Error {
  const e = err as DbError;
  console.error("[db] error SQL:", e?.sqlMessage || e?.message, "| code:", e?.code);
  const clean: DbError = new Error(
    "El servidor de datos no pudo completar la operación. Inténtalo de nuevo.",
  );
  if (e?.code) clean.code = e.code;
  return clean;
}

/**
 * Espera a que el esquema esté listo antes de la PRIMERA consulta de negocio.
 *
 * En un arranque frío el tráfico puede llegar mientras el bootstrap eager aún
 * está aplicando migraciones: sin esta espera, la primera petición leería una
 * tabla que todavía no existe (`ER_NO_SUCH_TABLE` en las tablas recién
 * añadidas). Es idempotente y sin coste tras la primera llamada (`ensureDbReady`
 * memoiza el promise); sin configuración de BD pasa directo (el error real ya
 * saldrá del pool). `applyMigrations` usa el pool a pelo, nunca `query`, así
 * que aquí no hay deadlock posible.
 */
async function waitSchemaReady(): Promise<void> {
  if (!(await isDbConfigured())) return;
  try {
    await ensureDbReady();
  } catch (err) {
    // Bootstrap de migraciones fallido: SEGUIMOS adelante en vez de convertir
    // el fallo en un error genérico para TODAS las consultas. Una migración
    // rota (p. ej. 0031 sobre TiDB) invalida su función, no el login ni la
    // tienda entera. Si además la BD está inaccesible, la consulta real lo
    // detectará y lanzará el error correspondiente. El fallo ya se registra
    // en el log dentro de applyMigrations/ensureDbReady.
    console.warn("[db] consultas con esquema no verificado:", (err as Error)?.message || err);
  }
}

/**
 * Ejecuta SQL parametrizado y devuelve las filas.
 *
 *   const rows = await query<UserRow>("select * from br_users where email = ?", [email]);
 *
 * En `INSERT/UPDATE/DELETE` mysql2 devuelve un `ResultSetHeader`; si necesitas
 * el `insertId` o `affectedRows`, usa `getDb()` directamente.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await waitSchemaReady();
  const pool = await getDb();
  try {
    const [rows] = await pool.query(sql, params);
    return rows as T[];
  } catch (err) {
    throw sanitizeDbError(err);
  }
}

/** Ejecuta una sentencia de modificación y devuelve la cabecera de resultado. */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ insertId: number; affectedRows: number }> {
  await waitSchemaReady();
  const pool = await getDb();
  try {
    const [res] = await pool.query(sql, params);
    const header = res as { insertId?: number; affectedRows?: number };
    return { insertId: header.insertId ?? 0, affectedRows: header.affectedRows ?? 0 };
  } catch (err) {
    throw sanitizeDbError(err);
  }
}

/**
 * Aplica los `.sql` pendientes de `migrations/` (no recursivo) y los registra en
 * `_migrations` por basename, de forma que un fichero se aplica una sola vez y
 * el arranque es idempotente. Cada fichero va en su propia transacción: si una
 * sentencia falla, el fichero queda sin aplicar y sin registrar.
 *
 * Se llama en el arranque (dev y producción) y desde `scripts/migrate.mjs`.
 *
 * Tolerancia (aprendido en producción): un fichero que falla se registra, se
 * INTENTA SEGUIR con los demás y no lanza. Antes, una sola migración
 * incompatible con el motor de producción (0031 multi-cláusula sobre TiDB)
 * abortaba el bootstrap y dejaba la BD inservible para TODO — login,
 * registros, pedidos. Ahora solo queda afectada la función cuya columna falta
 * (ER_BAD_FIELD_ERROR propio), y el fallo se reintenta como máximo cada
 * MIGRATION_RETRY_MS. Devuelve el número de ficheros aplicados.
 */
export async function applyMigrations(): Promise<number> {
  const pool = await getDb();
  await pool.query(
    "create table if not exists _migrations (" +
      "name varchar(191) not null primary key, " +
      "applied_at datetime not null default current_timestamp)",
  );

  const [appliedRows] = (await pool.query("select name from _migrations")) as [
    { name: string }[],
    unknown,
  ];
  const todo = pendingMigrations(
    Object.keys(MIGRATION_FILES),
    appliedRows.map((r) => r.name),
  );

  let failures = 0;
  for (const { name, path } of todo) {
    const lastFail = globalFailures.get(name);
    if (lastFail && Date.now() - lastFail < MIGRATION_RETRY_MS) {
      failures += 1;
      continue; // ya falló hace poco: no reintentar en cada petición
    }
    const sql = MIGRATION_FILES[path];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(sql);
      await conn.query("insert into _migrations (name) values (?)", [name]);
      await conn.commit();
      globalFailures.delete(name);
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      // OJO: en TiDB/MySQL el DDL se auto-confirma, un rollback NO deshace los
      // ALTER ya ejecutados del fichero. Si una sentencia falla, las anteriores
      // del mismo fichero pueden haber quedado aplicadas: al corregir una
      // migración rota hay que partir de esa realidad (sentencias idempotentes
      // o comprobar el esquema antes de reintentar).
      failures += 1;
      globalFailures.set(name, Date.now());
      console.error(`[db] error aplicando ${name}:`, (err as Error).message);
      continue;
    } finally {
      conn.release();
    }
    console.log(`[db] migración aplicada: ${name}`);
  }
  if (failures > 0) {
    throw new Error(
      `${failures} migración(es) no pudieron aplicarse; la app sigue con las funciones que no dependen de ellas.`,
    );
  }
  return todo.length;
}

let readyPromise: Promise<void> | null = null;

/**
 * Deja la BD lista antes de atender tráfico: aplica migraciones una vez por
 * proceso. Un fallo no se memoiza (el siguiente intento re-intenta), y los
 * llamadas concurrentes comparten el mismo `Promise`.
 */
export function ensureDbReady(): Promise<void> {
  readyPromise ??= applyMigrations()
    .then(() => undefined)
    .catch((err) => {
      readyPromise = null;
      console.error("[db] bootstrap fallido:", err?.message || err);
      throw err;
    });
  return readyPromise;
}

// Arranque eager en Node (producción / SSR). El bundle de cliente nunca llega
// aquí: `query` y `getDb` lanzan en el navegador.
//
// Solo si hay configuración de BD (en el preview/sandbox no la hay) y de forma
// NO letal: si el bootstrap falla se registra y se sigue arrancando, porque el
// error real debe aparecer al atender la petición (`query`), no derribando el
// proceso en tiempo de import.
if (typeof window === "undefined") {
  globalRef.__mysqlMigrate__ ??= (async () => {
    if (!(await isDbConfigured())) {
      console.warn("[db] sin configuración MySQL: se omiten las migraciones de arranque.");
      return;
    }
    await ensureDbReady();
    // Tras dejar el esquema listo, asegura el admin desde el entorno (siempre
    // que ADMIN_EMAIL/ADMIN_PASSWORD existan y no haya ya ninguno). Import
    // dinámico: evita el ciclo estático db <-> br-server y solo corre en Node.
    const { ensureAdminFromEnv } = await import("./br-server");
    await ensureAdminFromEnv();
  })().catch((err) => {
    console.error("[db] bootstrap inicial no completado:", err?.message || err);
  });
}
