-- Botella Rápida — código maestro de acceso (emergencia 2FA del equipo).
--
-- Puramente aditiva: UNA tabla nueva con UNA fila como mucho. Si la tabla
-- está vacía, el 2FA y el login se comportan EXACTAMENTE igual que siempre.
--
-- Es un segundo factor COMPARTIDO de emergencia: si la app autenticadora
-- falla (móvil perdido, reloj desincronizado) o la situación se tuerce (p. ej.
-- contraseña comprometida mientras se cambia), las personas del equipo que
-- conozcan el código pueden entrar en el panel escribiéndolo en el paso del
-- código, junto a la contraseña de admin.
--
-- Aquí solo vive el hash SHA-256 del código (nunca el código en claro), como
-- con las contraseñas y los códigos de respaldo. Collate `utf8mb4_unicode_ci`
-- como todo el esquema (MariaDB/XAMPP + MySQL hosting).

create table if not exists br_master_code (
  -- Fija 1: es una tabla de un solo valor (upsert `on duplicate key update`).
  id tinyint unsigned not null primary key,
  code_hash char(64) not null,
  -- Epoch ms del último giro del código (para mostrar «rotado hace X» en el panel).
  updated_at bigint not null
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
