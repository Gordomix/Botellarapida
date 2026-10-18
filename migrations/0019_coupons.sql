-- 0019_coupons.sql — cupones de descuento y códigos de afiliado.
--
-- Tabla `br_coupons`: el admin crea y gestiona códigos (premio de primera
-- compra, campañas, % para creadores de contenido). `kind` distingue descuento
-- en % ('percent') o en € ('fixed'); `affiliate` marca los códigos de afiliado
-- para listarlos aparte en el panel. Nunca se fía del navegador: `createOrder`
-- valida el código aquí y recalcula el descuento en servidor.
--
-- `amount`: € (fixed) o % 1–100 (percent). `max_uses` 0 = ilimitado.
-- `expires_at` epoch ms, null = sin caducidad. Collate utf8mb4_unicode_ci.

create table if not exists br_coupons (
  id varchar(64) not null primary key,
  -- Código único legible (p. ej. 'BIENVENIDO10'); se guarda en mayúsculas.
  code varchar(64) not null,
  kind enum('percent','fixed') not null default 'percent',
  amount decimal(10,2) not null,
  min_order decimal(10,2) not null default 0,
  -- 1 = solo válido para el primer pedido del cliente (prepago/primera compra).
  first_only tinyint(1) not null default 0,
  -- 1 = código de afiliado (creadores de contenido); se atribuye el pedido.
  affiliate tinyint(1) not null default 0,
  affiliate_name varchar(120) null,
  active tinyint(1) not null default 1,
  max_uses int not null default 0,
  used_count int not null default 0,
  expires_at bigint null,
  created_at bigint not null,
  unique key uq_coupons_code (code),
  key idx_coupons_active (active)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Columnas NUEVAS en br_orders con default: no afectan a pedidos existentes.
-- `discount` = € descontados por cupón; `coupon_code` = código aplicado (nulo
-- si no lleva); `night_surcharge` = recargo de madrugada realmente cobrado.
alter table br_orders add column discount decimal(10,2) not null default 0;
alter table br_orders add column coupon_code varchar(64) null;
alter table br_orders add column night_surcharge decimal(10,2) not null default 0;
