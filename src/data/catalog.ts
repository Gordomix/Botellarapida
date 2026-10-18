import type { Product } from "./types";

/**
 * Catálogo base vacío por decisión del titular: los únicos productos de la
 * tienda son los dados de alta desde el panel de admin (`br_custom_products`).
 * El catálogo de muestra (26 productos de ultramarinos con sus fotos en
 * `public/products/`) sigue intacto en el historial de git por si alguna vez
 * se quiere recuperar como semilla.
 */
export const CATALOG: Product[] = [];
