import { createFileRoute } from "@tanstack/react-router";

/**
 * Punto de salud MÍNIMO para mantener despierto el servicio.
 *
 * Render (plan gratuito) duerme la app tras ~15 min sin tráfico: el siguiente
 * visitante espera un arranque en frío. Un vigilante externo (UptimeRobot,
 * cron-job, etc.) golpea esta URL cada pocos minutos y evita el sueño. El
 * `loader` devuelve texto plano sin tocar la base de datos ni montar la UI, así
 * que cada ping es barato y no interfiere con la app real.
 *
 * Se puede abrir a mano en https://tu-dominio/health para comprobar que vive.
 */
export const Route = createFileRoute("/health")({
  loader: () => ({ ok: true, at: Date.now() }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: Health,
});

function Health() {
  const data = Route.useLoaderData();
  return (
    <main className="grid min-h-screen place-items-center bg-ink p-8 text-center">
      <div>
        <p className="font-display text-2xl font-semibold text-paper">Botella Rápida · OK</p>
        <p className="mt-2 text-sm text-mist">Servicio despierto · {new Date(data.at).toLocaleString()}</p>
      </div>
    </main>
  );
}
