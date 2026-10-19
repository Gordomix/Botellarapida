import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { SERVICE_AREA_LABEL } from "@/data/service-area";

export const Route = createFileRoute("/privacidad")({ component: Page });

function Page() {
  return (
    <StoreShell>
      <article className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-paper">Privacidad</h1>
        <p className="mt-4 text-mist">
          Botella Rápida S.L. trata los datos de pedidos, cuentas y soporte para entregar ultramarinos en nuestra zona de
          reparto ({SERVICE_AREA_LABEL} y alrededores). Base jurídica: ejecución del contrato y consentimiento del age gate.
        </p>
        <p className="mt-4 text-mist">
          Usuarios, pedidos, reclamaciones y soporte se guardan en la base de datos del servidor (MySQL). La cesta y la
          declaración de mayoría de edad se conservan solo en tu navegador. No hay cesión a terceros ni cookies
          publicitarias. Para ejercer derechos RGPD: privacidad@botellarapida.es.
        </p>
        <p className="mt-4 text-mist">
          El age gate recuerda tu declaración de mayoría de edad en el dispositivo. El alcohol no se muestra sin esa
          declaración. En un entorno real, las contraseñas irían hasheadas en servidor y el pago por pasarela certificada.
        </p>
      </article>
    </StoreShell>
  );
}
