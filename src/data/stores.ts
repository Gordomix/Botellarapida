/**
 * Tiendas de la zona (de MUESTRA).
 *
 * La app hoy no tiene un modelo de "tienda física": "Consum / Lidl / Dia" solo
 * existen como *marca* de cada producto (ver catalog.ts). Para poder enseñar un
 * mapa real de "tiendas cerca de ti" sin depender de una API de geocodificación,
 * aquí definimos un puñado de tiendas con coordenadas y la posición de cada
 * código postal que cubres.
 *
 * COORDENADAS VERIFICADAS Y EN TIERRA FIRME. Los centros de municipio son los
 * oficiales (fuente geodatos/OSM):
 *   Santa Coloma de Gramenet 41.4515, 2.2081 · Badalona 41.4500, 2.2474
 *   Sant Adrià de Besòs      41.4305, 2.2183 · Ripollet 41.4960, 2.1420
 * La costa queda al SUR de estos puntos, así que todas las latitudes están por
 * encima de la línea de playa: ningún marcador cae en el mar.
 *
 * Cuando tengas el listado real de tiendas (o quieras leerlas de la BD en el
 * admin), sustituye este array o cárgalo desde el servidor: el mapa y la lista
 * de cercanías leen de aquí y no hay que tocar nada más.
 */
import { SERVICE_AREA } from "@/data/service-area";

export type StoreKind = "supermercado" | "ultramarinos" | "hub";

export type NearbyStore = {
  id: string;
  name: string;
  brand: string;
  kind: StoreKind;
  address: string;
  town: string;
  cp: string;
  lat: number;
  lng: number;
};

/** Centro aproximado (lat,lng) de cada CP que cubres. Todos en tierra firme. */
export const CP_CENTROIDS: Record<string, [number, number]> = {
  // Badalona (costera, pero estos puntos son el casco urbano, al norte de la playa)
  "08910": [41.458, 2.246], // Badalona norte / Canyet
  "08911": [41.45, 2.244], // Badalona centro
  "08912": [41.447, 2.236], // Badalona Gorg / Sant Roc
  "08913": [41.445, 2.242], // Badalona Llefià / Eixample
  "08914": [41.446, 2.24], // Badalona Sant Roc / Molí
  "08915": [41.443, 2.247], // Badalona Pompeu Fabra (aún tierra: playa ~41.435)
  "08916": [41.454, 2.243], // Badalona Estació
  "08917": [41.456, 2.238], // Badalona Sant Crist
  "08918": [41.452, 2.252], // Badalona Dalt / Plana
  // Santa Coloma de Gramenet (interior, sin costa) — núcleo del negocio
  "08921": [41.4515, 2.208], // Santa Coloma centro
  "08922": [41.448, 2.202], // Santa Coloma Rocí
  "08923": [41.455, 2.206], // Santa Coloma Baró de Viver
  "08924": [41.445, 2.21], // Santa Coloma sud / Casablanca
  // Otros municipios
  "08930": [41.4305, 2.2183], // Sant Adrià de Besòs (centro urbano, norte de su playa)
  "08291": [41.496, 2.142], // Ripollet
};

/** Santa Coloma centro: punto por defecto si aún no se ha elegido CP. */
export const DEFAULT_COORDS: [number, number] = CP_CENTROIDS["08921"];

export const SAMPLE_STORES: NearbyStore[] = [
  // Santa Coloma de Gramenet
  { id: "st-consum-sc", name: "Consum Santa Coloma", brand: "Consum", kind: "supermercado", address: "C. de Torras 20", town: "Santa Coloma de Gramenet", cp: "08921", lat: 41.449, lng: 2.206 },
  { id: "st-lidl-sc", name: "Lidl Santa Coloma", brand: "Lidl", kind: "supermercado", address: "C. de la Mina 100", town: "Santa Coloma de Gramenet", cp: "08924", lat: 41.447, lng: 2.211 },
  { id: "st-dia-sc", name: "Dia Santa Coloma", brand: "Dia", kind: "supermercado", address: "Av. Francesc Macià 34", town: "Santa Coloma de Gramenet", cp: "08921", lat: 41.45, lng: 2.205 },
  { id: "st-ultra-sc", name: "Alimentació Germans", brand: "Ultramarinos", kind: "ultramarinos", address: "Rambla de Sant Jordi 55", town: "Santa Coloma de Gramenet", cp: "08923", lat: 41.453, lng: 2.206 },
  // Badalona
  { id: "st-consum-bad", name: "Consum Badalona Centre", brand: "Consum", kind: "supermercado", address: "Av. de Madrid 88", town: "Badalona", cp: "08911", lat: 41.4505, lng: 2.2445 },
  { id: "st-lidl-bad", name: "Lidl Badalona", brand: "Lidl", kind: "supermercado", address: "C. de Maragall 45", town: "Badalona", cp: "08913", lat: 41.4475, lng: 2.24 },
  { id: "st-dia-bad", name: "Dia Badalona", brand: "Dia", kind: "supermercado", address: "Carrer del Temple 12", town: "Badalona", cp: "08914", lat: 41.4495, lng: 2.246 },
  { id: "st-ultra-rull", name: "Ultramarinos Can Rull", brand: "Ultramarinos", kind: "ultramarinos", address: "Passatge de l'Ermita 3", town: "Badalona", cp: "08917", lat: 41.4555, lng: 2.238 },
  // Sant Adrià de Besòs y Ripollet
  { id: "st-dia-sad", name: "Dia Sant Adrià", brand: "Dia", kind: "supermercado", address: "C. del Mar 30", town: "Sant Adrià de Besòs", cp: "08930", lat: 41.433, lng: 2.22 },
  { id: "st-consum-rip", name: "Consum Ripollet", brand: "Consum", kind: "supermercado", address: "C. de la Torrasa 10", town: "Ripollet", cp: "08291", lat: 41.496, lng: 2.142 },
  // Hub propio
  { id: "st-hub-nord", name: "Botella Rápida · Hub Nord", brand: "Botella Rápida", kind: "hub", address: "C. de la Indústria 200", town: "Santa Coloma de Gramenet", cp: "08921", lat: 41.451, lng: 2.208 },
];

/** Todos los CP cubiertos, ordenados, para el selector del mapa. */
export const SERVICE_AREA_CPS: { cp: string; town: string }[] = SERVICE_AREA.flatMap((t) =>
  t.cps.map((cp) => ({ cp, town: t.town })),
);

/** Coordenadas aproximadas de un CP (o el centro por defecto si no se conoce). */
export function coordsForCp(cp: string): [number, number] {
  return CP_CENTROIDS[cp.trim()] ?? DEFAULT_COORDS;
}

/** Distancia en km (fórmula de haversine) entre dos puntos. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type StoreWithDistance = NearbyStore & { distanceKm: number };

/** Tiendas ordenadas por cercanía al punto dado (más cercanas primero). */
export function nearestStores(from: [number, number], stores = SAMPLE_STORES): StoreWithDistance[] {
  return stores
    .map((s) => ({ ...s, distanceKm: haversineKm(from, [s.lat, s.lng]) }))
    .sort((x, y) => x.distanceKm - y.distanceKm);
}
