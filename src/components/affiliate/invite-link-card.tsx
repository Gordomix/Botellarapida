import { Check, Copy, Share2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";
import { fmtDate } from "@/lib/utils";

/**
 * Tarjeta «Invita y gana chapas» (migración 0030): cualquier cuenta registrada
 * —cliente desde su área o repartidor desde su portal— genera UN enlace de
 * invitación. Cuando quien lo recibe completa su PRIMERA compra entregada,
 * ambas partes suman las chapas del regalo. El enlace se cierra tras ese uso.
 *
 * Si ya existe un enlace sin usar, el servidor devuelve el mismo: la tarjeta
 * muestra siempre la URL estable y no acumula códigos muertos.
 */
export function InviteLinkCard() {
  const br = useBr();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = br.affiliateLinks.find((l) => !l.usedBy) ?? null;
  const spent = br.affiliateLinks.filter((l) => l.usedBy);
  // Origen solo en cliente: el SSR del build no tiene `window`.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const linkUrl = open ? `${origin}/afiliado/${open.code}` : "";

  async function generate() {
    setBusy(true);
    try {
      await br.createAffiliateLink();
      toast.success("Enlace listo: compártelo por WhatsApp o redes.");
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo generar el enlace.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.message("Tu navegador no permite copiar: selecciona el texto y cópialo a mano.");
    }
  }

  async function share() {
    const payload = {
      title: "Botella Rápida",
      text: "Te invito a Botella Rápida: con mi enlace, en tu primera compra tú y yo ganamos 20 chapas cada uno. 🛵🥤",
      url: linkUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await copy();
        toast.success("Enlace copiado: pégalo donde quieras compartirlo.");
      }
    } catch {
      /* el usuario canceló el diálogo nativo: no hay nada que avisar */
    }
  }

  return (
    <section className="rounded-[1.5rem] bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-bottle/15">
          <Users className="size-5 text-bottle" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold">Invita y gana chapas</h2>
          <p className="mt-1 text-sm text-muted">
            Comparte tu enlace: cuando la persona invitada reciba su{" "}
            <strong className="text-ink">primera compra</strong>, las dos cuentas
            suman <strong className="text-ink">{open?.reward ?? 20} chapas</strong>.
            Cada enlace vale un solo uso.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {br.affiliateLinksLoading && !open ? (
          <p className="text-sm text-muted">Comprobando tu enlace…</p>
        ) : open ? (
          <div className="space-y-3">
            <p className="break-all rounded-2xl bg-paper px-4 py-3 text-sm font-medium shadow-card">
              {linkUrl}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="bottle" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "¡Copiado!" : "Copiar enlace"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void share()}>
                <Share2 className="size-4" /> Compartir
              </Button>
            </div>
            <p className="text-xs text-muted">
              Enlace activo · pendiente del primer pedido de tu invitado. Cuando se
              use, recibirás un aviso en la 🔔 de la cabecera.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="bottle" disabled={busy} onClick={() => void generate()}>
              {busy ? "Generando…" : "Generar mi enlace de invitación"}
            </Button>
            {spent.length ? (
              <p className="text-xs text-muted">
                Ya has invitado {spent.length} {spent.length === 1 ? "vez" : "veces"} · la última, {fmtDate(spent[0].usedAt ?? spent[0].createdAt)}.
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Sin generar aún pero con histórico: dejar visible el último resultado. */}
      {!open && spent.length ? (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {spent.slice(0, 5).map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="font-mono">{l.code}</span>
              <span>+{l.reward} chapas · {fmtDate(l.usedAt ?? l.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
