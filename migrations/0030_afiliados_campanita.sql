-- 0030: AFILIADOS (enlace de 1 uso +20 chapas a cada parte en la PRIMER compra
-- del invitado), CAMPANITA de notificaciones para el cliente, premios de CHAPAS
-- en la ruleta y pasarela con CLAVES EDITABLES desde el panel. Todo ADITIVO:
-- tablas nuevas, columnas nuevas y enums ampliados; nada del comportamiento
-- actual cambia hasta que el admin active these interruptores.
--
-- 1) Ruleta: kind 'chapas' (premio que suma chapas al instante, sin pago) +
--    columna `chapas` (cuántas) y su foto en el entry (`chapa_amount`) para
--    que un cambio posterior del admin no reescriba premios ya dados.
-- 2) Afiliados: cada cuenta registrada puede generar enlaces AF-XXXXXX de UN
--    solo uso. El invitado queda marcado con `referred_by`; al ENTREGARSE su
--    primer pedido, dono e invitado suman `reward` chapas cada uno y el enlace
--    se cierra (used_by/used_at). Si el invitado nunca compra, el enlace sigue
--    libre para otra persona.
-- 3) Notificaciones (`br_notifications`): bandeada por cuenta (campanita de la
--    cabecera) con premios, chapas, mensajes de chat, avisos de afiliado y
--    estados de pedido. Solo lectura para el dueño de la fila.
-- 4) Pasarela: interruptor maestro `enabled` + credenciales PayPal/Stripe
--    EDITABLES desde Panel → Pagos (si hay valor en BD manda la BD; si está
--    NULL, se usa la variable de entorno). Quitar el método = desactivar o
--    borrar claves: el checkout vuelve a «pago en mano» sin tocar código.
--
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). Fechas epoch ms.

-- 1) Ruleta con premios de chapas.
alter table br_raffle_prizes
  modify kind enum('premio','perdedor','chapas') not null default 'premio';

alter table br_raffle_prizes
  add column chapas int not null default 0 after weight;

alter table br_raffle_entries
  modify outcome enum('premio','perdedor','chapas') not null;

alter table br_raffle_entries
  add column chapa_amount int not null default 0 after amount;

-- 2) Afiliados.
alter table br_users
  add column referred_by varchar(32) null;

create table if not exists br_affiliates (
  id varchar(64) not null primary key,
  code varchar(32) not null,
  owner_email varchar(190) not null,
  owner_name varchar(120) not null default '',
  -- Chapas que se llevan AMBAS partes cuando el invitado hace su primera
  -- compra entregada (20 por defecto, el titular lo decidió así).
  reward int not null default 20,
  -- Un enlace es de UN solo uso: se cierra al convertir al invitado.
  used_by varchar(190) null,
  used_at bigint null,
  created_at bigint not null,
  unique key idx_affiliate_code (code),
  key idx_affiliate_owner (owner_email, created_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- 3) Campanita: notificaciones por cuenta.
create table if not exists br_notifications (
  id varchar(64) not null primary key,
  email varchar(190) not null,
  kind enum('premio','chapa','mensaje','pedido','afiliado','info') not null default 'info',
  title varchar(160) not null,
  body varchar(500) not null default '',
  -- Enlace interno adonde lleva el clic (/sorteo, /mensajes, /chapas...).
  link varchar(400) null,
  created_at bigint not null,
  read_at bigint null,
  key idx_notif_email (email, created_at),
  key idx_notif_unread (email, read_at)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- 4) Pasarela: interruptor maestro + credenciales editables (NULL = usar
--    variable de entorno, como hasta hoy; '' = Borrado explícito).
alter table br_payment_settings
  add column enabled tinyint(1) not null default 1,
  add column paypal_client_id varchar(191) null,
  add column paypal_secret varchar(191) null,
  add column stripe_secret_key varchar(191) null;
