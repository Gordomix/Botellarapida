import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { SERVICE_AREA_LABEL } from "@/data/service-area";
import { AppProviders } from "@/lib/query-provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Botella Rápida";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          `Botella Rápida: ultramarinos online, aperitivos, snacks, refrescos y bodega a precios de supermercado. Entrega en menos de 90 minutos en ${SERVICE_AREA_LABEL}.`,
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
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
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
