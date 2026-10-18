-- 0020: reseñas de clientes (privadas por defecto, el admin decide si se
-- publican) y donaciones «Apóyanos». Todo ADITIVO: dos tablas nuevas, ninguna
-- columna tocada en tablas existentes.

create table if not exists br_reviews (
  id varchar(64) not null primary key,
  -- Pedido entregado que originó la reseña (se guarda también el código legible
  -- para pintar la tarjeta sin joins).
  order_id varchar(64) not null,
  order_code varchar(32) not null default '',
  customer varchar(190) not null,
  customer_name varchar(120) not null default '',
  -- 1..5; se valida en servidor, la columna es pequeña a propósito.
  stars tinyint not null default 5,
  body varchar(600) not null default '',
  -- Foto del cliente como data URL corto (mediumtext por si pesa ~500 KB).
  photo mediumtext null,
  -- Nace 'privada': nada visible hasta que el admin la publica.
  status enum('privada','publicada') not null default 'privada',
  created_at bigint not null,
  -- Un cliente no puede reseñar dos veces el mismo pedido.
  unique key uq_reviews_order_customer (order_id, customer),
  key idx_reviews_status (status)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_donations (
  id varchar(64) not null primary key,
  customer varchar(190) not null,
  customer_name varchar(120) not null default '',
  -- 1..999 €; es un apoyo registrado, no un cobro (pasarela aún no activada).
  amount decimal(8,2) not null,
  message varchar(200) null,
  created_at bigint not null,
  key idx_donations_created (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
