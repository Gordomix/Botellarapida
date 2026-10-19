import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { OrderChat } from "@/components/chat/order-chat";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { STATUS_LABEL } from "@/lib/format";
import { useBr } from "@/lib/use-br";
import { cn, fmtDate } from "@/lib/utils";

export const Route = createFileRoute("/mensajes")({
  component: Page,
  // Enlace de la campanita (migración 0030): `?order=<id>` sube y resalta la
  // conversación del pedido que notificó el mensaje.
  validateSearch: (search: Record<string, unknown>): { order?: string } => ({
    order: typeof search.order === "string" && search.order ? search.order : undefined,
  }),
});

function Page() {
  return (
    <PanelShell role="user">
      <MensajesInner />
    </PanelShell>
  );
}

/**
 * Apartado de chat para el cliente. Aquí puede VOLVER a la conversación de
 * cualquier pedido (activo o cerrado), no solo al inicio. Reutiliza `OrderChat`,
 * cuya autorización (dueño / repartidor asignado / admin) se valida SIEMPRE en
 * servidor según la sesión — el navegador no manda identidad ni rol. El hilo se
 * monta solo al abrirlo, así que una lista larga no dispara N consultas de golpe.
 */
function MensajesInner() {
  const br = useBr();
  const { order: focusId } = Route.useSearch();
  const mine = br.orders
    .filter((o) => o.customer === br.session?.email)
    .sort((a, b) => {
      // El pedido señalado por la notificación va el primero (arriba de la lista).
      if (focusId && a.id === focusId) return -1;
      if (focusId && b.id === focusId) return 1;
      return b.createdAt - a.createdAt;
    });

  // Fase 12: premios de la ruleta ya reclamados. Cada uno abre un hilo de chat
  // con soporte/admin (mismo mecanismo que los pedidos, autorizado en servidor).
  const claims = (br.raffle?.claims ?? []).slice().sort((a, b) => {
    if (focusId && a.entryId === focusId) return -1;
    if (focusId && b.entryId === focusId) return 1;
    return b.createdAt - a.createdAt;
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Área cliente</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
          Tus mensajes
        </h1>
        <p className="mt-1 text-sm text-muted">
          Vuelve cuando quieras a la conversación de cualquier pedido con tu repartidor o con
          soporte. Nadie ve el teléfono del otro.
        </p>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-[1.5rem] bg-surface p-6 text-center shadow-card">
          <p className="text-mist">
            Aún no tienes conversaciones. Aparecerán aquí en cuanto hagas un pedido.
          </p>
          <Link
            to="/"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-bottle"
          >
            <MessageSquare className="size-4" /> Ir a la tienda
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {mine.map((o) => (
            <li
              key={o.id}
              className={cn(
                "rounded-[1.5rem] bg-surface p-5 shadow-card",
                focusId === o.id && "ring-2 ring-ember/60",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-xl font-semibold tabular-nums">{o.code}</p>
                <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
              </div>
              <p className="mt-1 text-sm text-muted">{fmtDate(o.createdAt)}</p>
              <OrderChat orderId={o.id} />
            </li>
          ))}
        </ul>
      )}

      {claims.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-paper">
              🎁 Chats de tus premios
            </h2>
            <p className="mt-1 text-sm text-muted">
              Conversaciones abiertas para coordinar la entrega de los premios que reclamaste en la
              ruleta.
            </p>
          </div>
          <ul className="space-y-4">
            {claims.map((c) => (
              <li
                key={c.entryId}
                className={cn(
                  "rounded-[1.5rem] bg-surface p-5 shadow-card",
                  focusId === c.entryId && "ring-2 ring-ember/60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-lg font-semibold text-ink">{c.prizeName}</p>
                  <span className="font-mono text-xs text-muted">{c.code}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{fmtDate(c.createdAt)}</p>
                <OrderChat
                  orderId={c.entryId}
                  label="Chat del premio"
                  emptyHint="Escribe a soporte para coordinar cuándo te entregamos el premio."
                  startOpen={focusId === c.entryId}
                  highlight={focusId === c.entryId}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
