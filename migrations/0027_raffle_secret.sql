-- 0027: Ruleta v2 — cada segmento puede ser PREMIO VISIBLE o SECRETO (todo
-- ADITIVO: una columna nueva, nada tocado en las existentes).
--
-- `secret = 0` (default): el nombre real del premio viaja al navegador y la
-- rueda lo muestra tal cual («Cerveza Estrella», «Pack de snacks»…).
-- `secret = 1`: el servidor NO envía nombre ni imagen; la rueda pinta la
-- casilla con el rótulo genérico (`wheel_label`, p. ej. «PREMIO SECRETO ???»)
-- y el detalle solo se descubre al revelar el premio (igual que hasta hoy).
--
-- Los segmentos existentes quedan visibles por defecto: cambio de semantics
-- mínimo, la ruleta de hoy sigue funcionando idéntica hasta que el admin active
-- el candado en algún premio.

alter table br_raffle_prizes add column secret tinyint(1) not null default 0;
