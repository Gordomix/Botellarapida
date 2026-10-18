-- 0025: SORTEO con ruleta (todo ADITIVO: tablas nuevas, ninguna columna tocada
-- en las existentes). El sorteo nace APAGADO (`enabled = 0` y sin premios): sin
-- que el admin lo configure desde el panel, la sección pública aparece como
-- "no disponible" y no cambia nada en la tienda de hoy.
--
-- Mecánica: el cliente (registrado) gira la ruleta; el resultado lo decide el
-- SERVIDOR por pesos (nunca el navegador). Si toca premio, este queda OCULTO
-- (`?`) hasta que el ganador paga el precio de reclamación que fijó el admin
-- (`reveal_price`). Con `reveal_price = 0` se descubre sin cobro. Reutilizamos
-- la pasarela de Stripe ya preparada (tabla de pagos propia para el entry).
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas epoch ms.

-- Configuración global (fila única id = 1).
create table if not exists br_raffle_config (
  id tinyint unsigned not null primary key,
  enabled tinyint(1) not null default 0,
  title varchar(120) not null default 'Ruleta Botella Rápida',
  subtitle varchar(240) not null default 'Prueba tu suerte: gira y llévate premios.',
  how_it_works text null,
  win_message varchar(400) not null default '¡Enhorabuena! Has ganado un premio.',
  lose_message varchar(400) not null default 'No ha podido ser. Vuelve a intentarlo pronto.',
  -- Giros por cliente y día natural; 0 = sin límite.
  daily_limit int not null default 1,
  updated_at bigint not null default 0
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Segmentos de la ruleta (premios casillas + casillas "perdedoras").
create table if not exists br_raffle_prizes (
  id varchar(64) not null primary key,
  -- 'premio' ocupa y gana; 'perdedor' muestra el mensaje de no-ganado.
  kind enum('premio','perdedor') not null default 'premio',
  -- Texto corto del segmento en la rueda (visible). Para premios se mantiene
  -- genérico ('PREMIO ???') porque el detalle real se oculta hasta el pago.
  wheel_label varchar(48) not null default 'PREMIO ???',
  -- Nombre real del premio (se revela tras pagar).
  name varchar(160) not null default '',
  description varchar(400) null,
  image varchar(600) null,
  -- Enlace opcional a un producto del catálogo para entregar el premio.
  product_id varchar(64) null,
  -- € a cobrar para descubrir/reclamar el premio (0 = se revela sin cobro).
  reveal_price decimal(8,2) not null default 0,
  -- Peso entero ≥ 0: probabilidad relativa del segmento. 0 nunca sale.
  weight int not null default 1,
  -- Mensaje personalizado para el ganador de ESTE premio (si vacío, el global).
  win_message varchar(400) null,
  active tinyint(1) not null default 1,
  sort int not null default 0,
  created_at bigint not null,
  key idx_raffle_prize_active (active, sort)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Cada giro registrado (identidad = sesión del cliente; se exige login).
create table if not exists br_raffle_entries (
  id varchar(64) not null primary key,
  code varchar(32) not null default '',
  customer varchar(190) not null,
  customer_name varchar(120) not null default '',
  prize_id varchar(64) not null,
  outcome enum('premio','perdedor') not null,
  -- El premio queda oculto (0) hasta que se paga y se revela (1).
  revealed tinyint(1) not null default 0,
  paid tinyint(1) not null default 0,
  claimed tinyint(1) not null default 0,
  -- € congelados al ganar (aunque el admin cambie luego el precio).
  amount decimal(8,2) not null default 0,
  created_at bigint not null,
  revealed_at bigint null,
  key idx_raffle_entry_customer (customer, created_at),
  key idx_raffle_entry_outcome (outcome, claimed)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Pago de reclamación de un premio (espejo de br_payments, para el entry).
create table if not exists br_raffle_payments (
  entry_id varchar(64) not null primary key,
  stripe_session_id varchar(191) not null default '',
  status enum('abierto','pagado','cancelado') not null default 'abierto',
  created_at bigint not null,
  updated_at bigint not null,
  key idx_raffle_pay_session (stripe_session_id),
  constraint fk_raffle_pay_entry foreign key (entry_id) references br_raffle_entries (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
