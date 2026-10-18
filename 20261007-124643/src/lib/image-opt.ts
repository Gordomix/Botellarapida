/**
 * Optimización de imágenes de producto en el navegador (sin dependencias).
 *
 * La subida del panel convierte la foto a **WebP** y la redimensiona antes de
 * guardarla: menos peso, mismo aspecto, y un `alt` pensado para SEO. No toca
 * nada del resto de la app — solo alimenta el campo `image` del producto.
 */

export type OptimizeOptions = {
  /** Lado máximo (px) del resultado; se respeta la proporción original. */
  maxDim?: number;
  /** Calidad WebP 0..1. 0.82 ≈ buen balance foto de producto. */
  quality?: number;
  /**
   * Ancho de lienzo forzado con recorte central (para el 4:5 de la ficha).
   * Si se indica `cropAspect`, el resultado encaja en la tarjeta sin deformar.
   */
  cropAspect?: number;
};

export type OptimizedImage = {
  /** Data URL lista para el campo `image` del producto. */
  dataUrl: string;
  mime: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  /** Bytes del resultado (decodificados del base64). */
  bytes: number;
  /** Bytes del fichero original, para mostrar el ahorro. */
  originalBytes: number;
};

/** ¿Este navegador sabe codificar WebP? (Safari antiguo no → fallback a JPEG). */
export function supportsWebpEncoding(): boolean {
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.toDataURL("image/webp").startsWith("data:image/webp");
}

function accept(file: File): boolean {
  return /^image\/(jpeg|jpg|png|webp|avif)$/i.test(file.type);
}

function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = dataUrl.slice(i + 1);
  return Math.floor((b64.length * 3) / 4);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = src;
  });
}

/**
 * Redimensiona (y opcionalmente recorta en el centro) a WebP comprimido.
 * @throws si el fichero no es una imagen admitida o no puede decodificarse.
 */
export async function fileToOptimizedImage(
  file: File,
  opts: OptimizeOptions = {},
): Promise<OptimizedImage> {
  if (!accept(file)) throw new Error("Formato no admitido: usa JPG, PNG, WebP o AVIF.");

  const maxDim = opts.maxDim ?? 800;
  const quality = opts.quality ?? 0.82;
  const mime: OptimizedImage["mime"] = supportsWebpEncoding() ? "image/webp" : "image/jpeg";

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error("La imagen está vacía o es incompatible.");

    // Canvas de salida; suavizado de alta calidad al reescalar.
    const out = document.createElement("canvas");

    let sw: number, sh: number, sx: number, sy: number;
    if (opts.cropAspect) {
      // Recorte central a la proporción objetivo, luego escalado a maxDim.
      const target = opts.cropAspect; // ancho/alto (p. ej. 4/5 = 0.8)
      const srcAspect = iw / ih;
      if (srcAspect > target) {
        sh = ih;
        sw = ih * target;
      } else {
        sw = iw;
        sh = iw / target;
      }
      sx = (iw - sw) / 2;
      sy = (ih - sh) / 2;
      // Lado largo resultante = maxDim.
      const scale = maxDim / Math.max(sw, sh);
      out.width = Math.round(sw * scale);
      out.height = Math.round(sh * scale);
    } else {
      sw = iw;
      sh = ih;
      sx = 0;
      sy = 0;
      const scale = Math.min(1, maxDim / Math.max(iw, ih));
      out.width = Math.round(iw * scale);
      out.height = Math.round(ih * scale);
    }

    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("El navegador no permite procesar la imagen.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Fondo blanco: evita negros en JPEG (WebP soporta alfa, JPEG no).
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);

    const dataUrl = out.toDataURL(mime, quality);
    return {
      dataUrl,
      mime,
      width: out.width,
      height: out.height,
      bytes: dataUrlBytes(dataUrl),
      originalBytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * `alt` descriptivo para SEO a partir de nombre + marca + unidad.
 * Ej.: "Palitos de Pan Crujiente DIA · bolsa 250 g".
 */
export function buildImageAlt(name: string, brand?: string, unit?: string): string {
  const parts = [name.trim(), brand?.trim(), unit?.trim()].filter(Boolean);
  return parts.join(" · ").slice(0, 200) || "Foto del producto";
}

/** Legible: 1.2 MB / 34 KB. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
