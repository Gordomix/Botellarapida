import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";

/**
 * Página de vuelta del Checkout de Stripe (también sirve para pedidos sin
 * pago). La `?estado=` de la URL es solo orientativa: LO AUTORITATIVO es lo
 * que responde el servidor tras consultar a Stripe — la URL se puede editar a
 * mano y por eso nunca se usa como prueba de cobro.
 */

type Search = { order?: string; estado?: string };

export const Route = createFileRoute("/gracias")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    order: typeof s.order === "string" ? s.order : undefined,
    estado: typeof s.estado === "string" ? s.estado : undefined,
  }),
  component: Gracias,
});

function Gracias() {
  const { order, estado } = Route.useSearch();
  const br = useBr();
  const [paid, setPaid] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Con sesión y pedido en la URL, pregunta al servidor si Stripe cobró de
  // verdad. `paid === null` = aún sin confirmar (o no hay sesión/checkout).
  useEffect(() => {
    if (!order || !br.sessionReady || !br.session || estado !== "pago") return;
    let alive = true;
    br.checkPayment({ id: order })
      .then((r) => {
        if (alive) setPaid(Boolean(r.paid));
      })
      .catch(() => {
        if (alive) setPaid(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, estado, br.sessionReady, br.session?.sid]);

  async function retry() {
    if (!order) return;
    setBusy(true);
    try {
      const { url } = await br.payByCard({ id: order });
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }

  const title =
    paid === true
      ? "Pago completado"
      : estado === "pendiente"
        ? "Pago cancelado"
        : paid === false
          ? "Aún sin confirmar"
          : "Gracias por tu pedido";

  return (
    <StoreShell>
      <section className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-[1.75rem] bg-surface p-8 text-center shadow-lift">
          {paid === true ? (
            <CheckCircle2 className="mx-auto size-12 text-bottle" />
          ) : (
            <Clock className="mx-auto size-12 text-ember" />
          )}
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 text-sm text-muted">
            {paid === true
              ? "La pasarela ha confirmado el cobro. Tu pedido ya está en cola para preparar y repartir."
              : estado === "pendiente"
                ? "Has salido del pago sin completarlo. El pedido sigue existiendo: puedes pagar desde aquí."
                : paid === false
                  ? "El cobro todavía no aparece como pagado en la pasarela. Si has completado el pago, espérate un momento y recarga esta página."
                  : "Tu pedido está creado. El repartidor cobrará en la entrega según el método elegido."}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {paid !== true && estado === "pago" && order ? (
              <Button onClick={retry} disabled={busy}>
                {busy ? "Abriendo el pago…" : "Reintentar el pago"}
              </Button>
            ) : null}
            {paid !== true && estado === "pendiente" && order && br.paymentsEnabled ? (
              <Button onClick={retry} disabled={busy}>
                {busy ? "Abriendo el pago…" : "Pagar ahora"}
              </Button>
            ) : null}
            <Button asChild variant={paid === true ? "bottle" : "ghost"}>
              <Link to="/cuenta">Ver mis pedidos</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">Volver a la tienda</Link>
            </Button>
          </div>
        </div>
      </section>
    </StoreShell>
  );
}
