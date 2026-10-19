import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/format";
import { useBr } from "@/lib/use-br";
import { fmtDate, fmtEur } from "@/lib/utils";
import { toast } from "sonner";

/** Acción fire-and-forget: avisa en toast si el servidor la rechaza. */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

export const Route = createFileRoute("/repartidor")({ component: Page });

function Page() {
  return (
    <PanelShell role="repartidor">
      <CourierInner />
    </PanelShell>
  );
}

function CourierInner() {
  const br = useBr();
  const open = br.orders.filter((o) => o.status === "pendiente" || (o.status === "asignado" && o.courier === br.session?.email));
  const active = br.orders.filter((o) => o.status === "en_reparto" && o.courier === br.session?.email);
  const done = br.orders.filter((o) => o.status === "entregado" && o.courier === br.session?.email);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Portal</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">Repartos</h1>
      </div>
      <Board title="Disponibles" empty="No hay nada en cola.">
        {open.map((o) => (
          <Card
            key={o.id}
            code={o.code}
            meta={`${o.address} · ${fmtEur(o.total)}`}
            status={o.status}
            extra={o.items.some((i) => br.products.find((p) => p.id === i.id)?.alcohol) ? "Verificar DNI: hay alcohol." : undefined}
            action={
              <Button size="sm" onClick={() => act(br.courierAccept({ id: o.id }), "Reparto aceptado")}>
                Aceptar {o.code}
              </Button>
            }
          />
        ))}
      </Board>
      <Board title="En curso" empty="Ningún reparto activo.">
        {active.map((o) => (
          <Card
            key={o.id}
            code={o.code}
            meta={`${o.address} · ${o.phone} · ${fmtDate(o.createdAt)}`}
            status={o.status}
            extra={o.notes || undefined}
            action={
              <Button size="sm" variant="bottle" onClick={() => act(br.markDelivered({ id: o.id }), "Marcado como entregado")}>
                Marcar entregado
              </Button>
            }
          />
        ))}
      </Board>
      <Board title="Entregados" empty="Aún no cierras el día.">
        {done.slice(0, 8).map((o) => (
          <Card key={o.id} code={o.code} meta={fmtEur(o.total)} status={o.status} />
        ))}
      </Board>
    </div>
  );
}

function Board({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const has = Array.isArray(children) ? children.length : children;
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl font-semibold text-paper">{title}</h2>
      {has ? <ul className="space-y-3">{children}</ul> : <p className="text-sm text-mist">{empty}</p>}
    </section>
  );
}

function Card({
  code,
  meta,
  status,
  extra,
  action,
}: {
  code: string;
  meta: string;
  status: string;
  extra?: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] bg-surface p-4 shadow-card">
      <div>
        <p className="font-display text-lg font-semibold tabular-nums">{code}</p>
        <p className="text-sm text-muted">{meta}</p>
        {extra ? <p className="mt-1 text-xs text-adult">{extra}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <Pill tone={statusTone(status)}>{STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}</Pill>
        {action}
      </div>
    </li>
  );
}
