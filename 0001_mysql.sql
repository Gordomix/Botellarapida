-- Botella Rápida — esquema MySQL (unica fuente de verdad del schema).
--
-- MySQL 5.7 / 8.0 y MariaDB, InnoDB + utf8mb4_unicode_ci. Se usa esa collation (y
-- no la de MySQL 8 utf8mb4_0900_ai_ci) a proposito: es la unica que entienden por
-- igual MariaDB (el que trae XAMPP en local) y los MySQL de hosting compartido, así
-- el mismo fichero corre en tu PC y en el servidor sin tocar nada. Las columnas
-- indexadas se declaran como VARCHAR(191): es el maximo que cabe en el limite de
-- clave de 767 bytes de MySQL 5.7. Las que no van en indice (direccion, nombre de
-- producto) admiten 512.
--
-- Los numeros de tiempo se guardan como epoch milis (BIGINT), igual que el
-- modelo de datos de la app (src/data/types.ts): evita convertir zonas horarias
-- entre la BD y el navegador.
--
-- `br_sessions` guarda el token de sesion (hash SHA-256) del login propio por
-- email/contrasena: ya no existe Better Auth ni tablas de OAuth que mantener.

create table if not exists br_users (
  id varchar(64) not null primary key,
  name varchar(191) not null,
  email varchar(191) not null,
  pass_hash varchar(255) not null,
  role enum('user','repartidor','admin') not null default 'user',
  status enum('activo','solicitud','rechazado','suspendido') not null default 'activo',
  dni varchar(32) null,
  vehicle varchar(32) null,
  created_at bigint not null,
  unique key uq_users_email (email),
  unique key uq_users_dni (dni)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_sessions (
  token_hash char(64) not null primary key,
  user_email varchar(191) not null,
  role enum('user','repartidor','admin') not null,
  created_at bigint not null,
  expires_at bigint not null,
  key idx_sessions_email (user_email),
  key idx_sessions_expires (expires_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_orders (
  id varchar(64) not null primary key,
  code varchar(32) not null,
  customer varchar(191) not null,
  customer_name varchar(191) not null,
  subtotal decimal(10, 2) not null,
  shipping_cost decimal(10, 2) not null,
  tip decimal(10, 2) not null default 0,
  total decimal(10, 2) not null,
  payment_method enum('tarjeta','bizum','apple_google_pay','efectivo') not null,
  delivery_slot enum('inmediata','programada_hoy','programada_noche') not null,
  address varchar(512) not null,
  phone varchar(64) not null,
  notes text null,
  status enum('pendiente','asignado','en_reparto','entregado','cancelado') not null default 'pendiente',
  courier varchar(191) null,
  created_at bigint not null,
  unique key uq_orders_code (code),
  key idx_orders_status (status),
  key idx_orders_customer (customer),
  key idx_orders_courier (courier),
  key idx_orders_created (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_order_items (
  id bigint not null auto_increment primary key,
  order_id varchar(64) not null,
  product_id varchar(191) not null,
  name varchar(512) not null,
  qty int not null,
  price decimal(10, 2) not null,
  key idx_items_order (order_id),
  constraint fk_items_order foreign key (order_id) references br_orders (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_order_history (
  id bigint not null auto_increment primary key,
  order_id varchar(64) not null,
  at bigint not null,
  actor varchar(191) not null,
  what varchar(512) not null,
  key idx_history_order (order_id),
  constraint fk_history_order foreign key (order_id) references br_orders (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_claims (
  id varchar(64) not null primary key,
  order_code varchar(32) not null default '',
  email varchar(191) not null,
  type varchar(64) not null,
  text text not null,
  status enum('abierta','resuelta') not null default 'abierta',
  answer text null,
  created_at bigint not null,
  key idx_claims_status (status),
  key idx_claims_email (email)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_support_messages (
  id varchar(64) not null primary key,
  email varchar(191) not null,
  text text not null,
  answer text null,
  status enum('abierto','respondido') not null default 'abierto',
  created_at bigint not null,
  key idx_messages_status (status),
  key idx_messages_email (email)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

create table if not exists br_custom_products (
  id varchar(64) not null primary key,
  payload json not null,
  created_at bigint not null,
  key idx_custom_created (created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
