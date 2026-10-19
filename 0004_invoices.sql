-- Botella Rápida — facturas de MUESTRA (documento, sin datos fiscales).
--
-- El admin o el repartidor asignado emiten una factura de un pedido YA
-- entregado. Nada de esto lo decide el navegador:
--   * `seq` es AUTO_INCREMENT → numeración correlativa a prueba de carreras.
--   * `number` se compone en servidor a partir de `seq` (FAC-<año>-<00000>).
--   * `items_total`, `shipping_cost` y `total` se RECALCULAN en servidor contra
--     `br_order_items`; el importe que enviara el cliente no se usa jamas.
--   * `unique key uq_invoice_order` → un pedido, una factura (no se puede
--     facturar dos veces ni inventar duplicados).
--
-- Es un documento de muestra: aun NO lleva CIF/NIF, IVA desglosado ni base
-- imponible, porque el negocio todavia no tiene datos fiscales configurados.
-- Collate `utf8mb4_unicode_ci` (MariaDB/XAMPP + MySQL hosting). `created_at`
-- en epoch ms.

create table if not exists br_invoices (
  id varchar(64) not null primary key,
  seq int not null auto_increment,
  number varchar(32) not null default '',
  order_id varchar(64) not null,
  order_code varchar(32) not null,
  customer_email varchar(191) not null,
  items_total decimal(10, 2) not null,
  shipping_cost decimal(10, 2) not null,
  total decimal(10, 2) not null,
  -- quien emite la factura, fijado desde la sesion en servidor:
  issued_by_email varchar(191) not null,
  issued_by_name varchar(191) not null,
  issued_by_role enum('user','repartidor','admin') not null,
  created_at bigint not null,
  -- AUTO_INCREMENT debe ser clave; ademas un pedido = una sola factura.
  unique key uq_invoice_seq (seq),
  unique key uq_invoice_order (order_id),
  key idx_invoice_created (created_at),
  constraint fk_invoice_order foreign key (order_id) references br_orders (id) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
