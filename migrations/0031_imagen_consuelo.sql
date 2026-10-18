-- 0031: FASE 10 — imagen REAL de los premios de la ruleta (y de las ofertas de
-- chapas) y premio de CONSUELO con descuento al perder. Todo ADITIVO: ensanchar
-- columnas y añadir una columna nueva; ningún comportamiento cambia hasta que
-- el admin vuelve a guardar la casilla.
--
-- 1) Bug imagen: el panel guarda la foto como data URL WebP (hasta 2 MB, el
--    validator `imageUrl` de br-api lo permite), pero la columna era
--    varchar(600) y el servidor la recortaba con slice(600): la foto salía
--    TRUNCADA y el navegador no podía pintarla. mediumtext (16 MB) la guarda
--    entera.
-- 2) Consuelo: al PERDER, la ruleta ofrece el premio secreto «que podría haber
--    caído» con un -10%. La oferta es un entry 'premio' normal y congelado en
--    BD (mismo flujo de pago/reveal/reclamación que un premio corriente); la
--    columna `consolation_of` liga la oferta con el giro perdedor que la creó
--    para que sea de UNA por giro (idempotente).

-- 1) Imágenes enteras (premios de ruleta + ofertas de chapas).
alter table br_raffle_prizes
  modify column image mediumtext null;

alter table br_chapa_rewards
  modify column image mediumtext null;

-- 2) Entry de consuelo ligado al giro perdedor que lo originó.
--    IMPORTANTE (producción): columna e índice van en sentencias ALTER
--    INDEPENDIENTES. MySQL (XAMPP) acepta `add column ..., add key ...` en un
--    solo ALTER, pero TiDB (la BD de Render) no resuelve la referencia del
--    índice en la misma sentencia y falla con «column does not exist:
--    consolation_of», tumbando el arranque de la BD entera.
alter table br_raffle_entries
  add column consolation_of varchar(64) null after chapa_amount;

alter table br_raffle_entries
  add key idx_raffle_consolation (consolation_of);
