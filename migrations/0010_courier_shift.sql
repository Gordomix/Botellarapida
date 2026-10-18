-- Botella Rápida — franja horaria del repartidor.
--
-- Los repartidores eligen SU jornada: 8 horas dentro de las 24 del día. Se
-- guarda solo la hora de INICIO (0-23); el fin es (inicio + 8) mod 24, así una
-- misma columna describe tanto "9:00-17:00" como el turno de noche
-- "22:00-06:00". Columna NUEVA y NULLABLE: quien no la haya elegido sigue
-- funcionando igual que hoy (sin franja). El runner aplica cada fichero UNA vez.

alter table br_users add column shift_start tinyint null;
