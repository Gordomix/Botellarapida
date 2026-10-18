/**
 * Imágenes de producto robustas en móvil/iOS.
 *
 * Los productos importados del proveedor guardan la FOTO COMO URL REMOTA
 * (no data URL). Eso falla en iPhone por tres vías: protección anti-hotlink
 * del origen (envía 403 según el `Referer`), contenido mixto (URL `http://`
 * en una web `https://`: iOS ni lo intenta) y bloqueadores de seguimiento.
 * Este módulo aporta las tres piezas del arreglo, todas aditivas:
 *
 * 1. `safeImgSrc` — sube `http://` a `https://` antes de pintar.
 * 2. `referrerPolicy="no-referrer"` en el `<img>` (la mayoría de anti-hotlink
 *    permiten el acceso si no se les identifica con un Referer ajeno).
 * 3. `recoverImgError` — si aun así el `<img>` falla, pide la foto al
 *    servidor (`proxyImageFn`, con guardas SSRF) y sustituye el src por el
 *    data URL resultante. Un único intento por imagen: nunca bucles.
 */
import type { SyntheticEvent } from "react";
import { proxyImageFn } from "./br-api";

/** `http://…` -> `https://…` (evita el bloqueo por contenido mixto). */
export function safeImgSrc(src: string): string {
  return src.startsWith("http://") ? `https://${src.slice(7)}` : src;
}

/**
 * Fallback de carga: se llama en `onError` de un `<img>` que pintó
 * `safeImgSrc(original)` y lleva `data-src={original}`. Reclama la imagen al
 * proxy del servidor una sola vez (marca `dataset.imgRetried`).
 */
export async function recoverImgError(el: HTMLImageElement): Promise<void> {
  const original = el.dataset.src || "";
  if (!original || el.dataset.imgRetried) return;
  el.dataset.imgRetried = "1";
  if (!/^https?:\/\//i.test(original)) return; // locales/data URL: no hay proxy que valga
  try {
    const res = await proxyImageFn({ data: { url: original } });
    if (res.ok && res.dataUrl) el.src = res.dataUrl;
  } catch {
    /* sin proxy disponible: la imagen queda como estaba (rota), sin romper la página */
  }
}

/** Props comunes para cualquier `<img>` de producto (uso en JSX). */
export function productImgProps(src: string) {
  return {
    src: safeImgSrc(src),
    "data-src": src,
    referrerPolicy: "no-referrer" as const,
    onError: (e: SyntheticEvent<HTMLImageElement>) => {
      void recoverImgError(e.currentTarget);
    },
  };
}
