-- 0018_order_cancel_reason.sql — motivo de cancelación (repartidor → admin).

-- El repartidor puede CANCELAR un reparto que ya tiene asignado, pero siempre
-- obligado a escribir el PORQUÉ. El motivo queda guardado en el pedido para que
-- el admin lo vea en el panel (y se le avisa por correo). `cancelled_by` dice
-- quién lo canceló ('repartidor' o 'admin'), así el admin distingue una baja del
-- cliente de un reparto que el propio repartidor no pudo asumir.
--
-- Columnas NUEVAS con default NULL: no afectan a los pedidos existentes.

alter table br_orders add column cancel_reason varchar(512) null;
alter table br_orders add column cancelled_by varchar(24) null;
