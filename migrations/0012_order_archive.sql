-- Botella Rápida — archivado (borrado lógico) de pedidos.

-- El admin puede ELIMINAR un pedido desde que está creado, pero el pedido no se
-- pierde: se marca como archivado y queda en una lista aparte descargable en
-- PDF. Borrado LÓGICO (flag), no físico: así los items, historial y facturas del
-- pedido siguen intactos y se pueden consultar/descargar después. Columna NUEVA
-- con default 0, así todos los pedidos existentes siguen viéndose normal.

alter table br_orders add column archived tinyint not null default 0;
