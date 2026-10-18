import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Printer, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Invoice } from "@/data/types";
import { getInvoiceFn, issueInvoiceFn } from "@/lib/br-api";
import { currentSession, currentSid } from "@/lib/br-db";
import { fmtEur } from "@/lib/utils";

/**
 * Factura POR PEDIDO (de muestra). La puede emitir el admin o el repartidor
 * asignado cuando el pedido está entregado; el cliente solo puede verla si ya
 * existe. El número y el importe los fija el servidor (recalculados contra la
 * BD): este componente no manda nunca un total.
 */

function fecha(ts: number) {
  return new Date(ts).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function OrderInvoice({
  orderId,
  status,
}: {
  orderId: string;
  status?: string;
}) {
  const [me] = useState(() => currentSession());
  const [sid] = useState(() => currentSid());
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const canIssue = me?.role === "admin" || me?.role === "repartidor";
  const key = ["invoice", orderId, sid ?? "anon"] as const;

  const invQ = useQuery<Invoice | null>({
    queryKey: key,
    queryFn: () => getInvoiceFn({ data: { sid, orderId } }),
    enabled: Boolean(sid),
  });
  const invoice = invQ.data ?? null;

  const issueMut = useMutation({
    mutationFn: () => issueInvoiceFn({ data: { sid, orderId } }),
    onSuccess: (inv) => {
      qc.setQueryData(key, inv);
      setOpen(true);
      toast.success("Factura emitida.");
    },
    onError: (err) => toast.error((err as Error)?.message || "No se pudo facturar."),
  });

  if (!invoice && !canIssue) return null;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {invoice ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-ink shadow-card transition-colors hover:bg-ink hover:text-paper"
          >
            <FileText className="size-3.5" />
            Ver factura {invoice.number}
          </button>
        ) : null}
        {canIssue && !invoice ? (
          <button
            type="button"
            disabled={issueMut.isPending || (status ? status !== "entregado" : false)}
            onClick={() => issueMut.mutate()}
            title={status && status !== "entregado" ? "Solo pedidos entregados" : undefined}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper shadow-card transition-colors hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText className="size-3.5" />
            {issueMut.isPending ? "Emitiendo…" : "Emitir factura"}
          </button>
        ) : null}
      </div>

      {open && invoice ? (
        <>
          <style>{`@media print{body *{visibility:hidden!important}#invoice-doc,#invoice-doc *{visibility:visible!important}#invoice-doc{position:fixed!important;inset:0!important;box-shadow:none!important;border-radius:0!important;max-height:none!important;overflow:visible!important}}`}</style>
          <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
            <div
              id="invoice-doc"
              className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 text-ink shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bottle">
                    Factura · muestra
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">{invoice.number}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid size-10 place-items-center rounded-full hover:bg-paper"
                  aria-label="Cerrar"
                >
                  <X className="size-5" />
                </button>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Fecha</dt>
                <dd className="tabular-nums">{fecha(invoice.createdAt)}</dd>
                <dt className="text-muted">Pedido</dt>
                <dd className="font-medium">{invoice.orderCode}</dd>
                <dt className="text-muted">Cliente</dt>
                <dd>{invoice.customerName}</dd>
                <dt className="text-muted">Emitida por</dt>
                <dd>
                  {invoice.issuedByName} ({invoice.issuedByRole})
                </dd>
              </dl>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-paper/40 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 font-medium">Producto</th>
                    <th className="py-2 text-right font-medium">Ud.</th>
                    <th className="py-2 text-right font-medium">Precio</th>
                    <th className="py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((it, idx) => (
                    <tr key={idx} className="border-b border-paper/20">
                      <td className="py-2">{it.name}</td>
                      <td className="py-2 text-right tabular-nums">{it.qty}</td>
                      <td className="py-2 text-right tabular-nums">{fmtEur(it.price)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtEur(it.price * it.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Productos</span>
                  <span className="tabular-nums">{fmtEur(invoice.itemsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Envío</span>
                  <span className="tabular-nums">{fmtEur(invoice.shippingCost)}</span>
                </div>
                <div className="flex justify-between border-t border-paper/40 pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums text-ember">{fmtEur(invoice.total)}</span>
                </div>
              </div>

              <p className="mt-4 rounded-2xl bg-paper px-3 py-2 text-xs text-muted">
                Documento de muestra sin datos fiscales (sin CIF/NIF ni IVA
                desglosado). La numeración y el importe los ha fijado el servidor.
              </p>

              <div className="mt-5 flex gap-2">
                <Button onClick={() => window.print()}>
                  <Printer className="size-4" />
                  Imprimir / PDF
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
