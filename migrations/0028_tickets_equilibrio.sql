-- 0028: RULETA POR TICKETS + EQUILIBRIO DE CHAPAS (todo ADITIVO: una tabla
-- nueva y columnas nuevas; ninguna columna existente tocada ni borrada).
--
-- 1) TICKETS DE RULETA. Se acaba el «giros por día»: la ruleta se ve sin
--    cuenta, pero para GIRAR hay que tener un ticket, y los tickets los da la
--    tienda: cada pedido ENTREGADO cuyo total supere `ticket_min_euro` (10 €
--    por defecto) regala 1 ticket al cliente. Un giro CONSUME un ticket
--    (idempotente por pedido: un pedido, como mucho, un ticket). La columna
--    histórica `br_raffle_config.daily_limit` queda obsoleta a propósito: ya
--    no se lee ni se escribe (conservamos la fila por no romper nada).
--
-- 2) EQUILIBRIO DE CHAPAS. El reparto anterior (1 chapa por €) era demasiado
--    genero. La nueva regla vive en `br_chapa_config.euros_per_chapa`:
--    1 chapa por cada 12 € gastados → 100 chapas cuestan ~1200 € de compra.
--    Y en el canje, 100 chapas = 12 € de regalo (10x de margen para la
--    tienda). `br_chapa_rewards.value_euro` guarda el valor en € del regalo:
--    si el admin lo pone (> 0), el coste en chapas se deriva solo con la
--    equivalencia 100 chapas ↔ 12 € (coste = valor × 100/12). Con value_euro
--    a 0 el admin sigue fijando el coste a mano (compatibilidad hacia atrás).
--    `earn_per_euro` queda obsoleta por el mismo motivo: no se toca la fila.
--
-- 3) CHAT DE CANJES. Sin tabla nueva: el chat existente (`br_chat_messages`,
--    keyed por `order_id`) admite como hilo el id de un canje
--    (`br_chapa_redemptions.id`): cliente dueños y admin pueden hablar para
--    coordinar la entrega del regalo.
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas epoch ms.

create table if not exists br_raffle_tickets (
  id varchar(64) not null primary key,
  customer varchar(190) not null,
  -- UN ticket por pedido: el mismo pedido entregado dos veces no duplica.
  order_id varchar(64) not null,
  order_code varchar(32) not null default '',
  created_at bigint not null,
  -- null = ticket sin usar (da derecho a UN giro).
  used_at bigint null,
  entry_id varchar(64) null,
  unique key uq_raffle_ticket_order (order_id),
  key idx_raffle_ticket_cust (customer, used_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

alter table br_raffle_config add column ticket_min_euro decimal(8,2) not null default 10;
alter table br_chapa_config add column euros_per_chapa decimal(6,2) not null default 12;
alter table br_chapa_rewards add column value_euro decimal(8,2) not null default 0;
