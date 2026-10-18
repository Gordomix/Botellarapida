-- Botella Rápida — registro de auditoría (blindaje Fase 2).
--
-- Traza las acciones SENSIBLES del panel (y los accesos de admin): quién,
-- qué, sobre qué objetivo y cuándo. Es una bitácora append-only: la app
-- nunca borra filas de aquí (solo el administrador con acceso físico a la
-- BD podría podar por antigüedad). Si la inserción fallase, la operación
-- auditada NO se rompe (el helper `audit` es best-effort por diseño).
--
-- Collate `utf8mb4_unicode_ci` como todo el esquema (MariaDB/XAMPP + MySQL
-- hosting). `created_at` en epoch ms, igual que el resto del modelo.

create table if not exists br_audit (
  id varchar(64) not null primary key,
  -- Email del actor (admin que actuó) o "sistema" para eventos propios.
  actor varchar(191) not null,
  -- Acción estable y legible: "login.admin", "usuario.estado", ...
  action varchar(96) not null,
  -- Sobre qué: email objetivo, id de pedido/producto, código...
  target varchar(191) not null default '',
  -- Detalles JSON (nunca secretos ni tokens).
  meta text null,
  created_at bigint not null,
  key idx_audit_created (created_at),
  key idx_audit_actor (actor)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
