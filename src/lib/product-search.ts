import type { CategoryId, Product } from "@/data/types";

/**
 * Utilidades de búsqueda y SEO para el catálogo (Fase 12).
 *
 * Todo es PURA función (sin dependencias de Node ni del DOM): se usa desde la
 * barra de la tienda (`store-shell`), desde `/catalogo` y también desde el
 * servidor al dar de alta un producto (`addCustomProduct`), para escribir ahí
 * las etiquetas. Así la búsqueda entiende términos genéricos —«bebida», «frío»,
 * «energética»— y no solo el nombre exacto del producto.
 */

/** Minúsculas, sin tildes y con espacios colapsados. Determinista y veloz. */
export function normalize(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Términos de una frase ya normalizada (palabras sueltas, sin vacíos). */
export function tokenize(input: string): string[] {
  return normalize(input).split(" ").filter(Boolean);
}

/**
 * Etiquetas de cada pasillo. Cubren el caso «refresco/energetica → bebida»,
 * «patatas → snack», etc., sin necesidad de que el admin rellene nada.
 */
const CATEGORY_TAGS: Record<CategoryId, string[]> = {
  refrescos: ["bebida", "refresco", "frio", "sed", "bodega", "tomar"],
  alcohol: ["bebida", "alcohol", "frio", "bar", "brindis", "tomar"],
  aperitivos: ["snack", "picar", "aperitivo", "frio", "bar", "salado"],
  snacks: ["snack", "picar", "salado", "antojo"],
  basicos: ["despensa", "basico", "cocina"],
  parafarmacia: ["salud", "higiene", "farmacia"],
  ofertas: ["oferta", "descuento", "ahorro"],
  packs: ["pack", "lote", "ahorro"],
};

/**
 * Sinónimos y términos relacionados disparados por palabras del propio
 * producto. Si el nombre/marca/desc contiene la clave, se suman todos sus
 * valores como etiquetas buscables. Claves y valores YA normalizados (sin
 * tildes) para que «energética» y «energetica» funcionen igual.
 */
const SYNONYMS: Record<string, string[]> = {
  energetica: ["bebida", "energetica", "energia", "frio", "refrecio", "cafeina", "gym", "sport"],
  energy: ["bebida", "energetica", "energia", "frio", "cafeina", "sport"],
  monster: ["bebida", "energetica", "energia", "frio", "refresco", "lata", "cafeina"],
  redbull: ["bebida", "energetica", "energia", "frio", "refresco", "lata", "cafeina"],
  cola: ["bebida", "refresco", "frio", "gas", "azucar"],
  gazosa: ["bebida", "refresco", "gas", "frio"],
  agua: ["bebida", "agua", "frio", "sed", "sin"],
  cerveza: ["bebida", "alcohol", "frio", "bar", "cerveza"],
  vino: ["bebida", "alcohol", "vino", "tinto", "blanco", "bar"],
  refresco: ["bebida", "refresco", "frio", "sed"],
  zumo: ["bebida", "zumo", "fruta", "frio"],
  cafe: ["bebida", "cafe", "caliente", "energia"],
  te: ["bebida", "te", "infusion"],
  lacta: ["lactea", "leche"],
  patatas: ["snack", "fritura", "salado", "picar"],
  chips: ["snack", "fritura", "salado", "picar"],
  nachos: ["snack", "mexicano", "salado", "picar"],
  palomitas: ["snack", "maiz", "salado", "cine"],
  frutos: ["snack", "frutossecos", "saludable", "picar"],
  pipas: ["snack", "semillas", "salado", "picar"],
  galletas: ["dulce", "snack", "desayuno"],
  chocolate: ["dulce", "snack", "postre"],
  congelados: ["congelado", "frio"],
  ibero: ["iberico", "carni", "jamón", "curado"],
};

/** Palabras vacías que no aportan como etiqueta (artículos, preposiciones…). */
const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "un",
  "una",
  "y",
  "e",
  "o",
  "u",
  "a",
  "en",
  "con",
  "por",
  "para",
  "sin",
  "sabor",
  "sabor",
  "pack",
  "packs",
  "caja",
  "lata",
  "botella",
  "unidades",
  "unidad",
  "gramos",
  "litros",
]);

/**
 * Deriva las etiquetas SEO de un producto: las almacenadas (`p.tags`) + las del
 * pasillo + las disparadas por sinónimos presentes en su texto + las palabras
 * significativas de su nombre/marca. Devuelve una lista sin duplicados.
 */
export function deriveTags(p: Product): string[] {
  const out = new Set<string>();
  for (const t of p.tags ?? []) out.add(normalize(t));
  for (const t of CATEGORY_TAGS[p.cat] ?? []) out.add(t);

  const hay = normalize(`${p.name} ${p.brand} ${p.desc} ${p.long ?? ""}`);
  for (const [key, related] of Object.entries(SYNONYMS)) {
    if (hay.includes(key)) {
      out.add(key);
      for (const r of related) out.add(r);
    }
  }
  // Palabras del nombre y la marca (útil para buscar por formato o variante).
  for (const w of tokenize(`${p.name} ${p.brand}`)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return [...out].filter(Boolean);
}

/** Texto único y normalizado contra el que se prueba cada término buscado. */
export function searchHaystack(p: Product): string {
  const tags = deriveTags(p).join(" ");
  return normalize(`${p.name} ${p.brand} ${p.desc} ${p.long ?? ""} ${p.cat} ${tags}`);
}

/**
 * ¿Coincide el producto con la consulta? TODAS las palabras del término deben
 * aparecer en el haystack (nombre, marca, descripción, pasillo o etiquetas).
 * Insensible a tildes y mayúsculas. Así «bebida fria energetica» exige las tres.
 */
export function matchesQuery(p: Product, query: string): boolean {
  const words = tokenize(query);
  if (words.length === 0) return true;
  const hay = searchHaystack(p);
  return words.every((w) => hay.includes(w));
}

/**
 * Descripción SEO corta generada a partir del nombre (y marca/pasillo si ayuda).
 * Se usa al dar de alta un producto sin descripción, para que cada ficha y
 * tarjeta tenga un texto orientativo y buscable desde el primer momento.
 */
export function autoSeoDescription(p: Pick<Product, "name" | "brand" | "cat" | "unit">): string {
  const name = (p.name || "").trim();
  const brand = (p.brand || "").trim();
  const lead = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} · ` : "";
  const base = `${lead}${name}`.trim() || "Producto";
  const extras: string[] = [];
  const tags = deriveTags({
    // deriveTags espera un Product completo; construimos un pseudo-producto con
    // solo lo que necesitamos (el resto vacío no altera las etiquetas base).
    id: "",
    name: p.name,
    cat: p.cat,
    brand: p.brand,
    price: 0,
    unit: p.unit,
    desc: "",
    long: "",
    nutrition: {},
    image: "",
  } as Product);
  const nice = tags
    .filter((t) => t.length > 3 && !STOPWORDS.has(t))
    .slice(0, 4)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  if (nice.length) extras.push(nice.join(", "));
  const unit = (p.unit || "").trim();
  if (unit) extras.push(`Formato ${unit}`);
  const tail = extras.length ? `. ${extras.join(". ")}.` : ".";
  return `${base}: ideal para tu pedido de ultramarinos${tail}`.slice(0, 240);
}

/**
 * Etiqueta(s) canónica(s) para persistir al dar de alta: derivadas del nombre y
 * pasillo, ordenadas y sin excesos. Se guarda aquí lo que luego `deriveTags`
 * vuelve a calcular, más las palabras del nombre, de forma que la búsqueda por
 * tags funcione igual aunque el texto base cambie.
 */
export function autoSeoTags(p: Pick<Product, "name" | "brand" | "cat">): string[] {
  return deriveTags({
    id: "",
    name: p.name,
    brand: p.brand,
    cat: p.cat,
    price: 0,
    unit: "",
    desc: "",
    long: "",
    nutrition: {},
    image: "",
  } as Product).slice(0, 12);
}
