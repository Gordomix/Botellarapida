-- Botella Rápida — contenido editable (CMS del panel admin).
--
-- Guarda SOLO los overrides que escribe el admin. Las páginas arrancan con los
-- defaults de `src/data/site-defaults.ts` (idénticos al sitio de hoy) y aplican
-- encima lo que haya aquí. Tabla vacía => la web se ve exactamente igual.
--
-- Mismo collate `utf8mb4_unicode_ci` que 0001: compatible con MariaDB (XAMPP) y
-- MySQL de hosting. `payload json` admite data URLs de imagen (WebP) grandes.

-- Overrides por sección de contenido (hero, home.*, brand, footer, legal.*, ...).
create table if not exists br_content (
  section varchar(64) not null primary key,
  payload json not null,
  updated bigint not null,
  key idx_content_updated (updated)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;

-- Parches sobre productos del catálogo estático (`src/data/catalog.ts`). Se
-- guarda solo el `id` (que NO cambia) y los campos a sustituir; al leer el
-- catálogo se hace merge superficial. Así editar precio/foto/texto no rompe
-- enlaces históricos ni pedidos ya hechos con ese id.
create table if not exists br_product_overrides (
  id varchar(64) not null primary key,
  payload json not null,
  updated bigint not null,
  key idx_product_overrides_updated (updated)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci;
