import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Coins,
  Dices,
  GripVertical,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderChat } from "@/components/chat/order-chat";
import { RaffleWheel, type RaffleWheelHandle, type WheelSegment } from "@/components/raffle/wheel";
import { primeRaffleAudio } from "@/lib/raffle-fx";
import { useBr } from "@/lib/use-br";
import { productImgProps } from "@/lib/product-img";
import { cn, fmtDate } from "@/lib/utils";
import type { Product, RafflePrizeAdmin } from "@/data/types";

/** Como `act()` del panel: fire-and-forget con toast de error. */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

/** Lo que viaja en dataTransfer: producto del catálogo o segmento existente. */
type DragPayload = { t: "p"; id: string } | { t: "seg"; id: string };

function readDrag(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const v = JSON.parse(raw) as DragPayload;
    return v && (v.t === "p" || v.t === "seg") ? v : null;
  } catch {
    return null;
  }
}

/** Payload completo de upsert a partir de un segmento (local o del servidor). */
function toInput(s: RafflePrizeAdmin) {
  return {
    id: s.id.startsWith("tmp") ? undefined : s.id,
    kind: s.kind,
    wheelLabel: s.wheelLabel || (s.secret ? "PREMIO ???" : "PREMIO"),
    name: s.name,
    description: s.description || null,
    image: s.image || null,
    productId: s.productId || null,
    revealPrice: s.revealPrice,
    // Migración 0030: chapas que regala el segmento (solo usa kind «chapas»).
    chapas: Math.max(0, Math.min(100000, Math.floor(s.chapas || 0))),
    weight: Math.max(0, Math.min(1000000, Math.floor(s.weight))),
    winMessage: s.winMessage || null,
    active: s.active,
    sort: s.sort,
    secret: s.secret,
  };
}

const WHEEL_ORDER_HINT =
  "Paso 2: suelta productos sobre la rueda (cada uno sale en ella CON SU FOTO). " +
  "Paso 3 (abajo): el deslizador sube o baja su probabilidad y el candado lo convierte en secreto («?» para el cliente).";

/** Pestaña «Sorteos» del panel: constructor interactivo de la ruleta. */
export function SorteosAdmin({ focusEntryId }: { focusEntryId?: string } = {}) {
  const br = useBr();
  const data = br.adminRaffle;
  // Fase 12: al reclamar un premio el admin recibe una campanita con deep-link
  // `/admin?chat=<entryId>`; aquí se abre el hilo de chat con ese ganador.
  const [chatEntryId, setChatEntryId] = useState<string | null>(focusEntryId ?? null);
  useEffect(() => {
    if (focusEntryId) setChatEntryId(focusEntryId);
  }, [focusEntryId]);
  const [cfg, setCfg] = useState(() => ({
    enabled: false,
    title: "",
    subtitle: "",
    howItWorks: "",
    winMessage: "",
    loseMessage: "",
    ticketMinEuro: 10,
    unlimitedTest: false,
  }));

  // La config real vive en servidor: al cargar, el formulario la refleja
  // (mismo patrón que la pestaña «Chapas»).
  useEffect(() => {
    if (!data) return;
    setCfg({
      enabled: data.config.enabled,
      title: data.config.title,
      subtitle: data.config.subtitle,
      howItWorks: data.config.howItWorks,
      winMessage: data.config.winMessage,
      loseMessage: data.config.loseMessage,
      ticketMinEuro: data.config.ticketMinEuro,
      unlimitedTest: data.config.unlimitedTest,
    });
  }, [data]);

  // Copia local de los segmentos: el constructor pinta al instante y guarda
  // en el servidor en cada acción (el refresco del query reconcilia al final).
  const [segs, setSegs] = useState<RafflePrizeAdmin[]>([]);
  useEffect(() => {
    if (data) setSegs([...data.prizes].sort((a, b) => a.sort - b.sort));
  }, [data]);

  const wheelRef = useRef<RaffleWheelHandle>(null);
  const [dragOverWheel, setDragOverWheel] = useState(false);
  const [dragSegId, setDragSegId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  if (br.adminRaffleLoading || !data) {
    return (
      <div className="grid place-items-center py-16 text-mist">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const totalWeight = segs.filter((p) => p.active).reduce((s, p) => s + Math.max(0, p.weight), 0);
  const pendingClaims = data.entries.filter(
    (e) => e.outcome === "premio" && e.revealed && !e.claimed,
  );
  const activeSegs = segs.filter((p) => p.active);

  /** Segmentos de la rueda de vista previa (mismos datos que verá el cliente). */
  const preview: WheelSegment[] = activeSegs.map((p) => ({
    id: p.id,
    label: p.secret ? p.wheelLabel : p.name || p.wheelLabel,
    kind: p.kind,
    secret: p.secret,
    image: p.secret ? null : p.image,
  }));

  function commit(s: RafflePrizeAdmin) {
    act(br.upsertRafflePrize(toInput(s)));
  }

  function patch(id: string, p: Partial<RafflePrizeAdmin>, autoCommit = false) {
    setSegs((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
    if (autoCommit) {
      const next = { ...segs.find((s) => s.id === id), ...p } as RafflePrizeAdmin;
      commit(next);
    }
  }

  function addSeg(base: Partial<RafflePrizeAdmin>) {
    const tmp = "tmp" + Math.random().toString(36).slice(2, 10);
    const seg: RafflePrizeAdmin = {
      id: tmp,
      kind: "premio",
      wheelLabel: "PREMIO",
      revealPrice: 0,
      chapas: 0,
      secret: false,
      publicName: "",
      publicImage: null,
      name: "",
      description: null,
      image: null,
      productId: null,
      weight: 10,
      winMessage: null,
      active: true,
      sort: segs.length,
      ...base,
    };
    setSegs((prev) => [...prev, seg]);
    void br
      .upsertRafflePrize(toInput(seg))
      .then((res) => {
        // El servidor da el id real: se sustituye el temporal sin pestañeo.
        setSegs((prev) => prev.map((s) => (s.id === tmp ? { ...s, id: res.id } : s)));
      })
      .catch((err) => {
        setSegs((prev) => prev.filter((s) => s.id !== tmp));
        toast.error((err as Error)?.message || "No se pudo añadir la casilla.");
      });
  }

  function addProduct(p: Product, replaceId?: string) {
    const base = {
      kind: "premio" as const,
      name: p.name,
      wheelLabel: p.name.slice(0, 48),
      image: p.image,
      productId: p.id,
      secret: false,
    };
    if (replaceId) {
      setSegs((prev) => prev.map((s) => (s.id === replaceId ? { ...s, ...base } : s)));
      const target = segs.find((s) => s.id === replaceId);
      if (target) commit({ ...target, ...base });
      toast.success(`Casilla actualizada con «${p.name}»`);
      return;
    }
    addSeg(base);
  }

  /** Rueda de ejemplo: 4 premios con foto + 1 secreto + 3 perdedoras. */
  function addTemplate() {
    if (segs.length > 0) {
      toast.message("La rueda no está vacía: borra las casillas antes de cargar la ejemplo.");
      return;
    }
    const prods = br.products.slice(0, 4);
    prods.forEach((p) =>
      addSeg({
        kind: "premio",
        name: p.name,
        wheelLabel: p.name.slice(0, 48),
        image: p.image,
        productId: p.id,
        weight: 12,
      }),
    );
    if (prods.length === 0) {
      for (let i = 0; i < 4; i += 1)
        addSeg({ wheelLabel: `PREMIO ${i + 1}`, name: `Premio ${i + 1}`, weight: 12 });
    }
    addSeg({ wheelLabel: "PREMIO ???", name: "Premio sorpresa", secret: true, weight: 8 });
    for (let i = 0; i < 3; i += 1)
      addSeg({ kind: "perdedor", wheelLabel: "CASI!", name: "", weight: 20 });
    addSeg({
      kind: "chapas",
      wheelLabel: "CHAPAS",
      name: "Pack de chapas",
      chapas: 20,
      weight: 15,
    });
    toast.success("Rueda de ejemplo creada: ajústala a tu gusto abajo.");
  }

  function removeSeg(id: string) {
    setSegs((prev) => prev.filter((s) => s.id !== id));
    if (!id.startsWith("tmp")) act(br.deleteRafflePrize({ id }), "Casilla eliminada");
  }

  /** Reordenar: se coloca `dragId` justo antes de `overId` y se renumera. */
  function reorder(dragId: string, overId: string) {
    if (dragId === overId) return;
    const list = [...segs];
    const from = list.findIndex((s) => s.id === dragId);
    if (from < 0) return;
    const [moved] = list.splice(from, 1);
    const to = list.findIndex((s) => s.id === overId);
    list.splice(to < 0 ? list.length : to, 0, moved);
    const renumbered = list.map((s, i) => ({ ...s, sort: i }));
    setSegs(renumbered);
    void Promise.all(
      renumbered
        .filter(
          (s) =>
            !s.id.startsWith("tmp") && s.sort !== data?.prizes.find((d) => d.id === s.id)?.sort,
        )
        .map((s) => br.upsertRafflePrize(toInput(s))),
    ).catch((err) => toast.error((err as Error)?.message || "No se pudo guardar el orden."));
  }

  function onWheelDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverWheel(false);
    const d = readDrag(e);
    if (!d) return;
    if (d.t === "p") {
      const p = br.products.find((x) => x.id === d.id);
      if (p) addProduct(p);
    }
  }

  function testSpin() {
    if (!preview.length) {
      toast.message("Añade al menos una casilla para probar el giro.");
      return;
    }
    // Sorteo PONDERADO igual que el servidor: pesos acumulados sobre las
    // casillas activas (con peso 0 nunca sale). Antes era uniforme y no
    // reflejaba las probabilidades configuradas.
    const pool = activeSegs.filter((s) => Math.max(0, s.weight) > 0);
    if (!pool.length) {
      toast.message(
        "Todas las casillas activas tienen peso 0: en el sorteo real no saldría ninguna.",
      );
      return;
    }
    const poolTotal = pool.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
    let roll = Math.random() * poolTotal;
    let winner = pool[pool.length - 1];
    for (const s of pool) {
      roll -= Math.max(0, s.weight);
      if (roll < 0) {
        winner = s;
        break;
      }
    }
    // El clic de aquí es el gesto que desbloquea el audio del tick.
    primeRaffleAudio();
    void wheelRef.current?.spinTo(activeSegs.findIndex((s) => s.id === winner.id));
  }

  // Catálogo filtrado por la busqueda de la paleta (filtro barato: sin useMemo,
  // que ademas estaria aqui detras del return de carga y rompería las reglas).
  const needle = q.trim().toLowerCase();
  const filteredProducts = needle
    ? br.products.filter((p) => p.name.toLowerCase().includes(needle))
    : br.products;

  const inputCls = "h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ config global */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Paso 1 · Ajustes del sorteo</h2>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#2f6d56]"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          Sorteo activo (visible y jugable en «Más → Sorteo»)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#b8860b]"
            checked={cfg.unlimitedTest}
            onChange={(e) => setCfg({ ...cfg, unlimitedTest: e.target.checked })}
          />
          🧪 Giros ilimitados (solo pruebas): las cuentas registradas giran sin gastar ticket
          <span className="text-[11px] font-normal text-muted">
            {" "}
            — no lo actives con clientes reales
          </span>
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelCls}>Título</span>
            <input
              className={inputCls}
              value={cfg.title}
              onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
            />
          </label>
          <label>
            <span className={labelCls}>€ mínimos del pedido para regalar 1 ticket</span>
            <input
              type="number"
              min={0}
              max={9999}
              step={0.01}
              className={inputCls}
              value={cfg.ticketMinEuro}
              onChange={(e) => setCfg({ ...cfg, ticketMinEuro: Number(e.target.value) })}
            />
            <span className="mt-1 block text-[11px] text-muted">
              Cada pedido ENTREGADO de más de esa cantidad da 1 ticket (un giro). Sin límite diario.
            </span>
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Subtítulo</span>
            <input
              className={inputCls}
              value={cfg.subtitle}
              onChange={(e) => setCfg({ ...cfg, subtitle: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>
              Mensaje de ganar (global; cada premio puede poner el suyo)
            </span>
            <input
              className={inputCls}
              value={cfg.winMessage}
              onChange={(e) => setCfg({ ...cfg, winMessage: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Mensaje de perder</span>
            <input
              className={inputCls}
              value={cfg.loseMessage}
              onChange={(e) => setCfg({ ...cfg, loseMessage: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Cómo funciona (texto legal/explicativo de la página)</span>
            <textarea
              className="min-h-20 w-full rounded-xl bg-paper p-3 text-sm shadow-card"
              value={cfg.howItWorks}
              onChange={(e) => setCfg({ ...cfg, howItWorks: e.target.value })}
            />
          </label>
        </div>
        <Button
          className="mt-4"
          onClick={() =>
            act(
              br.saveRaffleConfig({
                enabled: cfg.enabled,
                title: cfg.title,
                subtitle: cfg.subtitle,
                howItWorks: cfg.howItWorks,
                winMessage: cfg.winMessage,
                loseMessage: cfg.loseMessage,
                ticketMinEuro: Math.max(0, Number(cfg.ticketMinEuro) || 0),
                unlimitedTest: cfg.unlimitedTest,
              }),
              "Configuración guardada",
            )
          }
        >
          <Save className="mr-1.5 h-4 w-4" /> Guardar configuración
        </Button>
        {!br.paymentsEnabled &&
        segs.some((p) => p.active && p.kind === "premio" && p.revealPrice > 0) ? (
          <p className="mt-3 rounded-xl bg-night/10 p-3 text-xs text-muted">
            Hay premios con coste de reclamación, pero la pasarela de pago aún no está activa: elige
            proveedor y activa el modo pruebas en la pestaña «Pagos» (o configura PayPal). Mientras
            tanto, el ganador podrá pagar en mano/transferencia y tú confirmarás el pago desde
            «Reclamaciones».
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------ constructor */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Paso 2 · Monta la ruleta</h2>
        <p className="mt-2 text-xs text-muted">{WHEEL_ORDER_HINT}</p>

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* ------------------------------------------- paleta de productos */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Productos del catálogo</h3>
              <div className="relative w-40">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  className="h-8 w-full rounded-full bg-paper pl-8 pr-2 text-xs shadow-card"
                  placeholder="Buscar…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            {filteredProducts.length === 0 ? (
              <p className="mt-3 rounded-xl bg-night/10 p-3 text-xs text-muted">
                {br.products.length === 0
                  ? "El catálogo está vacío: da de alta productos en la pestaña «Productos» y aparecerán aquí para arrastrar."
                  : "Ningún producto coincide con la búsqueda."}
              </p>
            ) : (
              <div className="mt-3 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-2">
                {filteredProducts.map((p) => (
                  <div
                    key={p.id}
                    data-qa={`pal-${p.id}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", JSON.stringify({ t: "p", id: p.id }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group cursor-grab rounded-xl bg-paper p-2 shadow-card transition active:cursor-grabbing active:scale-95"
                    title="Arrástralo a la rueda"
                  >
                    <div className="relative mx-auto size-14 overflow-hidden rounded-lg">
                      <img
                        {...productImgProps(p.image)}
                        alt=""
                        className="size-full object-cover"
                      />
                      <button
                        type="button"
                        title="Añadir a la ruleta"
                        onClick={() => addProduct(p)}
                        className="absolute inset-0 grid place-items-center bg-night/60 text-paper opacity-0 transition group-hover:opacity-100"
                      >
                        <Plus className="size-5" />
                      </button>
                    </div>
                    <p className="mt-1.5 truncate text-[11px] font-medium" title={p.name}>
                      {p.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={addTemplate}>
                <Sparkles className="mr-1.5 h-4 w-4" /> Rueda de ejemplo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  addSeg({ wheelLabel: "PREMIO ???", name: "Premio sorpresa", secret: true })
                }
              >
                <Lock className="mr-1.5 h-4 w-4" /> Premio secreto
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addSeg({ kind: "perdedor", wheelLabel: "CASI!", name: "" })}
              >
                <X className="mr-1.5 h-4 w-4" /> Casilla perdedora
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  addSeg({
                    kind: "chapas",
                    wheelLabel: "CHAPAS +20",
                    name: "Pack de chapas",
                    chapas: 20,
                    revealPrice: 0,
                  })
                }
              >
                <Coins className="mr-1.5 h-4 w-4" /> Casilla de chapas
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  addSeg({ wheelLabel: "CHAPAS", name: "Pack de chapas", revealPrice: 0 })
                }
              >
                <Coins className="mr-1.5 h-4 w-4" /> Premio a medida
              </Button>
            </div>
          </div>

          {/* ------------------------------------------- rueda en vivo */}
          <div className="flex flex-col items-center">
            <div
              data-qa="wheel-drop"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverWheel(true);
              }}
              onDragLeave={() => setDragOverWheel(false)}
              onDrop={onWheelDrop}
              className={cn(
                "rounded-full p-2 transition-colors",
                dragOverWheel && "bg-[#e8b64c]/25 ring-2 ring-[#e8b64c]",
              )}
            >
              <RaffleWheel ref={wheelRef} segments={preview} className="w-[250px] sm:w-[300px]" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={testSpin}>
                <RotateCw className="mr-1.5 h-4 w-4" /> Probar giro
              </Button>
              <span className="text-xs text-muted">
                {activeSegs.length} casilla{activeSegs.length === 1 ? "" : "s"} · peso total{" "}
                {totalWeight}
              </span>
            </div>
            <p className="mt-2 max-w-xs text-center text-[11px] text-muted">
              «Probar giro» usa las MISMAS probabilidades que verán los clientes: si una casilla
              pone 100% sale siempre ahí y una 0% nunca. Sueltas un producto sobre la rueda → entra
              como premio visible CON SU FOTO en la cuña. El candado la convierte en secreta («?»).
            </p>
          </div>
        </div>

        {/* ------------------------------------------- fichas de casillas */}
        <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
          Paso 3 · Ajusta cada casilla
        </h3>
        <div className="mt-3 space-y-2">
          {segs.length === 0 ? (
            <p className="rounded-xl bg-night/10 p-4 text-center text-sm text-muted">
              La rueda está vacía: arrastra productos a la rueda de arriba, o pulsa «✨ Rueda de
              ejemplo» y ajústala después.
            </p>
          ) : null}
          {segs.map((s) => {
            const prob =
              s.active && totalWeight > 0 ? (Math.max(0, s.weight) / totalWeight) * 100 : null;
            return (
              <div
                key={s.id}
                draggable={dragSegId === s.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", JSON.stringify({ t: "seg", id: s.id }));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragSegId(null)}
                onDragOver={(e) => {
                  if (readDrag(e)?.t || e.dataTransfer.types.includes("text/plain"))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const d = readDrag(e);
                  if (!d) return;
                  if (d.t === "seg") reorder(d.id, s.id);
                  else {
                    const p = br.products.find((x) => x.id === d.id);
                    if (p) addProduct(p, s.id);
                  }
                  setDragOverWheel(false);
                }}
                className="rounded-2xl border border-line/30 bg-night/5 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    title="Arrastra para reordenar"
                    onPointerDown={() => setDragSegId(s.id)}
                    className="cursor-grab touch-none rounded-lg p-1 text-muted hover:bg-paper active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </button>
                  {s.kind === "chapas" ? (
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper text-[#d4a437]">
                      <Coins className="size-4" />
                    </span>
                  ) : s.kind === "premio" && (s.image || s.secret) ? (
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-paper">
                      {s.secret ? (
                        <Lock className="size-4 text-[#b8860b]" />
                      ) : s.image ? (
                        <img
                          {...productImgProps(s.image)}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : null}
                    </span>
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper text-muted">
                      <X className="size-4" />
                    </span>
                  )}
                  <input
                    className="h-9 w-40 min-w-0 flex-1 rounded-lg bg-paper px-2 text-sm font-medium shadow-card"
                    value={s.wheelLabel}
                    maxLength={48}
                    disabled={s.kind === "perdedor" ? false : s.secret}
                    title={
                      s.secret
                        ? "El secreto usa el rótulo genérico"
                        : "Texto que se lee en la rueda"
                    }
                    onChange={(e) => patch(s.id, { wheelLabel: e.target.value })}
                    onBlur={() => commit(s)}
                  />
                  <span className="w-14 text-right text-xs font-semibold tabular-nums text-muted">
                    {prob === null ? "—" : `${prob.toFixed(0)}%`}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    <input
                      type="checkbox"
                      className="size-4 accent-[#2f6d56]"
                      checked={s.active}
                      onChange={(e) => {
                        patch(s.id, { active: e.target.checked }, true);
                      }}
                    />
                    en la rueda
                  </label>
                  {s.kind === "chapas" ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      title={
                        s.secret
                          ? "Premio secreto: el cliente solo ve «?»"
                          : "Premio visible: el cliente ve nombre y foto"
                      }
                      onClick={() =>
                        patch(
                          s.id,
                          {
                            secret: !s.secret,
                            wheelLabel: !s.secret
                              ? "PREMIO ???"
                              : s.name || s.wheelLabel || "PREMIO",
                          },
                          true,
                        )
                      }
                    >
                      {s.secret ? (
                        <Lock className="mr-1.5 size-3.5 text-[#b8860b]" />
                      ) : (
                        <Unlock className="mr-1.5 size-3.5 text-muted" />
                      )}
                      {s.secret ? "Secreto" : "Visible"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeSeg(s.id)}
                    title="Eliminar casilla"
                  >
                    <Trash2 className="size-4 text-ember" />
                  </Button>
                </div>

                {/* peso = probabilidad (deslizador; se guarda al soltar) */}
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted"
                    title="Más peso = más opciones de que caiga aquí. El % de la derecha es la probabilidad real."
                  >
                    Probabilidad
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    className="h-1.5 flex-1 accent-[#b8860b]"
                    value={Math.min(100, Math.max(0, s.weight))}
                    onChange={(e) => patch(s.id, { weight: Number(e.target.value) })}
                    onPointerUp={() => commit(s)}
                    onKeyUp={() => commit(s)}
                  />
                  <span className="w-10 text-right text-xs tabular-nums">{s.weight}</span>
                  {s.kind === "chapas" ? (
                    <label className="ml-2 flex items-center gap-1 text-[11px] text-muted">
                      🪙 chapas
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        className="h-8 w-20 rounded-lg bg-paper px-2 text-xs shadow-card"
                        value={s.chapas}
                        onChange={(e) => patch(s.id, { chapas: Number(e.target.value) })}
                        onBlur={() => commit(s)}
                      />
                    </label>
                  ) : s.kind === "premio" ? (
                    <>
                      <label className="ml-2 flex items-center gap-1 text-[11px] text-muted">
                        € reclamación
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-8 w-20 rounded-lg bg-paper px-2 text-xs shadow-card"
                          value={s.revealPrice}
                          onChange={(e) => patch(s.id, { revealPrice: Number(e.target.value) })}
                          onBlur={() => commit(s)}
                        />
                      </label>
                    </>
                  ) : null}
                </div>

                {/* detalle (nombre real, imagen, mensaje) solo para premios */}
                {s.kind === "premio" ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink">
                      Detalle del premio {s.productId ? "(vinculado al catálogo)" : ""}
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label>
                        <span className={labelCls}>
                          Nombre real (lo ve al revelar si es secreto)
                        </span>
                        <input
                          className={inputCls}
                          value={s.name}
                          onChange={(e) => patch(s.id, { name: e.target.value })}
                          onBlur={() => commit(s)}
                        />
                      </label>
                      <label>
                        <span className={labelCls}>Imagen (URL o data)</span>
                        <input
                          className={inputCls}
                          value={s.image ?? ""}
                          onChange={(e) => patch(s.id, { image: e.target.value })}
                          onBlur={() => commit(s)}
                        />
                      </label>
                      <label className="sm:col-span-2">
                        <span className={labelCls}>Descripción</span>
                        <input
                          className={inputCls}
                          value={s.description ?? ""}
                          onChange={(e) => patch(s.id, { description: e.target.value })}
                          onBlur={() => commit(s)}
                        />
                      </label>
                      <label className="sm:col-span-2">
                        <span className={labelCls}>
                          Mensaje para ESTE ganador (vacío = el global)
                        </span>
                        <input
                          className={inputCls}
                          value={s.winMessage ?? ""}
                          onChange={(e) => patch(s.id, { winMessage: e.target.value })}
                          onBlur={() => commit(s)}
                        />
                      </label>
                    </div>
                  </details>
                ) : null}
                {s.kind === "chapas" ? (
                  <p className="mt-2 text-[11px] text-muted">
                    Al caer aquí, las chapas se suman AL INSTANTE a la cuenta del cliente (sin pago
                    ni reclamación) y le llega el aviso a su campanita 🔔.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        {segs.filter((s) => s.active).length < 2 ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-ember/10 p-3 text-xs font-medium text-ember">
            <Dices className="size-4" /> Para activar el sorteo hacen falta al menos 2 casillas «en
            la rueda».
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------ reclamaciones */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Reclamaciones y histórico</h2>
        <p className="mt-2 text-xs text-muted">
          Premios descubiertos listos para entregar con el próximo pedido del ganador. El cliente
          recibe email automático al descubrir el premio.
        </p>
        {pendingClaims.length ? (
          <p className="mt-3 rounded-xl bg-bottle/10 p-3 text-sm font-medium text-bottle">
            🎁 {pendingClaims.length} premio(s) esperando entrega:{" "}
            {pendingClaims.map((e) => `${e.code} (${e.prizeName})`).join(", ")}
          </p>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-160 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Código</th>
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Resultado</th>
                <th className="py-2 pr-3">Importe</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-t border-line/20">
                  <td className="py-2 pr-3 font-mono text-xs">{e.code}</td>
                  <td className="py-2 pr-3">
                    {e.customerName || e.customer}
                    <div className="text-xs text-muted">{fmtDate(e.createdAt)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {e.outcome === "premio"
                      ? e.revealed
                        ? e.prizeName
                        : "??? (sin descubrir)"
                      : e.outcome === "chapas"
                        ? "🪙 Chapas (al instante)"
                        : "No premió"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {e.amount > 0 ? `${e.amount.toFixed(2)} €` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {e.outcome === "chapas" ? (
                      <span className="text-xs font-semibold text-bottle">chapas entregadas</span>
                    ) : !e.revealed ? (
                      <span className="text-xs font-semibold text-muted">
                        {e.outcome === "premio"
                          ? e.paid
                            ? "pagado, falta revelar"
                            : "pendiente de pago"
                          : "—"}
                      </span>
                    ) : e.claimed ? (
                      <span className="text-xs font-semibold text-bottle">
                        reclamado · entregar
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-ember">
                        descubierto, sin reclamar
                      </span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap text-right">
                    {e.outcome === "premio" && !e.paid ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          act(
                            br.setRaffleFlags({ id: e.id, flags: { paid: true, revealed: true } }),
                            "Pago confirmado y premio descubierto",
                          )
                        }
                      >
                        Confirmar pago
                      </Button>
                    ) : null}
                    {e.outcome === "premio" && e.revealed && !e.claimed ? (
                      <Button
                        size="sm"
                        variant="bottle"
                        className="ml-2"
                        onClick={() =>
                          act(
                            br.setRaffleFlags({ id: e.id, flags: { claimed: true } }),
                            "Premio marcado como entregado",
                          )
                        }
                      >
                        Entregado
                      </Button>
                    ) : null}
                    {e.outcome === "premio" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-2 text-ink hover:bg-ink/10"
                        onClick={() => setChatEntryId((cur) => (cur === e.id ? null : e.id))}
                      >
                        {chatEntryId === e.id ? "Cerrar chat" : "Chat"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {data.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-muted">
                    Todavía nadie ha girado la ruleta.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {chatEntryId
          ? (() => {
              const e = data.entries.find((x) => x.id === chatEntryId);
              if (!e) return null;
              return (
                <div className="mt-3 rounded-2xl border border-line bg-paper/40 p-3">
                  <OrderChat
                    key={e.id}
                    orderId={e.id}
                    label={`Chat con ${e.customerName || e.customer} (${e.code})`}
                    emptyHint={`Escribe al cliente que reclamó «${e.prizeName || "su premio"}» para coordinar la entrega.`}
                    startOpen
                    highlight={focusEntryId === e.id}
                  />
                </div>
              );
            })()
          : null}
      </section>
    </div>
  );
}
