-- 0029: MODO PRUEBAS en la ruleta + PASARELA DE PAGO controlable (PayPal y
-- modo demo). Todo ADITIVO: columna nueva, tabla nueva y columnas nuevas en
-- las tablas de pagos; nada de lo existente cambia de comportamiento hasta que
-- el admin active estos interruptores desde el panel.
--
-- 1) `unlimited_test`: casilla de «Sorteos» que da GIROS ILIMITADOS a las
--    cuentas registradas (para probar la ruleta sin comprar). No toca los
--    tickets ya emitidos: simplemente el giro no consume ninguno.
-- 2) `br_payment_settings`: fila única con el proveedor por el que queremos
--    RECIBIR dinero ('paypal' | 'stripe') y el MODO PRUEBAS. Con modo pruebas
--    activo ningún pago sale fuera: el checkout lleva a /pago-demo, una
--    pasarela simulada donde el cliente aprueba el pago sin que se cobre
--    nada (queda anotado como SIMULADO en el historial).
-- 3) Columnas en las tablas de pagos para acompañar a Stripe con PayPal
--    (`paypal_order_id`) y con los pagos simulados (`demo_token` + `provider`).
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas epoch ms.

-- 1) Ruleta: giros ilimitados para cuentas (solo pruebas).
alter table br_raffle_config
  add column unlimited_test tinyint(1) not null default 0;

-- 2) Ajustes de la pasarela (fila única id = 1). PayPal por defecto: es el
--    método elegido para recibir dinero; el modo pruebas nace APAGADO.
create table if not exists br_payment_settings (
  id tinyint unsigned not null primary key,
  provider enum('paypal','stripe') not null default 'paypal',
  test_mode tinyint(1) not null default 0,
  updated_at bigint not null default 0
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

insert ignore into br_payment_settings (id, provider, test_mode, updated_at)
  values (1, 'paypal', 0, 0);

-- 3a) Pagos de pedidos: proveedor real del intento + id de orden PayPal +
--     token de la pasarela simulada (único para poder aprobarlo desde
--     /pago-demo; los NULL no chocan en el índice UNIQUE de MySQL/MariaDB).
alter table br_payments
  add column provider varchar(16) not null default 'stripe',
  add column paypal_order_id varchar(64) not null default '',
  add column demo_token varchar(64) null;

alter table br_payments
  add unique key idx_payment_demo (demo_token);

-- 3b) Pagos de reclamaciones de la ruleta: espejo exacto.
alter table br_raffle_payments
  add column provider varchar(16) not null default 'stripe',
  add column paypal_order_id varchar(64) not null default '',
  add column demo_token varchar(64) null;

alter table br_raffle_payments
  add unique key idx_raffle_pay_demo (demo_token);
