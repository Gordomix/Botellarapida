-- 0026: CHAPAS — programa de fidelización (todo ADITIVO: tablas nuevas,
-- ninguna columna tocada en las existentes). Nace APAGADO (`enabled = 0`): sin
-- que el admin lo configure, el apartado público avisa de que "todavía no está
-- disponible" y las órdenes existentes no suman chapas (el reparto no cambia).
--
-- Mecánica: al ENTREGARSE un pedido, el cliente acumula chapas según lo gastado
-- y el pack. El admin decide cuántas chapas da cada producto (override por
-- producto; si no hay, se usa la tasa base por € gastado). Con las chapas
-- acumuladas puede canjear "ofertas" que publica el admin (regalos/productos
-- entregables en el siguiente pedido), en vez de pagar con dinero.
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas epoch ms.

create table if not exists br_chapa_config (
  id tinyint unsigned not null primary key,
  enabled tinyint(1) not null default 0,
  title varchar(120) not null default 'Chapas Botella Rápida',
  subtitle varchar(240) not null default 'Acumula chapas con cada compra y cámbialas por regalos.',
  how_it_works text null,
  redeem_note varchar(400) null,
  -- Chapas por euro gastado (base, cuando el producto no tiene chapa propia).
  earn_per_euro decimal(6,2) not null default 1,
  updated_at bigint not null default 0
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Chapa fija por producto (override del admin). Sin fila = usa la base por €.
create table if not exists br_chapa_products (
  product_id varchar(64) not null primary key,
  -- Chapas por unidad pedida de este producto (≥ 0).
  chapas int not null default 0,
  updated_at bigint not null
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Saldo actual por cliente (cache derivada del libro; la fuente es br_chapa_ledger).
create table if not exists br_chapa_balances (
  customer varchar(190) not null primary key,
  balance int not null default 0,
  updated_at bigint not null
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Libro de movimientos (auditoría de cada suma/resto de chapas).
create table if not exists br_chapa_ledger (
  id varchar(64) not null primary key,
  customer varchar(190) not null,
  -- con signo: + acumula, − canje/ajuste.
  delta int not null,
  reason varchar(160) not null default '',
  ref varchar(64) null,
  created_at bigint not null,
  key idx_chapa_ledger_customer (customer, created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Ofertas de canje publicadas por el admin (se pagan en chapas, no en €).
create table if not exists br_chapa_rewards (
  id varchar(64) not null primary key,
  title varchar(160) not null,
  description varchar(400) null,
  image varchar(600) null,
  -- chapas que cuesta el canje (> 0).
  cost int not null default 10,
  -- -1 = stock ilimitado; 0 o más = unidades disponibles.
  stock int not null default -1,
  -- Producto del catálogo asociado (se entrega en el siguiente pedido), opcional.
  product_id varchar(64) null,
  active tinyint(1) not null default 1,
  sort int not null default 0,
  created_at bigint not null,
  key idx_chapa_reward_active (active, sort)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Canjes solicitados por los clientes (el admin los gestiona y entrega).
create table if not exists br_chapa_redemptions (
  id varchar(64) not null primary key,
  code varchar(32) not null default '',
  customer varchar(190) not null,
  customer_name varchar(120) not null default '',
  reward_id varchar(64) not null,
  reward_title varchar(160) not null default '',
  cost int not null default 0,
  status enum('pendiente','entregado','cancelado') not null default 'pendiente',
  created_at bigint not null,
  key idx_chapa_red_customer (customer, created_at),
  key idx_chapa_red_status (status)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
