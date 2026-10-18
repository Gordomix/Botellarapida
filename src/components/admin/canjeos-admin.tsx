import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderChat } from "@/components/chat/order-chat";
import { useBr } from "@/lib/use-br";
import { cn, fmtDate } from "@/lib/utils";
import { ChapaIcon } from "@/routes/chapas";
import type { ChapaRedemption } from "@/data/types";

/** Como `act()` del panel: fire-and-forget con toast de error. */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

const FILTERS = ["todos", "pendiente", "entregado", "cancelado"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TONE: Record<ChapaRedemption["status"], string> = {
  entregado: "text-bottle",
  cancelado: "text-ember",
  pendiente: "text-muted",
};

/**
 * Pestaña «Canjeos» del panel: cada canje por chapas es gestionable aquí.
 * Además del estado (entregar / cancelar con devolución), abre el CHAT con
 * el cliente que canjeó para coordinar la entrega del regalo (migración 0028:
 * el hilo reutiliza `br_chat_messages` con el id del canje).
 */
export function CanjeosAdmin() {
  const br = useBr();
  const data = br.adminChapa;
  const [filter, setFilter] = useState<Filter>("todos");

  if (br.adminChapaLoading || !data) {
    return (
      <div className="grid place-items-center py-16 text-mist">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const reds = data.redemptions;
  const pending = reds.filter((r) => r.status === "pendiente");
  const shown = filter === "todos" ? reds : reds.filter((r) => r.status === filter);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Canjeos por chapas</h2>
        <p className="mt-2 text-xs text-muted">
          Habla con el cliente desde el «Chat» de cada canje para acordar cómo le llega el regalo
          (con el próximo pedido, en mano…). Marca «Entregado» al dárselo. Si cancelas un canje
          pendiente, las chapas se devuelven solas.
        </p>
        {pending.length ? (
          <p className="mt-3 rounded-xl bg-bottle/10 p-3 text-sm font-medium text-bottle">
            🔴 {pending.length} canje(s) esperando entrega:{" "}
            {pending.map((r) => `${r.code} (${r.rewardTitle})`).join(", ")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium capitalize",
                filter === f ? "bg-ink text-surface" : "bg-paper shadow-card",
              )}
            >
              {f}
              {f === "pendiente" && pending.length ? ` (${pending.length})` : ""}
            </button>
          ))}
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted shadow-card">
          {reds.length === 0
            ? "Nadie ha canjeado chapas todavía: los canjes aparecerán aquí en cuanto alguien gaste las suyas."
            : "Ningún canje coincide con el filtro."}
        </p>
      ) : (
        <ul className="space-y-4">
          {shown.map((r) => (
            <li key={r.id} className="rounded-2xl bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {r.rewardTitle}{" "}
                    <span className="font-mono text-xs text-muted">({r.code})</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {r.customerName || r.customer}
                    <span className="ml-1 text-xs text-mist">· {r.customer}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <ChapaIcon size={14} /> {r.cost} chapas · {fmtDate(r.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-semibold capitalize", STATUS_TONE[r.status])}>
                    {r.status === "pendiente" ? "en camino" : r.status}
                  </span>
                  {r.status === "pendiente" ? (
                    <>
                      <Button
                        size="sm"
                        variant="bottle"
                        onClick={() =>
                          act(br.setChapaRedemption({ id: r.id, status: "entregado" }), "Canje entregado")
                        }
                      >
                        Marcar entregado
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            br.setChapaRedemption({ id: r.id, status: "cancelado" }),
                            "Canje cancelado (chapas devueltas)",
                          )
                        }
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {/* Hilo con el cliente (id = canje): autorizado en servidor por
                  chatAccess, que admite redenciones además de pedidos. */}
              {r.status !== "cancelado" ? (
                <OrderChat
                  orderId={r.id}
                  label="Chat con el cliente"
                  emptyHint="Escribe al cliente para coordinar la entrega del regalo."
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
