import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Navigation, RotateCcw, Star } from "lucide-react";
import { toast } from "sonner";
import { OrderChat } from "@/components/chat/order-chat";
import { OrderInvoice } from "@/components/chat/order-invoice";
import { InviteLinkCard } from "@/components/affiliate/invite-link-card";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/format";
import { fmtDeliveryDate } from "@/lib/delivery-days";
import { fileToOptimizedImage } from "@/lib/image-opt";
import { useBr } from "@/lib/use-br";
import { fmtDate, fmtEur } from "@/lib/utils";

export const Route = createFileRoute("/cuenta")({ component: Page });

function Page() {
  return (
    <PanelShell role="user">
      <CuentaInner />
    </PanelShell>
  );
}

function CuentaInner() {
  const br = useBr();
  const mine = br.orders
    .filter((o) => o.customer === br.session?.email)
    .sort((a, b) => b.createdAt - a.createdAt);
  const claims = br.claims.filter((c) => c.email === br.session?.email);

  /**
   * «Repetir pedido» en un toque: rellena la cesta con los productos de este
   * pedido pasado. Los dados de baja se ignoran y se avisan; los +18 piden la
   * confirmación de edad igual que al añadir uno a uno.
   */
  function repeatOrder(o: (typeof mine)[number]) {
    const res = br.reorderItems(o.items.map((it) => ({ id: it.id, qty: it.qty })));
    if (res.added === 0) {
      toast.error("Ningún producto de este pedido sigue disponible.");
    } else if (res.skipped > 0) {
      toast.warning(`${res.added} a la cesta · ${res.skipped} ya no están en catálogo`);
    } else {
      toast.success("Pedido repetido: todo en la cesta");
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Área cliente</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">
            Tus pedidos
          </h1>
          <Link
            to="/mensajes"
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-card hover:bg-ink hover:text-paper"
          >
            Ir a Tus mensajes
          </Link>
        </div>
      </div>
      {mine.length === 0 ? (
        <p className="text-mist">Aún no hay pedidos. La cesta de la tienda termina aquí.</p>
      ) : (
        <ul className="space-y-4">
          {mine.map((o) => (
            <li key={o.id} className="rounded-[1.5rem] bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-xl font-semibold tabular-nums">{o.code}</p>
                <div className="flex items-center gap-2">
                  {/* Seguimiento en vivo: solo mientras el pedido está en juego. */}
                  {o.status === "asignado" || o.status === "en_reparto" ? (
                    <Link
                      to="/seguimiento/$code"
                      params={{ code: o.code }}
                      className="inline-flex items-center gap-1 rounded-full bg-bottle px-3 py-1.5 text-xs font-semibold text-paper shadow-card transition hover:opacity-90"
                    >
                      <Navigation className="size-3.5" /> Seguir en directo
                    </Link>
                  ) : null}
                  <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted">
                {fmtDate(o.createdAt)} · {fmtEur(o.total)} · {o.address}
              </p>
              {/* Fase 11: si el pedido se hizo un día sin reparto, la tarjeta lo
                  dice clarísimo: llega el día de reparto, no «en 30 minutos». */}
              {o.scheduledFor && o.status !== "entregado" && o.status !== "cancelado" ? (
                <p className="mt-1 text-sm font-semibold text-bottle">
                  📅 Reservado: te llega el {fmtDeliveryDate(o.scheduledFor)}
                </p>
              ) : null}
              {/* Desglose honesto: lo que el servidor cobró de más o descontó. */}
              {(o.discount ?? 0) > 0 || (o.nightSurcharge ?? 0) > 0 ? (
                <p className="mt-1 text-xs text-muted">
                  {(o.discount ?? 0) > 0 ? (
                    <span className="text-bottle">
                      Cupón {o.couponCode ?? ""} −{fmtEur(o.discount ?? 0)}
                    </span>
                  ) : null}
                  {(o.discount ?? 0) > 0 && (o.nightSurcharge ?? 0) > 0 ? " · " : null}
                  {(o.nightSurcharge ?? 0) > 0 ? (
                    <span>+{fmtEur(o.nightSurcharge ?? 0)} madrugada</span>
                  ) : null}
                </p>
              ) : null}
              <ol className="mt-4 space-y-1.5 border-l border-line pl-4 text-sm">
                {o.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-muted">{fmtDate(h.at)}</span> · {h.what}{" "}
                    <span className="text-muted">({h.by})</span>
                  </li>
                ))}
              </ol>
              <ul className="mt-3 text-sm text-muted">
                {o.items.map((it) => (
                  <li key={it.id}>
                    {it.qty} × {it.name}
                  </li>
                ))}
              </ul>
              {o.status !== "cancelado" ? (
                <div className="mt-4">
                  <Button size="sm" variant="bottle" onClick={() => repeatOrder(o)}>
                    <RotateCcw />
                    Repetir pedido
                  </Button>
                </div>
              ) : null}
              {/* Reseña privada: solo en entregados que el cliente no ha valorado
                  ya. Nace privada; el admin decide si se publica en la portada. */}
              {o.status === "entregado" && !br.myReviewedOrderIds.includes(o.id) ? (
                <ReviewForm orderId={o.id} />
              ) : null}
              <OrderChat orderId={o.id} />
              <OrderInvoice orderId={o.id} status={o.status} />
            </li>
          ))}
        </ul>
      )}

      <InviteLinkCard />

      <ClaimForm />

      {claims.length ? (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Reclamaciones</h2>
          <ul className="space-y-3">
            {claims.map((c) => (
              <li key={c.id} className="rounded-2xl bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {c.orderCode || "Sin código"} · {c.type}
                  </p>
                  <Pill tone={statusTone(c.status)}>{c.status}</Pill>
                </div>
                <p className="mt-2 text-sm">{c.text}</p>
                {c.answer ? <p className="mt-2 text-sm text-bottle">{c.answer}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Reseña privada de un pedido entregado: estrellas, comentario opcional y foto
 * opcional (se reduce EN el navegador del cliente a WebP ≤600 px antes de
 * viajar). El servidor la guarda como `privada`: nunca se ve publicada sin que
 * el admin la apruebe, y el email del cliente no viaja a la vitrina pública.
 */
function ReviewForm({ orderId }: { orderId: string }) {
  const br = useBr();
  const [stars, setStars] = useState(5);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      // Sin recorte forzado: la foto del cliente se respeta tal cual, solo se
      // reduce de peso (la cámara del móvil manda 4-6 MB).
      const o = await fileToOptimizedImage(file, { maxDim: 600, quality: 0.8 });
      setPhoto(o.dataUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await br.submitReview({ orderId, stars, text, image: photo ?? undefined });
      toast.success("¡Gracias por valorar! Tu reseña es privada: la tienda decide si la muestra.");
    } catch (e) {
      toast.error((e as Error).message || "No se pudo enviar la reseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-paper/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        ¿Cómo fue la experiencia?
      </p>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
            onClick={() => setStars(n)}
            className="grid size-9 place-items-center rounded-full transition hover:bg-surface"
          >
            <Star className={cnStar(n <= stars)} />
          </button>
        ))}
        <span className="ml-1 text-xs text-muted tabular-nums">{stars}/5</span>
      </div>
      <textarea
        value={text}
        onChange={(ev) => setText(ev.target.value.slice(0, 600))}
        rows={2}
        placeholder="Cuéntanos brevemente cómo fue (opcional)."
        className="mt-2 w-full rounded-xl bg-paper p-3 text-sm shadow-card outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => void pickPhoto(ev.target.files?.[0])}
          />
          Añadir foto (opcional)
        </label>
        {photo ? (
          <span className="inline-flex items-center gap-2">
            <img
              src={photo}
              alt="Foto de la reseña"
              className="size-10 rounded-lg object-cover shadow-card"
            />
            <button
              type="button"
              className="text-xs text-ember underline"
              onClick={() => setPhoto(null)}
            >
              Quitar foto
            </button>
          </span>
        ) : null}
        <Button
          size="sm"
          variant="bottle"
          className="ml-auto"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Enviando…" : "Enviar valoración"}
        </Button>
      </div>
      <p className="mt-2 text-[0.65rem] text-muted">
        Se envía como privada: solo se hará pública si la tienda la aprueba.
      </p>
    </div>
  );
}

/** Estrella llena con color ámbar si elegida; contorno suave si no. */
function cnStar(active: boolean) {
  return active ? "size-5 fill-[#e0a458] text-[#e0a458]" : "size-5 text-muted";
}

function ClaimForm() {
  const br = useBr();
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOk("");
    setErr("");
    const fd = new FormData(e.currentTarget);
    try {
      // El servidor fija el `email` desde la sesión; el cliente no lo manda.
      await br.addClaim({
        orderCode: String(fd.get("code")),
        type: String(fd.get("type")) as "retraso" | "faltante" | "roto" | "otro",
        text: String(fd.get("text")),
      });
      setOk("Reclamación enviada.");
      e.currentTarget.reset();
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo enviar la reclamación.");
    }
  }
  return (
    <section className="rounded-[1.5rem] bg-surface p-5 shadow-card">
      <h2 className="font-display text-2xl font-semibold">Abrir reclamación</h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          name="code"
          placeholder="Código BR-XXXX"
          className="h-11 rounded-2xl bg-paper px-3 text-sm shadow-card"
        />
        <select name="type" className="h-11 rounded-2xl bg-paper px-3 text-sm shadow-card">
          <option value="retraso">Retraso</option>
          <option value="faltante">Faltante</option>
          <option value="roto">Producto dañado</option>
          <option value="otro">Otro</option>
        </select>
        <textarea
          name="text"
          required
          placeholder="Qué ha pasado"
          className="min-h-24 rounded-2xl bg-paper p-3 text-sm shadow-card sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <Button type="submit">Enviar</Button>
          {ok ? <span className="ml-3 text-sm text-bottle">{ok}</span> : null}
          {err ? <span className="ml-3 text-sm text-ember">{err}</span> : null}
        </div>
      </form>
    </section>
  );
}
