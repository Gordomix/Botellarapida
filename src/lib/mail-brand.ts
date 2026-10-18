/**
 * Plantilla HTML de los correos automatizados de Botella Rápida (Fase 13).
 *
 * Los clientes piden un correo «con el logo» y un botón claro: se resuelve con
 * una cabecera landscape que reutiliza la ficha de marca pública (`og.jpg`,
 * 1200×630 con el logo) y un botón de confirmación en color ámbar. Es HTML
 * plano con estilos en línea y tablas — el único formato que entienden bien
 * Gmail, Outlook y Apple Mail sin filtros de spam agresivos.
 *
 * IMPORTANTE: si `base` está vacío (sin `PUBLIC_APP_URL` y sin host público en
 * la request) no hay imágenes remotas que servir: la cabecera cae a un banner
 * CSS con el nombre de la marca, y el botón solo se pinta cuando existe enlace.
 */

/** Colores de la marca (mismos valores que los tokens de `styles.css`). */
const INK = "#1c1712";
const PAPER = "#efe4d0";
const SURFACE = "#f4ead8";
const EMBER = "#e25a32";
const MIST = "#cbb9a0";
const TEXT = "#4a4238";

/** Escapa el texto dinámico: un correo nunca debe inyectar etiquetas. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type BrandedEmail = {
  /** Base pública del sitio ("" = sin imágenes remotas; banner CSS). */
  base: string;
  /** Titular del cuerpo del correo. */
  heading: string;
  /** Párrafo introductorio (texto plano; se escapa). */
  intro: string;
  /** Texto del botón de acción. */
  ctaLabel: string;
  /** Destino del botón y del enlace de socorro ("" = sin botón). */
  ctaUrl: string;
  /** Nota pequeña de pie de cuerpo (opcional). */
  note?: string;
};

/**
 * Cabecera landscape: foto de marca desde `{base}/og.jpg` si hay URL pública
 * (Gmail la muestra tras «Mostrar imágenes» y debajo siempre va el texto), o
 * un banner tipográfico con los colores de la marca en caso contrario.
 */
function banner(base: string): string {
  if (base) {
    return `<img src="${esc(base)}/og.jpg" alt="Botella Rápida · Express España" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">`;
  }
  return `<div style="background:${INK};padding:26px 28px;">
  <span style="font:700 24px/1.2 Georgia,'Times New Roman',serif;color:${PAPER}">Botella <span style="color:${EMBER}">Rápida</span></span><br>
  <span style="font:600 11px/1.6 'Helvetica Neue',Arial,sans-serif;letter-spacing:3px;color:${MIST}">EXPRESS ESPAÑA · REPARTO 24 H</span>
</div>`;
}

/** Genera el HTML completo del correo a partir de la plantilla de marca. */
export function brandedEmailHtml({
  base,
  heading,
  intro,
  ctaLabel,
  ctaUrl,
  note,
}: BrandedEmail): string {
  const button = ctaUrl
    ? `<tr><td align="center" style="padding:20px 28px 8px;">
  <a href="${esc(ctaUrl)}" style="display:inline-block;background:${EMBER};color:#ffffff;font:700 16px/1 'Helvetica Neue',Arial,sans-serif;text-decoration:none;padding:16px 34px;border-radius:999px;">${esc(ctaLabel)}</a>
</td></tr>
<tr><td align="center" style="padding:8px 28px 0;">
  <p style="font:12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${TEXT};margin:0;">¿No ves el botón? Copia y pega esta dirección:<br>
  <span style="word-break:break-all;color:${INK};font-weight:600;">${esc(ctaUrl)}</span></p>
</td></tr>`
    : "";
  const noteHtml = note
    ? `<tr><td style="padding:14px 28px 0;">
  <p style="font:12px/1.6 'Helvetica Neue',Arial,sans-serif;color:${TEXT};margin:0;">${esc(note)}</p>
</td></tr>`
    : "";
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Botella Rápida</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${SURFACE};border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(28,23,18,.18);">
      <tr><td style="line-height:0;">${banner(base)}</td></tr>
      <tr><td style="padding:26px 28px 0;">
        <h1 style="font:700 22px/1.3 Georgia,'Times New Roman',serif;color:${INK};margin:0;">${esc(heading)}</h1>
        <p style="font:15px/1.7 'Helvetica Neue',Arial,sans-serif;color:${TEXT};margin:12px 0 0;">${esc(intro)}</p>
      </td></tr>
      ${button}
      ${noteHtml}
      <tr><td style="padding:24px 28px 26px;"></td></tr>
      <tr><td style="background:${INK};padding:16px 28px;">
        <p style="font:11px/1.6 'Helvetica Neue',Arial,sans-serif;color:${MIST};margin:0;">Botella Rápida · Express España — ultramarinos 24 h. Si no has pedido tú esta cuenta, ignora este correo y nada cambiará.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
