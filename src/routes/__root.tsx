import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { mergeSection, SITE_DEFAULTS, type MetaSection } from "@/data/site-defaults";
import { AppProviders } from "@/lib/query-provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { useBr } from "@/lib/use-br";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_DEFAULTS.meta.title },
      {
        name: "description",
        content: SITE_DEFAULTS.meta.description,
      },
      { name: "theme-color", content: "#12100E" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,560&family=Outfit:wght@400;500;600;700&display=swap",
      },
      // Manifiesto de marca (nombre + icono del acceso directo a pantalla de
      // inicio). Va ANTES que el de la plataforma: Chromium toma el primero
      // del documento, y el de la plataforma se conserva intacto detrás.
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      // iOS elige el último apple-touch-icon con atributos coincidentes: el de
      // la plataforma se declara primero (además desactiva la duplicación del
      // inyector, que busca esa URL exacta) y nuestro logo va después.
      { rel: "apple-touch-icon", sizes: "180x180", href: "/__grok/icon-180.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/brand/icons/apple-touch-icon.png" },
    ],
  }),
  component: () => (
    <html lang="es" suppressHydrationWarning className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-night text-paper font-sans">
        <PreviewHostBridge />
        <AppProviders>
          <MetaSync />
          <Outlet />
        </AppProviders>
        <Toaster
          position="bottom-center"
          toastOptions={{
            className:
              "!bg-ink !text-surface !border-0 !rounded-2xl !font-sans !shadow-lift",
          }}
        />
        <Scripts />
      </body>
    </html>
  ),
});

/**
 * Aplica en cliente el título y la meta description editables. Se ejecuta solo
 * tras la hidratación (efecto): el HTML del servidor mantiene los defaults y no
 * hay mismatch. Sin override, escribe los mismos valores de hoy.
 */
function MetaSync() {
  const br = useBr();
  const meta = mergeSection(SITE_DEFAULTS.meta, br.content.meta as MetaSection);
  useEffect(() => {
    document.title = meta.title;
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute("content", meta.description);
  }, [meta.title, meta.description]);
  return null;
}
