import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, FlaskConical } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";
import type { DemoPaymentInfo } from "@/data/types";

/**
 * Pasarela de pago SIMULADA (migración 0029). Solo se llega aquí con el «modo
 * pruebas» activo en Panel → Pagos: el checkout del pedido o de la ruleta
 * lleva a esta página en lugar de salir a PayPal. El cliente pulsa «Pagar» y
 * el servidor marca el pago como confirmado SIN COBRAR NADA (el historial lo
 * deja claro). Sirve para comprobar el flujo completo — pedido pagado, premio
 * descubierto, avisos al admin — antes de enchufar la pasarela real.
 */

export const Route = createFileRoute("/pago-demo")({
  component: Page,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
});

function Page() {
  const br = useBr();
  const { token } = Route.useSearch();
  const [info, setInfo] = useState<DemoPaymentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Falta el identificador del pago de prueba.");
      return;
    }
    let alive = true;
    br.demoPaymentInfo(token)
      .then((d) => {
        if (alive) setInfo(d);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || "No se pudo cargar el pago de prueba.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, br.session?.sid]);

  async function onApprove() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await br.approveDemoPayment({ token });
      // Mismo destino que la pasarela real al completar el cobro.
      window.location.href =
        res.kind === "pedido"
          ? `/gracias?order=${res.ref}&estado=pago`
          : `/sorteo?entry=${res.ref}&estado=pago`;
    } catch (err) {
      setBusy(false);
      setError((err as Error)?.message || "No se pudo completar el pago de prueba.");
    }
  }

  async function onCancel() {
    if (!token) return;
    setBusy(true);
    try {
      await br.cancelDemoPayment({ token });
      window.location.href = info?.kind === "ruleta" ? "/sorteo" : "/catalogo";
    } catch (err) {
      setBusy(false);
      setError((err as Error)?.message || "No se pudo cancelar el pago.");
    }
  }

  const done = info?.status === "pagado";

  return (
    <StoreShell>
      <div className="mx-auto max-w-md px-4 py-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b8860b]">
          <FlaskConical className="mr-1 inline h-3.5 w-3.5" />
          Pasarela de pruebas
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Pago de prueba</h1>
        <p className="mt-3 flex items-start justify-center gap-2 rounded-2xl border border-[#b8860b]/50 bg-[#b8860b]/10 p-3 text-left text-xs font-medium text-[#8a6508]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          MODO PRUEBAS ACTIVO: esto simula la pasarela de pago real. Al aprobar no se cobra
          nada en ninguna cuenta; el pedido (o el premio) queda pagado igual que con PayPal.
        </p>

        {error ? (
          <div className="mt-8 rounded-2xl bg-surface p-5 text-left shadow-card">
            <p className="text-sm font-semibold text-ember">No se pudo abrir el pago</p>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <p className="mt-3 text-xs text-mist">
              Si has cerrado sesión, vuelve a entrar y abre el pago desde «Mis pedidos» o desde
              la ruleta.
            </p>
            <Button asChild variant="bottle" className="mt-4">
              <Link to="/cuenta">Ir a mis pedidos</Link>
            </Button>
          </div>
        ) : !info ? (
          <div className="mt-10 grid place-items-center py-8 text-mist">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="mt-8 rounded-[1.5rem] border border-line bg-ink p-6 text-center shadow-card">
            <p className="text-sm text-mist">
              {info.kind === "pedido" ? "Pago de pedido" : "Reclamación de premio · ruleta"}
            </p>
            <p className="mt-1 font-display text-2xl font-semibold text-paper">
              {info.amount.toFixed(2)} €
            </p>
            <p className="mt-1 text-xs text-muted">
              Referencia: <span className="font-semibold">{info.code}</span>
            </p>

            {done || info.status === "cancelado" ? (
              <>
                <CheckCircle2
                  className={`mx-auto mt-5 size-10 ${info.status === "pagado" ? "text-bottle" : "text-ember"}`}
                />
                <p className="mt-2 text-sm font-semibold text-paper">
                  {info.status === "pagado"
                    ? "Este pago de prueba ya está aprobado."
                    : "Este pago de prueba fue cancelado."}
                </p>
                <Button
                  asChild
                  variant={info.status === "pagado" ? "bottle" : "outline"}
                  className="mt-4"
                >
                  <Link to={info.status === "pagado" && info.kind === "ruleta" ? "/sorteo" : "/cuenta"}>
                    {info.status === "pagado"
                      ? info.kind === "ruleta"
                        ? "Ver mi premio descubierto"
                        : "Ver mi pedido"
                      : "Volver"}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <div className="mt-5 rounded-2xl bg-surface/10 p-4 text-left text-xs text-mist">
                  <p className="flex justify-between border-b border-line/40 pb-2">
                    <span>Comercio</span>
                    <span className="font-semibold text-paper">Botella Rápida</span>
                  </p>
                  <p className="mt-2 flex justify-between border-b border-line/40 pb-2">
                    <span>Método (simulado)</span>
                    <span className="font-semibold text-paper">Pago de pruebas</span>
                  </p>
                  <p className="mt-2 flex justify-between">
                    <span>Total</span>
                    <span className="font-semibold text-paper">{info.amount.toFixed(2)} €</span>
                  </p>
                </div>
                <Button
                  size="lg"
                  variant="bottle"
                  className="mt-5 w-full"
                  disabled={busy}
                  onClick={onApprove}
                >
                  {busy ? "Procesando…" : `Pagar ${info.amount.toFixed(2)} € (simulado)`}
                </Button>
                <button
                  type="button"
                  className="mt-3 block text-xs text-muted underline-offset-2 hover:underline"
                  disabled={busy}
                  onClick={onCancel}
                >
                  Cancelar el pago
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-[11px] text-mist">
          ¿Quieres cobrar pagos reales? Apaga el modo pruebas en Panel → Pagos y configura
          PayPal.
        </p>
      </div>
    </StoreShell>
  );
}
