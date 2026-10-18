-- 0017_order_dest_coords.sql — dirección de entrega EXACTA (geocodificación).
--
-- Al crear el pedido resolvemos las coordenadas reales de la calle con
-- Nominatim (OpenStreetMap): gratis, sin API key y sin cuenta. NULL = no se
-- pudo resolver (calle rara o sin red): el mapa usa entonces el centroide del
-- código postal, igual que antes. Así el punto de entrega deja de ser
-- aproximado cuando el geocoder responde, sin depender de él en el camino
-- crítico del pedido.
--
-- `decimal(9,6)`: resolución ~11 cm, sobra para una entrega.

alter table br_orders add column dest_lat decimal(9,6) null;
alter table br_orders add column dest_lng decimal(9,6) null;
