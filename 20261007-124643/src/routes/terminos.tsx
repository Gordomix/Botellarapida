import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { SERVICE_AREA_LABEL } from "@/data/service-area";

export const Route = createFileRoute("/terminos")({ component: Page });

function Page() {
  return (
    <StoreShell>
      <article className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-paper">Términos</h1>
        <p className="mt-4 text-mist">
          Pedidos sujetos a stock y zona de entrega ({SERVICE_AREA_LABEL} y alrededores). Envío 2,90 €; gratis a partir de 25 €. Franja inmediata
          estimada en menos de 90 minutos, no es un compromiso de carrier.
        </p>
        <p className="mt-4 text-mist">
          La venta de alcohol está prohibida a menores de 18 años. El repartidor puede exigir DNI en la entrega y
          cancelar la parte de bodega si no hay verificación. Bebe con responsabilidad.
        </p>
        <p className="mt-4 text-mist">
          Desistimiento: 14 días para productos no perecederos y no abiertos, según la ley de consumidores. Reclamaciones
          desde Mi cuenta. Los pagos de esta demo no cargan tarjetas reales.
        </p>
      </article>
    </StoreShell>
  );
}
