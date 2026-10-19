-- Botella Rápida — guard contra fuerza bruta en el inicio de sesión.
--
-- Registra intentos de login para bloquear temporalmente un email tras
-- varios fallos seguidos (robo de cuentas / credential stuffing). El control
-- es SIEMPRE en servidor y es "fail-open": si algo de esta tabla fallase,
-- `login()` deja pasar (nunca rompe un acceso legítimo).
--
--   * Solo importan las filas `ok = 0` (fallos) dentro de la ventana.
--   * Un login correcto borra los fallos de ese email (se "resetea" el contador).
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). `created_at`
-- en epoch ms, igual que el resto del esquema.

create table if not exists br_login_attempts (
  id bigint not null auto_increment primary key,
  email varchar(191) not null,
  -- 1 = intento correcto, 0 = fallo (contraseña mal / usuario inexistente).
  ok tinyint(1) not null,
  created_at bigint not null,
  key idx_attempt_email_time (email, created_at),
  key idx_attempt_time (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
