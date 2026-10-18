-- Botella Rápida — verificación en dos pasos (TOTP) para cuentas admin.
--
-- Columnas NUEVAS y OPCIONALES en `br_users` (migración puramente aditiva:
-- las cuentas existentes quedan con `totp_enabled = 0` y su login no cambia
-- en absoluto; el segundo factor solo afecta a quien lo activa).
--
--   * `totp_secret`   secreto Base32 (RFC 4648) del generador de códigos.
--   * `totp_enabled`  1 una vez que el admin CONFIRMA un código válido.
--   * `totp_recovery` JSON con los hash SHA-256 de los códigos de respaldo
--                     (por si pierde el móvil; se muestran una sola vez).
--
-- Cada `ALTER` va en su propia sentencia: `mysql2` con `multipleStatements`
-- las ejecuta en orden y la migración completa se registra una sola vez.

alter table br_users add column totp_secret varchar(64) null;

alter table br_users add column totp_enabled tinyint(1) not null default 0;

alter table br_users add column totp_recovery text null;
