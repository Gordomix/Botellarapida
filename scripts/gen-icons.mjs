/**
 * Genera los iconos de aplicación (acceso directo a pantalla de inicio) a
 * partir del logo oficial Botella Rápida: mismo SVG que `Mark` en
 * src/components/brand/logo.tsx, rasterizado con resvg a 192/512/180 px.
 *
 * Uso (una sola vez, local): `npm install --no-save @resvg/resvg-js` y luego
 * `node scripts/gen-icons.mjs`. `--no-save` evita tocar package.json: resvg
 * solo hace falta para regenerar assets, nunca en build ni en despliegue.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "brand", "icons");

const ORANGE = "#E25A32";
const CREAM = "#EFE4D0";
const GREEN = "#2F6D56";

/** Trazos del logo (sin el rectángulo de fondo): shelf + botella + chapita. */
const SHAPES = `
  <path d="M5 11.5h6M3.5 16h5.5M6 20.5h5" stroke="${CREAM}" stroke-width="1.7" stroke-linecap="round" opacity="0.72"/>
  <path d="M17.2 7.2h4.2v2.2l1.6 2.1v11.4a2.6 2.6 0 0 1-2.6 2.6h-2.2a2.6 2.6 0 0 1-2.6-2.6V11.5l1.6-2.1V7.2z" fill="${CREAM}"/>
  <rect x="18.3" y="5.1" width="2.1" height="2.3" rx="0.55" fill="${GREEN}"/>`;

/** Icono "plano": el logo tal cual, con esquinas redondeadas transparentes. */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="9" fill="${ORANGE}"/>${SHAPES}
</svg>`;

/** Fondo completo naranja (iOS recorta las esquinas solo; Android/maskable no dejan huecos). */
const BLEED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${ORANGE}"/>${SHAPES}
</svg>`;

/** Maskable: logo centrado al 72 % dentro de la zona segura del recorte circular. */
const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${ORANGE}"/>
  <g transform="translate(4.48 4.48) scale(0.72)">${SHAPES}</g>
</svg>`;

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ["icon-192.png", MARK_SVG, 192],
  ["icon-512.png", MARK_SVG, 512],
  ["apple-touch-icon.png", BLEED_SVG, 180],
  ["maskable-512.png", MASKABLE_SVG, 512],
];
for (const [name, svg, size] of jobs) {
  writeFileSync(join(OUT, name), png(svg, size));
  console.log("OK", name, size);
}
