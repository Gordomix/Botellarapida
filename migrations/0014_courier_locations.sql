-- 0014_courier_locations.sql — seguimiento en vivo del reparto (Paso 4).
--
-- Última posición CONOCIDA de cada repartidor: la propia app del repartidor,
-- Consentimiento implícito: el GPS solo se comparte mientras hay un reparto
-- activo en su portal (`/repartidor`), y el botón de compartir lo autoriza él.
-- Nadie lee esta tabla en público: `br-server` autoriza contra `br_sessions` y
-- solo muestra la posición al dueño del pedido, al repartidor asignado y al
-- admin (mismo patrón que el chat de `0003_chat.sql`).
--
-- `lat`/`lng` decimal(9,6): resolución ~11 cm, de sobra para una entrega.
-- `updated_at` en epoch ms (mismo formato que el resto del esquema).
-- Collate `utf8mb4_unicode_ci`: compatible con MariaDB (XAMPP) y MySQL hosting.

create table if not exists br_courier_locations (
  -- Una sola fila por repartidor (upsert): solo nos interesa el último fix.
  courier_email varchar(191) not null primary key,
  lat decimal(9,6) not null,
  lng decimal(9,6) not null,
  -- Precisión del GPS en metros (la manda el navegador; 0 = desconocida).
  accuracy_m int not null default 0,
  -- Reparto que llevaba asignado en ese fix (null si era un ping suelto).
  order_id varchar(64) null,
  updated_at bigint not null,
  -- Índice para el panel de admin (listar posiciones frescas por fecha).
  key idx_loc_updated (updated_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
