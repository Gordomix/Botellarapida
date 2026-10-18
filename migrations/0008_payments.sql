-- Botella Rápida — pagos con tarjeta (Stripe).
--
-- Vínculo pedido ↔ sesión de Checkout de Stripe. Lo autoritativo NUNCA es esta
-- tabla ni la URL de vuelta: al confirmar, el servidor consulta la API de
-- Stripe (`payment_status`) y solo entonces marca `pagado`. Sin
-- `STRIPE_SECRET_KEY` en el entorno esta tabla no se escribe: la pasarela
-- queda preparada, no activada.
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas en
-- epoch ms, como el resto del esquema.

create table if not exists br_payments (
  order_id varchar(64) not null primary key,
  -- id de la sesión de Checkout (`cs_...`); se reemplaza si el cliente reintenta.
  stripe_session_id varchar(191) not null default '',
  status enum('abierto', 'pagado', 'cancelado') not null default 'abierto',
  created_at bigint not null,
  updated_at bigint not null,
  key idx_payment_session (stripe_session_id),
  constraint fk_payment_order foreign key (order_id) references br_orders (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
