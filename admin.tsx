import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Crop,
  Flag,
  Phone,
  Printer,
  Settings,
  GripVertical,
  MapPinned,
  AlertTriangle,
  Lock,
  Mail,
  ShieldCheck,
  ScrollText,
  Megaphone,
  Wrench,
  Eye,
  EyeOff,
  Download,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
} from "lucide-react";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { SorteosAdmin } from "@/components/admin/raffle-admin";
import { ChapasAdmin } from "@/components/admin/chapa-admin";
import { CanjeosAdmin } from "@/components/admin/canjeos-admin";
import { PagosAdmin } from "@/components/admin/pagos-admin";
import { downloadProfitXlsx } from "@/lib/profit-xlsx";
import { OrderChat } from "@/components/chat/order-chat";
import { OrderInvoice } from "@/components/chat/order-invoice";
import { Button } from "@/components/ui/button";
import { BASE_PRODUCTOS } from "@/data/productdb";
import {
  CATEGORIES,
  type CategoryId,
  type EanSearchHit,
  type LoginSession,
  type Order,
  type PasswordResetRequest,
  type Product,
  type Role,
} from "@/data/types";
import { CATALOG } from "@/data/catalog";
import {
  mergeSection,
  SITE_DEFAULTS,
  type AvisoSection,
  type MantenimientoSection,
  type PortalesSection,
  type RepartoSection,
  type SiteSectionKey,
} from "@/data/site-defaults";
import { fmtDeliveryDate, WEEKDAY_UI } from "@/lib/delivery-days";
import { STATUS_LABEL, shiftRange } from "@/lib/format";
import { fromLocalInput, isSoldOut, toLocalInput } from "@/lib/stock";
import {
  adjustOptimizedImage,
  buildImageAlt,
  fileToOptimizedImage,
  humanBytes,
  type FrameAdjust,
} from "@/lib/image-opt";
import { usePointerSort } from "@/lib/use-pointer-sort";
import { useBr, type Br } from "@/lib/use-br";
import { currentSid } from "@/lib/br-db";
import {
  beginTwoFactorFn,
  confirmTwoFactorFn,
  disableTwoFactorFn,
  listAuditFn,
  masterCodeStatusFn,
  revokeMasterCodeFn,
  rotateMasterCodeFn,
  twoFactorStatusFn,
} from "@/lib/br-api";
import { cn, fmtDate, fmtEur, slugify } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  component: Page,
  // Fase 12: `?chat=<entryId>` llega desde la campanita de «reclaman un premio»
  // y abre la pestaña Sorteos con el hilo del ganador ya desplegado.
  validateSearch: (search: Record<string, unknown>) => ({
    chat: typeof search.chat === "string" ? search.chat : "",
  }),
});

/**
 * Ejecuta una acción del panel sin bloquear la UI. Cada mutación de `useBr`
 * devuelve una `Promise`: si el servidor la rechaza (rol, estado, sesión), se
 * avisa en un toast en vez de romper el render.
 */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

const TABS = [
  "Pedidos",
  "Estadísticas",
  "Archivados",
  "Repartidores",
  "Sesiones",
  "Cuentas",
  "Cupones",
  "Reseñas",
  "Apoyos",
  "Sorteos",
  "Chapas",
  "Canjeos",
  "Pagos",
  "Productos",
  "Rentabilidad",
  "Editor",
  "Catálogo",
  "Reclamaciones",
  "Soporte",
  "Ajustes",
  "Seguridad",
] as const;

function Page() {
  return (
    <PanelShell role="admin">
      <AdminInner />
    </PanelShell>
  );
}

function AdminInner() {
  const br = useBr();
  const { chat } = Route.useSearch();
  const [tab, setTab] = useState<(typeof TABS)[number]>(chat ? "Sorteos" : "Pedidos");
  const pending = br.orders.filter((o) => o.status === "pendiente").length;
  const reqs = br.users.filter((u) => u.role === "repartidor" && u.status === "solicitud").length;
  const openC = br.claims.filter((c) => c.status === "abierta").length;
  const openM = br.messages.filter((m) => m.status === "abierto").length;
  // Solicitudes de recuperación pendientes (bandeja «Cuentas»): solo las vivas.
  const resetReqs = br.resetRequests.filter((r) => r.active).length;
  // Premios de la ruleta descubiertos sin entregar y canjes por chapas en espera.
  const rafflePend = (br.adminRaffle?.entries ?? []).filter(
    (e) => e.outcome === "premio" && e.revealed && !e.claimed,
  ).length;
  const chapaPend = (br.adminChapa?.redemptions ?? []).filter(
    (r) => r.status === "pendiente",
  ).length;

  const kpis = [
    { n: br.orders.length, l: "Pedidos" },
    { n: pending, l: "Por delegar" },
    { n: br.orders.filter((o) => o.status === "en_reparto").length, l: "En calle" },
    { n: br.couriers.length, l: "Repartidores" },
  ];

  return (
    <div className="admin-panel space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Logística</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">Panel</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="line"
            onClick={() => {
              const p = br.products.find((x) => !x.alcohol);
              if (!p) {
                // Antes salía en silencio y parecía un botón roto.
                toast.error(
                  br.products.length === 0
                    ? "No hay productos en el catálogo: da de alta uno en «Productos» antes de crear pedidos de prueba."
                    : "El catálogo solo tiene productos con alcohol: da de alta uno sin alcohol para la prueba.",
                );
                return;
              }
              act(
                br.createOrder({
                  items: [{ id: p.id, name: p.name, qty: 1, price: p.price }],
                  subtotal: p.price,
                  shippingCost: 2.9,
                  tip: 0,
                  total: p.price + 2.9,
                  paymentMethod: "tarjeta",
                  deliverySlot: "inmediata",
                  address: "Carrer de Maragall 20, Badalona",
                  postalCode: "08911",
                  phone: "600 000 000",
                  notes: "Pedido de prueba",
                }),
                "Pedido de prueba creado",
              );
            }}
          >
            Crear pedido de prueba
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.l} className="rounded-2xl bg-surface p-4 shadow-card">
            <p className="font-display text-2xl font-semibold tabular-nums">{k.n}</p>
            <p className="text-xs text-muted">{k.l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* La pestaña «Catálogo» solo tiene sentido con productos base; con el
            catálogo de muestra vaciado, toda la gestión vive en «Productos». */}
        {TABS.filter((t) => t !== "Catálogo" || CATALOG.length > 0).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`relative h-10 rounded-full px-4 text-sm font-medium ${
              tab === t ? "bg-ink text-surface" : "bg-surface shadow-card"
            }`}
          >
            {t}
            {t === "Pedidos" && pending ? <Badge n={pending} /> : null}
            {t === "Repartidores" && reqs ? <Badge n={reqs} /> : null}
            {t === "Reclamaciones" && openC ? <Badge n={openC} /> : null}
            {t === "Soporte" && openM ? <Badge n={openM} /> : null}
            {t === "Cuentas" && resetReqs ? <Badge n={resetReqs} /> : null}
            {t === "Sorteos" && rafflePend ? <Badge n={rafflePend} /> : null}
            {t === "Canjeos" && chapaPend ? <Badge n={chapaPend} /> : null}
          </button>
        ))}
      </div>

      {tab === "Pedidos" ? <Pedidos /> : null}
      {tab === "Estadísticas" ? <Estadisticas /> : null}
      {tab === "Archivados" ? <Archivados /> : null}
      {tab === "Repartidores" ? <Repartidores /> : null}
      {tab === "Sesiones" ? <Sesiones /> : null}
      {tab === "Cuentas" ? <Cuentas /> : null}
      {tab === "Cupones" ? <Cupones /> : null}
      {tab === "Reseñas" ? <Resenas /> : null}
      {tab === "Apoyos" ? <Apoyos /> : null}
      {tab === "Sorteos" ? <SorteosAdmin focusEntryId={chat || undefined} /> : null}
      {tab === "Chapas" ? <ChapasAdmin /> : null}
      {tab === "Canjeos" ? <CanjeosAdmin /> : null}
      {tab === "Pagos" ? <PagosAdmin /> : null}
      {tab === "Productos" ? <Productos /> : null}
      {tab === "Rentabilidad" ? <Rentabilidad /> : null}
      {tab === "Editor" ? <Editor /> : null}
      {tab === "Catálogo" ? <CatalogoEditor /> : null}
      {tab === "Reclamaciones" ? <Reclamos /> : null}
      {tab === "Soporte" ? <SoporteAdmin /> : null}
      {tab === "Ajustes" ? <Ajustes /> : null}
      {tab === "Seguridad" ? <Seguridad /> : null}
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-ember px-1 text-[0.65rem] text-surface">
      {n}
    </span>
  );
}

// Mapa en vivo (Leaflet): SOLO con lazy, necesita `window` y no ensucia el
// bundle inicial del panel.
const CourierLiveMapDialog = lazy(() =>
  import("@/components/map/tracking-map").then((m) => ({ default: m.CourierLiveMapDialog })),
);

// Gráficos (recharts): también lazy. Necesitan DOM para medir el
// ResponsiveContainer y no deben entrar en el bundle inicial del panel.
const StatsView = lazy(() =>
  import("@/components/admin/stats-view").then((m) => ({ default: m.StatsView })),
);

function Pedidos() {
  const br = useBr();
  const [mapOpen, setMapOpen] = useState(false);
  const orders = [...br.orders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="line" onClick={() => setMapOpen(true)}>
          <MapPinned className="size-4" /> Mapa en vivo ({br.liveCouriers.length})
        </Button>
        <p className="text-xs text-muted">
          Cada repartidor comparte GPS solo mientras tiene un reparto en curso.
        </p>
      </div>
      {(() => {
        // #3: aviso visible SIN abrir el mapa cuando un reparto activo lleva
        // más de 5 min sin enviar posición (GPS congelado o repartidor parado).
        const stalled = br.liveCouriers.filter(
          (c) =>
            (c.status === "asignado" || c.status === "en_reparto") &&
            Date.now() - c.updatedAt > 5 * 60_000,
        );
        if (stalled.length === 0) return null;
        return (
          <p className="flex items-start gap-1.5 rounded-xl bg-ember/15 px-3 py-2 text-xs font-semibold text-ember">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {stalled.length} reparto(s) en curso sin actualizar su GPS más de 5 min:{" "}
              {stalled.map((c) => c.orderCode || c.name).join(", ")}. Abre el mapa para revisar.
            </span>
          </p>
        );
      })()}
      {mapOpen ? (
        <Suspense
          fallback={<div className="h-[340px] animate-pulse rounded-[1.25rem] bg-surface" />}
        >
          <CourierLiveMapDialog couriers={br.liveCouriers} onClose={() => setMapOpen(false)} />
        </Suspense>
      ) : null}
      <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink text-surface">
            <tr>
              {["Código", "Cliente", "Total", "Estado", "Repartidor", "", "Chat", "Factura"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              // Cabecera suelta sobre tabla vacía se lee como panel roto.
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                  No hay pedidos en esta vista. Cuando un cliente compre, aparecerá aquí.
                </td>
              </tr>
            ) : null}
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-line">
                <td className="px-4 py-3 font-semibold tabular-nums text-ember">{o.code}</td>
                <td className="px-4 py-3">
                  {o.customerName}
                  <div className="text-xs text-muted">{fmtDate(o.createdAt)}</div>
                  {/* Fase 11: los pedidos de un día sin reparto llegan como
                      RESERVA; el admin la ve aquí sin abrir el detalle. */}
                  {o.scheduledFor && o.status !== "entregado" && o.status !== "cancelado" ? (
                    <div className="text-[0.65rem] font-semibold text-bottle">
                      📅 Reserva · {fmtDeliveryDate(o.scheduledFor)}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {fmtEur(o.total)}
                  {/* Desglose de ajustes: cupón y recargo de madrugada, si los hay. */}
                  {(o.discount ?? 0) > 0 || (o.nightSurcharge ?? 0) > 0 ? (
                    <div className="mt-0.5 text-[0.65rem] font-normal text-muted">
                      {(o.discount ?? 0) > 0 ? (
                        <span className="text-bottle">
                          −{fmtEur(o.discount ?? 0)} {o.couponCode ?? "cupón"}
                        </span>
                      ) : null}
                      {(o.discount ?? 0) > 0 && (o.nightSurcharge ?? 0) > 0 ? " · " : null}
                      {(o.nightSurcharge ?? 0) > 0 ? (
                        <span>+{fmtEur(o.nightSurcharge ?? 0)} madrugada</span>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
                </td>
                <td className="px-4 py-3 text-xs">{o.courier || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {o.status === "pendiente" ||
                    o.status === "asignado" ||
                    o.status === "cancelado" ? (
                      // Fase 10: un CANCELADO también se puede Delegar → se
                      // reactiva y se reasigna a otro repartidor en un solo paso
                      // (el servidor vuelve a consumir el cupón si lo llevaba).
                      <select
                        className="h-9 rounded-lg bg-paper px-2 text-xs"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          if (o.status === "cancelado") {
                            act(
                              br.reactivateAssignCourier({ id: o.id, courier: e.target.value }),
                              "Pedido reactivado y asignado",
                            );
                          } else {
                            act(
                              br.assignCourier({ id: o.id, courier: e.target.value }),
                              "Repartidor asignado",
                            );
                          }
                        }}
                      >
                        <option value="">
                          {o.status === "cancelado" ? "Reasignar…" : "Delegar…"}
                        </option>
                        {br.couriers.map((c) => (
                          <option key={c.email} value={c.email}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {o.status !== "entregado" && o.status !== "cancelado" ? (
                      <button
                        type="button"
                        className="h-9 rounded-lg bg-paper px-2 text-xs"
                        onClick={() => act(br.cancelOrder({ id: o.id }), "Pedido cancelado")}
                      >
                        Cancelar
                      </button>
                    ) : null}
                    {/* Eliminar = archivar (borrado lógico): sale del flujo pero se
                      conserva en «Archivados» para consultarlo y descargarlo en PDF. */}
                    <button
                      type="button"
                      className="h-9 rounded-lg bg-ember/10 px-2 text-xs text-ember"
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Eliminar el pedido ${o.code}? No se pierde: queda en «Archivados».`,
                          )
                        ) {
                          act(br.deleteOrder({ id: o.id }), "Pedido archivado");
                        }
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <OrderChat orderId={o.id} />
                </td>
                <td className="px-4 py-3 align-top">
                  <OrderInvoice orderId={o.id} status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Bandeja de reseñas: llegan PRIVADAS desde «Mi cuenta» del cliente (estrellas,
 * comentario y foto opcional). Aquí el admin decide, una a una, si se publican
 * en el desplegable «Reseñas» de la portada o se eliminan. Nada se publica solo.
 */
function Resenas() {
  const br = useBr();
  const list = br.adminReviews;
  const publicadas = list.filter((r) => r.status === "publicada").length;
  if (list.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aún no hay reseñas. Cuando un cliente recibe un pedido entregado puede valorarlo desde «Mi
        cuenta»: la valoración llega aquí en modo privado.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {list.length} reseñas · {publicadas} publicadas · las privadas solo las ves tú.
      </p>
      <ul className="space-y-3">
        {list.map((r) => (
          <li key={r.id} className="rounded-2xl bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {r.customerName}
                  <span className="ml-1.5 text-xs font-normal text-muted">{r.customer}</span>
                </p>
                <p className="text-xs text-muted">
                  {fmtDate(r.createdAt)} · pedido {r.orderCode || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-sm tracking-[0.12em] text-[#e0a458]"
                  aria-label={`${r.stars} de 5 estrellas`}
                  title={`${r.stars} de 5`}
                >
                  {"★".repeat(r.stars)}
                  {"☆".repeat(5 - r.stars)}
                </span>
                <Pill tone={r.status === "publicada" ? "go" : "neutral"}>
                  {r.status === "publicada" ? "Publicada" : "Privada"}
                </Pill>
              </div>
            </div>
            {r.text ? <p className="mt-2 text-sm">{r.text}</p> : null}
            {r.image ? (
              <a href={r.image} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                <img
                  src={r.image}
                  alt="Foto del cliente"
                  className="size-24 rounded-xl object-cover shadow-card transition hover:opacity-90"
                  title="Abrir a tamaño completo"
                />
              </a>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={r.status === "privada" ? "bottle" : "ghost"}
                onClick={() =>
                  act(
                    br.setReviewPublished({ id: r.id, published: r.status === "privada" }),
                    r.status === "privada"
                      ? "Reseña publicada en la portada"
                      : "Reseña ocultada de nuevo",
                  )
                }
              >
                {r.status === "privada" ? "Publicar" : "Despublicar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-ember"
                onClick={() => {
                  if (window.confirm("¿Borrar esta reseña? No se puede deshacer.")) {
                    act(br.deleteReview({ id: r.id }), "Reseña borrada");
                  }
                }}
              >
                Borrar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Apoyos «Apóyanos»: donaciones registradas desde el corazón de la cabecera
 * (1–999 €). Es un libro de agradecimientos: por ahora NO hay cobro asociado
 * (la pasarela real llegará con Stripe); el total es orientativo.
 */
function Apoyos() {
  const br = useBr();
  const list = br.donations;
  const total = list.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-2xl bg-surface px-4 py-3 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Total registrado
          </p>
          <p className="font-display text-2xl font-semibold tabular-nums">{fmtEur(total)}</p>
        </div>
        <div className="rounded-2xl bg-surface px-4 py-3 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Apoyos</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{list.length}</p>
        </div>
        <p className="text-xs text-muted">
          Los importes quedan registrados como agradecimiento; el cobro online se conectará con la
          pasarela de pago.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay apoyos registrados.</p>
      ) : (
        <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-ink text-surface">
              <tr>
                {["Fecha", "Cliente", "Importe", "Mensaje", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-4 py-3 text-xs text-muted">{fmtDate(d.createdAt)}</td>
                  <td className="px-4 py-3">
                    {d.customerName}
                    <div className="text-xs text-muted">{d.customer}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold">{fmtEur(d.amount)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{d.message || "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="h-9 rounded-lg bg-ember/10 px-2 text-xs text-ember"
                      onClick={() => {
                        if (window.confirm("¿Borrar este apoyo del registro?")) {
                          act(br.deleteDonation({ id: d.id }), "Apoyo borrado");
                        }
                      }}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Repartidores() {
  const br = useBr();
  const list = br.users.filter((u) => u.role === "repartidor");
  if (list.length === 0) {
    return <p className="text-sm text-muted">Todavía no hay repartidores (ni solicitudes).</p>;
  }
  return (
    <ul className="space-y-3">
      {list.map((u) => (
        <CourierRow key={u.email} u={u} />
      ))}
    </ul>
  );
}

/**
 * Ficha de gestión de un repartidor: datos (incluido el teléfono), sus pedidos
 * activos reasignables a otro repartidor y el registro de faltas. Todo plegado
 * tras un botón «Gestionar» para no saturar la lista.
 */
function CourierRow({ u }: { u: Br["users"][number] }) {
  const br = useBr();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const faults = br.faultsAdmin.filter((f) => f.courierEmail === u.email);
  const theirOrders = br.orders.filter(
    (o) => o.courier === u.email && (o.status === "asignado" || o.status === "en_reparto"),
  );
  const others = br.couriers.filter((c) => c.email !== u.email);

  return (
    <li className="rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium flex items-center gap-2">
            {u.name}
            {faults.length >= 3 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ember/15 px-2 py-0.5 text-[0.65rem] font-semibold text-ember">
                <Flag size={11} /> {faults.length} faltas
              </span>
            ) : faults.length ? (
              <span className="rounded-full bg-paper px-2 py-0.5 text-[0.65rem] font-medium text-muted">
                {faults.length} falta(s)
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            {u.email} · DNI {u.dni} · {u.vehicle}
          </p>
          <p className="text-xs text-muted">
            {u.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} /> {u.phone}
              </span>
            ) : (
              "Sin teléfono"
            )}
          </p>
          <p className="mt-0.5 text-xs text-bottle">Jornada {shiftRange(u.shiftStart)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={statusTone(u.status)}>{u.status}</Pill>
          {u.status === "solicitud" ? (
            <>
              <Button
                size="sm"
                onClick={() =>
                  act(br.setUserStatus({ email: u.email, status: "activo" }), "Repartidor aprobado")
                }
              >
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act(
                    br.setUserStatus({ email: u.email, status: "rechazado" }),
                    "Solicitud rechazada",
                  )
                }
              >
                Rechazar
              </Button>
            </>
          ) : u.status === "activo" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                act(br.setUserStatus({ email: u.email, status: "suspendido" }), "Cuenta suspendida")
              }
            >
              Suspender
            </Button>
          ) : u.status === "suspendido" ? (
            <Button
              size="sm"
              onClick={() =>
                act(br.setUserStatus({ email: u.email, status: "activo" }), "Cuenta reactivada")
              }
            >
              Reactivar
            </Button>
          ) : null}
          <Button size="sm" variant="bottle" onClick={() => setOpen((v) => !v)}>
            <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />{" "}
            Gestionar
          </Button>
          {/* Baja definitiva: exige el código de admin (no se puede deshacer). */}
          <DeleteAccountButton email={u.email} name={u.name} />
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {/* Pedidos activos de este repartidor: se pueden pasar a otro. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
              Pedidos activos ({theirOrders.length})
            </p>
            {theirOrders.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Sin repartos en curso.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {theirOrders.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-semibold tabular-nums text-ember">{o.code}</span> ·{" "}
                      {o.customerName || o.customer} · {fmtEur(o.total)}
                    </span>
                    <select
                      className="h-9 rounded-lg bg-surface px-2 text-xs"
                      defaultValue=""
                      disabled={others.length === 0}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        act(
                          br.assignCourier({ id: o.id, courier: e.target.value }),
                          "Pedido reasignado",
                        );
                      }}
                    >
                      <option value="">
                        {others.length ? "Pasar a…" : "Sin más repartidores"}
                      </option>
                      {others.map((c) => (
                        <option key={c.email} value={c.email}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Faltas: registrar nuevas y consultar las ya notificadas. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
              Faltas ({faults.length})
            </p>
            <p className="mt-1 text-xs text-muted">
              Con 3 faltas el repartidor recibe un aviso destacado al entrar en su portal.
            </p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason.trim()) return;
                act(
                  br.addCourierFault({ email: u.email, reason: reason.trim() }),
                  "Falta notificada",
                );
                setReason("");
              }}
            >
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={512}
                placeholder="Motivo de la falta"
                className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm"
              />
              <Button size="sm" type="submit">
                <Flag size={14} /> Notificar
              </Button>
            </form>
            {faults.length ? (
              <ul className="mt-2 space-y-1">
                {faults.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0">
                      <span className={f.ack ? "text-muted" : "font-semibold text-ember"}>
                        {f.reason}
                      </span>
                      <span className="ml-2 text-muted">{fmtDate(f.createdAt)}</span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-muted hover:text-ember"
                      onClick={() => act(br.deleteCourierFault({ id: f.id }), "Falta eliminada")}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

const EMPTY_FORM = {
  name: "",
  brand: "",
  price: "",
  old: "",
  unit: "",
  cat: "snacks" as CategoryId,
  alcohol: false,
  grad: "",
  desc: "",
  long: "",
  // Stock y visibilidad (sección 5 del alta): `stockOn`/`flashOn` deciden si
  // el producto controla unidades / tiene oferta flash; el resto son valores.
  stockOn: false,
  stock: "",
  hidden: false,
  flashOn: false,
  flash: "",
  // Coste del proveedor (€): solo lo consume el Excel de rentabilidad; la
  // tienda y el checkout lo ignoran. Vacío = sin dato.
  coste: "",
};

type ImgState = {
  dataUrl: string;
  w: number;
  h: number;
  bytes: number;
  orig: number;
  mime: string;
};

/** Proporciones disponibles en el editor de recorte (valor = ancho/alto). */
const CROP_RATIOS: { label: string; v: number }[] = [
  { label: "4:5 ficha", v: 4 / 5 },
  { label: "1:1 cuadrado", v: 1 },
  { label: "3:2 horizontal", v: 3 / 2 },
  { label: "16:9 panorámico", v: 16 / 9 },
];

/** Lado largo de salida: a más px, más calidad y más peso en la ficha. */
const CROP_SIZES = [600, 800, 1200, 1600];

/* ------------------------------------------------------- Excel de rentabilidad */

/**
 * Pestaña «Rentabilidad»: centro de mando del Excel de beneficios. Parámetros,
 * recargos por pasillo y resumen en vivo de lo que se va a descargar. El .xlsx
 * lo genera `profit-xlsx` al vuelo (5 hojas con fórmulas vivas).
 */
function Rentabilidad() {
  const br = useBr();
  // Parámetros previos a la descarga (porcentajes en texto; se validan al
  // pulsar). No se guardan: cada descarga es una foto.
  const [ppIva, setPpIva] = useState("10");
  const [ppTarget, setPpTarget] = useState("25");
  const [ppCourier, setPpCourier] = useState("20");
  const [ppGateway, setPpGateway] = useState("1.5");
  // % de recargo por categoría (hoja «Precios %»): en texto, vacío = 0.
  const [catPct, setCatPct] = useState<Record<string, string>>({});

  const products = br.custom;
  // Solo las categorías con productos subidos (orden canónico de CATEGORIES).
  const presentCats = (Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).filter((c) =>
    products.some((p) => p.cat === c),
  );
  const withCost = products.filter((p) => p.coste != null && p.coste >= 0);
  const noCost = products.length - withCost.length;
  const avgPrice = products.length
    ? products.reduce((s, p) => s + p.price, 0) / products.length
    : 0;
  // Margen medio sobre los productos con coste: (PVP − coste) / PVP.
  const avgMargin = withCost.length
    ? (withCost.reduce(
        (s, p) => s + (p.price > 0 ? Math.max(0, (p.price - (p.coste ?? 0)) / p.price) : 0),
        0,
      ) /
        withCost.length) *
      100
    : 0;

  const pctOf = (c: string) => {
    const t = (catPct[c] ?? "").trim();
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n / 100 : 0;
  };

  function downloadProfit() {
    const nums = [ppIva, ppTarget, ppCourier, ppGateway].map((v) => Number(v));
    if (nums.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) {
      return toast.error("Revisa los porcentajes: números entre 0 y 100.");
    }
    const [iva, target, , gateway] = nums;
    if (1 / (1 + iva / 100) - gateway / 100 - target / 100 <= 0) {
      return toast.error(
        "Con ese IVA/margen/pasarela ningún precio es viable: baja el margen objetivo.",
      );
    }
    if (products.length === 0) return toast.error("Aún no hay productos subidos que analizar.");
    const pct: Record<string, number> = {};
    for (const [c, v] of Object.entries(catPct)) {
      const t = v.trim();
      if (!t) continue;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        return toast.error(
          `El recargo de «${CATEGORIES[c as keyof typeof CATEGORIES]?.label ?? c}» debe ser un % entre 0 y 1000.`,
        );
      }
      pct[c] = n / 100;
    }
    try {
      downloadProfitXlsx(
        products,
        {
          ivaPct: iva / 100,
          targetPct: target / 100,
          courierPct: nums[2] / 100,
          gatewayPct: gateway / 100,
        },
        pct,
      );
      toast.success(`Excel listo (${products.length} productos): mira «Precios %» y «Nutrición».`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const stats = [
    { n: String(products.length), label: "productos subidos", tone: "text-ink" },
    { n: String(withCost.length), label: "con coste proveedor", tone: "text-bottle" },
    {
      n: String(noCost),
      label: "sin coste (la hoja los marca)",
      tone: noCost ? "text-ember" : "text-muted",
    },
    {
      n: products.length ? fmtEur(avgPrice) : "—",
      label: "precio medio de venta",
      tone: "text-ink",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[1.5rem] bg-surface p-5 shadow-card sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
          Rentabilidad
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold">Excel de rentabilidad</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Prepara y descarga la hoja de cálculo de tus productos: recargo por pasillo o individual,
          PVP final, beneficio, reparto repartidor/admin y tabla nutricional. Todo son fórmulas
          vivas: cambia un % en Excel y se recalcula solo.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-paper p-4 shadow-card">
              <p className={`font-display text-2xl font-semibold tabular-nums ${s.tone}`}>{s.n}</p>
              <p className="mt-1 text-xs text-muted">{s.label}</p>
            </div>
          ))}
        </div>
        {withCost.length ? (
          <p className="mt-3 text-xs text-muted">
            Margen medio sobre los productos con coste:{" "}
            <strong className={avgMargin >= 25 ? "text-bottle" : "text-ember"}>
              {avgMargin.toFixed(1)} %
            </strong>{" "}
            (objetivo de referencia: {ppTarget || "25"} % tras IVA y pasarela).
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h3 className="font-display text-lg font-semibold">Parámetros globales</h3>
          <p className="mt-1 text-xs text-muted">
            Alimentan las hojas «Rentabilidad» y «Resumen»; luego en Excel puedes pisarlos celda a
            celda.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="IVA (%)" value={ppIva} onChange={setPpIva} type="number" step="0.1" />
            <Input
              label="Margen objetivo (%)"
              value={ppTarget}
              onChange={setPpTarget}
              type="number"
              step="1"
            />
            <Input
              label="Repartidor (% beneficio)"
              value={ppCourier}
              onChange={setPpCourier}
              type="number"
              step="1"
            />
            <Input
              label="Pasarela (% PVP)"
              value={ppGateway}
              onChange={setPpGateway}
              type="number"
              step="0.1"
            />
          </div>
          <div className="mt-4 rounded-2xl bg-paper p-3 text-xs text-muted">
            <p className="font-semibold text-ink">Cómo se reparte cada euro vendido</p>
            <p className="mt-1">
              PVP → IVA {ppIva || "10"} % → pasarela {ppGateway || "1,5"} % → lo que queda es el
              beneficio: {ppCourier || "20"} % para el repartidor y el resto para el admin. El
              detalle celda a celda viaja en la hoja «Rentabilidad».
            </p>
          </div>
        </div>

        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h3 className="font-display text-lg font-semibold">Recargo % por pasillo</h3>
          <p className="mt-1 text-xs text-muted">
            Vacío = 0 %. Dentro de Excel puedes afinar cada grupo o pisar el % de un producto con su
            columna «% individual».
          </p>
          {presentCats.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-paper p-4 text-sm text-muted">
              Todavía no hay productos subidos: dales de alta en «Productos» y vuelve — el Excel se
              alimenta de tus altas.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.1em] text-muted">
                  <tr>
                    <th className="py-2 pr-2 font-medium">Pasillo</th>
                    <th className="py-2 pr-2 font-medium">Productos</th>
                    <th className="py-2 pr-2 font-medium">Precio medio</th>
                    <th className="py-2 pr-2 font-medium">Recargo %</th>
                    <th className="py-2 font-medium">PVP estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {presentCats.map((c) => {
                    const list = products.filter((p) => p.cat === c);
                    const avg = list.reduce((s, p) => s + p.price, 0) / list.length;
                    const est = avg * (1 + pctOf(c));
                    return (
                      <tr key={c} className="border-t border-line">
                        <td className="py-2 pr-2 font-medium">{CATEGORIES[c].label}</td>
                        <td className="py-2 pr-2 tabular-nums text-muted">{list.length}</td>
                        <td className="py-2 pr-2 tabular-nums">{fmtEur(avg)}</td>
                        <td className="py-2 pr-2">
                          <input
                            value={catPct[c] ?? ""}
                            onChange={(ev) => setCatPct((m) => ({ ...m, [c]: ev.target.value }))}
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`Recargo ${CATEGORIES[c].label} (%)`}
                            className="h-9 w-20 rounded-xl bg-paper px-2 text-right text-sm shadow-card"
                          />
                        </td>
                        <td className="py-2 tabular-nums font-semibold text-bottle">
                          {fmtEur(est)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">
              Descargar .xlsx ({products.length} productos)
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              5 hojas: Parámetros, Precios %, Rentabilidad, Nutrición y Resumen. Consejo: rellena
              antes el «Coste proveedor» de cada producto en «Productos»; sin coste, la hoja lo
              marca como «Sin coste».
            </p>
          </div>
          <Button
            className="w-full sm:w-auto"
            variant="bottle"
            type="button"
            disabled={products.length === 0}
            onClick={downloadProfit}
          >
            <FileSpreadsheet size={16} />
            {products.length === 0 ? "Sin productos subidos" : "Descargar Excel"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Productos() {
  const br = useBr();
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [nutr, setNutr] = useState<{ k: string; v: string }[]>([]);
  const [img, setImg] = useState<ImgState | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  // Alta o edición: si trae id, «Publicar» sustituye a ese producto en vez
  // de crear uno nuevo (mismo upsert del servidor, sin cambiar el id).
  const [editId, setEditId] = useState<string | null>(null);
  // Base española remota (Open Food Facts): resultados y foto leída de la red.
  const [remote, setRemote] = useState<EanSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [remoteImg, setRemoteImg] = useState<string | null>(null);
  // Editor de encuadre: original en memoria (object URL) + ajuste zoom/paneo.
  const [origSrc, setOrigSrc] = useState<string | null>(null);
  const [origBytes, setOrigBytes] = useState(0);
  const [adj, setAdj] = useState<FrameAdjust>({ zoom: 1, panX: 0, panY: 0 });
  // Proporción y tamaño de salida del recorte: elegibles antes de aplicar.
  const [cropAspect, setCropAspect] = useState(4 / 5);
  const [cropMax, setCropMax] = useState(800);
  // Carrusel de subidos: deslizador para las flechas ← →.
  const stripRef = useRef<HTMLDivElement>(null);
  // El alta guiada: tras importar una ficha por URL la página se desplaza aquí
  // (la tarjeta del proveedor queda lejos del formulario, sobre todo en móvil).
  const formRef = useRef<HTMLFormElement>(null);
  // Y tras publicar, el panel se mueve solo a la lista de subidos: si no, el
  // alta parece «invisible» porque la tarjeta nace fuera de la pantalla.
  const uploadedRef = useRef<HTMLDivElement>(null);
  // Anti-carrera del editor de imagen: si cambias de producto rápido, la
  // descarga de la foto del anterior no debe pisar al que estás editando ya.
  const editSeq = useRef(0);
  // Arrastre EN VIVO sobre el carrusel: mientras se arrastra manda una copia
  // local (`stripIds`); al soltar se persiste TODO de una sola pasada con
  // reorderCustom (no se martilla el servidor en cada intercambio).
  const [stripIds, setStripIds] = useState<string[] | null>(null);
  const customSig = br.custom.map((p) => p.id).join("|");
  useEffect(() => setStripIds(null), [customSig]);
  const stripProducts = useMemo(() => {
    if (!stripIds) return br.custom;
    const byId = new Map(br.custom.map((p) => [p.id, p]));
    const picked = stripIds.map((id) => byId.get(id)).filter((x): x is Product => Boolean(x));
    const seen = new Set(picked.map((p) => p.id));
    return [...picked, ...br.custom.filter((p) => !seen.has(p.id))];
  }, [br.custom, stripIds]);
  const {
    dragI: stripDragI,
    start: startStripDrag,
    setRowRef: stripRowRef,
  } = usePointerSort(stripProducts, (next) => setStripIds(next.map((p) => p.id)), {
    onEnd: (next) => {
      const ids = next.map((p) => p.id);
      if (ids.join("|") !== customSig) act(br.reorderCustom({ ids }), "Orden actualizado");
      else setStripIds(null);
    },
  });
  const searchEan = br.searchEan;
  const importUrl = br.importUrl;
  // Importación desde la web del proveedor: URL de la tienda (se guarda en ESTE
  // navegador, es una preferencia del admin, no un dato de la app) + URL del
  // producto a pegar + estado del botón.
  const [supplierSite, setSupplierSite] = useState("");
  const [pUrl, setPUrl] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    try {
      setSupplierSite(localStorage.getItem("br.supplierUrl") ?? "");
    } catch {
      /* modo privado sin localStorage: el campo queda vacío y listo */
    }
  }, []);
  const saveSupplierSite = (v: string) => {
    setSupplierSite(v);
    try {
      localStorage.setItem("br.supplierUrl", v.trim());
    } catch {
      /* no se pudo guardar la preferencia: vale para esta sesión */
    }
  };

  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return BASE_PRODUCTOS.filter(
      (p) =>
        p.name.toLowerCase().includes(n) || p.ean.includes(n) || p.brand.toLowerCase().includes(n),
    ).slice(0, 6);
  }, [q]);

  // Búsqueda remota con debounce (450 ms): la base local responde al instante y
  // la española (Open Food Facts) llega detrás; si la remota cae, la local sigue.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRemote([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchEan(term)
        .then((r) => alive && setRemote(r))
        .catch(() => alive && setRemote([]))
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, searchEan]);

  // Sin duplicar: la remota no repite lo que ya muestra la base local.
  const remoteOnly = useMemo(
    () => remote.filter((r) => !hits.some((h) => h.ean === r.ean)),
    [remote, hits],
  );

  // Rellenar el formulario desde la base española (por EAN o nombre): NO publica,
  // para que el admin pueda añadir la foto y ajustar precio/descripción.
  function fillFromDraft(d: (typeof BASE_PRODUCTOS)[number]) {
    set({
      name: d.name,
      brand: d.brand,
      price: String(d.price),
      unit: d.unit,
      cat: d.cat,
      alcohol: !!d.alcohol,
      grad: d.grad || "",
      desc: `${d.name} de ${d.brand}.`,
      long: `${d.name} (${d.unit}). Precio de supermercado, entrega express en tu zona.`,
    });
    setNutr(Object.entries(d.nutrition).map(([k, v]) => ({ k, v })));
    toast.success(`Base cargada: ${d.name}. Añade la foto y pulsa Publicar.`);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Rellenar desde la base española remota (Open Food Facts): trae foto de red
  // (se guarda como URL, no como data URL: no hincha la BD) y nutrición real.
  function fillFromRemote(h: EanSearchHit) {
    set({
      name: h.name,
      brand: h.brand === "—" ? "" : h.brand,
      price: h.price != null ? String(h.price) : "",
      unit: h.unit,
      cat: h.alcohol ? "alcohol" : form.cat,
      alcohol: h.alcohol,
      desc: `${h.name}${h.brand && h.brand !== "—" ? ` de ${h.brand}` : ""}.`,
      long: `${h.name}${h.unit ? ` (${h.unit})` : ""}. Precio de supermercado, entrega express en tu zona.`,
    });
    setNutr(Object.entries(h.nutrition).map(([k, v]) => ({ k, v })));
    if (h.image) setRemoteImg(h.image);
    toast.success(
      h.price == null
        ? `Ficha cargada: ${h.name}. Escribe el precio y pulsa Publicar.`
        : `Ficha cargada: ${h.name}. Revisa precio y foto, y pulsa Publicar.`,
    );
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Volcar la ficha importada en el formulario (nombre, marca, precio, foto,
  // descripción) sin publicar: queda editable. Compartido por «Importar» (solo
  // rellenar) y por el one-click cuando el precio no viene y hay que escribirlo.
  function fillFormFromHit(h: NonNullable<Awaited<ReturnType<typeof importUrl>>["hit"]>) {
    set({
      name: h.name,
      brand: h.brand,
      price: h.price != null ? String(h.price) : "",
      desc: h.desc ? (h.desc.length <= 120 ? h.desc : `${h.desc.slice(0, 119).trimEnd()}…`) : "",
      long: h.desc || "",
    });
    // La foto importada viaja como URL remota (no hincha la BD); si hubiera
    // una foto local preparada de antes, la sustituye la del proveedor.
    setImg(null);
    if (h.image) setRemoteImg(h.image);
    setPUrl("");
    // Llevar la vista al formulario relleno: sin esto parece que «no se ha
    // añadido nada» cuando lo que falta es el último clic de Publicar.
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function fetchImport(u: string) {
    if (!u) {
      toast.error("Pega primero la URL del producto.");
      return null;
    }
    if (!/^https?:\/\//i.test(u)) {
      toast.error("La URL debe empezar por http:// o https://");
      return null;
    }
    setImporting(true);
    try {
      const r = await importUrl(u);
      if (!r.ok || !r.hit) {
        toast.error(r.msg || "No se pudo importar la ficha.");
        return null;
      }
      if (r.note) toast.info(r.note);
      return r.hit;
    } catch {
      toast.error("El servidor no pudo abrir esa página: rellena los datos a mano.");
      return null;
    } finally {
      setImporting(false);
    }
  }

  // 1-clic «solo rellenar»: el servidor lee la ficha y la trae al formulario.
  // NO publica: todo queda editable antes de pulsar Publicar.
  async function runImport() {
    const h = await fetchImport(pUrl.trim());
    if (!h) return;
    fillFormFromHit(h);
    toast.success(
      h.price == null
        ? `Importado: ${h.name}. Escribe el precio y pulsa Publicar.`
        : `Importado: ${h.name}. Revisa precio y foto, y pulsa Publicar.`,
      { duration: 9000 },
    );
  }

  // One-click real: lee la ficha del proveedor y la PUBLICA de una (usando la
  // categoría y el coste que el formulario tenga puestos). Si la página no trae
  // precio, no inventa: rellena el formulario para que lo escriba y publique.
  async function importAndPublish() {
    const h = await fetchImport(pUrl.trim());
    if (!h) return;
    const price = h.price ?? Number(form.price);
    if (!h.name?.trim()) {
      fillFormFromHit(h);
      toast.error("La página no trajo el nombre: complétalo y pulsa Publicar.", { duration: 9000 });
      return;
    }
    if (!(price > 0)) {
      fillFormFromHit(h);
      toast.error("La ficha no trae precio: escríbelo en el formulario y pulsa Publicar.", {
        duration: 9000,
      });
      return;
    }
    const name = h.name.trim();
    const brand = h.brand?.trim() || "Botella Rápida";
    const unit = form.unit.trim() || "ud";
    const coste = form.coste.trim() ? Number(form.coste) : null;
    if (coste != null && !(coste >= 0)) {
      fillFormFromHit(h);
      toast.error("El coste del proveedor debe ser un número ≥ 0.", { duration: 9000 });
      return;
    }
    const p: Product = {
      id: slugify(name) + "-" + Math.random().toString(36).slice(2, 5),
      name,
      cat: form.cat,
      brand,
      price,
      unit,
      desc: (h.desc?.trim() || `${name} de ${brand}.`).slice(0, 120),
      long: h.desc?.trim() || `${name} (${unit}).`,
      nutrition: {},
      image: h.image || CATEGORIES[form.cat].image,
      alcohol: form.cat === "alcohol" ? true : form.alcohol,
      grad: form.grad.trim() || undefined,
      pos: undefined,
      stock: null,
      coste,
    };
    try {
      await br.addCustomProduct({ product: p });
      setPUrl("");
      toast.success(
        `«${p.name}» publicado: ya está en «Subidos por el admin» y en la tienda. Edítalo si quieres ajustar precio, foto o categoría.`,
        { duration: 9000 },
      );
      // Enseñar el alta nueva en cuanto el panel la reciba (la consulta se
      // invalida al resolver la mutación; 700 ms cubre el refresco sin parpadeo).
      window.setTimeout(
        () => uploadedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        700,
      );
    } catch (err) {
      toast.error((err as Error)?.message || "No se pudo publicar el producto.");
    }
  }

  async function handleFile(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      // Recorte 4:5 (proporción de la ficha) + WebP q0.82 a 800 px de lado largo.
      const o = await fileToOptimizedImage(file, { maxDim: 800, quality: 0.82, cropAspect: 4 / 5 });
      setImg({
        dataUrl: o.dataUrl,
        w: o.width,
        h: o.height,
        bytes: o.bytes,
        orig: o.originalBytes,
        mime: o.mime,
      });
      // Guardamos el original en memoria (object URL) para poder reencuadrarlo
      // con el editor sin volver a subir la foto.
      if (origSrc) URL.revokeObjectURL(origSrc);
      setOrigSrc(URL.createObjectURL(file));
      setOrigBytes(file.size);
      setAdj({ zoom: 1, panX: 0, panY: 0 });
      setRemoteImg(null);
      const saved =
        o.originalBytes > 0 ? Math.max(0, Math.round((1 - o.bytes / o.originalBytes) * 100)) : 0;
      toast.success(
        `Imagen optimizada: ${o.width}×${o.height} · ${humanBytes(o.bytes)} (−${saved}%).`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // «Aplicar recorte»: regenera el WebP desde el original con el encuadre,
  // proporción y tamaño elegidos. Con productos ya publicados, el original es
  // la propia imagen guardada (data URL), así que se puede reeditar sin volver
  // a subir la foto.
  async function applyCrop() {
    if (!origSrc) return;
    setBusy(true);
    try {
      const o = await adjustOptimizedImage(origSrc, adj, {
        maxDim: cropMax,
        quality: 0.82,
        cropAspect,
      });
      setImg((prev) =>
        prev
          ? { ...prev, dataUrl: o.dataUrl, w: o.width, h: o.height, bytes: o.bytes }
          : {
              dataUrl: o.dataUrl,
              w: o.width,
              h: o.height,
              bytes: o.bytes,
              orig: origBytes,
              mime: o.mime,
            },
      );
      toast.success(`Recorte aplicado: ${o.width}×${o.height} · ${humanBytes(o.bytes)}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const price = Number(form.price);
    if (!form.name.trim()) return toast.error("Ponle un nombre al producto.");
    if (!(price > 0)) return toast.error("El precio debe ser mayor que 0.");
    // Oferta: precio anterior opcional; si se rellena debe superar al de venta
    // (si no, el tachado sería una mentira). Con ambos, la ficha pinta OFERTA.
    const oldPrice = form.old.trim() ? Number(form.old) : 0;
    if (oldPrice && !(oldPrice > price)) {
      return toast.error("El precio anterior de la oferta debe ser mayor que el precio de venta.");
    }
    // Stock y oferta flash: con la palanca apagada no se controla (null);
    // 0 unidades = agotado. La flash exige fecha válida o se avisa antes de publicar.
    if (form.flashOn && !fromLocalInput(form.flash)) {
      return toast.error("Pon una fecha y hora de fin para la oferta flash.");
    }
    const stock = form.stockOn ? Math.max(0, Math.floor(Number(form.stock) || 0)) : null;
    const flashUntil = form.flashOn ? fromLocalInput(form.flash) : null;
    // Coste del proveedor: opcional, solo para el Excel de rentabilidad.
    const coste = form.coste.trim() ? Number(form.coste) : null;
    if (coste != null && !(coste >= 0)) {
      return toast.error("El coste del proveedor debe ser un número ≥ 0.");
    }
    const nutrition = Object.fromEntries(
      nutr.filter((n) => n.k.trim()).map((n) => [n.k.trim(), n.v.trim()]),
    );
    // Al editar se conserva la posición manual del catálogo: el formulario no la
    // pinta y el upsert sustituye el payload entero (si no viajara `pos`, el
    // producto editado perdería su hueco y caería al final de la tienda).
    const keptPos = editId ? br.custom.find((x) => x.id === editId)?.pos : undefined;
    const p: Product = {
      id: editId ?? slugify(form.name) + "-" + Math.random().toString(36).slice(2, 5),
      name: form.name.trim(),
      cat: form.cat,
      brand: form.brand.trim() || "Botella Rápida",
      price,
      unit: form.unit.trim() || "ud",
      desc: form.desc.trim() || `${form.name.trim()} de ${form.brand.trim() || "Botella Rápida"}.`,
      long:
        form.long.trim() ||
        form.desc.trim() ||
        `${form.name.trim()} (${form.unit.trim() || "ud"}).`,
      nutrition,
      image: img?.dataUrl || remoteImg || CATEGORIES[form.cat].image,
      alcohol: form.cat === "alcohol" ? true : form.alcohol,
      grad: form.grad.trim() || undefined,
      oferta: oldPrice > price ? true : undefined,
      oldPrice: oldPrice > price ? oldPrice : undefined,
      pos: keptPos,
      stock,
      hidden: form.hidden || undefined,
      flashUntil: flashUntil ?? undefined,
      coste,
    };
    const editing = Boolean(editId);
    act(
      br.addCustomProduct({ product: p }).then(() => {
        setForm(EMPTY_FORM);
        setNutr([]);
        setImg(null);
        setQ("");
        setEditId(null);
        setRemoteImg(null);
        setOrigSrc(null);
        setAdj({ zoom: 1, panX: 0, panY: 0 });
        editSeq.current++;
        // Alta nueva (no edición): llevar la vista al carrusel para verla ahí.
        if (!editing) {
          window.setTimeout(
            () => uploadedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            700,
          );
        }
      }),
      editing ? `${p.name} actualizado` : `${p.name} publicado en el catálogo`,
    );
  }

  // Cargar un producto ya subido en el formulario para editarlo.
  function startEdit(p: Product) {
    setEditId(p.id);
    set({
      name: p.name,
      brand: p.brand,
      price: String(p.price),
      old: p.oldPrice != null ? String(p.oldPrice) : "",
      unit: p.unit,
      cat: p.cat,
      alcohol: !!p.alcohol,
      grad: p.grad || "",
      desc: p.desc,
      long: p.long,
      stockOn: p.stock != null,
      stock: p.stock != null ? String(p.stock) : "",
      hidden: !!p.hidden,
      flashOn: p.flashUntil != null,
      flash: p.flashUntil != null ? toLocalInput(p.flashUntil) : "",
      coste: p.coste != null ? String(p.coste) : "",
    });
    setNutr(Object.entries(p.nutrition ?? {}).map(([k, v]) => ({ k, v: String(v) })));
    // La imagen guardada (data URL o ruta/URL remota) se reutiliza si se vuelve
    // a publicar: una URL remota viaja por `remoteImg`, no por el editor de recorte.
    // Con data URL la cargamos TAMBIÉN como original del editor: así se puede
    // recortar y cambiar de tamaño un producto ya publicado sin volver a subir.
    setImg(
      p.image.startsWith("data:")
        ? {
            dataUrl: p.image,
            w: 0,
            h: 0,
            bytes: p.image.length,
            orig: p.image.length,
            mime: "image/webp",
          }
        : null,
    );
    setRemoteImg(p.image.startsWith("data:") ? null : p.image);
    setOrigSrc(p.image.startsWith("data:") ? p.image : null);
    setAdj({ zoom: 1, panX: 0, panY: 0 });
    setCropAspect(4 / 5);
    setCropMax(800);
    // Fotos enlazadas (URL del proveedor o ruta local): también se hacen
    // editables. El navegador no puede procesar en canvas una imagen de otro
    // dominio sin CORS, así que la baja nuestro servidor como data URL y el
    // editor de encuadre aparece igual que con una foto subida. Si la descarga
    // falla se queda solo el chip de enlace (y se puede subir una foto nueva).
    if (!p.image.startsWith("data:")) {
      const seq = ++editSeq.current;
      const src = p.image;
      void (async () => {
        let orig: string | null = src.startsWith("/") ? src : null;
        if (!orig) {
          const r = await br.fetchImage(src).catch(() => null);
          if (r?.ok && r.dataUrl) orig = r.dataUrl;
        }
        if (!orig || seq !== editSeq.current) return;
        setOrigSrc(orig);
        // La previsualización usa la copia descargada, no el enlace remoto:
        // muchos proveedores bloquean la incrustación desde otros dominios
        // (hotlink) y el recuadro saldría roto. Con la copia medida de verdad,
        // si se guarda sin recortar, la foto queda incrustada (ya no depende
        // de que el proveedor la retire).
        const copy = orig;
        const probe = new Image();
        probe.src = copy;
        await probe.decode().catch(() => {});
        if (seq !== editSeq.current) return;
        setImg(
          (prev) =>
            prev ?? {
              dataUrl: copy,
              w: probe.naturalWidth || 0,
              h: probe.naturalHeight || 0,
              bytes: copy.length,
              orig: copy.length,
              mime: "image/webp",
            },
        );
      })();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.success(`Editando «${p.name}». Cambia lo que quieras y pulsa Guardar.`);
  }

  function resetForm() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setNutr([]);
    setImg(null);
    setQ("");
    setRemoteImg(null);
    setOrigSrc(null);
    setAdj({ zoom: 1, panX: 0, panY: 0 });
    editSeq.current++;
  }

  // Flechas ↑↓ del carrusel: invierte dos posiciones vecinas y guarda el orden
  // completo (el servidor escribe `pos` en cada payload; no hay migración).
  // Operan sobre `stripProducts`: durante un arrastre en curso reflejan lo que
  // se está viendo, no la lista del servidor desfasada.
  function moveProduct(idx: number, dir: -1 | 1) {
    const ids = stripProducts.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    act(br.reorderCustom({ ids }), "Orden actualizado");
  }

  const altText = buildImageAlt(form.name || "Producto", form.brand, form.unit);

  // 2 productos por slide: cada columna del carrusel apila dos tarjetas.
  const stripCells: { p: Product; i: number }[][] = [];
  stripProducts.forEach((p, i) => {
    const c = Math.floor(i / 2);
    if (!stripCells[c]) stripCells[c] = [];
    stripCells[c].push({ p, i });
  });

  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      {/* Columna principal: el alta guiada */}
      <form
        ref={formRef}
        onSubmit={publish}
        className="space-y-6 rounded-[1.5rem] bg-surface p-5 shadow-card lg:col-span-3"
      >
        <div>
          <h2 className="font-display text-xl font-semibold">
            {editId ? "Editar producto" : "Subir producto"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {editId
              ? "Estás modificando un producto ya publicado: los cambios sustituyen al anterior sin cambiar su id."
              : "Rellena desde la base española por EAN o nombre, sube la foto (se convierte sola a WebP optimizado) y publica."}
          </p>
        </div>

        {/* 1 · Imagen */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">1 · Foto</p>
          <label
            onDragOver={(ev) => {
              ev.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(ev) => {
              ev.preventDefault();
              setDrag(false);
              void handleFile(ev.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-3 transition ${
              drag ? "border-ember bg-paper" : "border-line bg-paper"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(ev) => void handleFile(ev.target.files?.[0])}
            />
            <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface shadow-card">
              {busy ? (
                <Loader2 className="animate-spin text-muted" />
              ) : img ? (
                <img src={img.dataUrl} alt="Vista previa" className="size-full object-cover" />
              ) : (
                <Upload className="text-muted" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              {img ? (
                <>
                  <p className="font-medium">
                    {img.w}×{img.h} · {humanBytes(img.bytes)}
                  </p>
                  <p className="text-xs text-muted">
                    WebP listo para SEO (antes {humanBytes(img.orig)}). Alt: “{altText}”.
                  </p>
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-ember"
                    onClick={() => {
                      setImg(null);
                      setRemoteImg(null);
                      if (origSrc) URL.revokeObjectURL(origSrc);
                      setOrigSrc(null);
                    }}
                  >
                    <Trash2 size={14} /> Quitar imagen
                  </button>
                </>
              ) : (
                <>
                  <p className="font-medium">Arrastra una foto o haz clic</p>
                  <p className="text-xs text-muted">
                    JPG · PNG · WebP · AVIF — se redimensiona a 800 px y se guarda como WebP.
                  </p>
                </>
              )}
            </div>
          </label>
          {/* Foto enlazada por URL (base española o importación del proveedor):
              se previsualiza aquí para verla antes de publicar; si se quita o
              se sube una propia, manda la local. */}
          {!img && remoteImg ? (
            <div className="flex items-center gap-3 rounded-2xl bg-paper p-3">
              <img
                src={remoteImg}
                alt=""
                className="h-16 w-14 rounded-xl bg-surface object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1 text-xs text-muted">
                <p className="font-medium text-ink">
                  Foto enlazada por URL (se guarda como enlace)
                </p>
                <p className="truncate">{remoteImg}</p>
              </div>
              <button
                type="button"
                aria-label="Quitar foto enlazada"
                title="Quitar foto enlazada"
                className="text-muted transition hover:text-ember"
                onClick={() => setRemoteImg(null)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : null}
          {/* Editor de encuadre: zoom + paneo sobre la proporción y el tamaño
              elegidos, sin volver a subir la foto. Funciona también AL EDITAR:
              el original es la imagen guardada. La previsualización usa la misma
              matemática que el recorte canvas, así que lo que se ve es lo que se
              guarda. */}
          {origSrc && img ? (
            <div className="rounded-2xl bg-paper p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <Crop size={14} /> Encuadre, proporción y tamaño: ajusta y aplica sin volver a subir
                la foto.
              </p>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {CROP_RATIOS.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setCropAspect(r.v)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[0.68rem] font-semibold transition",
                      Math.abs(cropAspect - r.v) < 0.001
                        ? "bg-ink text-paper"
                        : "bg-surface text-muted hover:text-ink",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[0.68rem] text-muted">
                  Tamaño
                  <select
                    value={cropMax}
                    onChange={(ev) => setCropMax(Number(ev.target.value))}
                    className="h-7 rounded-lg bg-surface px-1.5 text-[0.68rem] text-ink"
                  >
                    {CROP_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-3">
                <div
                  className="relative w-24 shrink-0 overflow-hidden rounded-xl bg-surface"
                  style={{ aspectRatio: String(cropAspect) }}
                >
                  <img
                    src={origSrc}
                    alt="Previsualización del recorte"
                    className="absolute inset-0 size-full object-cover"
                    style={{
                      transform: `translate(${-adj.panX * (adj.zoom - 1) * 50}%, ${-adj.panY * (adj.zoom - 1) * 50}%) scale(${adj.zoom})`,
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted">Zoom</span>
                    <input
                      type="range"
                      min={1}
                      max={2.5}
                      step={0.05}
                      value={adj.zoom}
                      onChange={(ev) => setAdj((a) => ({ ...a, zoom: Number(ev.target.value) }))}
                      className="min-w-0 flex-1 accent-[#c2410c]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted">Horizontal</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={adj.panX}
                      onChange={(ev) => setAdj((a) => ({ ...a, panX: Number(ev.target.value) }))}
                      className="min-w-0 flex-1 accent-[#c2410c]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted">Vertical</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={adj.panY}
                      onChange={(ev) => setAdj((a) => ({ ...a, panY: Number(ev.target.value) }))}
                      className="min-w-0 flex-1 accent-[#c2410c]"
                    />
                  </label>
                  <div className="flex items-center gap-3 pt-1">
                    <Button
                      size="sm"
                      variant="bottle"
                      type="button"
                      disabled={busy}
                      onClick={() => void applyCrop()}
                    >
                      <Crop size={14} /> Aplicar recorte ({cropMax} px)
                    </Button>
                    <button
                      type="button"
                      className="text-muted underline-offset-2 hover:text-ember hover:underline"
                      onClick={() => setAdj({ zoom: 1, panX: 0, panY: 0 })}
                    >
                      Restablecer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* 2 · Básicos */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">2 · Datos</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nombre *"
              value={form.name}
              onChange={(v) => set({ name: v })}
              required
              placeholder="Palitos de pan"
            />
            <Input
              label="Marca"
              value={form.brand}
              onChange={(v) => set({ brand: v })}
              placeholder="DIA"
            />
            <Input
              label="Precio (€) *"
              value={form.price}
              onChange={(v) => set({ price: v })}
              type="number"
              step="0.01"
              placeholder="0.79"
            />
            <Input
              label="Precio anterior (oferta, €)"
              value={form.old}
              onChange={(v) => set({ old: v })}
              type="number"
              step="0.01"
              placeholder="1.20"
            />
            <Input
              label="Unidad"
              value={form.unit}
              onChange={(v) => set({ unit: v })}
              placeholder="bolsa 250 g"
            />
            <Input
              label="Coste proveedor (€, opcional)"
              value={form.coste}
              onChange={(v) => set({ coste: v })}
              type="number"
              step="0.01"
              placeholder="0.45"
            />
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-muted">Categoría</span>
              <select
                value={form.cat}
                onChange={(ev) => set({ cat: ev.target.value as CategoryId })}
                className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
              >
                {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
              </select>
            </label>
            {form.cat === "alcohol" ? (
              <>
                <Input
                  label="Graduación"
                  value={form.grad}
                  onChange={(v) => set({ grad: v })}
                  placeholder="5,5°"
                />
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked readOnly className="size-4 accent-[#c2410c]" />
                  +18 automático (alcohol)
                </label>
              </>
            ) : (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.alcohol}
                  onChange={(ev) => set({ alcohol: ev.target.checked })}
                  className="size-4 accent-[#c2410c]"
                />
                Producto con alcohol (+18)
              </label>
            )}
          </div>
        </section>

        {/* 3 · Texto SEO */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
            3 · Descripción
          </p>
          <label className="block">
            <span className="text-xs font-medium text-muted">Resumen (lista de productos)</span>
            <textarea
              value={form.desc}
              onChange={(ev) => set({ desc: ev.target.value })}
              rows={2}
              placeholder="Una línea que se ve en la ficha."
              className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">
              Descripción larga (página de producto)
            </span>
            <textarea
              value={form.long}
              onChange={(ev) => set({ long: ev.target.value })}
              rows={3}
              placeholder="Detalle, formato, conservación…"
              className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
            />
          </label>
        </section>

        {/* 4 · Nutrición */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
              4 · Nutrición
            </p>
            <button
              type="button"
              className="text-xs text-ember"
              onClick={() => setNutr((n) => [...n, { k: "", v: "" }])}
            >
              + Añadir fila
            </button>
          </div>
          {nutr.length === 0 ? (
            <p className="text-sm text-muted">Sin información nutricional (opcional).</p>
          ) : (
            <div className="space-y-2">
              {nutr.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.k}
                    onChange={(ev) =>
                      setNutr((all) =>
                        all.map((r, j) => (j === i ? { ...r, k: ev.target.value } : r)),
                      )
                    }
                    placeholder="Grasas"
                    className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm"
                  />
                  <input
                    value={row.v}
                    onChange={(ev) =>
                      setNutr((all) =>
                        all.map((r, j) => (j === i ? { ...r, v: ev.target.value } : r)),
                      )
                    }
                    placeholder="1.8 g"
                    className="h-24 w-24 rounded-xl bg-paper px-3 text-sm"
                  />
                  <button
                    type="button"
                    aria-label="Quitar fila"
                    className="text-muted hover:text-ember"
                    onClick={() => setNutr((all) => all.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5 · Stock y visibilidad */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
            5 · Stock y visibilidad
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.stockOn}
              onChange={(ev) => set({ stockOn: ev.target.checked })}
              className="size-4 accent-[#c2410c]"
            />
            Controlar unidades disponibles
          </label>
          {form.stockOn ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Unidades"
                value={form.stock}
                onChange={(v) => set({ stock: v })}
                type="number"
                step="1"
                placeholder="12"
              />
              <p className="self-end pb-2 text-xs text-muted">
                0 = agotado: la tienda marca «Agotado» y nadie puede añadirlo a la cesta.
              </p>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.hidden}
              onChange={(ev) => set({ hidden: ev.target.checked })}
              className="size-4 accent-[#c2410c]"
            />
            Ocultar de la tienda (solo lo ves tú en el panel)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.flashOn}
              onChange={(ev) => set({ flashOn: ev.target.checked })}
              className="size-4 accent-[#c2410c]"
            />
            Oferta flash con cuenta atrás
          </label>
          {form.flashOn ? (
            <Input
              label="Termina el"
              value={form.flash}
              onChange={(v) => set({ flash: v })}
              type="datetime-local"
            />
          ) : null}
        </section>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Procesando imagen…" : editId ? "Guardar cambios" : "Publicar producto"}
        </Button>
        {editId ? (
          <button
            type="button"
            onClick={resetForm}
            className="w-full text-center text-xs font-medium text-muted hover:text-ember"
          >
            Cancelar edición (crear un producto nuevo)
          </button>
        ) : null}
      </form>

      {/* Columna lateral: búsqueda EAN + catálogo subido */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">
            Tienda del proveedor (importar por URL)
          </h2>
          <p className="mt-1 text-sm text-muted">
            Guarda la web de tu proveedor, ábrela en 1 clic y pega la URL del producto. Con{" "}
            <strong>Importar y publicar</strong> se añade a tu tienda de una sola vez; con{" "}
            <strong>Solo rellenar</strong> vuelca los datos en el formulario para que los revises
            antes de Publicar.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={supplierSite}
              onChange={(ev) => saveSupplierSite(ev.target.value)}
              placeholder="https://tienda-del-proveedor.com"
              className="h-11 min-w-0 flex-1 rounded-2xl bg-paper px-3 text-sm shadow-card"
            />
            <Button
              size="sm"
              variant="bottle"
              type="button"
              disabled={!/^https?:\/\//i.test(supplierSite.trim())}
              onClick={() => window.open(supplierSite.trim(), "_blank", "noopener,noreferrer")}
            >
              <ExternalLink size={14} /> Abrir tienda
            </Button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={pUrl}
              onChange={(ev) => setPUrl(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  void importAndPublish();
                }
              }}
              placeholder="Pega aquí la URL del producto…"
              className="h-11 min-w-0 rounded-2xl bg-paper px-3 text-sm shadow-card"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                type="button"
                disabled={importing}
                onClick={() => void importAndPublish()}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{" "}
                Importar y publicar
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={importing}
                onClick={() => void runImport()}
              >
                <Download size={14} /> Solo rellenar
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            El one-click usa la <strong>categoría</strong> y el <strong>coste</strong> que tengas
            puestos en el formulario (por defecto Snacks): elígelos antes si importas vino, cerveza
            o parafarmacia. Si la página no trae precio, no lo inventa: rellena el formulario y
            pulsa Publicar.
          </p>
          <p className="mt-2 text-xs text-muted">
            Funciona con la mayoría de tiendas (leemos sus datos estructurados). Si una web bloquea
            la lectura automática el panel avisa y se puede rellenar a mano; la foto viaja enlazada
            por URL, así que si el proveedor la retira cárgala tú en el panel de imagen.
          </p>
        </div>

        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Base española (por EAN)</h2>
          <p className="mt-1 text-sm text-muted">
            Miles de productos comercializados en España (Open Food Facts): escribe nombre o EAN y
            pulsa «Rellenar».
          </p>
          <div className="relative mt-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="palitos, rioja, 8410…"
              className="h-11 w-full rounded-2xl bg-paper pl-9 pr-3 text-sm shadow-card"
            />
          </div>
          <ul className="mt-3 space-y-2">
            {hits.map((h) => (
              <li
                key={h.ean}
                className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{h.name}</p>
                  <p className="text-xs text-muted">
                    {h.brand} · {fmtEur(h.price)} · {h.ean}
                  </p>
                </div>
                <Button size="sm" variant="bottle" type="button" onClick={() => fillFromDraft(h)}>
                  Rellenar
                </Button>
              </li>
            ))}
            {remoteOnly.map((h) => (
              <li
                key={h.ean}
                className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {h.image ? (
                    <img
                      src={h.image}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg bg-surface object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{h.name}</p>
                    <p className="truncate text-xs text-muted">
                      {h.brand} · {h.price != null ? fmtEur(h.price) : "sin precio"} · {h.ean}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="bottle" type="button" onClick={() => fillFromRemote(h)}>
                  Rellenar
                </Button>
              </li>
            ))}
          </ul>
          {searching ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Buscando en la base española…
            </p>
          ) : null}
          {q.trim().length >= 2 && !searching && hits.length === 0 && remoteOnly.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              Sin resultados: prueba con otro término o EAN (la base local sigue disponible).
            </p>
          ) : null}
        </div>

        <div ref={uploadedRef}>
          <h2 className="mb-3 font-display text-lg font-semibold">
            Subidos por el admin ({br.custom.length})
          </h2>
          {br.custom.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay altas.</p>
          ) : (
            <>
              {/* Carrusel horizontal con 2 productos por slide: cada columna
                  apila dos tarjetas y se desplaza de a una. Se puede arrastrar
                  cualquier tarjeta con su asa para reordenar EN VIVO; ↑↓ y las
                  flechas ← → siguen disponibles. */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Desplazar a la izquierda"
                  onClick={() => stripRef.current?.scrollBy({ left: -188, behavior: "smooth" })}
                  className="absolute -left-2 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-surface text-bottle shadow-lift transition hover:bg-paper"
                >
                  <ChevronLeft size={16} />
                </button>
                <div
                  ref={stripRef}
                  className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
                >
                  {stripCells.map((cell, ci) => (
                    <div key={ci} className="flex w-44 shrink-0 snap-start flex-col gap-3">
                      {cell.map(({ p, i }) => (
                        <div
                          key={p.id}
                          ref={stripRowRef(i)}
                          className={`rounded-2xl bg-surface p-3 shadow-card${stripDragI === i ? " opacity-60" : ""}${
                            p.oferta && p.oldPrice != null && p.oldPrice > p.price
                              ? " ring-2 ring-ember"
                              : ""
                          }`}
                        >
                          <div className="relative overflow-hidden rounded-xl bg-paper">
                            <img
                              src={p.image}
                              alt={p.name}
                              className="h-28 w-full object-cover"
                              loading="lazy"
                            />
                            {p.oferta ? (
                              <span className="absolute left-1.5 top-1.5 rounded-full bg-ember px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-surface">
                                Oferta
                              </span>
                            ) : null}
                            {p.hidden ? (
                              <span className="absolute right-1.5 top-1.5 rounded-full bg-ink/85 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-paper">
                                Oculto
                              </span>
                            ) : null}
                            {isSoldOut(p) ? (
                              <span className="absolute inset-0 grid place-items-center bg-ink/60 text-xs font-bold uppercase tracking-wide text-paper">
                                Agotado
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 flex items-center gap-1 text-sm font-medium">
                            <span
                              onPointerDown={(ev) => startStripDrag(i, ev)}
                              style={{ touchAction: "none" }}
                              className="grid w-4 shrink-0 cursor-grab place-items-center text-muted hover:text-ember active:cursor-grabbing"
                              title="Arrastra para recolocar en la tienda"
                              aria-label={`Arrastrar ${p.name}`}
                            >
                              <GripVertical size={14} />
                            </span>
                            <span className="truncate" title={p.name}>
                              {p.name}
                            </span>
                          </p>
                          <p className="text-xs text-muted">
                            {p.oferta && p.oldPrice != null && p.oldPrice > p.price ? (
                              <span className="mr-1 line-through">{fmtEur(p.oldPrice)}</span>
                            ) : null}
                            <span className={p.oferta ? "font-semibold text-ember" : ""}>
                              {fmtEur(p.price)}
                            </span>
                          </p>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                aria-label="Subir posición en la tienda"
                                title="Subir posición en la tienda"
                                disabled={i === 0}
                                onClick={() => moveProduct(i, -1)}
                                className="grid size-7 place-items-center rounded-lg bg-paper text-muted transition hover:text-bottle disabled:opacity-30"
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                type="button"
                                aria-label="Bajar posición en la tienda"
                                title="Bajar posición en la tienda"
                                disabled={i === stripProducts.length - 1}
                                onClick={() => moveProduct(i, 1)}
                                className="grid size-7 place-items-center rounded-lg bg-paper text-muted transition hover:text-bottle disabled:opacity-30"
                              >
                                <ArrowDown size={14} />
                              </button>
                            </div>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                aria-label={
                                  p.hidden
                                    ? `Mostrar ${p.name} en la tienda`
                                    : `Ocultar ${p.name} de la tienda`
                                }
                                title={p.hidden ? "Mostrar en la tienda" : "Ocultar de la tienda"}
                                onClick={() =>
                                  act(
                                    br.addCustomProduct({ product: { ...p, hidden: !p.hidden } }),
                                    p.hidden
                                      ? `${p.name} visible en la tienda`
                                      : `${p.name} ocultado de la tienda`,
                                  )
                                }
                                className="grid size-7 place-items-center rounded-lg bg-paper text-muted transition hover:text-ink"
                              >
                                {p.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                aria-label={`Editar ${p.name}`}
                                title="Editar"
                                onClick={() => startEdit(p)}
                                className="grid size-7 place-items-center rounded-lg bg-bottle/10 text-bottle transition hover:bg-bottle/20"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Borrar ${p.name}`}
                                title="Borrar"
                                onClick={() =>
                                  act(br.removeCustomProduct({ id: p.id }), "Producto quitado")
                                }
                                className="grid size-7 place-items-center rounded-lg bg-ember/10 text-ember transition hover:bg-ember/20"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Desplazar a la derecha"
                  onClick={() => stripRef.current?.scrollBy({ left: 188, behavior: "smooth" })}
                  className="absolute -right-2 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-surface text-bottle shadow-lift transition hover:bg-paper"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Dos productos por slide · arrastra el asa{" "}
                <GripVertical className="inline size-3 align-text-bottom" /> para recolocar en
                tiempo real · ↑↓ mueven de a una · desliza para ver todos.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  step,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
      />
    </label>
  );
}

function Reclamos() {
  const br = useBr();
  return (
    <ul className="space-y-3">
      {br.claims.map((c) => (
        <li key={c.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {c.email} · {c.orderCode} · {c.type}
            </p>
            <Pill tone={statusTone(c.status)}>{c.status}</Pill>
          </div>
          <p className="mt-2 text-sm">{c.text}</p>
          {c.status === "abierta" ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                act(
                  br.resolveClaim({ id: c.id, answer: String(fd.get("answer")) }),
                  "Reclamación resuelta",
                );
              }}
            >
              <input
                name="answer"
                required
                placeholder="Respuesta"
                className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm"
              />
              <Button size="sm" type="submit">
                Resolver
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-bottle">{c.answer}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function SoporteAdmin() {
  const br = useBr();
  return (
    <ul className="space-y-3">
      {br.messages.map((m) => (
        <li key={m.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{m.email}</p>
            <Pill tone={statusTone(m.status)}>{m.status}</Pill>
          </div>
          <p className="mt-2 text-sm">{m.text}</p>
          {m.status === "abierto" ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                act(
                  br.replyMessage({ id: m.id, answer: String(fd.get("answer")) }),
                  "Mensaje respondido",
                );
              }}
            >
              <input
                name="answer"
                required
                placeholder="Respuesta"
                className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm"
              />
              <Button size="sm" type="submit">
                Responder
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-bottle">{m.answer}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pestaña de estadísticas. Deja skeleton hasta que `getStats` responde (es la
 * única pantalla que dispara esa consulta, solo admin) y monta los gráficos
 * (recharts) bajo `Suspense` porque entran en lazy.
 */
function Estadisticas() {
  const br = useBr();
  if (br.statsLoading || !br.stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
        <div className="h-56 animate-pulse rounded-[1.25rem] bg-surface" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Suspense fallback={<div className="h-56 animate-pulse rounded-[1.25rem] bg-surface" />}>
        <StatsView stats={br.stats} />
      </Suspense>
      <LaunchReset />
    </div>
  );
}

/**
 * Reinicio de lanzamiento (fin de la pestaña «Estadísticas»). Para usar UNA sola
 * vez, el día de la apertura: borra pedidos, archivados, facturas, pagos,
 * reseñas, reclamaciones y chats de prueba para que las estadísticas arranquen
 * a cero. Cuentas, catálogo, cupones y ajustes NO se tocan.
 *
 * Triple confirmación: dos diálogos de aviso y, al final, escribir la frase
 * REINICIAR. El servidor NO se fía del navegador: exige la misma frase y deja
 * el borrado (con conteos) en la bitácora de «Seguridad».
 */
function LaunchReset() {
  const br = useBr();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    // 1/3 · qué se va a borrar exactamente.
    const step1 = window.confirm(
      "1 de 3 · ¿Reiniciar TODAS las estadísticas de lanzamiento?\n\n" +
        "Se borran: pedidos (también los archivados), facturas, pagos, reseñas, " +
        "reclamaciones y chats.\n" +
        "NO se tocan: cuentas, productos, cupones ni ajustes.",
    );
    if (!step1) return;
    // 2/3 · irreversibilidad + copia de seguridad.
    const step2 = window.confirm(
      "2 de 3 · Es IRREVERSIBLE: no hay forma de volver atrás.\n\n" +
        "¿Has guardado antes una copia de seguridad (npm run backup:db)?",
    );
    if (!step2) return;
    // 3/3 · la frase exacta, escrita a mano.
    const typed = window.prompt(
      "3 de 3 · Último paso: escribe REINICIAR para confirmar el borrado.",
    );
    if (typed === null) return;
    setBusy(true);
    try {
      const res = await br.resetLaunchData(typed);
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
      toast.success(`Estadísticas reiniciadas · ${total} registros borrados`);
    } catch (err) {
      toast.error((err as Error)?.message || "No se pudo reiniciar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[1.25rem] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="font-display text-xl font-semibold">Reinicio de lanzamiento</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Para usar el día que abra la tienda: borra de golpe pedidos, archivados, facturas,
            pagos, reseñas, reclamaciones y chats de prueba, y pone a cero los contadores de
            cupones; las estadísticas arrancan limpias. Cuentas, catálogo y ajustes se conservan.
            Pide confirmación tres veces y NO tiene vuelta atrás: guarda antes una copia con{" "}
            <span className="font-semibold">npm run backup:db</span>.
          </p>
        </div>
        <Button
          size="sm"
          variant="bottle"
          className="btn-metallic"
          disabled={busy}
          onClick={onClick}
        >
          <Trash2 /> {busy ? "Reiniciando…" : "Reiniciar estadísticas"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- cupones */

/**
 * Pestaña de cupones y códigos de afiliado: alta, activar/desactivar y borrar.
 * El contador «Usados» lo alimenta el servidor al crear cada pedido (con tope
 * garantizado en transacción), así que aquí se lee siempre el dato real. Los
 * códigos marcados como afiliado se distinguen en la tabla y guardan el nombre
 * del creador de contenido para poder atribuirle la campaña.
 */
function Cupones() {
  const br = useBr();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [amount, setAmount] = useState("10");
  const [minOrder, setMinOrder] = useState("0");
  const [maxUses, setMaxUses] = useState("0");
  const [expires, setExpires] = useState("");
  const [affiliateName, setAffiliateName] = useState("");
  const [firstOnly, setFirstOnly] = useState(false);
  const [affiliate, setAffiliate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await br.createCoupon({
        code: code.trim().toUpperCase(),
        kind,
        amount: Number(amount),
        minOrder: Number(minOrder) || 0,
        firstOnly,
        affiliate,
        affiliateName: affiliate ? affiliateName.trim() || undefined : undefined,
        maxUses: Math.max(0, Math.floor(Number(maxUses) || 0)),
        // Fin del día elegido (hora local); vacío = sin caducidad.
        expiresAt: expires ? new Date(expires).setHours(23, 59, 59, 999) : null,
      });
      toast.success(`Cupón ${code.trim().toUpperCase()} creado`);
      e.currentTarget.reset();
      setCode("");
      setAmount("10");
      setMinOrder("0");
      setMaxUses("0");
      setExpires("");
      setAffiliateName("");
      setFirstOnly(false);
      setAffiliate(false);
    } catch (err) {
      toast.error((err as Error)?.message || "No se pudo crear el cupón.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="rounded-[1.25rem] bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Crear cupón o código de afiliado</h2>
        <p className="mt-1 text-xs text-muted">
          Un código de afiliado es ideal para creadores de contenido: el cliente lo escribe en el
          checkout, se descuenta su % y el pedido queda atribuido a ese nombre.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Código (A–Z, 0–9, guion)"
            value={code}
            onChange={(v) => setCode(v.toUpperCase())}
            required
            placeholder="CREATOR10"
          />
          <label className="block">
            <span className="text-xs font-medium text-muted">Tipo</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "percent" | "fixed")}
              className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
            >
              <option value="percent">Descuento %</option>
              <option value="fixed">Descuento €</option>
            </select>
          </label>
          <Input
            label={kind === "percent" ? "Porcentaje (1–90)" : "Importe (€)"}
            value={amount}
            onChange={setAmount}
            type="number"
            step="0.5"
            required
          />
          <Input
            label="Mínimo de pedido (€, 0 = sin mínimo)"
            value={minOrder}
            onChange={setMinOrder}
            type="number"
            step="1"
          />
          <Input
            label="Tope de usos (0 = ilimitado)"
            value={maxUses}
            onChange={setMaxUses}
            type="number"
            step="1"
          />
          <Input label="Caducidad (opcional)" value={expires} onChange={setExpires} type="date" />
          {affiliate ? (
            <Input
              label="Nombre del afiliado (interno)"
              value={affiliateName}
              onChange={setAffiliateName}
              placeholder="@mi-canal"
            />
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={firstOnly}
              onChange={(e) => setFirstOnly(e.target.checked)}
              className="size-4"
            />
            Solo primera compra
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={affiliate}
              onChange={(e) => setAffiliate(e.target.checked)}
              className="size-4"
            />
            Código de afiliado / creador
          </label>
        </div>
        <Button type="submit" size="sm" className="mt-4" disabled={busy}>
          <Plus /> Crear cupón
        </Button>
      </form>

      {br.couponsLoading && br.coupons.length === 0 ? (
        <p className="text-sm text-muted">Cargando cupones…</p>
      ) : br.coupons.length === 0 ? (
        <p className="text-sm text-muted">Todavía no has creado ningún cupón.</p>
      ) : (
        <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-ink text-surface">
              <tr>
                {["Código", "Descuento", "Condiciones", "Usos", "Caduca", "Estado", "Acciones"].map(
                  (h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {br.coupons.map((c) => {
                const expired = c.expiresAt != null && c.expiresAt < Date.now();
                const exhausted = c.maxUses > 0 && c.usedCount >= c.maxUses;
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-semibold tabular-nums text-ember">{c.code}</p>
                      {c.affiliate ? (
                        <p className="text-xs text-bottle">
                          Afiliado · {c.affiliateName ?? "sin nombre"}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.kind === "percent" ? `−${c.amount}%` : `−${fmtEur(c.amount)}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.minOrder > 0 ? `mín. ${fmtEur(c.minOrder)}` : "sin mínimo"}
                      {c.firstOnly ? " · solo 1ª compra" : ""}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.usedCount}
                      {c.maxUses > 0 ? ` / ${c.maxUses}` : " / ∞"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.expiresAt ? fmtDate(c.expiresAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {!c.active ? (
                        <Pill tone="neutral">Pausado</Pill>
                      ) : expired ? (
                        <Pill tone="stop">Caducado</Pill>
                      ) : exhausted ? (
                        <Pill tone="warn">Agotado</Pill>
                      ) : (
                        <Pill tone="go">Activo</Pill>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="h-9 rounded-lg bg-paper px-2 text-xs"
                          onClick={() =>
                            act(
                              br.setCouponActive({ id: c.id, active: !c.active }),
                              c.active ? "Cupón pausado" : "Cupón activado",
                            )
                          }
                        >
                          {c.active ? "Pausar" : "Activar"}
                        </button>
                        <button
                          type="button"
                          className="h-9 rounded-lg bg-ember/15 px-2 text-xs text-ember"
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Borrar el cupón ${c.code}? Los pedidos ya hechos conservan su código, pero dejará de poder usarse.`,
                              )
                            ) {
                              act(br.deleteCoupon({ id: c.id }), "Cupón borrado");
                            }
                          }}
                        >
                          Borrar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- pedidos archivados */

/**
 * Lista de pedidos ELIMINADOS (archivados). Cada uno se puede abrir para
 * descargarlo en PDF (imprimir) o devolverlo al flujo normal.
 */
function Archivados() {
  const br = useBr();
  const [sel, setSel] = useState<Order | null>(null);
  const list = [...br.archivedOrders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <p className="text-sm text-muted">No hay pedidos eliminados.</p>
      ) : (
        <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-ink text-surface">
              <tr>
                {["Código", "Cliente", "Total", "Estado", "Fecha", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-4 py-3 font-semibold tabular-nums text-ember">{o.code}</td>
                  <td className="px-4 py-3">{o.customerName || o.customer}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtEur(o.total)}</td>
                  <td className="px-4 py-3">
                    <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{fmtDate(o.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="h-9 rounded-lg bg-paper px-2 text-xs"
                        onClick={() => setSel(o)}
                      >
                        Ver / PDF
                      </button>
                      <button
                        type="button"
                        className="h-9 rounded-lg bg-bottle/10 px-2 text-xs text-bottle"
                        onClick={() => act(br.restoreOrder({ id: o.id }), "Pedido restaurado")}
                      >
                        Restaurar
                      </button>
                      <button
                        type="button"
                        className="h-9 rounded-lg bg-ember/15 px-2 text-xs text-ember"
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Borrar DEFINITIVAMENTE el pedido ${o.code}? Se elimina para siempre junto con sus items, chat e historial. Esta acción no se puede deshacer.`,
                            )
                          ) {
                            act(br.purgeOrder({ id: o.id }), "Pedido borrado definitivamente");
                          }
                        }}
                      >
                        Borrar definitivo
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel ? <OrderDocModal order={sel} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

/** Ficha imprimible de un pedido: «Imprimir / PDF» usa el diálogo del navegador. */
function OrderDocModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  return (
    <>
      <style>{`@media print{body *{visibility:hidden!important}#order-doc,#order-doc *{visibility:visible!important}#order-doc{position:fixed!important;inset:0!important;box-shadow:none!important;border-radius:0!important;max-height:none!important;overflow:visible!important}}`}</style>
      <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
        <div
          id="order-doc"
          className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 text-ink shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bottle">
                Pedido archivado
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold tabular-nums">{o.code}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-10 place-items-center rounded-full hover:bg-paper"
              aria-label="Cerrar"
            >
              <span className="text-lg">×</span>
            </button>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Fecha</dt>
            <dd className="tabular-nums">{fmtDate(o.createdAt)}</dd>
            <dt className="text-muted">Cliente</dt>
            <dd>{o.customerName || o.customer}</dd>
            <dt className="text-muted">Teléfono</dt>
            <dd>{o.phone || "—"}</dd>
            <dt className="text-muted">Dirección</dt>
            <dd>{o.address}</dd>
            <dt className="text-muted">Repartidor</dt>
            <dd>{o.courier || "—"}</dd>
            <dt className="text-muted">Estado</dt>
            <dd>{STATUS_LABEL[o.status]}</dd>
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
              {o.items.map((it) => (
                <tr key={it.id} className="border-b border-paper/20">
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
              <span className="tabular-nums">{fmtEur(o.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Envío</span>
              <span className="tabular-nums">{fmtEur(o.shippingCost)}</span>
            </div>
            <div className="flex justify-between border-t border-paper/40 pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums text-ember">{fmtEur(o.total)}</span>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Button onClick={() => window.print()}>
              <Printer className="size-4" />
              Imprimir / PDF
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ ajustes */

/**
 * Control del admin sobre las entradas públicas: abrir/cerrar el registro de
 * cliente, el de repartidor y el buzón de soporte. Se guarda en la sección
 * «portales» de `br_content` (reutiliza el CMS; sin migración). Aquí también
 * viven el aviso deslizante de la cabecera y el cierre por mantenimiento.
 */
function Ajustes() {
  const br = useBr();
  const portales = mergeSection(SITE_DEFAULTS.portales, br.content.portales as PortalesSection);
  const toggle = (key: keyof PortalesSection, value: boolean) =>
    act(
      br.saveSection({ section: "portales", payload: { ...portales, [key]: value } }),
      "Ajuste guardado",
    );
  const rows: { key: keyof PortalesSection; label: string; hint: string }[] = [
    {
      key: "registroCliente",
      label: "Registro de clientes",
      hint: "Alta de cuentas nuevas desde «Crear cuenta».",
    },
    {
      key: "registroRepartidor",
      label: "Registro de repartidores",
      hint: "Solicitudes de plaza nuevas.",
    },
    { key: "soporte", label: "Buzón de soporte", hint: "Formulario público de la página Soporte." },
    {
      key: "confirmarCorreo",
      label: "Exigir confirmar el correo al registrarse",
      hint: "Encendido: el cliente no entra hasta pulsar el enlace del correo de confirmación (el envío ya funciona por Brevo). Apagado: la cuenta vale desde el primer segundo.",
    },
  ];

  // Aviso y mantenimiento: borrador local + Guardar explícito (mismo patrón que
  // el Editor de contenido, pero con campos a medida). Si no se pulsa Guardar,
  // nada cambia en la web.
  const aviso = mergeSection(SITE_DEFAULTS.aviso, br.content.aviso as AvisoSection);
  const maint = mergeSection(
    SITE_DEFAULTS.mantenimiento,
    br.content.mantenimiento as MantenimientoSection,
  );
  const [avisoDraft, setAvisoDraft] = useState(aviso);
  const [maintDraft, setMaintDraft] = useState(maint);
  const avisoSig = JSON.stringify(aviso);
  const maintSig = JSON.stringify(maint);
  useEffect(() => setAvisoDraft(JSON.parse(avisoSig) as AvisoSection), [avisoSig]);
  useEffect(() => setMaintDraft(JSON.parse(maintSig) as MantenimientoSection), [maintSig]);
  const avisoDirty = JSON.stringify(avisoDraft) !== avisoSig;
  const maintDirty = JSON.stringify(maintDraft) !== maintSig;

  // Fase 11: días de reparto (sección `reparto` del CMS). Los días NO marcados
  // siguen admitiendo pedidos: el servidor los convierte en RESERVA para el
  // siguiente día de reparto. Sin marcar ninguno = reparto todos los días.
  const reparto = mergeSection(SITE_DEFAULTS.reparto, br.content.reparto as RepartoSection);
  const [repartoDraft, setRepartoDraft] = useState(reparto);
  const repartoSig = JSON.stringify(reparto);
  useEffect(() => setRepartoDraft(JSON.parse(repartoSig) as RepartoSection), [repartoSig]);
  const repartoDirty = JSON.stringify(repartoDraft) !== repartoSig;
  const toggleDia = (idx: number) =>
    setRepartoDraft((d) => ({
      dias: d.dias.includes(idx) ? d.dias.filter((x) => x !== idx) : [...d.dias, idx].sort(),
    }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-ember" />
          <p className="text-sm text-muted">
            Abre o cierra las entradas públicas. Los accesos ya creados (login) siguen funcionando.
          </p>
        </div>
        {rows.map((r) => (
          <label
            key={r.key}
            className="flex items-center justify-between gap-4 rounded-2xl bg-surface p-4 shadow-card"
          >
            <span>
              <span className="block font-medium">{r.label}</span>
              <span className="block text-xs text-muted">{r.hint}</span>
            </span>
            <input
              type="checkbox"
              checked={portales[r.key]}
              onChange={(e) => toggle(r.key, e.target.checked)}
              className="size-5 accent-[#c2410c]"
            />
          </label>
        ))}
      </div>

      {/* Fase 11: días en los que sale el repartidor; el resto = reservas. */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="size-4 text-ember" />
          <span className="font-medium">Días de reparto</span>
          <span className="ml-auto text-xs text-muted">
            Ahora:{" "}
            {reparto.dias.length
              ? WEEKDAY_UI.filter((w) => reparto.dias.includes(w.idx))
                  .map((w) => w.short)
                  .join(" · ")
              : "todos los días"}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Marca los días en que sale el repartidor. Los demás la tienda sigue abierta: los pedidos
          de lunes a jueves (p. ej.) llegan como{" "}
          <strong>reserva para el siguiente día de reparto</strong>, con la fecha escrita en el
          pedido. Sin marcar ninguno se reparte todos los días como siempre.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAY_UI.map((w) => {
            const on = repartoDraft.dias.includes(w.idx);
            return (
              <button
                key={w.idx}
                type="button"
                onClick={() => toggleDia(w.idx)}
                className={cn(
                  "h-10 rounded-full px-4 text-sm font-medium transition-colors",
                  on ? "bg-ink text-paper" : "bg-paper text-muted hover:text-ink",
                )}
                aria-pressed={on}
              >
                {w.short}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={repartoSig === JSON.stringify({ dias: [] })}
            onClick={() =>
              act(
                br.saveSection({ section: "reparto", payload: { dias: [] } }),
                "Reparto apagado: se reparte todos los días",
              )
            }
          >
            Repartir todos los días
          </Button>
          <Button
            size="sm"
            disabled={!repartoDirty}
            onClick={() =>
              act(br.saveSection({ section: "reparto", payload: repartoDraft }), "Días guardados")
            }
          >
            <Save size={16} /> Guardar
          </Button>
        </div>
      </div>

      {/* Aviso deslizante: se ve en la barra superior de toda la tienda. */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Megaphone className="size-4 text-ember" />
          <span className="font-medium">Aviso deslizante en la cabecera</span>
          <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
            Mostrar
            <input
              type="checkbox"
              checked={avisoDraft.activo}
              onChange={(e) => setAvisoDraft({ ...avisoDraft, activo: e.target.checked })}
              className="size-5 accent-[#c2410c]"
            />
          </label>
        </div>
        <input
          value={avisoDraft.texto}
          maxLength={220}
          onChange={(e) => setAvisoDraft({ ...avisoDraft, texto: e.target.value })}
          placeholder="Ej.: Mantenimiento programado el 24 a las 00:00 · Volvemos en unos minutos"
          className="mt-3 h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs text-muted">
            El texto desliza de derecha a izquierda por la barra superior, en bucle. Sin texto o
            apagado, la web se ve exactamente como siempre.
          </p>
          <Button
            size="sm"
            disabled={!avisoDirty}
            onClick={() =>
              act(br.saveSection({ section: "aviso", payload: avisoDraft }), "Aviso guardado")
            }
          >
            <Save size={16} /> Guardar
          </Button>
        </div>
      </div>

      {/* Mantenimiento: cierre real (el servidor rechaza pedidos) + pantalla. */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Wrench className="size-4 text-ember" />
          <span className="font-medium">Mantenimiento (cierre de la tienda)</span>
          <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
            Cerrar
            <input
              type="checkbox"
              checked={maintDraft.activo}
              onChange={(e) => setMaintDraft({ ...maintDraft, activo: e.target.checked })}
              className="size-5 accent-[#c2410c]"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          Con el cierre activo, clientes y visitantes ven una pantalla de mantenimiento y el
          servidor rechaza pedidos nuevos. Tu cuenta de admin y los repartidores siguen operando con
          normalidad (y el login sigue accesible para poder reabrir).
        </p>
        <div className="mt-3 space-y-3">
          <input
            value={maintDraft.titulo}
            maxLength={80}
            onChange={(e) => setMaintDraft({ ...maintDraft, titulo: e.target.value })}
            placeholder="Título de la pantalla (ej.: Cerrados por mantenimiento)"
            className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card"
          />
          <textarea
            rows={3}
            value={maintDraft.mensaje}
            maxLength={400}
            onChange={(e) => setMaintDraft({ ...maintDraft, mensaje: e.target.value })}
            placeholder="Explicación para los clientes"
            className="w-full rounded-xl bg-paper p-3 text-sm shadow-card"
          />
          <input
            value={maintDraft.vuelta}
            maxLength={80}
            onChange={(e) => setMaintDraft({ ...maintDraft, vuelta: e.target.value })}
            placeholder="Nota opcional de reapertura (ej.: Volvemos el 24 a las 00:30)"
            className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs text-muted">
            Vacío = no se muestra. Puedes dejar el cierre activado y retocar los textos: la pantalla
            cambia al instante para los clientes.
          </p>
          <Button
            size="sm"
            disabled={!maintDirty}
            onClick={() =>
              act(
                br.saveSection({ section: "mantenimiento", payload: maintDraft }),
                "Mantenimiento guardado",
              )
            }
          >
            <Save size={16} /> Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------------------------------- Editor de contenido (CMS) */

const EDIT_SECTIONS: { key: SiteSectionKey; label: string }[] = [
  { key: "meta", label: "Metadatos · título y descripción (SEO)" },
  { key: "brand", label: "Marca · textos del catálogo" },
  { key: "hero", label: "Portada · slides del hero" },
  { key: "home.order", label: "Inicio · orden de las secciones (arrastrar)" },
  { key: "nav", label: "Navegación · enlaces" },
  { key: "home.pasillos", label: "Inicio · Pasillos" },
  { key: "home.nevera", label: "Inicio · Nevera" },
  { key: "home.casa", label: "Inicio · La casa" },
  { key: "home.como", label: "Inicio · Cómo va" },
  { key: "home.testimonios", label: "Inicio · Testimonios" },
  { key: "home.cobertura", label: "Inicio · Cobertura (barrios)" },
  { key: "home.buzon", label: "Inicio · Buzón" },
  { key: "categories", label: "Pasillos · categorías (nombre, kicker, foto)" },
  { key: "footer", label: "Pie de página" },
  { key: "agegate", label: "Verificación +18" },
  { key: "checkout", label: "Cesta y checkout" },
  { key: "legal.privacidad", label: "Privacidad" },
  { key: "legal.terminos", label: "Términos" },
  { key: "contacto", label: "Contacto · email y teléfono" },
  { key: "aviso", label: "Cabecera · aviso deslizante (mensaje y activar)" },
  { key: "mantenimiento", label: "Mantenimiento · cierre de la tienda" },
  { key: "reparto", label: "Reparto · días de la semana (el resto son reservas)" },
];

/** Etiquetas legibles para las claves internas de cada campo. */
const FIELD_LABEL: Record<string, string> = {
  title: "Título",
  kicker: "Antetítulo",
  body: "Texto",
  lead: "Entradilla",
  label: "Etiqueta",
  name: "Nombre",
  description: "Descripción",
  caption: "Pie de foto",
  src: "Imagen",
  linkLabel: "Enlace",
  ctaLabel: "Botón",
  placeholder: "Texto de ayuda",
  who: "Autor",
  q: "Testimonio",
  heroImg: "Imagen",
  heroQuote: "Cita destacada",
  heroWho: "Autor destacado",
  imgBg: "Imagen de fondo",
  img1: "Imagen 1",
  img2: "Imagen 2",
  img: "Imagen",
  t: "Título",
  d: "Descripción",
  iconKey: "Icono (clock/snow/pin)",
  cities: "Ciudades",
  tagline: "Lema",
  coverageLabel: "Texto de cobertura",
  storeTitle: "Columna Tienda",
  legalTitle: "Columna Legal",
  legalNote: "Nota legal",
  copyright: "Copyright",
  items: "Elementos",
  paragraphs: "Párrafos",
  slides: "Slides",
  steps: "Pasos",
  ok: "Botón aceptar",
  no: "Botón rechazar",
  notePrefix: "Nota (prefijo)",
  termsLink: "Palabra términos",
  privacyLink: "Palabra privacidad",
  cartTitle: "Título cesta",
  empty: "Cesta vacía",
  submit: "Botón finalizar",
  to: "Ruta del enlace",
  image: "Imagen",
  topBadge: "Insignia superior",
  topDelivery: "Entrega (barra superior)",
  topShippingLabel: "Envío gratis (texto)",
  catalogKicker: "Kicker del catálogo",
  catalogFallbackTitle: "Título del catálogo",
  catalogLead: "Entradilla del catálogo",
  pasillosLabel: "Enlace “Pasillos”",
  supportEmail: "Email de soporte",
  privacyEmail: "Email de privacidad (RGPD)",
  phone: "Teléfono",
  hours: "Horario de atención",
  activo: "Activado",
  texto: "Mensaje deslizante",
  titulo: "Título",
  mensaje: "Mensaje",
  vuelta: "Nota de reapertura",
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isImageKey(k?: string) {
  return Boolean(k && /image|img|src|bg/i.test(k));
}

function labelOf(o: Record<string, any>): string {
  return String(o.title || o.label || o.name || o.q || o.kicker || o.t || "");
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function Editor() {
  const br = useBr();
  const [key, setKey] = useState<SiteSectionKey>("meta");
  const merged = mergeSection(
    SITE_DEFAULTS[key] as Record<string, any>,
    br.content[key] as Record<string, any>,
  );
  const sig = JSON.stringify(merged);
  const [draft, setDraft] = useState<any>(merged);
  useEffect(() => setDraft(merged), [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== sig;
  const overridden = Boolean(br.content[key]);

  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Editor de textos e imágenes</h2>
        <p className="mt-1 text-sm text-muted">
          Cambia cualquier texto o imagen y pulsa Guardar. Los valores que ves son los de hoy: si no
          tocas nada, la web se ve idéntica. “Restaurar original” devuelve la sección a su texto
          base. En cualquier lista (slides, pasos, testimonios…) arrastra el asa{" "}
          <GripVertical className="inline size-3.5 align-text-bottom" /> para cambiar el orden.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={key}
            onChange={(e) => setKey(e.target.value as SiteSectionKey)}
            className="h-11 min-w-64 flex-1 rounded-2xl bg-paper px-3 text-sm shadow-card"
          >
            {EDIT_SECTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              overridden ? "bg-bottle/10 text-bottle" : "bg-paper text-muted"
            }`}
          >
            {overridden ? "Personalizado" : "Sin cambios"}
          </span>
        </div>
      </div>

      <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
        {key === "home.order" ? (
          <SectionOrderEditor
            items={Array.isArray(draft?.sections) ? (draft.sections as string[]) : []}
            onChange={(secs) => setDraft({ ...draft, sections: secs })}
          />
        ) : (
          <RenderNode value={draft} onChange={setDraft} />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!dirty}
          onClick={() => act(br.saveSection({ section: key, payload: draft }), "Guardado")}
        >
          <Save size={16} /> Guardar
        </Button>
        <Button
          variant="ghost"
          disabled={!overridden}
          onClick={() =>
            act(
              br.resetSection(key).then(() => setDraft(SITE_DEFAULTS[key])),
              "Sección restaurada",
            )
          }
        >
          <RotateCcw size={16} /> Restaurar original
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(merged)}>
          Descartar cambios
        </Button>
      </div>
    </div>
  );
}

/** Renderiza recursivamente cualquier valor (objeto, lista, string, número, booleano). */
function RenderNode({
  name,
  value,
  onChange,
}: {
  name?: string;
  value: any;
  onChange: (v: any) => void;
}) {
  if (Array.isArray(value)) {
    const objLike = value.length > 0 && typeof value[0] === "object" && value[0] !== null;
    return objLike ? (
      <ObjList name={name} items={value as Record<string, any>[]} onChange={onChange} />
    ) : (
      <StrList items={value.map((x) => String(x))} onChange={onChange} />
    );
  }
  if (value && typeof value === "object") {
    return (
      <div className="space-y-3">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
              {FIELD_LABEL[k] ?? k}
            </p>
            <RenderNode name={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 accent-[#c2410c]"
        />
        {value ? "Sí" : "No"}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card"
      />
    );
  }
  if (isImageKey(name)) {
    return <FieldImage value={String(value ?? "")} onChange={onChange} />;
  }
  const s = String(value ?? "");
  const long =
    s.length > 60 ||
    name === "body" ||
    name === "description" ||
    name === "lead" ||
    name === "tagline";
  return long ? (
    <textarea
      rows={3}
      value={s}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl bg-paper p-3 text-sm shadow-card"
    />
  ) : (
    <input
      value={s}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card"
    />
  );
}

function StrList({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  // Arrastre EN VIVO con el cursor (Pointer Events, vale también táctil): las
  // filas saltan mientras pasas el puntero por encima. ↑↓ siguen ahí como vía
  // alternativa y accesible.
  const { dragI, start, setRowRef } = usePointerSort(items, onChange);
  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div
          key={i}
          ref={setRowRef(i)}
          className={`flex items-center gap-1${dragI === i ? " opacity-60" : ""}`}
        >
          <span
            onPointerDown={(e) => start(i, e)}
            style={{ touchAction: "none" }}
            className="grid w-6 shrink-0 cursor-grab place-items-center text-muted hover:text-ember active:cursor-grabbing"
            title="Arrastra para reordenar"
            aria-label={`Arrastrar elemento ${i + 1}`}
          >
            <GripVertical size={14} />
          </span>
          <input
            value={s}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm shadow-card"
          />
          <button
            type="button"
            aria-label="Subir"
            className="text-muted hover:text-ember disabled:opacity-30"
            disabled={i === 0}
            onClick={() => onChange(swap(items, i, i - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Bajar"
            className="text-muted hover:text-ember disabled:opacity-30"
            disabled={i === items.length - 1}
            onClick={() => onChange(swap(items, i, i + 1))}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Quitar"
            className="text-muted hover:text-ember"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-ember"
        onClick={() => onChange([...items, ""])}
      >
        <Plus size={14} /> Añadir
      </button>
    </div>
  );
}

function ObjList({
  name,
  items,
  onChange,
}: {
  name?: string;
  items: Record<string, any>[];
  onChange: (v: Record<string, any>[]) => void;
}) {
  const template = items.length ? items[items.length - 1] : {};
  // Arrastre EN VIVO igual que StrList: agarras el asa ⋮⋮ y las tarjetas van
  // saltando bajo el cursor mientras arrastras.
  const { dragI, start, setRowRef } = usePointerSort(items, onChange);
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div
          key={i}
          ref={setRowRef(i)}
          className={`rounded-xl border border-line bg-paper p-3${dragI === i ? " opacity-60 ring-2 ring-[#c2410c]" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex min-w-0 items-center gap-1">
              <span
                onPointerDown={(e) => start(i, e)}
                style={{ touchAction: "none" }}
                className="grid w-5 shrink-0 cursor-grab place-items-center text-muted hover:text-ember active:cursor-grabbing"
                title="Arrastra para reordenar"
                aria-label={`Arrastrar elemento ${i + 1}`}
              >
                <GripVertical size={14} />
              </span>
              <span className="truncate text-xs font-semibold text-muted">
                {labelOf(it) || `${name ?? "Elemento"} ${i + 1}`}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <button
                type="button"
                aria-label="Subir"
                className="text-muted hover:text-ember disabled:opacity-30"
                disabled={i === 0}
                onClick={() => onChange(swap(items, i, i - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Bajar"
                className="text-muted hover:text-ember disabled:opacity-30"
                disabled={i === items.length - 1}
                onClick={() => onChange(swap(items, i, i + 1))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="Quitar"
                className="text-muted hover:text-ember"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <RenderNode
            value={it}
            onChange={(nv) => onChange(items.map((x, j) => (j === i ? nv : x)))}
          />
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-ember"
        onClick={() => onChange([...items, clone(template)])}
      >
        <Plus size={14} /> Añadir
      </button>
    </div>
  );
}

/** Nombres legibles para las ids internas de `HOME_SECTION_IDS` (orden de portada). */
const HOME_SECTION_LABELS: Record<string, string> = {
  pasillos: "Pasillos (mosaico de categorías)",
  nevera: "Nevera (productos destacados)",
  casa: "La casa (historia y fotos)",
  como: "Cómo va (los 3 pasos)",
  testimonios: "Testimonios",
  cobertura: "Cobertura (barrios de reparto)",
  buzon: "Buzón (boletín de ofertas)",
};

/**
 * Editor del orden de las secciones de la portada: arrastrar el asa (o ↑↓).
 * Guarda la lista en la sección `home.order`; la portada filtra ids válidas y
 * rellena huecos, así que ninguna combinación puede dejar secciones sin pintar.
 */
function SectionOrderEditor({
  items,
  onChange,
}: {
  items: string[];
  onChange: (v: string[]) => void;
}) {
  // Arrastre EN VIVO con el cursor: las filas saltan mientras se arrastra.
  const { dragI, start, setRowRef } = usePointerSort(items, onChange);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Arrastra el asa <GripVertical className="inline size-3.5 align-text-bottom" /> (o usa ↑↓)
        para colocar las secciones de la portada en el orden que quieras. «Restaurar original»
        devuelve el orden de siempre.
      </p>
      {items.map((s, i) => (
        <div
          key={`${s}-${i}`}
          ref={setRowRef(i)}
          className={`flex items-center gap-2 rounded-xl border border-line bg-paper px-2 py-2${dragI === i ? " opacity-60 ring-2 ring-[#c2410c]" : ""}`}
        >
          <span
            onPointerDown={(e) => start(i, e)}
            style={{ touchAction: "none" }}
            className="grid w-6 shrink-0 cursor-grab place-items-center text-muted hover:text-ember active:cursor-grabbing"
            title="Arrastra para reordenar"
            aria-label={`Arrastrar sección ${i + 1}`}
          >
            <GripVertical size={16} />
          </span>
          <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm font-medium">{HOME_SECTION_LABELS[s] ?? s}</span>
          <button
            type="button"
            aria-label="Subir"
            className="text-muted hover:text-ember disabled:opacity-30"
            disabled={i === 0}
            onClick={() => onChange(swap(items, i, i - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Bajar"
            className="text-muted hover:text-ember disabled:opacity-30"
            disabled={i === items.length - 1}
            onClick={() => onChange(swap(items, i, i + 1))}
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}

function FieldImage({
  value,
  onChange,
  maxDim = 1280,
  cropAspect,
}: {
  value: string;
  onChange: (v: string) => void;
  maxDim?: number;
  cropAspect?: number;
}) {
  const [busy, setBusy] = useState(false);
  async function pick(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const o = await fileToOptimizedImage(file, { maxDim, quality: 0.82, cropAspect });
      onChange(o.dataUrl);
      toast.success(`Imagen ${o.width}×${o.height} · ${humanBytes(o.bytes)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface shadow-card">
        {busy ? (
          <Loader2 className="animate-spin text-muted" size={18} />
        ) : (
          <img src={value} alt="" className="size-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/brand/slides/… o https://… (o sube una imagen)"
          className="h-9 w-full rounded-lg bg-surface px-2 text-xs shadow-card"
        />
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-ember">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Upload size={14} /> Subir imagen
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------ Overrides de producto fijo */

function CatalogoEditor() {
  const br = useBr();
  const [selId, setSelId] = useState<string>(CATALOG[0]?.id ?? "");
  const baseProd = useMemo(() => CATALOG.find((p) => p.id === selId), [selId]);
  const current = baseProd ? (br.products.find((p) => p.id === selId) ?? baseProd) : undefined;
  const sig = JSON.stringify(current);
  const [draft, setDraft] = useState<Product | null>(current ? clone(current) : null);
  useEffect(() => setDraft(current ? clone(current) : null), [selId, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!CATALOG.length)
    return (
      <p className="text-sm text-muted">
        El catálogo de muestra se retiró: ya no hay productos base que editar. Gestiona tus
        productos en la pestaña «Productos» (alta y borrado).
      </p>
    );
  if (!baseProd || !draft) return <p className="text-sm text-muted">Cargando catálogo…</p>;
  const base = baseProd;
  const form = draft;

  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const hasOverride = JSON.stringify(current) !== JSON.stringify(base);

  function set<K extends keyof Product>(k: K, v: Product[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  function buildPatch(): Partial<Product> {
    const patch: Partial<Product> = {};
    (["name", "brand", "unit", "desc", "long", "image"] as const).forEach((k) => {
      if (form[k] !== base[k]) (patch as Record<string, unknown>)[k] = form[k];
    });
    if (form.cat !== base.cat) patch.cat = form.cat;
    if (form.price !== base.price) patch.price = form.price;
    if ((form.grad || "") !== (base.grad || "")) patch.grad = form.grad;
    if (!!form.oferta !== !!base.oferta) patch.oferta = !!form.oferta;
    if (!!form.alcohol !== !!base.alcohol) patch.alcohol = !!form.alcohol;
    return patch;
  }

  function save() {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return toast.error("No has cambiado nada.");
    act(br.saveProductPatch({ id: selId, patch }), "Producto actualizado");
  }
  function reset() {
    act(
      br.resetProductPatch(selId).then(() => setDraft(clone(base))),
      "Producto restaurado",
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Productos del catálogo</h2>
          <p className="mt-1 text-sm text-muted">
            Elige un producto y edita su texto o su foto. El ID no cambia (los pedidos lo usan).
          </p>
          <select
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            className="mt-3 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
          >
            {CATALOG.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lg:col-span-3">
        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Editar: {baseProd.name}</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${hasOverride ? "bg-bottle/10 text-bottle" : "bg-paper text-muted"}`}
            >
              {hasOverride ? "Personalizado" : "Original"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <FieldImage
              value={draft.image}
              onChange={(v) => set("image", v)}
              maxDim={800}
              cropAspect={4 / 5}
            />
            <Input label="Nombre" value={draft.name} onChange={(v) => set("name", v)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Marca" value={draft.brand} onChange={(v) => set("brand", v)} />
              <Input label="Unidad" value={draft.unit} onChange={(v) => set("unit", v)} />
              <Input
                label="Precio (€)"
                type="number"
                step="0.01"
                value={String(draft.price)}
                onChange={(v) => set("price", Number(v) || 0)}
              />
              <Input label="Graduación" value={draft.grad || ""} onChange={(v) => set("grad", v)} />
            </div>
            <label className="block">
              <span className="text-xs font-medium text-muted">Categoría</span>
              <select
                value={draft.cat}
                onChange={(e) => set("cat", e.target.value as CategoryId)}
                className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
              >
                {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">Resumen</span>
              <textarea
                rows={2}
                value={draft.desc}
                onChange={(e) => set("desc", e.target.value)}
                className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">Descripción larga</span>
              <textarea
                rows={3}
                value={draft.long}
                onChange={(e) => set("long", e.target.value)}
                className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
              />
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!draft.oferta}
                  onChange={(e) => set("oferta", e.target.checked)}
                  className="size-4 accent-[#c2410c]"
                />
                Es oferta
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!draft.alcohol}
                  onChange={(e) => set("alcohol", e.target.checked)}
                  className="size-4 accent-[#c2410c]"
                />
                Producto con alcohol (+18)
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={!dirty} onClick={save}>
              <Save size={16} /> Guardar producto
            </Button>
            <Button variant="ghost" disabled={!hasOverride} onClick={reset}>
              <RotateCcw size={16} /> Restaurar original
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- auditoría de accesos */

/**
 * Pestaña «Sesiones»: lista de todos los accesos registrados (filas de
 * `br_sessions`) con su fecha, usuario, rol y si siguen vivos. Ordenable por
 * cualquier columna (clic en la cabecera alterna asc/desc) y filtrable por
 * texto (nombre o email). Datos 100% server-side autorizados (solo admin) y
 * sin exponer nunca el token real. Sondeo largo (60 s): no es una vista en
 * tiempo real, basta con ver las últimas entradas al refrescar.
 */
type SortKey = "createdAt" | "name" | "role" | "active";

function Sesiones() {
  const br = useBr();
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");
  // Fase 12: paginación para que la tabla no baje «hasta el infinito» cuando se
  // acumulan los accesos. La búsqueda por nombre/email ya existía (mini barra).
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [q, sortKey, asc]);

  const data = br.sessions;
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? data.filter(
          (s) => s.name.toLowerCase().includes(term) || s.email.toLowerCase().includes(term),
        )
      : data.slice();
    const mul = asc ? 1 : -1;
    base.sort((a, b) => {
      if (sortKey === "createdAt") return (a.createdAt - b.createdAt) * mul;
      if (sortKey === "active") return (Number(a.active) - Number(b.active)) * mul;
      const av = String(a[sortKey] ?? "").toLowerCase();
      const bv = String(b[sortKey] ?? "").toLowerCase();
      return av.localeCompare(bv) * mul;
    });
    return base;
  }, [data, q, sortKey, asc]);

  const live = data.filter((s) => s.active).length;

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  const header = (k: SortKey, label: string, cls = "") => (
    <th className={`px-4 py-3 font-medium ${cls}`}>
      <button
        type="button"
        onClick={() => {
          if (sortKey === k) setAsc((v) => !v);
          else {
            setSortKey(k);
            setAsc(false);
          }
        }}
        className="inline-flex items-center gap-1 hover:text-paper"
      >
        {label}
        {sortKey === k ? (
          asc ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : null}
      </button>
    </th>
  );

  if (br.sessionsLoading && data.length === 0) {
    return <div className="h-40 animate-pulse rounded-[1.25rem] bg-surface" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-mist">
          {data.length} acceso(s) registrados · {live} con sesión viva
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por nombre o email…"
          className="h-9 w-full max-w-xs rounded-full bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>
      <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink text-surface">
            <tr>
              {header("createdAt", "Inicio de sesión")}
              {header("name", "Usuario")}
              {header("role", "Rol")}
              <th className="px-4 py-3 font-medium">Caduca</th>
              {header("active", "Estado")}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">
                  {data.length === 0
                    ? "Todavía no hay accesos registrados."
                    : "Ningún acceso coincide con el filtro."}
                </td>
              </tr>
            ) : (
              pageRows.map((s) => <SessionRow key={s.key + s.createdAt} s={s} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted">
            Mostrando {from}–{to} de {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="size-4" /> Anterior
            </Button>
            <span className="text-xs tabular-nums text-mist">
              Página {safePage + 1} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Siguiente <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionRow({ s }: { s: LoginSession }) {
  return (
    <tr className="border-t border-line">
      <td className="px-4 py-3 tabular-nums">{fmtDate(s.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{s.name}</div>
        <div className="text-xs text-muted">{s.email}</div>
      </td>
      <td className="px-4 py-3 text-xs">
        <Pill tone={s.role === "admin" ? "warn" : s.role === "repartidor" ? "info" : "neutral"}>
          {s.role}
        </Pill>
      </td>
      <td className="px-4 py-3 text-xs tabular-nums text-muted">{fmtDate(s.expiresAt)}</td>
      <td className="px-4 py-3">
        <Pill tone={s.active ? "go" : "neutral"}>{s.active ? "viva" : "caducada"}</Pill>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------- cuentas y recuperación */

/** Contraseña legible generada por el admin (sin caracteres ambiguos 0/O/1/l/I). */
function genPassword(): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += alpha[buf[i] % alpha.length];
  return out;
}

/**
 * Pestaña «Cuentas»: bandeja de recuperación de contraseña SIN depender de
 * correo externo. Quien pulsa «¿Has olvidado tu contraseña?» deja una solicitud
 * aquí; el operador valida la identidad por su canal (teléfono, mostrador) y
 * fija una clave nueva con el botón azul de candado. Esto es lo que impide que
 * alguien restablezca el correo de otro: decide una persona, no el navegador.
 * Incluye además un cambio de contraseña directo para cualquier cuenta.
 */
function Cuentas() {
  const br = useBr();
  const reqs = br.resetRequests;
  const sorted = useMemo(() => [...reqs].sort((a, b) => b.requestedAt - a.requestedAt), [reqs]);
  const pending = sorted.filter((r) => r.active);
  const expired = sorted.filter((r) => !r.active);

  if (br.resetRequestsLoading && reqs.length === 0) {
    return <div className="h-40 animate-pulse rounded-[1.25rem] bg-surface" />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[1.25rem] bg-surface p-4 text-sm text-muted shadow-card">
        <p className="font-medium text-ink">Recuperación sin correo externo</p>
        <p className="mt-1">
          Cuando alguien pulsa «¿Has olvidado tu contraseña?», su petición aparece aquí con el email
          de la cuenta. Valida su identidad por tu canal habitual y asígnale una clave nueva con el
          botón azul. El usuario recibirá la clave de tu parte y deberá cambiarla desde su cuenta.
        </p>
        <p className="mt-2 rounded-xl bg-paper/70 p-2 text-xs">
          <span className="font-semibold text-ink">
            Por seguridad, las contraseñas nunca se muestran.
          </span>{" "}
          Se guardan cifradas (hash irreversible), así que no es posible —ni legal— ver la original
          ni la de su correo. Lo que sí puedes hacer es restablecerla: se genera una nueva, se
          cierran sus sesiones y se la comunicas tú.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
          Solicitudes pendientes ({pending.length})
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-mist">No hay solicitudes de recuperación ahora mismo.</p>
        ) : (
          pending.map((r) => <ResetRow key={r.email} r={r} />)
        )}
      </div>

      {expired.length ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Caducadas ({expired.length})
          </p>
          {expired.map((r) => (
            <ResetRow key={r.email} r={r} />
          ))}
        </div>
      ) : null}

      <AccountsDesk />

      <SmtpTestDesk />

      <EmailVerifyDesk />

      <ManualPassword />
    </div>
  );
}

/**
 * Lista paginada de TODAS las cuentas (Fase 12): el admin la pedía «sin que se
 * acumulen hasta el infinito» y con una mini barra para filtrar por nombre o
 * gmail. Reutiliza `br.users` (ya en memoria del panel), así que no dispara
 * ninguna consulta nueva: filtro y corte por página se hacen en cliente.
 */
function AccountsDesk() {
  const br = useBr();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"todos" | Role>("todos");
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [q, role]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return br.users
      .filter((u) => (role === "todos" ? true : u.role === role))
      .filter((u) =>
        term ? u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) : true,
      )
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [br.users, q, role]);

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ember">
        Todas las cuentas ({filtered.length})
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o gmail…"
          className="h-9 w-full max-w-xs rounded-full bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted"
        />
        <div className="flex gap-1.5">
          {(["todos", "user", "repartidor", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                role === r ? "bg-ink text-surface" : "bg-surface text-ink hover:bg-ink/10",
              )}
            >
              {r === "todos" ? "Todos" : r === "user" ? "Clientes" : r}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-ink text-surface">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Alta</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                  {br.users.length === 0
                    ? "Todavía no hay cuentas registradas."
                    : "Ninguna cuenta coincide con la búsqueda."}
                </td>
              </tr>
            ) : (
              pageRows.map((u) => (
                <tr key={u.email} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-xs text-muted">{u.email}</td>
                  <td className="px-4 py-3 text-xs">
                    <Pill
                      tone={
                        u.role === "admin" ? "warn" : u.role === "repartidor" ? "info" : "neutral"
                      }
                    >
                      {u.role === "user" ? "cliente" : u.role}
                    </Pill>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={statusTone(u.status)}>{u.status}</Pill>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-muted">
                    {fmtDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "admin" ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <DeleteAccountButton email={u.email} name={u.name} />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted">
            Mostrando {from}–{to} de {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="size-4" /> Anterior
            </Button>
            <span className="text-xs tabular-nums text-mist">
              Página {safePage + 1} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Siguiente <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bandeja de correos pendientes de confirmar (migración 0030): aparece solo si
 * queda alguien sin verificar. «Confirmar a mano» valida al cliente que te
 * enseñe su acceso por otro canal; «Reenviar correo» le manda el enlace otra vez.
 */
function EmailVerifyDesk() {
  const br = useBr();
  const pending = br.users.filter((u) => u.emailVerified === false);
  if (pending.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
        Correos pendientes de confirmar ({pending.length})
      </p>
      <ul className="space-y-2">
        {pending.map((u) => (
          <li
            key={u.email}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[1.25rem] bg-surface p-4 shadow-card"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{u.name}</span>
              <span className="block truncate text-xs text-muted">{u.email}</span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="bottle"
                onClick={() => act(br.adminVerifyEmail(u.email), "Correo marcado como confirmado")}
              >
                Confirmar a mano
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act(br.adminResendVerification(u.email), "Correo de verificación reenviado")
                }
              >
                Reenviar correo
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Diagnóstico de correo (Fase 13): «no llegan los correos» suele ser SMTP mal
 * configurado (falta la contraseña de aplicación de Gmail, puerto 465 vs 587) o
 * el puerto de salida bloqueado por el hosting. Este panel manda un correo de
 * prueba REAL y muestra el error en claro, en vez de dejar el flujo best-effort
 * silencioso. Destino por defecto: el email del propio admin.
 */
function SmtpTestDesk() {
  const br = useBr();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    setBusy(true);
    setRes(null);
    try {
      const r = await br.testSmtp(to.trim() || undefined);
      setRes(r);
    } catch (cause) {
      setRes({
        ok: false,
        msg: (cause as Error)?.message || "No se pudo contactar con el servidor.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
        Probar el correo (SMTP)
      </p>
      <div className="rounded-[1.25rem] bg-surface p-4 shadow-card">
        <p className="text-sm text-muted">
          Envía un correo de prueba para comprobar si la configuración de Gmail funciona. Si falla,
          verás el error exacto (contraseña, puerto o bloqueo del hosting).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">
              Destino (vacío = tu email de admin)
            </span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="tucorreo@gmail.com"
              className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          <Button type="button" variant="bottle" onClick={run} disabled={busy}>
            {busy ? "Enviando…" : "Enviar prueba"}
          </Button>
        </div>
        {res ? (
          <p
            className={cn(
              "mt-3 rounded-xl px-3 py-2 text-sm",
              res.ok ? "bg-bottle/10 text-bottle" : "bg-ember/10 text-ember",
            )}
          >
            {res.msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Fila de una solicitud con su formulario de nueva contraseña (colapsable). */
function ResetRow({ r }: { r: PasswordResetRequest }) {
  const br = useBr();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState("");

  async function apply() {
    if (pass.length < 8) {
      toast.error("Mínimo 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const res = await br.adminSetPassword({ email: r.email, pass });
      if (!res.ok) {
        toast.error(res.msg || "No se pudo actualizar.");
        return;
      }
      toast.success(res.msg || "Contraseña actualizada.");
      setIssued(pass);
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[1.25rem] bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted">{r.email}</p>
          <p className="mt-0.5 text-xs text-muted">
            Pedido {fmtDate(r.requestedAt)} ·{" "}
            <Pill tone={r.active ? "go" : "neutral"}>{r.active ? "vigente" : "caducada"}</Pill>
          </p>
        </div>
        {/* Azul fuerte + candado: acción destacada de restablecer. */}
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setIssued("");
          }}
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          <Lock className="size-4" />
          {open ? "Cerrar" : "Restablecer contraseña"}
        </button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">Nueva contraseña</span>
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="mín. 8 caracteres"
              className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          <Button type="button" variant="ghost" onClick={() => setPass(genPassword())}>
            <RotateCcw className="size-4" /> Generar
          </Button>
          <Button type="button" variant="bottle" onClick={apply} disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      ) : null}
      {open && issued ? <HandoffNote name={r.name} email={r.email} pass={issued} /> : null}
    </div>
  );
}

/** Cambio de contraseña directo para cualquier cuenta (por email). */
function ManualPassword() {
  const br = useBr();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; pass: string } | null>(null);

  async function apply() {
    if (!email.trim()) {
      toast.error("Escribe el email de la cuenta.");
      return;
    }
    if (pass.length < 8) {
      toast.error("Mínimo 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const res = await br.adminSetPassword({ email: email.trim(), pass });
      if (!res.ok) {
        toast.error(res.msg || "No se pudo actualizar.");
        return;
      }
      toast.success(res.msg || "Contraseña actualizada.");
      setIssued({ email: email.trim().toLowerCase(), pass });
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
        Cambiar la contraseña a cualquier cuenta
      </p>
      <div className="rounded-[1.25rem] bg-surface p-4 shadow-card">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@correo.com"
              className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Nueva contraseña</span>
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="mín. 8 caracteres"
              className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setPass(genPassword())}>
            <RotateCcw className="size-4" /> Generar
          </Button>
          <button
            type="button"
            onClick={apply}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            <Lock className="size-4" />
            {busy ? "Guardando…" : "Restablecer"}
          </button>
        </div>
      </div>
      {issued ? <HandoffNote name={issued.email} email={issued.email} pass={issued.pass} /> : null}
    </div>
  );
}

/**
 * Aviso listo para entregar al cliente la clave temporal sin SMTP ni servicios
 * externos: se copia al portapapeles (para WhatsApp/SMS) o se abre en el propio
 * gestor de correo del operador con `mailto:`. La contraseña solo viaja por un
 * canal privado que el comercio ya tenga con el cliente.
 */
function HandoffNote({ name, email, pass }: { name: string; email: string; pass: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const msg =
    `Hola ${name},\n\nHemos restablecido tu acceso a Botella Rápida. ` +
    `Tu contraseña temporal es:\n\n${pass}\n\n` +
    `Entra en ${origin}/acceso y cámbiala desde “Tu cuenta” por una solo tuya. ` +
    `Por tu seguridad, guarda este aviso en privado.\n\n— Equipo Botella Rápida`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg);
      toast.success("Aviso copiado. Pégalo por WhatsApp, SMS o tu email.");
    } catch {
      toast.error("Tu navegador no permite copiar; selecciona el texto y cópialo.");
    }
  }

  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    "Recuperación de acceso · Botella Rápida",
  )}&body=${encodeURIComponent(msg)}`;

  return (
    <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm font-semibold text-blue-900">Comunica la clave al cliente</p>
      <p className="mt-1 text-xs text-blue-800">
        Entrega esta contraseña temporal por un canal privado que ya tengas con él (WhatsApp, SMS o
        tu propio Gmail). No la publiques ni la envíes por canales abiertos.
      </p>
      <textarea
        readOnly
        value={msg}
        rows={6}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 w-full rounded-xl border border-blue-200 bg-white p-2 font-mono text-xs text-ink outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="bottle" onClick={copy}>
          Copiar aviso
        </Button>
        <a
          href={mailto}
          className="inline-flex items-center gap-2 rounded-full border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <Mail className="size-4" /> Abrir en mi email
        </a>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- seguridad */

/**
 * Pestaña «Seguridad» (Fase 2, solo admin): verificación en dos pasos (TOTP)
 * para la propia cuenta y registro de acciones sensibles. Es UNA TARJETA MÁS
 * del panel: mismos `rounded-2xl bg-surface p-4 shadow-card`, mismos inputs y
 * mismos botones — el resto de la página no cambia ni un píxel.
 */
function Seguridad() {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["br", "2fa-status"],
    queryFn: () => twoFactorStatusFn({ data: { sid: currentSid() } }),
    staleTime: 30_000,
  });
  const auditQ = useQuery({
    queryKey: ["br", "audit"],
    queryFn: () => listAuditFn({ data: { sid: currentSid() } }),
    staleTime: 15_000,
  });

  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Código maestro de emergencia (compartido con el equipo): el en claro solo
  // se ve aquí, la única vez que se genera; luego queda oculto (en BD vive
  // solo su hash).
  const [master, setMaster] = useState<string | null>(null);
  const [masterBusy, setMasterBusy] = useState(false);
  const masterQ = useQuery({
    queryKey: ["br", "master-code"],
    queryFn: () => masterCodeStatusFn({ data: { sid: currentSid() } }),
    staleTime: 30_000,
  });

  const enabled = statusQ.data?.enabled === true;

  async function begin() {
    setBusy(true);
    try {
      const s = await beginTwoFactorFn({ data: { sid: currentSid() } });
      setSetup(s);
      setCode("");
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo generar el código QR.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!setup) return;
    setBusy(true);
    try {
      const res = await confirmTwoFactorFn({
        data: { sid: currentSid(), secret: setup.secret, code: code.trim() },
      });
      if (!res.ok) {
        toast.error(res.msg || "Código incorrecto.");
        return;
      }
      toast.success(res.msg || "2FA activado.");
      setSetup(null);
      setCode("");
      setRecovery(res.recovery ?? []);
      void qc.invalidateQueries({ queryKey: ["br", "2fa-status"] });
      void qc.invalidateQueries({ queryKey: ["br", "audit"] });
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo confirmar.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const res = await disableTwoFactorFn({ data: { sid: currentSid(), code: code.trim() } });
      if (!res.ok) {
        toast.error(res.msg || "Código incorrecto.");
        return;
      }
      toast.success(res.msg || "2FA desactivado.");
      setCode("");
      setRecovery(null);
      void qc.invalidateQueries({ queryKey: ["br", "2fa-status"] });
      void qc.invalidateQueries({ queryKey: ["br", "audit"] });
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo desactivar.");
    } finally {
      setBusy(false);
    }
  }

  async function rotateMaster() {
    setMasterBusy(true);
    try {
      const res = await rotateMasterCodeFn({ data: { sid: currentSid() } });
      setMaster(res.code);
      toast.success(res.msg || "Código maestro generado.");
      void qc.invalidateQueries({ queryKey: ["br", "master-code"] });
      void qc.invalidateQueries({ queryKey: ["br", "audit"] });
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo generar el código.");
    } finally {
      setMasterBusy(false);
    }
  }

  async function revokeMaster() {
    setMasterBusy(true);
    try {
      const res = await revokeMasterCodeFn({ data: { sid: currentSid() } });
      setMaster(null);
      toast.success(res.msg || "Código maestro eliminado.");
      void qc.invalidateQueries({ queryKey: ["br", "master-code"] });
      void qc.invalidateQueries({ queryKey: ["br", "audit"] });
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo quitar el código.");
    } finally {
      setMasterBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1) Verificación en dos pasos */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 text-bottle" />
              Verificación en dos pasos
            </p>
            <p className="mt-1 text-xs text-muted">
              Además de la contraseña, tu panel pedirá un código de 6 dígitos que genera tu móvil
              (Google Authenticator, Aegis, Authy, 1Password…). Sin ese código, nadie entra en la
              administración aunque acierte la contraseña.
            </p>
          </div>
          <Pill tone={enabled ? "go" : "neutral"}>{enabled ? "Activada" : "Desactivada"}</Pill>
        </div>

        {!enabled && !setup ? (
          <div className="mt-3">
            <Button type="button" variant="bottle" onClick={begin} disabled={busy}>
              <ShieldCheck className="size-4" /> {busy ? "Preparando…" : "Activar 2FA"}
            </Button>
          </div>
        ) : null}

        {setup ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm">
              1. Escanea este QR con tu app autenticadora (o introduce el secreto a mano):
            </p>
            <div className="flex flex-wrap items-start gap-4">
              <img
                src={setup.qrDataUrl}
                alt="Código QR para tu app autenticadora"
                className="size-44 rounded-xl bg-paper p-2 shadow-card"
              />
              <p className="max-w-60 break-all font-mono text-xs text-muted">{setup.secret}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[10rem] flex-1">
                <span className="mb-1 block text-xs font-medium text-muted">
                  2. Código de 6 dígitos que muestra la app
                </span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
                />
              </label>
              <Button
                type="button"
                variant="bottle"
                onClick={confirm}
                disabled={busy || code.trim().length < 6}
              >
                {busy ? "Confirmando…" : "Confirmar"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSetup(null);
                  setCode("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}

        {enabled && !setup ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <p className="w-full text-xs text-muted">
              Estás protegido: al entrar te pedirá el código de tu app.
              {statusQ.data && statusQ.data.recoveryLeft > 0
                ? ` Te quedan ${statusQ.data.recoveryLeft} código(s) de respaldo.`
                : " No te quedan códigos de respaldo."}
            </p>
            <label className="block min-w-[10rem] flex-1">
              <span className="mb-1 block text-xs font-medium text-muted">
                Código actual para desactivar
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="123456"
                className="h-10 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
              />
            </label>
            <Button
              type="button"
              variant="line"
              onClick={disable}
              disabled={busy || code.trim().length < 6}
            >
              Desactivar 2FA
            </Button>
          </div>
        ) : null}
      </div>

      {/* 1b) Código maestro de acceso: emergencia compartida del equipo */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium">
              <KeyRound className="size-4 text-bottle" />
              Código maestro de acceso
            </p>
            <p className="mt-1 text-xs text-muted">
              Emergencia compartida para el equipo (3-5 personas de confianza): si la app
              autenticadora falla o se pierde el móvil, se escribe este código en el paso del código
              al entrar en el panel, en lugar del de 6 dígitos. La contraseña de admin sigue siendo
              obligatoria. Rótalo cuando quieras: el anterior deja de valer al instante.
            </p>
          </div>
          <Pill tone={masterQ.data?.configured ? "go" : "neutral"}>
            {masterQ.data?.configured ? "Activo" : "Sin configurar"}
          </Pill>
        </div>

        {master ? (
          <div className="mt-3 rounded-xl bg-paper p-3">
            <p className="text-xs font-medium text-muted">
              Nuevo código — se muestra <span className="font-semibold">una sola vez</span>,
              guárdalo ya:
            </p>
            <p className="mt-1 select-all text-center font-mono text-lg tracking-wider">{master}</p>
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="line"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(master)
                    .then(() => toast.success("Copiado al portapapeles."))
                    .catch(() => toast.error("Selecciona el código y cópialo a mano."));
                }}
              >
                Copiar
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="bottle" onClick={rotateMaster} disabled={masterBusy}>
            <KeyRound className="size-4" />
            {masterBusy
              ? "Generando…"
              : masterQ.data?.configured
                ? "Rotar código"
                : "Generar código"}
          </Button>
          {masterQ.data?.configured ? (
            <Button type="button" variant="line" onClick={revokeMaster} disabled={masterBusy}>
              Quitar código
            </Button>
          ) : null}
          {masterQ.data?.configured && masterQ.data.updatedAt ? (
            <p className="text-xs text-muted">Último giro: {fmtDate(masterQ.data.updatedAt)}</p>
          ) : null}
        </div>
      </div>

      {/* 1c) Bloqueo por IP (con 2FA) + detector de accesos sospechosos */}
      <AccessIpsDesk />

      {/* 2) Códigos de respaldo (solo acaban de generarse: una única vez) */}
      {recovery ? (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="font-medium">Códigos de respaldo</p>
          <p className="mt-1 text-xs text-muted">
            Guárdalos ahora en un lugar seguro (gestor de contraseñas, papel en el mostrador): se
            muestran <span className="font-semibold">una sola vez</span> y cada uno sirve para un
            acceso sin el móvil.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {recovery.map((c) => (
              <span key={c} className="rounded-xl bg-paper px-3 py-2 text-center font-mono text-sm">
                {c}
              </span>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="bottle" onClick={() => setRecovery(null)}>
              Ya los he guardado
            </Button>
          </div>
        </div>
      ) : null}

      {/* 3) Registro de acciones sensibles */}
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <ScrollText className="size-4 text-bottle" />
            Registro de seguridad
          </p>
          <Button size="sm" variant="ghost" onClick={() => void auditQ.refetch()}>
            Actualizar
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Accesos de admin y acciones sensibles (borrados, cambios de estado, contraseñas…): quién,
          qué y cuándo. Las últimas 300.
        </p>
        {auditQ.isLoading ? (
          <div className="mt-3 h-40 animate-pulse rounded-[1.25rem] bg-paper/60" />
        ) : (auditQ.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-mist">De momento no hay nada registrado.</p>
        ) : (
          <div className="mt-3 max-h-96 divide-y divide-line/40 overflow-auto">
            {(auditQ.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-xs"
              >
                <span className="tabular-nums text-muted">{fmtDate(a.createdAt)}</span>
                <span className="font-semibold">{a.action}</span>
                {a.target ? (
                  <span className="break-all font-mono text-muted">{a.target}</span>
                ) : null}
                <span className="ml-auto text-muted">{a.actor}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Oculta los tramos centrales de una IP (v4 o v6) para no exponerla en claro. */
function maskIp(ip: string): string {
  const s = (ip || "").trim();
  if (!s) return s;
  const v4 = s.split(".");
  if (v4.length === 4) return `${v4[0]}.***.***.***`;
  if (s.includes(":")) {
    const head = s.split(":")[0] || s.slice(0, 2);
    return `${head}:***`;
  }
  return `${s.slice(0, 2)}***`;
}

/**
 * Panel «Accesos por IP» (migración 0033, solo admin): lista las IPs desde las
 * que se ha intentado entrar en las últimas 24 h (con dispositivo y nº de
 * intentos) para detectar un ataque de «muchas IPs», y permite BLOQUEARLAS de
 * forma total. Banear y desbanear exigen el código de 2FA (decisión del titular:
 * «para no liarla»). La IP va oculta por defecto; «Revelar» la muestra en claro.
 *
 * Fail-open: si la migración 0033 aún no está aplicada, las listas vienen vacías
 * y el panel no molesta; no toca ni el login ni los pedidos.
 */
function AccessIpsDesk() {
  const br = useBr();
  const [reveal, setReveal] = useState(false);
  // IP sobre la que se va a operar y modo (banear/desbanear). El 2FA se pide aquí.
  const [form, setForm] = useState<{ ip: string; mode: "ban" | "unban" } | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const suspicious = br.suspiciousIps;
  const banned = br.ipBans;
  const show = (ip: string) => (reveal ? ip : maskIp(ip));

  function openForm(ip: string, mode: "ban" | "unban") {
    setForm({ ip, mode });
    setCode("");
    setNote("");
  }

  async function submit() {
    if (!form || code.trim().length < 6) return;
    setBusy(true);
    try {
      if (form.mode === "ban") {
        await br.banIp({ ip: form.ip, code: code.trim(), note: note.trim() || undefined });
        toast.success(`IP bloqueada: ${form.ip}`);
      } else {
        await br.unbanIp({ ip: form.ip, code: code.trim() });
        toast.success(`IP desbloqueada: ${form.ip}`);
      }
      setForm(null);
      setCode("");
      setNote("");
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo completar (¿2FA correcto?).");
    } finally {
      setBusy(false);
    }
  }

  const loading = br.suspiciousIpsLoading && suspicious.length === 0;

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-bottle" />
          Accesos por IP y bloqueo
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setReveal((v) => !v)}
          aria-pressed={reveal}
        >
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {reveal ? "Ocultar IPs" : "Revelar IPs"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        IPs desde las que se ha intentado entrar en las últimas 24 h. Banear una IP es un bloqueo
        TOTAL: desde ella no se puede entrar, ni registrarse, ni pedir. Para banear o desbanear hay
        que confirmar con tu código de 2FA.
      </p>

      {loading ? (
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-paper/60" />
      ) : (
        <>
          {/* IPs sospechosas */}
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ember">
              Intentos de acceso ({suspicious.length})
            </p>
            {suspicious.length === 0 ? (
              <p className="mt-1 text-sm text-mist">
                Sin intentos registrados todavía (o la base aún no guarda la IP: aplica la migración
                0033).
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">IP</th>
                      <th className="px-2 py-1.5 font-medium">Cuenta</th>
                      <th className="px-2 py-1.5 font-medium">Dispositivo</th>
                      <th className="px-2 py-1.5 font-medium">Intentos</th>
                      <th className="px-2 py-1.5 font-medium">Último</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {suspicious.slice(0, 40).map((row) => (
                      <tr key={`${row.ip}-${row.email}`} className="border-t border-line">
                        <td className="px-2 py-1.5 font-mono text-xs">{show(row.ip)}</td>
                        <td className="px-2 py-1.5 text-xs">{row.email}</td>
                        <td className="px-2 py-1.5 text-xs text-muted">{row.device}</td>
                        <td className="px-2 py-1.5 tabular-nums text-xs">{row.attempts}</td>
                        <td className="px-2 py-1.5 text-xs tabular-nums text-muted">
                          {fmtDate(row.lastSeen)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {row.banned ? (
                            <Pill tone="neutral">bloqueada</Pill>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-ember"
                              onClick={() => openForm(row.ip, "ban")}
                            >
                              <AlertTriangle className="size-4" /> Banear
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* IPs ya bloqueadas */}
          {banned.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">
                IPs bloqueadas ({banned.length})
              </p>
              <ul className="mt-2 space-y-1">
                {banned.map((b) => (
                  <li
                    key={b.ip}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="font-mono">{show(b.ip)}</span>
                      {b.note ? <span className="ml-2 text-muted">{b.note}</span> : null}
                      <span className="ml-2 text-muted">
                        {b.actor} · {fmtDate(b.createdAt)}
                      </span>
                    </span>
                    <Button size="sm" variant="line" onClick={() => openForm(b.ip, "unban")}>
                      Desbanear
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Formulario de confirmación con 2FA */}
          {form ? (
            <div className="mt-4 space-y-2 rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-sm">
                {form.mode === "ban" ? "Bloquear" : "Desbloquear"} la IP{" "}
                <span className="font-mono font-semibold">{form.ip}</span> — escribe tu código de
                2FA (6 dígitos) para confirmar.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[9rem] flex-1">
                  <span className="mb-1 block text-xs font-medium text-muted">Código 2FA</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="h-10 w-full rounded-2xl bg-surface px-3 text-sm outline-none shadow-card"
                  />
                </label>
                {form.mode === "ban" ? (
                  <label className="block min-w-[10rem] flex-1">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Motivo (opcional)
                    </span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={512}
                      placeholder="Ataque, bot, spam…"
                      className="h-10 w-full rounded-2xl bg-surface px-3 text-sm outline-none shadow-card"
                    />
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant={form.mode === "ban" ? "line" : "bottle"}
                  className={form.mode === "ban" ? "text-ember" : ""}
                  onClick={submit}
                  disabled={busy || code.trim().length < 6}
                >
                  {busy ? "Confirmando…" : form.mode === "ban" ? "Confirmar bloqueo" : "Confirmar"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setForm(null);
                    setCode("");
                    setNote("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Botón de borrado definitivo de una cuenta (clientes y repartidores; jamás un
 * admin). Al pulsar no borra: abre un panel inline que exige el código de admin
 * (2FA, código de respaldo o código maestro), igual que el bloqueo por IP. El
 * servidor reitera la comprobación y rechaza si el objetivo es un admin.
 */
function DeleteAccountButton({ email, name }: { email: string; name: string }) {
  const br = useBr();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setCode("");
  }

  async function submit() {
    if (code.trim().length < 6) return;
    setBusy(true);
    try {
      await br.deleteUser({ email, code: code.trim() });
      toast.success(`Cuenta eliminada: ${name}`);
      close();
    } catch (cause) {
      toast.error((cause as Error)?.message || "No se pudo eliminar (¿código correcto?).");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="text-ember" onClick={() => setOpen(true)}>
        <Trash2 size={14} /> Eliminar
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-line bg-paper/60 p-3">
      <p className="text-sm">
        Eliminar a <span className="font-semibold">{name}</span> es definitivo. Escribe tu código de
        admin (2FA o maestro) para confirmar.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-muted">Código de admin</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            placeholder="2FA o código maestro"
            className="h-10 w-full rounded-2xl bg-surface px-3 text-sm outline-none shadow-card"
          />
        </label>
        <Button
          type="button"
          variant="line"
          className="text-ember"
          onClick={submit}
          disabled={busy || code.trim().length < 6}
        >
          {busy ? "Eliminando…" : "Confirmar borrado"}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
