import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/utils";
import { productImgProps } from "@/lib/product-img";
import { playRaffleTick } from "@/lib/raffle-fx";

/**
 * Ruleta dorada «estilo casino» compartida: la usa la página pública
 * (`/sorteo`) y el constructor del panel admin como vista previa en vivo.
 *
 * Diseño fiel a la marca: aro metálico dorado con bombillas, segmentos
 * rojo/verde alternos (premios visibles), negro para las casillas perdedoras y
 * negro-ámbar para el PREMIO SECRETO, separadores de oro, medallón central
 * «BR» y puntero triangular dorado arriba.
 *
 * El giro NO es una transición CSS: es un bucle rAF con easing de salida
 * cuártica (arranca fuerte y frena poco a poco, como una bola real) que ademaás
 * dispara el «tic» en cada frontera que el puntero cruza. La parada la decide
 * SIEMPRE el servidor (`spinTo(index)`); aquí solo se anima.
 */

export type WheelSegment = {
  id: string;
  /** Texto corto del segmento (nombre visible o «PREMIO SECRETO ???»). */
  label: string;
  kind: "premio" | "perdedor" | "chapas";
  /** true = casilla oscura con `???` (premio no revelado). */
  secret?: boolean;
  /** Foto del premio visible: se pinta como medallón redondo en la cuña. */
  image?: string | null;
};

export type RaffleWheelHandle = {
  /**
   * Anima hasta el segmento `index` (decidido fuera) y resuelve al parar.
   * `turns` = vueltas completas antes de frenar. Sin segmentos, resuelve ya.
   */
  spinTo: (index: number, opts?: { turns?: number; durationMs?: number }) => Promise<void>;
};

/** Rojo/verde de los premios visibles (alternan por posición, como la foto). */
const RED = "#b3211f";
const GREEN = "#0e7a3c";
const DARK = "#17120e";
const SECRET = "#241a10";
/** BRONCE de las casillas de chapas (migración 0030): se distinguen al vuelo. */
const CHAPA = "#9a6a14";

function segColor(s: WheelSegment, i: number): string {
  if (s.kind === "perdedor") return DARK;
  if (s.kind === "chapas") return CHAPA;
  if (s.secret) return SECRET;
  return i % 2 === 0 ? GREEN : RED;
}

/**
 * Texto del segmento: los secretos no necesitan texto (llevan el «?» de oro);
 * los visibles se truncan con «…» al máximo de caracteres que cabe en el radio
 * disponible, recortando aún más cuando la cuña además lleva foto.
 */
function clipLabel(s: WheelSegment, maxChars: number): string {
  if (s.secret) return "";
  const t = s.label.trim();
  const budget = s.image ? Math.max(4, maxChars - 3) : maxChars;
  if (t.length <= budget) return t;
  return `${t.slice(0, Math.max(1, budget - 1)).trimEnd()}…`;
}

const BULBS = 16;

export function RaffleWheel({
  segments,
  className,
  ref,
}: {
  segments: WheelSegment[];
  className?: string;
  ref?: Ref<RaffleWheelHandle>;
}) {
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const rotRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [spinning, setSpinning] = useState(false);

  const n = segments.length;
  const seg = n > 0 ? 360 / n : 360;

  // Geometría de las etiquetas segun el nº de segmentos:
  // - ancho = arco útil de la cuña en el anillo exterior (antes era un fijo de
  //   48 px que con 12+ cuñas hacía que el texto de dos vecinos se solapase);
  // - tamaño de fuente y nº de caracteres inversos a la densidad de cuñas.
  const labelW = n === 0 ? 24 : Math.min(24, Math.max(9, seg * 0.68));
  const fontSize = n <= 4 ? 12 : n <= 6 ? 11 : n <= 8 ? 10 : n <= 12 ? 9 : 8;
  const maxChars = n <= 4 ? 12 : n <= 6 ? 10 : n <= 8 ? 8 : n <= 12 ? 6 : 5;

  // Limpia cualquier animación pendiente si el componente se desmonta.
  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
  useEffect(() => stopRaf, [stopRaf]);
  useImperativeHandle(
    ref,
    () => ({
      spinTo: (index, opts) =>
        new Promise<void>((resolve) => {
          if (n === 0) {
            resolve();
            return;
          }
          const idx = Math.max(0, Math.min(n - 1, Math.floor(index)));
          const mid = (idx + 0.5) * seg;
          const cur = rotRef.current;
          const curMod = ((cur % 360) + 360) % 360;
          // Rotación final ≡ -mid (mod 360): el centro del segmento para en el
          // puntero (arriba). Un jitter dentro del tercio central de la
          // casilla evita paradas milimétricamente idénticas giro tras giro.
          const delta = (((360 - mid - curMod) % 360) + 360) % 360;
          const jitter = (Math.random() * 2 - 1) * seg * 0.22;
          const turns = opts?.turns ?? 6 + Math.floor(Math.random() * 3);
          const durationMs = opts?.durationMs ?? 5200;
          const target = cur + turns * 360 + delta + jitter;

          const reduce =
            typeof window !== "undefined" &&
            Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
          if (reduce) {
            // Movimiento reducido: sin animación ni ticks, solo el resultado.
            rotRef.current = target;
            if (rotorRef.current) rotorRef.current.style.transform = `rotate(${target}deg)`;
            resolve();
            return;
          }

          stopRaf();
          setSpinning(true);
          const start = performance.now();
          const from = cur;
          const span = target - from;
          let lastSegUnderPointer = -1;

          const frame = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs);
            // Ease-out cuártico: sale disparada y desacelera como una bola.
            const e = 1 - Math.pow(1 - t, 4);
            const rot = from + span * e;
            if (rotorRef.current) rotorRef.current.style.transform = `rotate(${rot}deg)`;
            // «Tic» cada vez que el puntero cruza una frontera de segmento.
            const pointerAngle = (((360 - (((rot % 360) + 360) % 360)) % 360) + 360) % 360;
            const sIdx = Math.floor(pointerAngle / seg);
            if (sIdx !== lastSegUnderPointer) {
              lastSegUnderPointer = sIdx;
              playRaffleTick();
            }
            if (t < 1) {
              rafRef.current = requestAnimationFrame(frame);
            } else {
              rafRef.current = null;
              rotRef.current = target;
              setSpinning(false);
              resolve();
            }
          };
          rafRef.current = requestAnimationFrame(frame);
        }),
    }),
    [n, seg, stopRaf],
  );

  const stops = segments
    .map((s, i) => `${segColor(s, i)} ${i * seg}deg ${(i + 1) * seg}deg`)
    .join(", ");

  return (
    <div
      className={cn("relative aspect-square select-none", spinning && "wheel-spinning", className)}
    >
      {/* Aura dorada que late mientras gira (invisible en reposo; ver styles.css). */}
      <div
        aria-hidden
        className="wheel-glow pointer-events-none absolute -inset-[16%] rounded-full opacity-0"
        style={{
          background:
            "radial-gradient(circle, rgba(232,182,76,.35), rgba(232,182,76,.12) 45%, transparent 70%)",
        }}
      />
      {/* ------------------------------------------------ aro dorado + bombillas */}
      <div
        aria-hidden
        className="wheel-rim absolute -inset-[6%] rounded-full"
        style={{
          background:
            "conic-gradient(from 210deg, #6b4d12, #f0c96a 12%, #8a5f10 30%, #f7e08a 52%, #6b4d12 70%, #e8b64c 90%, #6b4d12)",
          boxShadow:
            "0 0 0 2px #3c2a08, 0 18px 48px -12px rgba(0,0,0,.8), 0 0 34px rgba(232,182,76,.18)",
        }}
      >
        {Array.from({ length: BULBS }, (_, i) => {
          const a = (i * 360) / BULBS;
          const rad = (a * Math.PI) / 180;
          return (
            <span
              key={i}
              className="wheel-bulb absolute size-[4.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff3cf]"
              style={{
                left: `${50 + 50 * Math.sin(rad) * 0.96}%`,
                top: `${50 - 50 * Math.cos(rad) * 0.96}%`,
                boxShadow: "0 0 6px rgba(255,224,150,.9), inset 0 0 2px rgba(140,90,10,.8)",
                // Parpadeo escalonado mientras gira (CSS en styles.css).
                animationDelay: `${(i % 4) * 0.12}s`,
              }}
            />
          );
        })}
      </div>

      {/* ------------------------------------------------ disco que gira */}
      <div
        className="absolute inset-0 overflow-hidden rounded-full border-2 border-[#8a5f10]"
        style={{ boxShadow: "inset 0 0 34px rgba(0,0,0,.55)" }}
      >
        <div ref={rotorRef} className="absolute inset-0 will-change-transform">
          {/* cuñas de color */}
          <div
            className="absolute inset-0"
            style={{ background: n ? `conic-gradient(${stops})` : DARK }}
          />
          {/* separadores dorados: una línea fina en cada frontera */}
          {n > 1 ? (
            <div
              className="absolute inset-0"
              style={{
                background: `repeating-conic-gradient(from 0deg, rgba(232,182,76,.95) 0deg 0.9deg, transparent 0.9deg ${seg}deg)`,
              }}
            />
          ) : null}
          {/* etiquetas: ocupan SOLO el anillo exterior (máscara que desvanece
              antes del medallón BR) y se truncan según el espacio disponible */}
          {segments.map((s, i) => (
            <div
              key={s.id}
              className="absolute left-1/2 top-0 h-1/2 origin-bottom overflow-hidden"
              style={{
                width: `${labelW}%`,
                transform: `translateX(-50%) rotate(${(i + 0.5) * seg}deg)`,
                // El elemento mide media rueda (origen en el centro, imprescindible
                // para que el rotate alinee la cuña). El medallón empieza al ~70% de
                // esa altura: la máscara corta el contenido antes de llegar a él.
                maskImage: "linear-gradient(to bottom, #000 58%, transparent 70%)",
                WebkitMaskImage: "linear-gradient(to bottom, #000 58%, transparent 70%)",
              }}
            >
              <div className="flex flex-col items-center">
                {/* Foto del premio (o «?» dorado si es secreto): medallón redondo
                    con aro de oro pegado al borde exterior de la cuña. */}
                {s.secret ? (
                  <span
                    className="mt-[4%] grid aspect-square w-[86%] place-items-center rounded-full border-2 border-[#e8b64c]/85 bg-[#0b0b0b]/75"
                    style={{
                      boxShadow: "0 2px 10px rgba(0,0,0,.55), inset 0 0 12px rgba(232,182,76,.15)",
                    }}
                  >
                    <span
                      className="font-display font-black leading-none text-[#e8b64c]"
                      style={{ fontSize: fontSize * 1.9 }}
                    >
                      ?
                    </span>
                  </span>
                ) : s.image ? (
                  <span className="mt-[4%] block aspect-square w-[86%] overflow-hidden rounded-full border-2 border-[#e8b64c]/90 bg-paper">
                    <img
                      {...productImgProps(s.image)}
                      alt=""
                      draggable={false}
                      className="size-full object-cover"
                    />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "block pt-1 text-center font-bold uppercase leading-tight tracking-wide",
                    s.secret || s.kind === "perdedor" ? "text-[#e8b64c]/90" : "text-paper/95",
                  )}
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "mixed",
                    margin: "0 auto",
                    fontSize,
                  }}
                >
                  {clipLabel(s, maxChars)}
                </span>
              </div>
            </div>
          ))}
        </div>
        {/* brillo acristalado (fijo, no gira con el disco) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(255,255,255,.14), transparent 38%), radial-gradient(circle at 50% 122%, rgba(0,0,0,.32), transparent 52%)",
          }}
        />
        {/* barrido especular: una luz dorada recorre el cristal al girar */}
        <div
          aria-hidden
          className="wheel-sheen pointer-events-none absolute inset-0 rounded-full opacity-0"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(255,244,200,.28) 24deg, transparent 60deg, transparent 360deg)",
          }}
        />
      </div>

      {/* ------------------------------------------------ medallón central BR */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 z-20 flex h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#e8b64c]"
        style={{
          background: "radial-gradient(circle at 35% 28%, #404040, #0b0b0b 62%)",
          boxShadow:
            "0 0 0 3px #6b4d12, 0 8px 20px rgba(0,0,0,.65), inset 0 2px 10px rgba(255,255,255,.08)",
        }}
      >
        <span
          className="font-display text-2xl font-black tracking-tight text-[#e8b64c] sm:text-3xl"
          style={{ textShadow: "0 1px 0 #fff3cf55, 0 2px 6px rgba(0,0,0,.8)" }}
        >
          BR
        </span>
      </div>

      {/* ------------------------------------------------ puntero dorado */}
      <div aria-hidden className="wheel-pointer absolute left-1/2 top-[-9%] z-30 -translate-x-1/2">
        <div className="mx-auto size-3 rounded-full bg-gradient-to-b from-[#f7e08a] to-[#b8860b] shadow-[0_0_8px_rgba(232,182,76,.8)]" />
        <div
          className="h-7 w-6 bg-gradient-to-b from-[#f7e08a] to-[#a8760e]"
          style={{
            clipPath: "polygon(50% 100%, 0 0, 100% 0)",
            filter: "drop-shadow(0 3px 4px rgba(0,0,0,.55))",
          }}
        />
      </div>
    </div>
  );
}
