#!/usr/bin/env node
/**
 * Backup diario de la base de datos (Fase 2 «ultra seguridad»).
 *
 * Vuelca la BD completa con `mysqldump` a `.backups/<db>-AAAA-MM-DD-HHMM.sql.gz`
 * (gzip en vuelo, sin ficheros intermedios sin comprimir) y recorta la carpeta
 * a los 14 backups más recientes. La contraseña NUNCA va por la línea de
 * comandos (sería visible en el monitor de procesos): viaja por la variable
 * `MYSQL_PWD` del entorno del subproceso.
 *
 * Uso:  npm run backup:db                (manual o planificador)
 *       mysqldump fuera del PATH -> probar con MYSQLDUMP_BIN=/ruta/mysqldump
 *       (en XAMPP: C:\xampp\mysql\bin\mysqldump.exe).
 *
 * Sin configuración de MySQL sale 0 avisando (igual que `migrate.mjs`: un
 * despliegue sin BD todavía no rompe el planificador de backups).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { hasDbConfig, mysqlConfig, projectRoot } from "./mysql-connection.mjs";

const KEEP = 14; // retención: dos semanas de backups diarios

if (!hasDbConfig()) {
  console.log("[backup] sin configuración de MySQL — nada que respaldar.");
  process.exit(0);
}

const cfg = mysqlConfig();

/** Busca el binario: MYSQLDUMP_BIN -> PATH -> ubicaciones típicas de XAMPP. */
async function findDumpBin() {
  const { spawnSync } = await import("node:child_process");
  const candidates = [
    process.env.MYSQLDUMP_BIN,
    "mysqldump",
    "C:\\xampp\\mysql\\bin\\mysqldump.exe",
    "/usr/bin/mysqldump",
    "/usr/local/bin/mysqldump",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (bin.includes("\\") || bin.startsWith("/")) {
      // Ruta absoluta: se comprueba dejándola ejecutar al spawn real abajo.
      return bin;
    }
    const probe = spawnSync(bin, ["--version"], { shell: process.platform === "win32" });
    if (probe.status === 0) return bin;
  }
  return "mysqldump"; // último intento: que el error lo reporte el spawn real
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, (c) => (c === "T" ? "-" : c));
const backupsDir = join(projectRoot, ".backups");
await mkdir(backupsDir, { recursive: true });
// El nombre se fija antes de volcar: patrón <db>-*.sql.gz dentro de .backups/
const outFile = join(backupsDir, `${cfg.database}-${stamp}.sql.gz`);

const bin = await findDumpBin();
const args = [
  `--host=${cfg.host}`,
  `--port=${cfg.port}`,
  `--user=${cfg.user}`,
  "--single-transaction", // BD InnoDB consistente sin bloquear la app
  "--routines",
  "--triggers",
  "--events",
  "--default-character-set=utf8mb4",
  cfg.database,
];

console.log(`[backup] volcando ${cfg.database}@${cfg.host}:${cfg.port} → ${outFile}`);
const dump = spawn(bin, args, {
  env: { ...process.env, MYSQL_PWD: cfg.password }, // la clave por entorno, no por argv
  windowsHide: true,
});
dump.stderr.on("data", (b) => process.stderr.write(`[mysqldump] ${b}`));

const gzip = createGzip();
const sink = createWriteStream(outFile);
try {
  await pipeline(dump.stdout, gzip, sink);
} catch (err) {
  await rm(outFile, { force: true });
  console.error("[backup] fallo durante el volcado:", err?.message || err);
  process.exit(1);
}
if (dump.exitCode !== 0) {
  await rm(outFile, { force: true });
  console.error(`[backup] mysqldump terminó con código ${dump.exitCode}.`);
  process.exit(1);
}

/** Recorta a los KEEP más recientes (orden lexicográfico = orden temporal). */
const files = (await readdir(backupsDir)).filter((f) => f.endsWith(".sql.gz")).sort();
for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
  const dead = join(backupsDir, old);
  // El obsoleto no se borra a lo bruto: se marca, por si alguien lo necesita.
  await rename(dead, join(backupsDir, `${old}.expired`)).catch(() => undefined);
  await rm(join(backupsDir, `${old}.expired`), { force: true });
  console.log(`[backup] purgado ${old}`);
}

const size = (await import("node:fs")).statSync(outFile).size;
console.log(`[backup] listo — ${(size / 1024).toFixed(1)} KB gzip, retenidos ${Math.min(files.length, KEEP)}.`);
