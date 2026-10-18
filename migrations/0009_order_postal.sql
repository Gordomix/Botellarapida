-- Botella Rápida — código postal de entrega en el pedido.
--
-- El repartidor necesita geolocalizar la dirección sin ambigüedad: un texto como
-- "Carrer de Maragall 20, 2n 1a" (sin CP ni municipio) hacía que el mapa clavara
-- el pin donde podía. El cliente ya teclea su CP en el checkout y el servidor lo
-- validaba, pero no se guardaba. Columna NUEVA y NULLABLE: los pedidos
-- anteriores siguen válidos (sin CP). El runner aplica cada fichero UNA vez.

alter table br_orders add column postal_code varchar(16) null;
