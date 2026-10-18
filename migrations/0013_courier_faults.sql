-- Botella Rápida — faltas notificadas a los repartidores.

-- El admin registra faltas a un repartidor (incumplimientos, avisos). Cada falta
-- es una fila; el repartidor la ve como un pop-up de aviso en su portal y, al
-- cerrarlo, queda acusada de recibo (ack = 1). Con 3 o más faltas el aviso se
-- resalta. Tabla NUEVA: no toca nada existente.

create table if not exists br_courier_faults (
  id varchar(64) not null primary key,
  courier_email varchar(191) not null,
  reason varchar(512) not null,
  ack tinyint not null default 0,
  created_at bigint not null,
  key idx_faults_courier (courier_email)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
