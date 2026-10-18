"use client";

// Mapa real de "tiendas cerca de ti" (Paso 3). OpenStreetMap vía react-leaflet,
// sin API key. Este módulo se carga con React.lazy SOLO al abrir el diálogo, de
// modo que Leaflet (que necesita `window`) jamás se ejecuta en el render de
// servidor.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { X } from "lucide-react";
import {
  coordsForCp,
  nearestStores,
  SERVICE_AREA_CPS,
  type NearbyStore,
  type StoreKind,
  type StoreWithDistance,
} from "@/data/stores";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<StoreKind, string> = {
  supermercado: "#2f9e6b", // bottle
  ultramarinos: "#e0912f", // ámbar
  hub: "#e0533b", // ember
};

function dotIcon(color: string, size = 22) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const YOU_ICON = L.divIcon({
  className: "",
  html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:#1f6feb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(31,111,235,.25)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Leaflet mide el contenedor una sola vez al montarse. En móvil el diálogo es
 * un bottom-sheet que abre con animación: el mapa nace con tamaño 0 o errado y
 * sale en gris. `invalidateSize()` tras los primeros frames y en cada cambio de
 * viewport lo redrawa. Sin esto, el mapa no se ve en móvil.
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

export function NearbyStoresDialog({
  onClose,
  onPickStore,
}: {
  onClose: () => void;
  /**
   * Al elegir una tienda aquí, el checkout la preselecciona como origen del
   * pedido. Optional: sin callback, el diálogo es solo informativo.
   */
  onPickStore?: (store: NearbyStore) => void;
}) {
  const br = useBr();
  // Arranca en Santa Coloma (núcleo del negocio); si no está en la lista,
  // el primer CP disponible.
  const [cp, setCp] = useState(
    () =>
      SERVICE_AREA_CPS.find((c) => c.town === "Santa Coloma de Gramenet")?.cp ??
      SERVICE_AREA_CPS[0]?.cp ??
      "08921",
  );
  const you = useMemo(() => coordsForCp(cp), [cp]);
  const stores = useMemo(() => nearestStores(you), [you]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Tiendas cerca de ti</h2>
            <p className="text-sm text-muted">
              Supermercados y ultramarinos de la zona que abastecen tu pedido.
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

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium">Tu código postal</span>
          <select
            value={cp}
            onChange={(e) => setCp(e.target.value)}
            className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
          >
            {SERVICE_AREA_CPS.map((c) => (
              <option key={c.cp} value={c.cp}>
                {c.cp} · {c.town}
              </option>
            ))}
          </select>
        </label>

        {/* key={cp} fuerza a remotar el mapa y recentrarlo al cambiar de CP */}
        <div className="mt-4 h-[320px] overflow-hidden rounded-2xl shadow-card sm:h-[380px]">
          <MapContainer
            key={cp}
            center={you}
            zoom={13}
            scrollWheelZoom={false}
            style={{ height: "100%", width: "100%" }}
          >
            <ResizeFix />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={you} icon={YOU_ICON}>
              <Popup>Tu zona de entrega</Popup>
            </Marker>
            {stores.map((s) => (
              <Marker key={s.id} position={[s.lat, s.lng]} icon={dotIcon(KIND_COLOR[s.kind])}>
                <Popup>
                  <strong>{s.name}</strong>
                  <br />
                  {s.address}, {s.town}
                  <br />
                  A {s.distanceKm.toFixed(1)} km
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <ul className="mt-4 space-y-2">
          {stores.map((s) => (
            <StoreRow
              key={s.id}
              s={s}
              onPickStore={onPickStore}
              onAsk={(email, producto) =>
                br.sendMessage({
                  email,
                  text: `Consulta de disponibilidad en ${s.name} (${s.cp} · ${s.town}): ¿lo tenéis? — ${producto}`,
                })
              }
            />
          ))}
        </ul>

        <p className="mt-4 text-xs text-muted">
          Mapa de muestra: las posiciones son aproximadas por código postal. El
          seguimiento en vivo del repartidor ya está activo: cuando tu pedido
          salga a la calle, síguelo desde «Tus pedidos → Seguir en directo».
        </p>
      </div>
    </div>
  );
}

function StoreRow({
  s,
  onPickStore,
  onAsk,
}: {
  s: StoreWithDistance;
  onPickStore?: (store: NearbyStore) => void;
  /** Pregunta "¿lo tenéis?" por email (reutiliza el buzón de soporte). */
  onAsk: (email: string, producto: string) => Promise<unknown>;
}) {
  const [askOpen, setAskOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  return (
    <li className="rounded-2xl bg-paper px-3 py-2.5 shadow-card">
      <div className="flex items-center gap-3">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ background: KIND_COLOR[s.kind] }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{s.name}</span>
          <span className="block truncate text-xs text-muted">
            {s.address} · {s.town}
          </span>
        </span>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums text-ember")}>
          {s.distanceKm.toFixed(1)} km
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {onPickStore ? (
          <button
            type="button"
            onClick={() => onPickStore(s)}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:opacity-90"
          >
            Elegir para mi pedido
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setAskOpen((v) => !v)}
          className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-card transition hover:bg-white"
        >
          {askOpen ? "Cerrar consulta" : "¿Lo tenemos?"}
        </button>
      </div>

      {askOpen ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setStatus("sending");
            try {
              await onAsk(String(fd.get("email") || ""), String(fd.get("producto") || ""));
              setStatus("sent");
            } catch {
              setStatus("error");
            }
          }}
          className="mt-2.5 space-y-2 rounded-2xl bg-surface p-3"
        >
          <input
            name="email"
            type="email"
            required
            placeholder="Tu email"
            className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card outline-none"
          />
          <input
            name="producto"
            required
            placeholder="¿Qué buscas? (ej. Estrella Galicia 6-lata)"
            className="h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card outline-none placeholder:text-muted"
          />
          {status === "sent" ? (
            <p className="text-xs text-bottle">Consulta enviada. Te respondemos por email.</p>
          ) : status === "error" ? (
            <p className="text-xs text-ember">No se pudo enviar. Revisa el email.</p>
          ) : null}
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-full bg-ember px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-60"
          >
            {status === "sending" ? "Enviando…" : "Preguntar disponibilidad"}
          </button>
        </form>
      ) : null}
    </li>
  );
}
