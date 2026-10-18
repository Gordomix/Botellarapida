-- Botella Rápida — recuperación de contraseña ("¿Has olvidado tu contraseña?").
--
-- Guardamos SOLO el hash sha256 del token de un solo uso: la BD no revela el
-- enlace en claro, y un token sirve una vez (`used`) hasta caducar (`expires_at`).
-- Pedir un nuevo enlace invalida los anteriores del mismo email (se borran),
-- así nunca coexisten varias rutas abiertas.
--
-- `token_hash` único (char(64)) y `email` indexado para la ventana anti-spam.
-- `created_at`/`expires_at` en epoch ms, igual que el resto del esquema.
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL del hosting).

create table if not exists br_password_resets (
  id bigint not null auto_increment primary key,
  email varchar(191) not null,
  token_hash char(64) not null,
  expires_at bigint not null,
  -- 1 = ya se usó para cambiar la contraseña (no vale dos veces).
  used tinyint(1) not null default 0,
  created_at bigint not null,
  unique key uq_reset_token (token_hash),
  key idx_reset_email_time (email, created_at),
  key idx_reset_time (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
