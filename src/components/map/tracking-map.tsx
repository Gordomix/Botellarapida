"use client";

// Mapas del seguimiento en vivo (Paso 4). Como el de tiendas cercanas, este
// módulo se carga SOLO con React.lazy: Leaflet necesita `window` y jamás debe
// ejecutarse en el render de servidor. Los patrones (divIcon de colores y
// ResizeFix con invalidateSize) están probados en móvil en nearby-stores.tsx:
// sin el invalidateSize el bottom-sheet sale el mapa en gris.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { X } from "lucide-react";
import type { LiveCourier, TrackingInfo } from "@/data/types";
import { townForCp } from "@/data/service-area";

const EMBER = "#e0533b";
const BOTTLE = "#2f9e6b";

function dotIcon(color: string, size = 22) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const COURIER_ICON = L.divIcon({
  className: "",
  html: `<span style="display:block;width:22px;height:22px;border-radius:50%;background:${BOTTLE};border:3px solid #fff;box-shadow:0 0 0 5px rgba(47,158,107,.25)"></span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Gris: el punto existe, pero el GPS del repartidor lleva ratos sin enviar
// (pausa, pantalla bloqueada o sin señal). Mejor esto que dejar al cliente sin
// mapa: ve dónde se quedó el último fix.
const STALE_COURIER_ICON = L.divIcon({
  className: "",
  html: `<span style="display:block;width:22px;height:22px;border-radius:50%;background:#8a8f98;border:3px solid #fff;box-shadow:0 0 0 5px rgba(138,143,152,.25)"></span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Misma ventana de frescura que el servidor (10 min = «en directo»). */
const isFresh = (at: number) => Date.now() - at < 10 * 60_000;

const YOU_ICON = L.divIcon({
  className: "",
  html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:#1f6feb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(31,111,235,.25)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Azul, algo mayor y con anillo: en el mapa del admin distingue al CLIENTE que
// compartió su ubicación (bidireccional) del repartidor (verde/gris).
const CUSTOMER_ICON = L.divIcon({
  className: "",
  html: `<span style="display:block;width:20px;height:20px;border-radius:50%;background:#1f6feb;border:3px solid #fff;box-shadow:0 0 0 5px rgba(31,111,235,.28)"></span>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/**
 * Leaflet mide el contenedor una sola vez al montarse; en el bottom-sheet
 * móvil nace con tamaño 0 y sale gris. `invalidateSize()` a los 150/700 ms y
 * en cada resize lo redrawa (idéntico al mapa de tiendas cercanas).
 */
function ResizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t1 = window.setTimeout(fix, 150);
    const t2 = window.setTimeout(fix, 700);
    window.addEventListener("resize", fix);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", fix);
    };
  }, [map]);
  return null;
}

/**
 * Encuadre inicial: ajusta a los puntos la primera vez que hay al menos dos.
 * Después NO vuelve a encuadrar aunque el repartidor se mueva (el sondeo de
 * 10 s re-renderiza el marcador, pero el usuario puede mover el mapa libre).
 */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length < 2) return;
    done.current = true;
    map.fitBounds(points, { padding: [36, 36] });
  }, [map, points]);
  return null;
}

/** Minutos desde un epoch ms, en texto corto ("hace 2 min"). */
function ageMin(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return min < 1 ? "ahora mismo" : `hace ${min} min`;
}

/**
 * Reparto EN CURSO cuyo GPS no ha enviado un fix en los últimos 5 min. El admin
 * lo ve como aviso: o el repartidor está pausando, o el móvil perdió señal.
 */
function isStalled(c: LiveCourier): boolean {
  const inFlight = c.status === "asignado" || c.status === "en_reparto";
  return inFlight && Date.now() - c.updatedAt > 5 * 60_000;
}

const TILE = (
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  />
);

/**
 * Mapa de la página de seguimiento: destino (approx. por CP), repartidor (su
 * último fix si es fresco) y, cuando el cliente lo autoriza, SU propia
 * posición real para ver la distancia a la que va el pedido.
 */
export function TrackingMapView({
  tracking,
  you,
}: {
  tracking: TrackingInfo;
  you: [number, number] | null;
}) {
  const points: [number, number][] = [tracking.destination];
  if (tracking.courier) points.push([tracking.courier.lat, tracking.courier.lng]);
  if (you) points.push(you);
  const town = tracking.postalCode ? townForCp(tracking.postalCode) : "";
  return (
    <div className="h-[300px] overflow-hidden rounded-2xl shadow-card sm:h-[380px]">
      <MapContainer
        center={tracking.destination}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix />
        <FitOnce points={points} />
        {TILE}
        <Marker position={tracking.destination} icon={dotIcon(EMBER)}>
          <Popup>
            <strong>Entrega</strong>
            <br />
            {tracking.address}
            {town ? `, ${town}` : ""}
          </Popup>
        </Marker>
        {tracking.courier ? (
          <Marker
            position={[tracking.courier.lat, tracking.courier.lng]}
            icon={tracking.courierOnline ? COURIER_ICON : STALE_COURIER_ICON}
          >
            <Popup>
              <strong>{tracking.courierName || "Repartidor"}</strong>
              <br />
              {tracking.courierOnline
                ? `En directo, ${ageMin(tracking.courier.updatedAt)} (±${tracking.courier.accuracyM} m)`
                : `Última posición ${ageMin(tracking.courier.updatedAt)}: su GPS está en pausa o sin señal`}
            </Popup>
          </Marker>
        ) : null}
        {you ? (
          <Marker position={you} icon={YOU_ICON}>
            <Popup>Tú estás aquí</Popup>
          </Marker>
        ) : null}
      </MapContainer>
    </div>
  );
}

/**
 * Mapa en vivo del panel de admin: todos los repartidores con fix reciente y
 * el pedido que llevan. Diálogo a pantalla completa, mismo estilo bottom-sheet
 * que el resto de la app.
 */
export function CourierLiveMapDialog({ couriers, onClose }: { couriers: LiveCourier[]; onClose: () => void }) {
  const center: [number, number] = couriers.length
    ? [couriers[0].lat, couriers[0].lng]
    : [41.4417, 2.2117]; // Santa Coloma de Gramenet: núcleo del negocio.
  const bounds: [number, number][] = couriers.flatMap((c) =>
    c.customer ? ([[c.lat, c.lng], [c.customer.lat, c.customer.lng]] as [number, number][]) : [[c.lat, c.lng] as [number, number]],
  );
  const stalledCount = couriers.filter(isStalled).length;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Repartidores en vivo</h2>
            <p className="text-sm text-muted">
              Última posición conocida (últimas 6 h) con el pedido asignado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-paper"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 h-[340px] overflow-hidden rounded-2xl shadow-card sm:h-[420px]">
          <MapContainer
            center={center}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: "100%", width: "100%" }}
          >
            <ResizeFix />
            <FitOnce points={bounds} />
            {TILE}
            {couriers.map((c) => (
              <Marker key={c.courier} position={[c.lat, c.lng]} icon={isFresh(c.updatedAt) ? COURIER_ICON : STALE_COURIER_ICON}>
                <Popup>
                  <strong>{c.name}</strong>
                  <br />
                  {c.orderCode ? `Pedido ${c.orderCode}` : "Sin pedido en ese fix"}
                  <br />
                  {isFresh(c.updatedAt) ? "En directo — " : "GPS en pausa — "}
                  {ageMin(c.updatedAt)} (±{c.accuracyM} m)
                </Popup>
              </Marker>
            ))}
            {couriers.map((c) =>
              c.customer ? (
                <Marker key={`cust-${c.courier}`} position={[c.customer.lat, c.customer.lng]} icon={CUSTOMER_ICON}>
                  <Popup>
                    <strong>Cliente</strong>
                    <br />
                    {c.orderCode ? `Pedido ${c.orderCode}` : ""}
                    <br />
                    Compartió su ubicación {isFresh(c.customer.updatedAt) ? "en directo" : "hace un rato"} — {ageMin(c.customer.updatedAt)}
                  </Popup>
                </Marker>
              ) : null,
            )}
          </MapContainer>
        </div>

        {stalledCount > 0 ? (
          <p className="mt-4 rounded-xl bg-ember/15 px-3 py-2 text-sm font-medium text-ember">
            {stalledCount} reparto(s) en curso con el GPS sin actualizar más de 5 min. Comprueba
            que el repartidor sigue en ruta.
          </p>
        ) : null}

        {couriers.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Ningún repartidor ha compartido posición todavía. Solo envían GPS
            mientras tienen un reparto en curso en su portal.
          </p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {couriers.map((c) => (
              <li key={c.courier} className="rounded-xl bg-paper px-3 py-2 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted">
                  {" "}
                  · {c.orderCode ? `pedido ${c.orderCode}` : "sin pedido"} ·{" "}
                  {isFresh(c.updatedAt) ? "en directo" : "GPS en pausa"} ·{" "}
                  {ageMin(c.updatedAt)}
                </span>
                {c.customer ? (
                  <span className="ml-1 font-medium text-[#1f6feb]"> · cliente compartido</span>
                ) : null}
                {isStalled(c) ? (
                  <span className="ml-1 font-semibold text-ember"> · sin señal +5 min</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
