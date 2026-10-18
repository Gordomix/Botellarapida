-- 0033: SEGURIDAD DE ACCESOS — IP + dispositivo en cada login, bloqueo total
-- por IP (ban/unban exigente 2FA) y registro de dispositivos conocidos para
-- avisar de accesos nuevos. TODO ADITIVO: columnas nuevas opcionales y tablas
-- nuevas. El login y el pedido funcionan EXACTAMENTE igual que antes aunque
-- estas columnas/tablas aún no existan: el servidor lo tolera (fail-open) y
-- sigue, para no romper nunca un acceso legítimo ni el arranque en Render/TiDB.

-- 1) IP y navegador/sistema de cada sesión y de cada intento de login.
--    Son NULL por defecto: los accesos anteriores quedan sin dato (no se puede
--    reconstruir). REGLA TiDB (ver 0031): una columna por ALTER y los índices en
--    un ALTER aparte; si no, TiDB falla con «column does not exist» y tumba el
--    arranque de la BD entera.
alter table br_sessions add column ip varchar(64) null;

alter table br_sessions add column user_agent varchar(512) null;

alter table br_login_attempts add column ip varchar(64) null;

alter table br_login_attempts add column user_agent varchar(512) null;

-- Índice para el panel: ver rápido las IPs que una cuenta ha usado (detector de
-- «muchas IPs = ataque» y poder banearlas desde ahí). ALTER separado del ADD.
alter table br_login_attempts add key idx_attempt_ip (ip);

-- 2) Lista de IPs BANEADAS (bloqueo total: no entra, no pide, no usa el panel).
--    `actor` y `note` dan trazabilidad de quién bloqueó y por qué. La IP viaja
--    como texto plano (es la clave de búsqueda), nunca como hash.
create table if not exists br_ip_bans (
  ip varchar(64) not null primary key,
  created_at bigint not null,
  actor varchar(191) not null,
  note varchar(512) not null default ''
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- 3) Dispositivos ya vistos por cada cuenta (email + IP). Sirve para detectar el
--    PRIMER acceso desde un equipo/red desconocido y avisar por correo +
--    campanita («se ha iniciado sesión desde X; si no has sido tú, cambia tu
--    contraseña»). Sin esta tabla el aviso simplemente nunca se dispara y nada
--    más cambia.
create table if not exists br_user_devices (
  email varchar(191) not null,
  ip varchar(64) not null,
  user_agent varchar(512) not null default '',
  first_seen bigint not null,
  last_seen bigint not null,
  primary key (email, ip)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
