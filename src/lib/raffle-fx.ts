/**
 * Sonido de la ruleta: tic de la bola contra los obstáculos, fanfare al ganar
 * y tono corto al perder. Sintetizado con WebAudio (cero assets, cero red),
 * sobre el MISMO AudioContext compartido que el carrito (`cart-fx`): en móvil
 * dos contextos compiten por el desbloqueo por gesto y uno se queda mudo.
 *
 * Todo es aditivo y best-effort: si el navegador no tiene WebAudio o el usuario
 * silenciada la app con el botón de la cabecera, la ruleta gira igual en silencio.
 */

import { isSfxMuted, primeSfx, sharedAudioCtx } from "@/lib/cart-fx";

/**
 * Reanuda el AudioContext SIEMPRE que se va a emitir un sonido de ruleta.
 * `primeSfx` solo corre una vez por carga; si el navegador suspendió el
 * contexto después (cambio de pestaña, bloqueo de pantalla en móvil), el
 * primer tick del giro moriría en un contexto dormido y sonaría «apagado».
 * Es barato: `resume()` sobre un contexto ya activo es un no-op.
 */
function readyCtx(): AudioContext | null {
  const ctx = sharedAudioCtx();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * Ancla el desbloqueo de audio al gesto del usuario ANTES de arrancar el
 * giro: en iOS la primera nota se pierde si el contexto no sonó dentro del
 * propio handler del toque. `primeSfx` es idempotente y silencioso.
 */
export function primeRaffleAudio(): void {
  primeSfx();
  const ctx = sharedAudioCtx();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/**
 * «Tick» seco de la bola rozando un obstáculo: chasquido metálico (square muy
 * corta) reforzado con un golpe grave de madera (sine 190 Hz) por debajo, que es
 * lo que hace que se PERCIBA incluso con el móvil en volumen medio. Frecuencia
 * con jitter para que la sucesión no suene a metralla.
 */
export function playRaffleTick(): void {
  if (isSfxMuted()) return;
  const ctx = readyCtx();
  if (!ctx || ctx.state !== "running") return;
  try {
    const t = ctx.currentTime;
    // Chasquido agudo.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1750 + Math.random() * 650;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.035);
    // Golpe grave «de madera»: sin esto el tick agudo se pierde con ruido ambiente.
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(220, t);
    thump.frequency.exponentialRampToValueAtTime(150, t + 0.025);
    thumpGain.gain.setValueAtTime(0.0001, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    thump.connect(thumpGain).connect(ctx.destination);
    thump.start(t);
    thump.stop(t + 0.05);
  } catch {
    /* sin WebAudio: silencio */
  }
}

/** Fanfare ascendente de victoria: do-mi-sol-do-mi con cola larga final. */
export function playRaffleWin(): void {
  if (isSfxMuted()) return;
  const ctx = readyCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, i) => {
      const t = t0 + i * 0.09;
      const isLast = i === notes.length - 1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (isLast ? 0.8 : 0.24));
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + (isLast ? 0.85 : 0.28));
      // Brillo: una octava superior suave encima del cuerpo triangle.
      const spark = ctx.createOscillator();
      const sparkGain = ctx.createGain();
      spark.type = "sine";
      spark.frequency.value = freq * 2;
      sparkGain.gain.setValueAtTime(0.0001, t);
      sparkGain.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
      sparkGain.gain.exponentialRampToValueAtTime(0.0001, t + (isLast ? 0.7 : 0.2));
      spark.connect(sparkGain).connect(ctx.destination);
      spark.start(t);
      spark.stop(t + (isLast ? 0.75 : 0.24));
    });
  } catch {
    /* silencio */
  }
}

/** Dos notas descendentes y suaves: «casi casi», sin dramatismo. */
export function playRaffleLose(): void {
  if (isSfxMuted()) return;
  const ctx = readyCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    [392, 311.13].forEach((freq, i) => {
      const t = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  } catch {
    /* silencio */
  }
}
