-- 0016_customer_locations.sql — seguimiento BIDIRECCIONAL (cliente → repartidor).
--
-- El cliente puede elegir compartir SU ubicación en la pantalla de seguimiento
-- (permiso explícito del navegador, y solo mientras el pedido está EN JUEGO).
-- Así el repartidor ve dónde está realmente el cliente para llegar antes, y el
-- admin ve a ambos. Es el espejo de `br_courier_locations` pero por pedido.
--
-- Una sola fila por pedido (PK `order_id`, upsert): SIN histórico, caduca a los
-- 10 min igual que la del repartidor. Nadie la lee en público: `br-server`
-- autoriza contra la sesión (dueño del pedido, repartidor asignado o admin).
-- `lat`/`lng` decimal(9,6) ~11 cm; `updated_at` en epoch ms.

create table if not exists br_customer_locations (
  order_id varchar(64) not null primary key,
  lat decimal(9,6) not null,
  lng decimal(9,6) not null,
  accuracy_m int not null default 0,
  updated_at bigint not null,
  key idx_cust_loc_updated (updated_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
