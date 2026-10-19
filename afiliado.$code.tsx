import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gift, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StoreShell } from "@/components/layout/store-shell";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/afiliado/$code")({ component: Page });

/**
 * Página pública de un ENLACE DE INVITACIÓN (migración 0030): la abre quien
 * recibe el enlace `…/afiliado/AF-XXXXXX` desde el chat o el WhatsApp de su
 * amigo. Explica el regalo (chapas para ambos en la PRIMERA compra), guarda el
 * código en el navegador (`br_ref`, lo captura también la cabecera al entrar a
 * la tienda con `?ref=`) y, si ya tiene cuenta abierta, se la vincula al acto.
 * Es de UN solo uso: si alguien lo gastó antes, aquí mismo lo decimos.
 */
function Page() {
  const { code } = Route.useParams();
  const br = useBr();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const infoQ = useQuery({
    queryKey: ["affiliate-info", code.toUpperCase()],
    queryFn: () => br.affiliateInfo(code),
    staleTime: 60_000,
  });
  const info = infoQ.data;

  // Guardar el código AHORA (sin esperar a entrar en la tienda): así lo hereda
  // hasta quien se registre desde el enlace en otro momento de la sesión.
  const remember = () => {
    try {
      localStorage.setItem("br_ref", (code || "").trim().toUpperCase());
    } catch {
      /* modo privado: el CTA con ?ref= sigue funcionando en el mismo navegador */
    }
  };

  async function linkAccount() {
    setBusy(true);
    try {
      await br.attachReferral(code);
      toast.success("Invitación vinculada a tu cuenta: ya puedes hacer tu primer pedido.");
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo vincular la invitación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StoreShell>
      <section className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-[1.75rem] bg-surface p-8 text-center shadow-lift">
          {infoQ.isLoading ? (
            <p className="text-sm text-muted">Cargando la invitación…</p>
          ) : !info?.ok ? (
            <>
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-ember/15">
                <TriangleAlert className="size-6 text-ember" />
              </div>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
                Este enlace ya no está disponible
              </h1>
              <p className="mt-2 text-sm text-muted">
                Puede que ya lo haya usado otra persona (cada invitación es de un
                solo uso) o que el enlace esté mal escrito. Pídele a quien te lo
                envió que te compile uno nuevo desde su cuenta.
              </p>
            </>
          ) : !info.available ? (
            <>
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-ember/15">
                <TriangleAlert className="size-6 text-ember" />
              </div>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
                Alguien ya usó esta invitación
              </h1>
              <p className="mt-2 text-sm text-muted">
                El enlace de {info.ownerName} caducó al primer uso. Aun así, bienvenido:
                entra en la tienda y crea tu cuenta — las chapas se ganan con cada pedido.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-bottle/15">
                <Gift className="size-6 text-bottle" />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-bottle">
                Te invita {info.ownerName}
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                {info.reward} chapas para ti… y {info.reward} para quien te invita
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Haz tu <strong className="text-ink">primera compra</strong> en Botella
                Rápida con esta invitación y, al recibirla, las dos cuentas suman{" "}
                <strong className="text-ink">{info.reward} chapas</strong>. Canjea las
                tuyas por regalos en la pestaña Chapas. El enlace es de un solo uso:
                vale solo para la primera compra.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    remember();
                    void navigate({ to: "/", search: { ref: code.toUpperCase() } as never }).catch(
                      () => {
                        window.location.href = `/?ref=${encodeURIComponent(code.toUpperCase())}`;
                      },
                    );
                  }}
                >
                  Comprar ahora con mi invitación
                </Button>
                {br.session ? (
                  <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void linkAccount()}>
                    {busy ? "Vinculando…" : `Vincular a mi cuenta (${br.session.name.split(" ")[0]})`}
                  </Button>
                ) : (
                  <Button asChild variant="ghost" className="w-full">
                    <Link to="/registro/cliente" search={{ ref: code.toUpperCase() } as never} onClick={remember}>
                      Crear mi cuenta con esta invitación
                    </Link>
                  </Button>
                )}
              </div>
              <p className="mt-4 text-xs text-muted">
                Al registrarte o pedir, la invitación se adjunta sola. Si el correo
                de confirmación te llega, ábrelo: si no, entra directamente.
              </p>
            </>
          )}
        </div>
      </section>
    </StoreShell>
  );
}
