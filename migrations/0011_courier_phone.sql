-- Botella Rápida — teléfono de contacto del repartidor.

-- El admin necesita ver el teléfono de cada repartidor (tanto solicitudes como
-- ya activos) para localizarlo fuera de la app. Columna NUEVA y NULLABLE: las
-- cuentas ya registradas siguen igual (sin teléfono hasta que se edite o se
-- registren de nuevo). El runner aplica cada fichero UNA vez.

alter table br_users add column phone varchar(64) null;
