import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle, BellRing, Copy, MapPin, Navigation, Phone } from "lucide-react";
import { InviteLinkCard } from "@/components/affiliate/invite-link-card";
import { OrderChat } from "@/components/chat/order-chat";
import { OrderInvoice } from "@/components/chat/order-invoice";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import type { Order } from "@/data/types";
import { townForCp } from "@/data/service-area";
import { STATUS_LABEL, shiftRange } from "@/lib/format";
import { fmtDeliveryDate } from "@/lib/delivery-days";
import { useBr, useOrderTracking } from "@/lib/use-br";
import { fmtEur } from "@/lib/utils";
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

/** Minutos desde la creación, en texto legible ("hace 12 min"). */
function timeAgo(at: number) {
  const min = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

const PAY_LABEL: Record<Order["paymentMethod"], string> = {
  tarjeta: "Tarjeta",
  bizum: "Bizum",
  apple_google_pay: "Apple/Google Pay",
  efectivo: "Efectivo",
};

function CourierInner() {
  const br = useBr();
  const me = br.session?.email;
  // Pedido que el repartidor quiere cancelar: abre el diálogo de motivo obligatorio.
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  // FIFO: el más antiguo primero, que es el que más espera.
  const open = br.orders
    .filter((o) => o.status === "pendiente" || (o.status === "asignado" && o.courier === me))
    .sort((a, b) => a.createdAt - b.createdAt);
  const active = br.orders
    .filter((o) => o.status === "en_reparto" && o.courier === me)
    .sort((a, b) => a.createdAt - b.createdAt);
  const done = br.orders
    .filter((o) => o.status === "entregado" && o.courier === me)
    .sort((a, b) => b.createdAt - a.createdAt);

  // Caja del repartidor: efectivo que aún tiene que cobrar y importe cobrado
  // en los repartos cerrados hoy (aprox.: último hito de historia de hoy).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cashPending = [...open, ...active]
    .filter((o) => o.paymentMethod === "efectivo")
    .reduce((s, o) => s + o.total, 0);
  const doneToday = done.filter(
    (o) => (o.history.at(-1)?.at ?? o.createdAt) >= todayStart.getTime(),
  );
  const cashDone = doneToday
    .filter((o) => o.paymentMethod === "efectivo")
    .reduce((s, o) => s + o.total, 0);

  // Un pedido contiene +18 si alguno de sus productos lo es en el catálogo.
  const hasAlcohol = (o: Order) =>
    o.items.some((i) => br.products.find((p) => p.id === i.id)?.alcohol);

  return (
    <div className="space-y-10">
      {/* Aviso de faltas: pop-up si el admin te ha notificado alguna pendiente. */}
      <FaultAlert />

      {/* GPS en vivo + avisos de pedidos nuevos (el «SMS gratis» real). */}
      <LocationBroadcast running={active.length > 0} orderId={active[0]?.id} />
      <NewOrderAlert orders={open} />

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Portal</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">Repartos</h1>
      </div>

      {/* Resumen rápido del turno: de un vistazo antes de salir a la calle. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Por coger" value={String(open.length)} />
        <Stat
          label="En curso"
          value={String(active.length)}
          tone={active.length ? "go" : undefined}
        />
        <Stat
          label="Efectivo por cobrar"
          value={fmtEur(cashPending)}
          tone={cashPending ? "wait" : undefined}
        />
        <Stat
          label="Cobrado hoy"
          value={fmtEur(cashDone)}
          hint={`${doneToday.length} entregado(s)`}
        />
      </div>

      {/* Mi jornada: 8 h dentro del día. Se guarda en servidor y lo ve el admin. */}
      <MyShift
        start={br.myShiftStart}
        onPick={(h) => act(br.setCourierShift({ startHour: h }), "Jornada guardada")}
      />

      <Board title="Disponibles" empty="No hay nada en cola.">
        {open.map((o) => (
          <DeliveryCard
            key={o.id}
            order={o}
            alcohol={hasAlcohol(o)}
            action={
              <Button
                size="sm"
                onClick={() => act(br.courierAccept({ id: o.id }), "Reparto aceptado")}
              >
                Aceptar {o.code}
              </Button>
            }
            // Solo los que YA están asignados a él se pueden cancelar (un pendiente
            // del que aún no se hizo cargo no es suyo).
            onCancel={
              o.status === "asignado" && o.courier === me ? () => setCancelTarget(o) : undefined
            }
            chat={o.courier === me ? <OrderChat orderId={o.id} /> : undefined}
          />
        ))}
      </Board>
      <Board title="En curso" empty="Ningún reparto activo.">
        {active.map((o) => (
          <DeliveryCard
            key={o.id}
            order={o}
            alcohol={hasAlcohol(o)}
            action={
              <Button
                size="sm"
                variant="bottle"
                onClick={() => act(br.markDelivered({ id: o.id }), "Marcado como entregado")}
              >
                Marcar entregado
              </Button>
            }
            onCancel={() => setCancelTarget(o)}
            chat={<OrderChat orderId={o.id} />}
          />
        ))}
      </Board>
      <Board title="Entregados" empty="Aún no cierras el día.">
        {done.slice(0, 8).map((o) => (
          <li key={o.id} className="rounded-[1.25rem] bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-lg font-semibold tabular-nums">{o.code}</p>
                <p className="text-sm text-muted">
                  {o.customerName || o.customer} · {fmtEur(o.total)}
                  {o.paymentMethod === "efectivo"
                    ? " · cobrado en mano"
                    : ` · ${PAY_LABEL[o.paymentMethod]}`}
                </p>
              </div>
              <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
            </div>
            <OrderInvoice orderId={o.id} status={o.status} />
          </li>
        ))}
      </Board>

      {/* Invitación con enlace (migración 0030): el repartidor también puede
          repartir sus tarjetas — si su invitado compra, ambos suman chapas. */}
      <InviteLinkCard />

      {cancelTarget ? (
        <CourierCancelDialog order={cancelTarget} onClose={() => setCancelTarget(null)} />
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "go" | "wait";
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      {tone === "go" ? (
        <span className="mt-1 inline-block h-1.5 w-8 rounded-full bg-bottle" />
      ) : null}
      {tone === "wait" ? (
        <span className="mt-1 inline-block h-1.5 w-8 rounded-full bg-ember" />
      ) : null}
    </div>
  );
}

/**
 * Pop-up de aviso de faltas. Se muestra si el admin ha notificado alguna falta
 * que aún no has acusado recibo. Con 3 o más, el aviso se resalta en rojo.
 * «Entendido» marca todas como leídas (ack) en el servidor.
 */
function FaultAlert() {
  const br = useBr();
  const pendientes = br.myFaults.filter((f) => !f.ack);
  if (pendientes.length === 0) return null;
  const graves = br.myFaultsTotal >= 3;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4">
      <div className="w-full max-w-md rounded-[1.5rem] bg-surface p-6 text-ink shadow-lift">
        <div className="flex items-center gap-2">
          <AlertTriangle className={graves ? "size-5 text-ember" : "size-5 text-bottle"} />
          <h2 className="font-display text-xl font-semibold">
            {graves ? "Aviso importante" : "Tienes un aviso"}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted">
          {graves
            ? `Llevas ${br.myFaultsTotal} faltas registradas. Cuida tu rendimiento: varias incidencias pueden suspender tu cuenta.`
            : "El administrador te ha notificado las siguientes faltas:"}
        </p>
        <ul className="mt-3 space-y-2">
          {pendientes.map((f) => (
            <li key={f.id} className="rounded-xl bg-paper px-3 py-2 text-sm">
              {f.reason}
            </li>
          ))}
        </ul>
        <Button
          className="mt-5 w-full"
          onClick={() => act(br.ackFaults(), "Aviso acuse de recibo enviado")}
        >
          Entendido
        </Button>
      </div>
    </div>
  );
}

/**
 * Selector de franja del repartidor: jornadas de 8 h sobre las 24 del día.
 * Solo se elige la hora de inicio; el cierre se calcula solo (inicio + 8).
 */
function MyShift({ start, onPick }: { start: number | null; onPick: (h: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.25rem] bg-surface p-5 shadow-card">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">Mi jornada</p>
        <p className="mt-1 font-display text-lg font-semibold text-ink">{shiftRange(start)}</p>
        <p className="text-xs text-muted">
          Elige cuándo repartes (8 horas). El panel y tus clientes lo verán.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Empiezo a las</span>
        <select
          value={start ?? ""}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v !== "") onPick(Number(v));
          }}
          className="h-11 rounded-2xl bg-paper px-3 text-sm shadow-card"
        >
          <option value="" disabled>
            Sin asignar
          </option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {shiftRange(h)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Tarjeta de reparto con todo lo que necesita el repartidor en la puerta:
 * cliente, teléfono, cobro por delante, check de productos (tocable, solo
 * visual) y atajos para llamar / llegar / copiar la dirección.
 */
function DeliveryCard({
  order: o,
  alcohol,
  action,
  chat,
  onCancel,
}: {
  order: Order;
  alcohol: boolean;
  action?: ReactNode;
  chat?: ReactNode;
  /** Si viene, muestra «Cancelar reparto»: abre el diálogo de motivo obligatorio. */
  onCancel?: () => void;
}) {
  // Check de picking: estado local, no se envía a ningún sitio.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const telHref = `tel:${o.phone.replace(/[^0-9+]/g, "")}`;
  // Dirección COMPLETA y desambiguada: calle + CP + municipio. Sin el CP, Google
  // Maps clavaba el pin donde podía (el número suelto u otra población).
  const town = o.postalCode ? townForCp(o.postalCode) : "";
  const cpTown = [o.postalCode, town].filter(Boolean).join(" ");
  const fullAddress = [o.address, cpTown].filter(Boolean).join(", ");
  const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;
  return (
    <li className="rounded-[1.25rem] bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold tabular-nums">{o.code}</p>
          <p className="text-sm text-muted">
            {o.customerName || "Cliente"} · {timeAgo(o.createdAt)}
          </p>
          {/* Fase 11: pedido de un día sin reparto = RESERVA con fecha fija. */}
          {o.scheduledFor ? (
            <p className="mt-1 inline-flex rounded-full bg-bottle/15 px-2.5 py-1 text-xs font-semibold text-bottle">
              📅 Reserva: entrega el {fmtDeliveryDate(o.scheduledFor)}
            </p>
          ) : null}
          <p className="mt-1 text-sm font-medium text-ink">{fullAddress}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status] ?? o.status}</Pill>
          {action}
        </div>
      </div>

      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ember/10 px-3 py-1.5 text-xs font-semibold text-ember transition-colors hover:bg-ember/20"
        >
          <AlertTriangle className="size-3.5" /> Cancelar este reparto
        </button>
      ) : null}

      {/* Cobro: que nunca se lleve sorpresas en la puerta. */}
      <p className="mt-3 inline-flex rounded-full bg-ember/15 px-3 py-1 text-xs font-semibold text-ember">
        {o.paymentMethod === "efectivo"
          ? `Cobrar en mano · ${fmtEur(o.total)} (lleva cambio)`
          : `${PAY_LABEL[o.paymentMethod]} · ${fmtEur(o.total)} — no tienes que cobrar nada`}
      </p>
      {alcohol ? (
        <p className="mt-2 text-xs font-semibold text-adult">Verificar DNI: hay productos +18.</p>
      ) : null}
      {o.notes ? <p className="mt-2 text-sm text-muted">Notas del cliente: “{o.notes}”</p> : null}

      {/* Atajos de acción, del tamaño para usar con guantes/pulgar. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-2 text-xs font-medium text-ink shadow-card transition-colors hover:bg-ink hover:text-paper"
        >
          <Navigation className="size-3.5" /> Cómo llegar
        </a>
        {o.phone ? (
          <a
            href={telHref}
            className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-2 text-xs font-medium text-ink shadow-card transition-colors hover:bg-ink hover:text-paper"
          >
            <Phone className="size-3.5" /> Llamar
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(fullAddress)
              .then(() => toast.success("Dirección copiada"))
              .catch(() => toast.error("Tu navegador no permite copiar aquí."));
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-2 text-xs font-medium text-ink shadow-card transition-colors hover:bg-ink hover:text-paper"
        >
          <Copy className="size-3.5" /> Copiar dirección
        </button>
      </div>

      {/* Check de picking: toca cada producto al meterlo en la mochila. */}
      <details className="mt-3 rounded-2xl bg-paper/60 p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Productos ({o.items.length}) — toca para marcar
        </summary>
        <ul className="mt-2 space-y-1">
          {o.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => setPicked((p) => ({ ...p, [it.id]: !p[it.id] }))}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors ${
                  picked[it.id] ? "bg-bottle/15 text-bottle" : "text-ink hover:bg-ink/5"
                }`}
              >
                <span className={picked[it.id] ? "line-through opacity-70" : undefined}>
                  {it.qty} × {it.name}
                </span>
                <span className="tabular-nums text-xs text-muted">{fmtEur(it.price * it.qty)}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      {o.status === "en_reparto" ? <CustomerShareBadge orderRef={o.id} /> : null}

      {chat}
    </li>
  );
}

/**
 * El CLIENTE de este reparto puede haber activado «Compartir mi ubicación»
 * (seguimiento bidireccional). Si lo ha hecho, el repartidor ve aquí un aviso y
 * un atajo para navegar hasta SU posición real (no solo el portal de la calle).
 * La posición la sirve el servidor solo al repartidor asignado; si el cliente no
 * comparte, este bloque no aparece.
 */
function CustomerShareBadge({ orderRef }: { orderRef: string }) {
  const t = useOrderTracking(orderRef);
  const cust = t.data?.customer;
  if (!cust) return null;
  const fresh = Date.now() - cust.updatedAt < 10 * 60_000;
  const href = `https://www.google.com/maps/dir/?api=1&destination=${cust.lat},${cust.lng}`;
  const mins = Math.max(0, Math.round((Date.now() - cust.updatedAt) / 60_000));
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#1f6feb]/10 px-3 py-2">
      <p className="text-xs text-ink">
        <span className="font-semibold text-[#1f6feb]">El cliente comparte su ubicación</span>
        <span className="text-muted">
          {" "}
          · {fresh ? "en directo" : `última hace ${mins} min`} · puede estar en la calle, no en el
          portal
        </span>
      </p>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-[#1f6feb] px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-[#1a5fd0]"
      >
        <Navigation className="size-3.5" /> Ir hasta el cliente
      </a>
    </div>
  );
}

/**
 * Diálogo de cancelación del repartidor. El motivo es OBLIGATORIO: sin texto no
 * se puede enviar. Al confirmar llama a `br.courierCancel` (el servidor valida
 * que el reparto es suyo y está en curso, guarda el motivo y avisa al admin).
 */
function CourierCancelDialog({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const br = useBr();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const submit = async () => {
    if (!trimmed) {
      toast.error("Escribe el motivo: es obligatorio.");
      return;
    }
    setBusy(true);
    try {
      const res = await br.courierCancel({ id: o.id, reason: trimmed });
      toast[res.ok ? "success" : "error"](res.msg);
      if (res.ok) onClose();
    } catch (err) {
      toast.error((err as Error)?.message || "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[75] grid place-items-end bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-[1.5rem] bg-surface p-6 text-ink shadow-lift sm:rounded-[1.5rem]">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-ember" />
          <h2 className="font-display text-xl font-semibold">Cancelar reparto {o.code}</h2>
        </div>
        <p className="mt-1 text-sm text-muted">
          Se avisará al administrador con el motivo. El pedido pasará a «cancelado» y el cliente
          recibirá un aviso.
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Motivo (obligatorio)
        </label>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={512}
          rows={3}
          placeholder="Ej.: no puedo llegar a tiempo, vehículo averiado, dirección incorrecta…"
          className="mt-1 w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ember"
        />
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" variant="primary" onClick={submit} disabled={busy || !trimmed}>
            {busy ? "Cancelando…" : "Confirmar cancelación"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Volver
          </Button>
        </div>
      </div>
    </div>
  );
}

function Board({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const has = Array.isArray(children) ? children.length : children;
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl font-semibold text-paper">{title}</h2>
      {has ? (
        <ul className="space-y-3">{children}</ul>
      ) : (
        <p className="text-sm text-mist">{empty}</p>
      )}
    </section>
  );
}

/**
 * GPS en vivo del reparto: mientras haya un reparto EN CURSO y el interruptor
 * esté activado, el móvil del repartidor comparte su posición (el navegador le
 * pide permiso una vez) y la envía con throttle. El cliente la ve en
 * /seguimiento y el admin en el mapa del panel. Con el reparto terminado se
 * apaga el watch: privacy por diseño — nunca se tracea al repartidor fuera de
 * su turno, y él puede pausar el GPS cuando quiera con el interruptor
 * (persiste entre sesiones en el dispositivo).
 */
const SHARE_LS_KEY = "br-share-loc";

function LocationBroadcast({ running, orderId }: { running: boolean; orderId?: string }) {
  // Función ESTABLE de useBr: si dependiera del objeto `br` completo, el
  // watchPosition se reiniciaría en cada render (cada sondeo de 15 s).
  const { pingCourierLocation } = useBr();
  const [state, setState] = useState<"off" | "on" | "denied" | "unavailable" | "unsupported">(
    "off",
  );
  // El predeterminado «activado» no es traquear a nadie: el GPS real solo
  // arranca si el navegador concede el permiso. El interruptor es un PLUS.
  const [share, setShare] = useState(true);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [sendingNow, setSendingNow] = useState(false);

  // SSR: localStorage no existe en servidor; se lee tras el primer render.
  useEffect(() => {
    setShare(localStorage.getItem(SHARE_LS_KEY) !== "0");
  }, []);

  // Reloj barato para el texto «último envío hace X s» (solo con watch activo).
  useEffect(() => {
    if (!running || !share) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(t);
  }, [running, share]);
  void tick; // el render se repite para refrescar la antigüedad

  function toggleShare(v: boolean) {
    setShare(v);
    localStorage.setItem(SHARE_LS_KEY, v ? "1" : "0");
    if (!v) setState("off");
  }

  // Forzar un envío puntual manual: resuelve el #3 ("no se actualiza la
  // ubicación"). Si el navegador congeló el GPS en segundo plano, un toque
  // manual manda la posición actual aunque el watch esté detenido o pausado.
  function sendNow() {
    if (!("geolocation" in navigator)) {
      toast.error("Este navegador no ofrece GPS.");
      return;
    }
    setSendingNow(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void pingCourierLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          orderId,
        })
          .then(() => {
            setState("on");
            setLastSentAt(Date.now());
            toast.success("Posición enviada al cliente y al admin");
          })
          .catch(() => toast.error("No se pudo enviar la posición."))
          .finally(() => setSendingNow(false));
      },
      () => {
        setSendingNow(false);
        toast.error("Sin permiso de ubicación no puedo enviar.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    if (!running || !share) return;
    if (!("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setState("on");
        const now = Date.now();
        if (now - lastSent < 3_000) return; // throttle: no saturar el servidor
        lastSent = now;
        void pingCourierLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          orderId,
        })
          .then(() => setLastSentAt(Date.now()))
          .catch(() => undefined);
      },
      (err) => {
        // code 1 = permiso denegado; 2/3 = sin señal GPS (interior, pantalla
        // bloqueada): mensajes distintos para no culpar al permiso equivocado.
        setState(err.code === 1 ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [running, share, orderId, pingCourierLocation]);

  if (!running) return null;
  const sentAgoSec = lastSentAt ? Math.round((Date.now() - lastSentAt) / 1000) : null;
  const stalled = state === "on" && sentAgoSec !== null && sentAgoSec > 60;
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 shadow-card">
      <div className="flex items-start gap-2">
        <MapPin
          className={
            state === "on" && share ? "size-4 shrink-0 text-bottle" : "size-4 shrink-0 text-muted"
          }
        />
        <p className="flex-1 text-xs text-muted">
          {!share
            ? "Ubicación pausada: el cliente y el admin no verán tu posición en el mapa. Reactívala para que el seguimiento funcione."
            : state === "on"
              ? stalled
                ? "Ojo: llevan más de un minuto sin llegar posiciones. Mantén esta pestaña abierta y la pantalla encendida (el navegador congela el GPS en segundo plano)."
                : "Compartiendo tu ubicación con el cliente y el admin (solo mientras repartes)."
              : state === "denied"
                ? "Permiso de ubicación denegado: el cliente no verá dónde estás. Actívalo en los ajustes del navegador."
                : state === "unavailable"
                  ? "El navegador no capta señal GPS ahora (interior o pantalla bloqueada): en cuanto vuelva, se reenvía sola."
                  : state === "unsupported"
                    ? "Este navegador no ofrece GPS: el cliente verá solo los hitos del pedido."
                    : "El mapa en vivo necesita permiso de ubicación: el navegador lo pedirá ahora."}
          {state === "on" && share && sentAgoSec !== null && !stalled
            ? ` Último envío: hace ${sentAgoSec < 5 ? "unos segundos" : `${sentAgoSec} s`}.`
            : ""}
        </p>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => toggleShare(e.target.checked)}
            className="size-4 accent-bottle"
          />
          Compartir ubicación
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sendNow}
          disabled={sendingNow}
          className="inline-flex items-center gap-1.5 rounded-full bg-bottle px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-bottle/85 disabled:opacity-60"
        >
          <Navigation className="size-3.5" />{" "}
          {sendingNow ? "Enviando…" : "Enviar mi posición ahora"}
        </button>
        <p className="text-[11px] text-muted">
          Si el GPS se ha congelado (pantalla bloqueada), esto fuerza un envío puntual.
        </p>
      </div>
    </div>
  );
}

/**
 * El «SMS gratis» que sí existe: notificaciones del navegador (PWA). Con los
 * avisos activados, cada pedido que entra en la cola suena en el móvil sin
 * pagar operadores; el email de asignación (br-server) cubre el teléfono aun
 * con la app cerrada, y el SMS de pago queda preparado si se configuran las
 * claves de Twilio.
 */
function NewOrderAlert({ orders }: { orders: Order[] }) {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState<NotificationPermission | null>(
    supported ? Notification.permission : null,
  );
  // Pedidos ya vistos: el primer paso NO avisa (no queremos ruido del pasado).
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ids = orders.map((o) => o.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    if (perm === "granted") {
      for (const id of ids) {
        if (seen.current.has(id)) continue;
        const o = orders.find((x) => x.id === id);
        if (!o) continue;
        try {
          new Notification(`Nuevo pedido ${o.code}`, {
            body:
              o.status === "asignado"
                ? "El admin te lo ha asignado — acéptalo en el portal"
                : "Hay un reparto esperando en el portal",
            tag: id,
          });
        } catch {
          /* modo privado sin soporte: seguimos sin avisos */
        }
      }
    }
    seen.current = new Set(ids);
  }, [orders, perm]);

  if (!supported) return null;
  if (perm === "granted") {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 shadow-card">
        <BellRing className="size-4 shrink-0 text-bottle" />
        <p className="text-xs text-muted">
          Avisos activados: sonará un nuevo pedido en cuanto entre en la cola.
        </p>
      </div>
    );
  }
  if (perm === "denied") return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center gap-2">
        <BellRing className="size-4 shrink-0 text-ember" />
        <p className="text-xs text-muted">
          Avisos de pedidos nuevos en el móvil (gratis, sin SMS).
        </p>
      </div>
      <Button
        size="sm"
        variant="bottle"
        onClick={() => {
          void Notification.requestPermission().then((p) => {
            setPerm(p);
            if (p === "granted") toast.success("Avisos activados");
          });
        }}
      >
        Activar avisos
      </Button>
    </div>
  );
}
