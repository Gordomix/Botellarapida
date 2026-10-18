-- 0032: FASE 11 — días de reparto configurables (de momento VIE/SÁB/DOM) y
-- RESERVAS de lunes a jueves. Todo ADITIVO: una columna nueva en pedidos; los
-- días se guardan en el CMS existente (`br_content`, sección `reparto`), así
-- que el admin los cambia desde Panel → Ajustes sin desplegar nada.
--
-- Cuando hoy NO es día de reparto, el pedido sigue siendo válido pero queda
-- RESERVADO para el próximo día de reparto: `scheduled_for` guarda el ancla
-- (epoch ms a las 12:00 UTC de ese día) y el historial lo explica. Los pedidos
-- de un día de reparto traen la columna NULL = comportamiento de siempre.

alter table br_orders
  add column scheduled_for bigint null after created_at;
