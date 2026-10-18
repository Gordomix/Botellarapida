-- 0015_email_verification.sql — confirmación de email en altas con contraseña.
--
-- `br_users.email_verified`: 1 = confirmado. DEFAULT 1 a propósito: las cuentas
-- YA existentes (admin sembrado, clientes de prueba, altas por Google) NO se
-- ven afectadas por la nueva norma — nadie queda bloqueado al desplegar. Las
-- altas NUEVAS por formulario entran con 0 SOLO si hay SMTP configurado; en
-- local sin SMTP (XAMPP) se insertan con 1 para no romper el flujo de prueba.
--
-- Token de un solo uso con caducidad, mismo patrón que `br_password_resets`:
-- se guarda solo el hash sha256 (la BD jamás revela el enlace en claro). PK por
-- email: pedir un enlace nuevo reemplaza al anterior (nunca coexisten dos).

alter table br_users add column email_verified tinyint(1) not null default 1;

create table if not exists br_email_verifications (
  email varchar(191) not null primary key,
  token_hash char(64) not null,
  expires_at bigint not null,
  created_at bigint not null,
  key idx_email_verif_expires (expires_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
