-- Botella Rápida — origen de tienda del pedido.
--
-- Ahora el cliente puede elegir, al poner su CP (o desde el mapa de "tiendas"),
-- QUÉ tienda física surte su pedido. Guardamos id y nombre de la tienda en el
-- pedido para que admin y repartidor sepan de dónde recoger. Son columnas
-- NUEVAS y NULLABLES: los pedidos anteriores siguen válidos (sin tienda asignada).
--
-- El runner de migraciones aplica cada fichero UNA vez (tabla `_migrations`), así
-- que el ALTER se ejecuta solo una vez aunque redeploques.

alter table br_orders add column store_id varchar(64) null;
alter table br_orders add column store_name varchar(191) null;
