/**
 * Efectos del carrito: pitido "8-bit" al añadir, vuelo de la imagen hasta el
 * bolsón de la cabecera y pequeño rebote del icono. Todo es aditivo y vive en
 * cliente: si algo falla (sin WebAudio, imagen remota rota, movimiento
 * reducido), la compra sigue funcionando exactamente igual que antes.
 *
 * El sonido se silencia con un botón de la cabecera; la preferencia se guarda
 * en localStorage (`br-sfx-muted`), no en la base de datos.
 */

const MUTED_KEY = "br-sfx-muted";

export function isSfxMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSfxMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    /* modo privado sin storage: el cambio solo dura esta sesión */
  }
  // La cabecera escucha este evento para sincronizar el icono desde cualquier
  // parte (el botón y `setSfxMuted` pueden vivir en componentes distintos).
  window.dispatchEvent(new CustomEvent("br-sfx-muted", { detail: muted }));
}

/* ------------------------------------------------------------------- sonido */

// Un solo AudioContext para toda la página: crearlo por cada pitido agota los
// límites de Chrome en sesiones largas.
let ac: AudioContext | null = null;

/**
 * El AudioContext compartido de la app (creado perezosamente y reanudado si
 * estaba suspendido). Exportado para el sonido de la ruleta (`raffle-fx`):
 * DOS contextos distintos en móvil compiten por el desbloqueo por gesto y el
 * segundo suele quedarse mudo; mejor uno solo para todo.
 */
export function sharedAudioCtx(): AudioContext | null {
  return audioCtx();
}

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ac) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ac = new Ctor();
    }
    // Los navegadores lo dejan "suspendido" hasta el primer gesto: el click
    // de "Añadir" ES el gesto, así que reanudarlo aquí es legítimo.
    if (ac.state === "suspended") void ac.resume();
    return ac;
  } catch {
    return null;
  }
}

/**
 * Desbloqueo de audio en MÓVIL (iOS/Android). Los navegadores móviles dejan el
 * AudioContext "suspendido" hasta que suena dentro de un gesto, y en iOS la
 * PRIMERA nota se pierde aunque el gesto sea válido. La solución estándar es
 * "primar" el motor en el primer toque real de la página reproduciendo un
 * buffer mudo de una muestra (inaudible): así el contexto queda despierto y
 * corriendo, y los pitidos posteriores suenan siempre. Idempotente: solo se
 * ejecuta una vez.
 */
let primed = false;
export function primeSfx(): void {
  if (typeof window === "undefined" || primed) return;
  primed = true;
  try {
    const ctx = audioCtx();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* sin WebAudio: los pitidos simplemente no sonarán */
  }
}

// En cuanto haya interacción real (tocar/pulsar/ratón), desbloqueamos el motor.
// `once` + el flag `primed` garantizan que solo corre la primera vez. Se pincha
// en fase de captura para adelantarnos a cualquier `stopPropagation` del árbol.
if (typeof window !== "undefined") {
  const opts = { capture: true, once: true } as const;
  window.addEventListener("pointerdown", primeSfx, opts);
  window.addEventListener("touchend", primeSfx, opts);
  window.addEventListener("keydown", primeSfx, opts);
}

/**
 * Arpegio ascendente do-mi-sol-do con onda square: el clásico "recogida de
 * moneda" 8-bit, corto (≈250 ms) y a volumen bajo para no molestar.
 */
export function playAddSfx(): void {
  if (isSfxMuted()) return;
  const ctx = audioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.015;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const t = t0 + i * 0.06;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    // Envolvente de decay rápido: sin clicks al principio y al final.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  });
}

/**
 * Saludo del logo: dos notas suaves (mi → la) con onda sine, más corto y
 * discreto que el arpegio del carrito. Respeta el mismo botón de silencio.
 */
export function playLogoSfx(): void {
  if (isSfxMuted()) return;
  const ctx = audioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.015;
  const notes = [329.63, 440.0];
  notes.forEach((freq, i) => {
    const t = t0 + i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

/* ------------------------------------------------------------- vuelo al carro */

/** Coordenada del bolsón de la cabecera (marcado con `data-cart-target`). */
function cartEl(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector("[data-cart-target]");
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Fantasma de la imagen que vuela desde la tarjeta hasta el icono del carrito.
 * No lanza excepciones nunca: sin origen, sin destino o con movimiento
 * reducido, simplemente no se pinta nada.
 */
export function flyToCart(imgSrc: string, from: DOMRect | null | undefined): void {
  if (typeof window === "undefined" || !from || reducedMotion()) return;
  const target = cartEl();
  if (!target) return;
  const to = target.getBoundingClientRect();

  const ghost = document.createElement("img");
  ghost.src = imgSrc;
  ghost.alt = "";
  const size = Math.min(96, Math.max(48, Math.min(from.width, from.height)));
  const startX = from.left + from.width / 2 - size / 2;
  const startY = from.top + from.height / 2 - size / 2;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${startX}px`,
    top: `${startY}px`,
    width: `${size}px`,
    height: `${size}px`,
    objectFit: "cover",
    borderRadius: "1rem",
    pointerEvents: "none",
    zIndex: "70",
    boxShadow: "0 12px 32px rgba(18, 16, 14, 0.45)",
    transition: "transform 620ms cubic-bezier(0.22, 0.61, 0.21, 1), opacity 620ms ease",
    willChange: "transform, opacity",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (startX + size / 2);
  const dy = to.top + to.height / 2 - (startY + size / 2);
  // Doble rAF: el navegador primero pinta el fantasma en su sitio de origen y
  // luego anima el transform; sin esto la transición no se vería.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.22) rotate(10deg)`;
      ghost.style.opacity = "0.35";
    }),
  );
  window.setTimeout(() => ghost.remove(), 720);
}

/** Rebote del icono del carrito al entrar un producto. */
export function bumpCart(): void {
  if (typeof window === "undefined" || reducedMotion()) return;
  const el = cartEl();
  if (!el) return;
  el.classList.remove("cart-bump");
  // Forzar reflow para que la animación vuelva a arrancar si estaba terminada.
  void (el as HTMLElement).offsetWidth;
  el.classList.add("cart-bump");
}
