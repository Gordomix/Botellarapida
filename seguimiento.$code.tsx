import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CircleDot, Clock, MapPin, Navigation, PhoneCall, XCircle } from "lucide-react";
import type { OrderStatus } from "@/data/types";
import { useBr, useOrderTracking } from "@/lib/use-br";
import { fmtDate } from "@/lib/utils";

// El mapa (Leaflet) se monta SOLO vía lazy: necesita `window` y no debe entrar
// en el bundle crítico ni ejecutarse en servidor (mismo patrón que tiendas
// cercanas).
const TrackingMapView = lazy(() =>
  import("@/components/map/tracking-map").then((m) => ({ default: m.TrackingMapView })),
);

export const Route = createFileRoute("/seguimiento/$code")({ component: Page });

/** Hitos que pintan la barra de progreso (cancelado se muestra aparte). */
const STEPS: { key: OrderStatus; title: string; note: string }[] = [
  { key: "pendiente", title: "Pedido recibido", note: "Lo estamos preparando" },
  { key: "asignado", title: "Repartidor asignado", note: "Sale a la calle en breve" },
  { key: "en_reparto", title: "En reparto", note: "Ya va hacia ti — síguelo en el mapa" },
  { key: "entregado", title: "Entregado", note: "¡Que lo disfrutes!" },
];

/** Distancia en línea recta (km) entre dos coordenadas (haversine). */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * ETA orientativa en minutos: línea recta repartidor → entrega a ~18 km/h
 * (ritmo urbano medio en patinete/bici). NO es routing: es una ayuda honesta
 * "a ojo", por eso se muestra con "~" y "aprox.". Solo con fix fresco.
 */
function etaMin(courier: [number, number], dest: [number, number]): number {
  return Math.max(1, Math.round((haversineKm(courier, dest) / 18) * 60));
}

function Page() {
  const { code } = Route.useParams();
  return (
    <main className="min-h-dvh bg-paper px-4 py-10 text-ink sm:px-6">
      <TrackingInner code={code} />
    </main>
  );
}

function TrackingInner({ code }: { code: string }) {
  const br = useBr();
  const tracking = useOrderTracking(code);
  // El cliente puede elegir compartir SU ubicación real (GPS del navegador) con
  // el repartidor asignado y el admin: seguimiento BIDIRECCIONAL. Es opt-in: se
  // envía solo si él pulsa el interruptor, y solo mientras el pedido está en
  // juego (el servidor lo rechaza fuera de reparto). Su elección se recuerda.
  const SHARE_KEY = `br.share-customer:${code}`;
  const [you, setYou] = useState<[number, number] | null>(null);
  const [share, setShare] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  const watchId = useRef<number | null>(null);
  const lastPing = useRef(0);

  // Carga la preferencia guardada (persiste entre visitas al mismo pedido).
  useEffect(() => {
    try {
      setShare(localStorage.getItem(SHARE_KEY) === "1");
    } catch {
      /* localStorage bloqueado: arranca sin compartir */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con «compartir» activo y el pedido en juego, escucha el GPS y hace ping
  // (throttle 10 s) al servidor. Al desactivar o entregarse, corta la escucha.
  useEffect(() => {
    const st = tracking.data?.status;
    const live = st === "asignado" || st === "en_reparto";
    if (!share || !live) {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      setYou(null);
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoMsg("Tu navegador no ofrece geolocalización.");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, accuracy } = p.coords;
        setYou([latitude, longitude]);
        setGeoMsg("");
        const now = Date.now();
        if (now - lastPing.current > 10_000) {
          lastPing.current = now;
          void br
            .pingCustomerLocation({
              orderRef: code,
              lat: latitude,
              lng: longitude,
              accuracyM: Math.round(accuracy),
            })
            .catch(() => setGeoMsg("No se pudo enviar tu ubicación. Revisa tu conexión."));
        }
      },
      () => setGeoMsg("Sin permiso de ubicación no puedo compartirla con tu repartidor."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
    // br.pingCustomerLocation es stable; `code` no cambia en la vida del pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, tracking.data?.status, code]);

  function toggleShare() {
    const next = !share;
    setShare(next);
    try {
      localStorage.setItem(SHARE_KEY, next ? "1" : "0");
    } catch {
      /* persistir es best-effort */
    }
    if (!next) setGeoMsg("");
  }

  if (!br.sessionReady) return <p className="text-sm text-mist">Cargando…</p>;
  if (!br.session) {
    return (
      <div className="mx-auto max-w-md rounded-[1.5rem] bg-surface p-6 text-center shadow-card">
        <h1 className="font-display text-2xl font-semibold">Entra para seguir tu pedido</h1>
        <p className="mt-2 text-sm text-muted">
          El seguimiento es privado: solo lo ve el dueño del pedido.
        </p>
        <Link
          to="/login/cliente"
          className="mt-4 inline-flex rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-paper"
        >
          Entrar
        </Link>
      </div>
    );
  }
  if (tracking.isError) {
    return (
      <div className="mx-auto max-w-md rounded-[1.5rem] bg-surface p-6 text-center shadow-card">
        <XCircle className="mx-auto size-8 text-ember" />
        <h1 className="mt-2 font-display text-xl font-semibold">No se pudo seguir ese pedido</h1>
        <p className="mt-1 text-sm text-muted">{(tracking.error as Error)?.message || "Error"}</p>
        <Link to="/cuenta" className="mt-4 inline-block text-sm font-semibold text-bottle underline">
          Volver a tus pedidos
        </Link>
      </div>
    );
  }
  if (tracking.isLoading || !tracking.data) {
    return <p className="text-sm text-mist">Buscando tu pedido {code}…</p>;
  }
  const t = tracking.data;
  const idx = STEPS.findIndex((s) => s.key === t.status);
  const cancelled = t.status === "cancelado";
  const live = t.status === "asignado" || t.status === "en_reparto";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Seguimiento</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Pedido <span className="tabular-nums">{t.code}</span>
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <MapPin className="size-4" /> {t.address}
          {t.postalCode ? ` · ${t.postalCode}` : ""}
        </p>
        <p className="text-xs text-muted">Se actualiza solo cada 10 s mientras esté en camino.</p>
      </div>

      {/* Barra de hitos: verde hasta el estado actual; cancelado = rojo aparte. */}
      {cancelled ? (
        <p className="rounded-2xl bg-ember/15 px-4 py-3 text-sm font-semibold text-ember">
          Este pedido se canceló. Si ya habías pagado, no se te cobra nada.
        </p>
      ) : (
        <ol className="space-y-0">
          {STEPS.map((s, i) => {
            const reached = i <= idx;
            const current = i === idx;
            return (
              <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className={`absolute left-[11px] top-6 h-full w-0.5 ${reached && i < idx ? "bg-bottle" : "bg-line"}`}
                  />
                ) : null}
                <span
                  className={`z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                    reached ? "bg-bottle text-paper" : "bg-paper text-muted"
                  }`}
                >
                  {reached ? <CircleDot className="size-3.5" /> : <Clock className="size-3.5" />}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${current ? "text-ink" : "text-muted"}`}>
                    {s.title}
                    {current && t.history.length ? (
                      <span className="ml-2 font-normal text-muted">
                        · {fmtDate(t.history[t.history.length - 1].at)}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">{s.note}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {live && (
        <section className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">En el mapa</h2>
            <button
              type="button"
              onClick={toggleShare}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-card transition-colors ${
                share
                  ? "bg-[#1f6feb] text-paper hover:bg-[#1a5fd0]"
                  : "bg-paper text-ink hover:bg-ink hover:text-paper"
              }`}
            >
              <Navigation className="size-3.5" />
              {share ? "Dejar de compartir" : "Compartir mi ubicación"}
            </button>
          </div>
          {t.courier && t.courierOnline ? (
            <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-bottle/12 px-3 py-2 text-sm font-semibold text-bottle">
              <Clock className="size-4" />
              Llega en ~{etaMin([t.courier.lat, t.courier.lng], t.destination)} min
              <span className="font-normal text-muted">(aprox., en línea recta)</span>
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {t.courier
              ? t.courierOnline
                ? `${t.courierName || "Tu repartidor"} va en camino — su posición es de hace unos segundos.`
                : `${t.courierName || "Tu repartidor"}: te mostramos su última posición conocida (punto gris); puede que esté pausando el GPS un momento.`
              : `${t.courierName || "El repartidor"} aún no ha empezado a compartir su GPS (sale en breve).`}{" "}
            {t.destinationExact
              ? "La entrega está marcada en tu dirección exacta."
              : "La entrega está situada aproximadamente por código postal."}{" "}
            {share ? (
              <>
                Estás compartiendo tu punto azul con <strong>tu repartidor y Botella Rápida</strong>{" "}
                para guiar la entrega; deja de enviarse al acabar el reparto o al pulsar «Dejar de
                compartir».
              </>
            ) : (
              <>
                No compartes tu ubicación: nada sale de tu pantalla. Pulsa «Compartir mi ubicación»
                si quieres que tu repartidor sepa dónde estás y llegue antes.
              </>
            )}
          </p>
          {geoMsg ? <p className="mt-2 text-xs text-ember">{geoMsg}</p> : null}
          <div className="mt-3">
            <Suspense fallback={<div className="h-[300px] animate-pulse rounded-2xl bg-paper" />}>
              <TrackingMapView tracking={t} you={you} />
            </Suspense>
          </div>
        </section>
      )}

      {t.history.length > 1 && (
        <details className="rounded-2xl bg-surface p-4 text-sm shadow-card">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Historial del pedido
          </summary>
          <ol className="mt-3 space-y-1.5 border-l border-line pl-4">
            {t.history.map((h, i) => (
              <li key={i}>
                <span className="text-muted">{fmtDate(h.at)}</span> · {h.what}{" "}
                <span className="text-muted">({h.by})</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          to="/cuenta"
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 font-semibold text-ink shadow-card hover:bg-ink hover:text-paper"
        >
          Tus pedidos
        </Link>
        <a
          href="/soporte"
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 font-semibold text-ink shadow-card hover:bg-ink hover:text-paper"
        >
          <PhoneCall className="size-4" /> ¿Problemas con la entrega?
        </a>
      </div>
    </div>
  );
}
