-- Botella Rápida — declaración de mayoría de edad registrada en servidor.
--
-- Columna NUEVA y OPCIONAL en `br_users` (migración puramente aditiva: las
-- cuentas existentes nacen con `age_ok = 0` y su comportamiento no cambia;
-- solo los pedidos CON alcohol la consultan). El age gate del navegador era
-- una promesa de papel: sin esta columna, un menor podía crear pedidos con
-- alcohol llamando a la función de servidor directamente.
--
--   * `age_ok`  1 cuando el cliente confirmó ante el servidor ser mayor de
--               18 años (se registra al aceptar el gate o en el primer
--               pedido con alcohol; el repartidor sigue verificando el DNI
--               en la entrega como hasta ahora).

alter table br_users add column age_ok tinyint(1) not null default 0;
