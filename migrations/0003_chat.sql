-- Botella Rápida — chat por pedido (cliente ↔ repartidor ↔ admin/soporte).
--
-- Una conversación por PEDIDO. Nadie envía su identidad desde el navegador:
-- `br-server` autoriza con el token de sesión (`br_sessions`) y solo deja leer
-- o escribir al dueño del pedido, al repartidor asignado y al admin. Esto es lo
-- que sustituye al WhatsApp: el número real nunca se comparte (privacidad +
-- anti-fraude), todo queda registrado en la app.
--
-- Collate `utf8mb4_unicode_ci`: compatible con MariaDB (XAMPP) y MySQL hosting.
-- `created_at` en epoch ms (mismo formato que el resto del esquema).

create table if not exists br_chat_messages (
  id varchar(64) not null primary key,
  order_id varchar(64) not null,
  -- email verificado en servidor desde la sesión; nunca lo manda el cliente.
  sender_email varchar(191) not null,
  sender_name varchar(191) not null,
  sender_role varchar(16) not null,
  body text not null,
  created_at bigint not null,
  -- índice para cargar el hilo ordenado y para el throttle anti-spam.
  key idx_chat_order (order_id, created_at),
  key idx_chat_sender_time (sender_email, created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
