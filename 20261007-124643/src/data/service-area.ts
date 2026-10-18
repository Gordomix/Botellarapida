/**
 * Zona de reparto real. Fuente única de verdad: el checkout valida aquí y el
 * servidor (`br-server.createOrder`) también, para que no se cuele un pedido de
 * fuera aunque alguien manipule el formulario.
 *
 * De momento se reparte en el cinturón norte del área metropolitana de Barcelona.
 * Cuando amplíes zona, añade el municipio con sus códigos postales y ya: la
 * validación y los textos que leen `SERVICE_AREA_LABEL` se actualizan solos.
 *
 * Los CP son los de cada municipio (5 dígitos). Badalona y Sta. Coloma tienen
 * varios, así que se listan todos los que cubres.
 */
export type ServiceTown = { town: string; cps: string[] };

export const SERVICE_AREA: ServiceTown[] = [
  { town: "Ripollet", cps: ["08291"] },
  { town: "Sant Adrià de Besòs", cps: ["08930"] },
  { town: "Badalona", cps: ["08910", "08911", "08912", "08913", "08914", "08915", "08916", "08917", "08918"] },
  // Añade aquí municipios vecinos cuando cubras "esa zona", p. ej.:
  // { town: "Santa Coloma de Gramenet", cps: ["08921", "08922", "08923", "08924"] },
  // { town: "Montcada i Reixac", cps: ["08110"] },
];

/** Todos los códigos postales aceptados, para validación O(1). */
const CP_SET = new Set(SERVICE_AREA.flatMap((t) => t.cps));

/** Ej. "Ripollet, Sant Adrià de Besòs y Badalona" para los textos visibles. */
export const SERVICE_AREA_TOWNS = SERVICE_AREA.map((t) => t.town);

export const SERVICE_AREA_LABEL =
  SERVICE_AREA_TOWNS.length <= 1
    ? SERVICE_AREA_TOWNS[0] ?? ""
    : `${SERVICE_AREA_TOWNS.slice(0, -1).join(", ")} y ${SERVICE_AREA_TOWNS.at(-1)}`;

/** ¿El CP está dentro de la zona de reparto? Requiere 5 dígitos. */
export function isWithinServiceArea(cp: string): boolean {
  return CP_SET.has(cp.trim());
}
