import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";
import { Button } from "@/components/ui/button";
import { RaffleWheel, type RaffleWheelHandle, type WheelSegment } from "@/components/raffle/wheel";
import { playRaffleLose, playRaffleWin, primeRaffleAudio } from "@/lib/raffle-fx";
import { useBr } from "@/lib/use-br";
import { productImgProps } from "@/lib/product-img";
import type { RaffleSpinResult } from "@/data/types";

export const Route = createFileRoute("/sorteo")({
  component: Page,
  // Stripe vuelve aquí tras pagar la reclamación: ?entry=…&estado=pago
  validateSearch: (search: Record<string, unknown>) => ({
    entry: typeof search.entry === "string" ? search.entry : "",
    estado: typeof search.estado === "string" ? search.estado : "",
    // Campanita del consuelo: ?consuelo=<giro perdedor> reabre la tarjeta de la
    // oferta (el servidor la reentrega por `consolation_of`, sin girar otra vez).
    consuelo: typeof search.consuelo === "string" ? search.consuelo : "",
  }),
});

/** Estado del dialogo de resultado: cerrado / girando / resultado. */
type Phase = "idle" | "spinning" | "result";

function Page() {
  const br = useBr();
  const { entry: entryParam, estado, consuelo: consueloParam } = Route.useSearch();
  const state = br.raffle;

  const wheelRef = useRef<RaffleWheelHandle>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RaffleSpinResult | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof br.revealRaffle>> | null>(null);
  // Fase 10 — premio de consuelo: al PERDER pedimos al servidor el secreto que
  // podría haber caído, con su -10 % congelado. `consolationLoaded` distingue
  // «todavía no ha venido» de «la rueda no tiene premios» (null legítimo).
  const [consolation, setConsolation] =
    useState<Awaited<ReturnType<typeof br.raffleConsolation>>>(null);
  const [consolationLoaded, setConsolationLoaded] = useState(false);

  const prizes = state?.prizes ?? [];
  const n = prizes.length;
  // Tickets (migración 0028): sin sesión se VE pero no se gira; con sesión,
  // cada giro gasta un ticket ganado comprando (nada de giros diarios).
  const tickets = state?.spinsLeft ?? 0;
  const minTxt = (state?.config.ticketMinEuro ?? 10).toFixed(2).replace(/\.00$/, "");
  // Giros ilimitados (0029): el servidor manda el centinela 999 y no gasta
  // tickets; la UI lo anuncia como modo pruebas para que nadie crea que tiene
  // 999 tickets reales.
  const unlimited = state?.config.unlimitedTest === true;
  const canSpin =
    Boolean(state?.config.enabled) &&
    n > 0 &&
    state?.spinsLeft !== null &&
    (unlimited || tickets > 0);

  // Segmentos de la rueda: los premios VISIBLES lucen su nombre e imagen real;
  // los secretos, el rótulo genérico del admin (el nombre jamás viaja al navegador).
  const wheelSegments: WheelSegment[] = prizes.map((p) => ({
    id: p.id,
    label: p.secret ? p.wheelLabel : p.publicName || p.wheelLabel,
    kind: p.kind,
    secret: p.secret,
    image: p.secret ? null : p.publicImage,
  }));

  /* Al volver del Checkout de Stripe: confirmar el pago en servidor y abrir el premio. */
  useEffect(() => {
    if (!entryParam || estado !== "pago") return;
    let alive = true;
    br.checkRaffleClaim({ id: entryParam })
      .then((res) => {
        if (!alive) return;
        if (res.paid) {
          toast.success("¡Pago confirmado! Tu premio ya está descubierto.");
          br.revealRaffle({ id: entryParam })
            .then((d) => {
              if (!alive) return;
              setDetail(d);
              setResult((r) =>
                r
                  ? r
                  : {
                      entryId: entryParam,
                      code: "",
                      index: 0,
                      outcome: "premio",
                      revealed: true,
                      amount: 0,
                      chapaAwarded: 0,
                      winMessage: "¡Enhorabuena!",
                      loseMessage: "",
                    },
              );
              setPhase("result");
            })
            .catch(() => undefined);
        } else {
          toast.message("El pago aún no se ha completado.");
        }
      })
      .catch((err: Error) => toast.error(err.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryParam, estado]);

  // El consuelo se pide SOLO al aterrizar un giro perdedor (una vez por giro:
  // el servidor es idempotente vía `consolation_of`, pero aquí tampoco lo
  // disparamos en cada render). Sin sesión ni premio en la rueda, null.
  useEffect(() => {
    if (phase !== "result" || result?.outcome !== "perdedor" || !br.session) return;
    let alive = true;
    br.raffleConsolation({ id: result.entryId })
      .then((res) => {
        if (alive) setConsolation(res);
      })
      .catch(() => {
        if (alive) setConsolation(null);
      })
      .finally(() => {
        if (alive) setConsolationLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result?.entryId]);

  // Deep-link de la campanita 🎗️: el aviso enlaza al giro perdedor; aquí se
  // REABRE su tarjeta de consuelo sin tener que volver a girar la ruleta.
  // `revealConsolationPrize` es idempotente (reentrega la oferta existente),
  // así que reabrir no crea nada ni gasta otro ticket.
  useEffect(() => {
    if (!consueloParam || !br.session) return;
    let alive = true;
    br.raffleConsolation({ id: consueloParam })
      .then((res) => {
        if (!alive || !res) return;
        setConsolation(res);
        setConsolationLoaded(true);
        setResult({
          entryId: consueloParam,
          code: "",
          index: -1,
          outcome: "perdedor",
          revealed: false,
          amount: 0,
          chapaAwarded: 0,
          winMessage: "",
          loseMessage: "Reabrimos tu premio de consuelo: sigue reservado con su descuento.",
        });
        setPhase("result");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consueloParam]);

  async function onSpin() {
    // Dentro del propio gesto: despierta el AudioContext antes del primer tick
    // (en iOS la primera nota se pierde si el contexto no suena aquí).
    primeRaffleAudio();
    if (!br.session) {
      toast.message("Para jugar y reclamar premios necesitas tu cuenta de cliente.");
      return;
    }
    if (!canSpin || phase === "spinning") return;
    setPhase("spinning");
    setResult(null);
    setDetail(null);
    setConsolation(null);
    setConsolationLoaded(false);
    try {
      const res = await br.spinRaffle();
      setResult(res);
      // El servidor ya decidió el segmento (índice); aquí solo se ANIMA la
      // parada — con ticks de bola incluidos — y al frenar sonorea el resultado.
      await wheelRef.current?.spinTo(res.index);
      if (res.outcome !== "perdedor") playRaffleWin();
      else playRaffleLose();
      setPhase("result");
    } catch (err) {
      setPhase("idle");
      toast.error((err as Error)?.message || "No se pudo girar la ruleta.");
    }
  }

  async function onPayOrReveal(res: RaffleSpinResult) {
    if (res.amount <= 0) {
      try {
        const d = await br.revealRaffle({ id: res.entryId });
        setDetail(d);
      } catch (err) {
        toast.error((err as Error)?.message);
      }
      return;
    }
    if (!br.paymentsEnabled) {
      const via = br.paymentStatus?.provider === "stripe" ? "con tarjeta" : "con PayPal";
      toast.message(
        `El pago ${via} aún no está activo: escribe a soporte con tu código y el admin confirmará tu pago.`,
      );
      return;
    }
    try {
      const { url } = await br.payRaffleClaim({ id: res.entryId });
      window.location.href = url;
    } catch (err) {
      toast.error((err as Error)?.message);
    }
  }

  // Comprar el consuelo: el entry offering ya lleva el -10 % CONGELADO en BD,
  // así que el pago usa la pasarela corriente (`payRaffleClaim` cobra lo que
  // hay en la tabla, nunca lo que ve el navegador). Gratis se revela al acto;
  // una oferta ya pagada/revelada se descubre directo (reveal es idempotente)
  // y jamás se vuelve a pasar por caja.
  async function onBuyConsolation() {
    if (!consolation) return;
    const target = consolation;
    if (target.discountedPrice <= 0 || target.revealed) {
      try {
        const d = await br.revealRaffle({ id: target.entryId });
        setDetail(d);
        // Cambiamos el resultado al entry de consuelo: la tarjeta pasa a la
        // rama «ganador revelado» y «Reclamar» actúa sobre el entry correcto.
        setResult((r) =>
          r ? { ...r, entryId: target.entryId, outcome: "premio", index: -1, amount: 0 } : r,
        );
      } catch (err) {
        toast.error((err as Error)?.message);
      }
      return;
    }
    if (!br.paymentsEnabled) {
      const via = br.paymentStatus?.provider === "stripe" ? "con tarjeta" : "con PayPal";
      toast.message(
        `El pago ${via} aún no está activo: escribe a soporte con tu código y el admin confirmará tu pago.`,
      );
      return;
    }
    try {
      const { url } = await br.payRaffleClaim({ id: target.entryId });
      window.location.href = url;
    } catch (err) {
      toast.error((err as Error)?.message);
    }
  }

  async function onClaim(id: string) {
    try {
      await br.claimRaffle({ id });
      toast.success("Premio reclamado: lo entregamos con tu próximo pedido. 🎉");
      setPhase("idle");
      setResult(null);
      setDetail(null);
    } catch (err) {
      toast.error((err as Error)?.message);
    }
  }

  if (br.raffleLoading) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-3xl animate-pulse px-4 py-16">
          <div className="mx-auto h-72 w-72 rounded-full bg-surface/20" />
        </div>
      </StoreShell>
    );
  }

  // Query fallido (el servidor no respondió): nunca dejar la página clavada en
  // el skeleton; se ofrece reintentar antes que el aviso de «no disponible».
  if (!state) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Sorteo</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper">
            La ruleta no ha cargado
          </h1>
          <p className="mt-4 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
            Ha fallado la conexión con el sorteo. Reintenta en un momento: tus giros no se pierden.
          </p>
          <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      </StoreShell>
    );
  }

  if (!state.config.enabled || n === 0) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Sorteo</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper">
            La ruleta está descansando
          </h1>
          <p className="mt-4 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
            Este sorteo todavía no está disponible. Vuelve pronto: puede que sea la noche en que
            gire.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link to="/catalogo">Ver el catálogo</Link>
          </Button>
        </div>
      </StoreShell>
    );
  }

  // Casilla ganadora en la lista pública: si no es secreta, el resultado se
  // enseña con nombre e imagen reales desde el primer momento.
  const wonPub = result && result.outcome === "premio" ? (prizes[result.index] ?? null) : null;

  return (
    <StoreShell>
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">
          <Sparkles className="mr-1 inline h-3.5 w-3.5" />
          Sorteo
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
          {state.config.title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-mist">{state.config.subtitle}</p>
        {unlimited ? (
          <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#e8b64c]/60 bg-night px-3 py-1 text-xs font-semibold text-[#e8b64c]">
            🧪 Modo pruebas: giros ilimitados activados por el admin
          </p>
        ) : null}

        {/* Ruleta dorada con bombillas: el disco y el giro los pone RaffleWheel
            (el MISMO componente que usa el admin como vista previa). */}
        <RaffleWheel
          ref={wheelRef}
          segments={wheelSegments}
          className="mx-auto mt-12 w-[290px] sm:w-[380px]"
        />

        {/* controles */}
        <div className="mt-10">
          {br.session ? (
            <>
              <Button
                size="lg"
                onClick={onSpin}
                disabled={phase === "spinning" || !canSpin}
                className="btn-metallic px-10 text-lg"
              >
                {phase === "spinning" ? "¡Girando!" : "Girar la ruleta"}
              </Button>
              <p className="mt-3 text-xs text-mist">
                {unlimited
                  ? "Modo pruebas: giras las veces que quieras sin gastar tickets."
                  : tickets > 0
                    ? `Tienes ${tickets} ticket${tickets === 1 ? "" : "s"} de ruleta: cada giro gasta uno.`
                    : `Aún no tienes tickets. Cada pedido entregado de más de ${minTxt} € te regala 1.`}
              </p>
              {!unlimited && tickets === 0 ? (
                <Button asChild variant="bottle" className="mt-4">
                  <Link to="/catalogo">Comprar y conseguir mi ticket</Link>
                </Button>
              ) : null}
            </>
          ) : (
            <div className="mx-auto max-w-sm rounded-2xl bg-surface p-5 shadow-card">
              <p className="text-sm text-muted">
                Mira la rueda y los premios todo lo que quieras. Para jugar necesitas cuenta y un
                ticket: cada pedido entregado de más de {minTxt} € te regala 1.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button asChild variant="primary">
                  <Link to="/login/cliente">Entra para jugar</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/registro/cliente">Crear cuenta</Link>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Los premios en juego, con su foto: así la rueda se entiende de un
            vistazo sin tener que descifrar las letras en diagonal. */}
        {prizes.some((p) => p.kind === "premio") ? (
          <div className="mx-auto mt-12 max-w-2xl text-left">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-ember">
              Los premios en juego
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {prizes
                .filter((p) => p.kind === "premio")
                .map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card"
                  >
                    {p.secret ? (
                      <span className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-[#e8b64c]/80 bg-night">
                        <span className="font-display text-2xl font-black leading-none text-[#e8b64c]">
                          ?
                        </span>
                      </span>
                    ) : p.publicImage ? (
                      <img
                        {...productImgProps(p.publicImage)}
                        alt=""
                        className="size-12 shrink-0 rounded-full border-2 border-line object-cover"
                      />
                    ) : (
                      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-paper text-xl">
                        🎁
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {p.secret ? "Premio secreto" : p.publicName || p.wheelLabel}
                      </p>
                      <p className="text-[11px] text-muted">
                        {p.secret
                          ? "Solo el ganador lo descubrirá"
                          : p.revealPrice > 0
                            ? `Reclamable por ${p.revealPrice.toFixed(2)} €`
                            : "Reclamable gratis con tu pedido"}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-mist">
              Las casillas oscuras con «?» son premios secretos: nadie sabe qué hay dentro hasta que
              toca.
            </p>
          </div>
        ) : null}

        {/* premio pendiente de reclamar (al volver o al recargar la página) */}
        {phase === "idle" && state.pending ? (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-line bg-ink p-5 text-left shadow-card">
            <p className="text-sm font-semibold text-paper">
              🎁 Tienes un premio sin reclamar ({state.pending.code})
            </p>
            <p className="mt-1 text-xs text-mist">
              {state.pending.revealed
                ? "Está descubierto y espera tu reclamación."
                : state.pending.amount > 0
                  ? `Descúbrelo pagando ${state.pending.amount.toFixed(2)} €.`
                  : "Descúbrelo sin coste."}
            </p>
            <div className="mt-3">
              {state.pending.revealed ? (
                <Button size="sm" variant="bottle" onClick={() => onClaim(state.pending!.entryId)}>
                  Reclamar con mi próximo pedido
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => onPayOrReveal(state.pending!)}>
                  {state.pending.amount > 0
                    ? `Pagar y descubrir (${state.pending.amount.toFixed(2)} €)`
                    : "Descubrir premio"}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {/* resultado del giro — Fase 10: tarjeta MODAL centrada (ya no abajo,
            bajo el fold). El fondo oscurecido cierra; la tarjeta gana altura
            en móvil desde el borde inferior, como el checkout. */}
        {phase === "result" && result ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Resultado del sorteo"
            className="fixed inset-0 z-[70] grid place-items-end overflow-y-auto bg-night/80 sm:place-items-center sm:p-4"
            onClick={() => setPhase("idle")}
          >
            <div
              className="max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-t-[1.5rem] border border-line bg-ink p-6 text-center shadow-lift sm:max-h-[92dvh] sm:rounded-[1.5rem]"
              onClick={(e) => e.stopPropagation()}
            >
              {result.outcome === "chapas" ? (
                <>
                  {/* Segmento de chapas (migración 0030): se cobran al instante,
                    sin reveal ni reclamación — nada que pagar ni entregar. */}
                  <div className="text-4xl">🪙</div>
                  <p className="mt-3 font-display text-2xl text-paper">{result.winMessage}</p>
                  {result.chapaAwarded > 0 ? (
                    <p className="mt-2 text-sm text-mist">
                      ¡Has ganado{" "}
                      <span className="font-semibold text-[#d4a437]">
                        +{result.chapaAwarded} chapas
                      </span>
                      ! Ya están sumadas en tu cuenta: canjéalas por regalos.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-mist">
                      Este año el segmento venía sin chapas dentro… ¡la próxima rinde más!
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">Código de participación: {result.code}</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button asChild variant="bottle">
                      <Link to="/chapas">Ver mis chapas</Link>
                    </Button>
                    <Button variant="outline" onClick={() => setPhase("idle")}>
                      Cerrar
                    </Button>
                  </div>
                </>
              ) : result.outcome === "perdedor" ? (
                <>
                  {/* Fase 10 — tarjeta de DERROTA con premio de consuelo: se
                    revela el secreto que podría haber caído y se ofrece al
                    90 % (precio original tachado). El -10 % lo congela el
                    servidor en el entry: aquí solo se pinta esa cifra. */}
                  <div className="text-4xl">💨</div>
                  <p className="mt-3 font-display text-2xl text-paper">Casi casi…</p>
                  <p className="mt-2 text-sm text-mist">{result.loseMessage}</p>
                  {consolation ? (
                    <div className="mt-5 rounded-2xl border border-[#e8b64c]/40 bg-night p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#e8b64c]">
                        🎗️ Premio de consuelo
                      </p>
                      {consolation.image ? (
                        <img
                          {...productImgProps(consolation.image)}
                          alt={consolation.name}
                          className="mx-auto mt-3 h-32 w-32 rounded-2xl object-cover shadow-card"
                        />
                      ) : (
                        <div className="mx-auto mt-3 flex h-28 w-28 items-center justify-center rounded-full bg-ink shadow-[inset_0_0_24px_rgba(0,0,0,.8)]">
                          <span className="font-display text-5xl text-[#d4a437]">?</span>
                        </div>
                      )}
                      <p className="mt-3 font-display text-xl text-paper">{consolation.name}</p>
                      {consolation.description ? (
                        <p className="mt-1 text-sm text-mist">{consolation.description}</p>
                      ) : null}
                      <p className="mt-3 text-sm font-semibold text-paper">
                        ¡Aún puedes conseguirlo!
                      </p>
                      <p className="mt-1">
                        <span className="text-sm text-muted line-through">
                          {consolation.originalPrice.toFixed(2)} €
                        </span>{" "}
                        <span className="text-lg font-bold text-[#d4a437]">
                          {consolation.discountedPrice.toFixed(2)} €
                        </span>
                        <span className="ml-1.5 rounded-full bg-[#d4a437]/15 px-2 py-0.5 text-xs font-semibold text-[#d4a437]">
                          −10 %
                        </span>
                      </p>
                      {consolation.claimed ? (
                        <>
                          {/* La campanita reabre la oferta incluso ya reclamada: aquí
                            no hay que pagar otra vez, se habla con la tienda. */}
                          <p className="mt-3 text-sm font-semibold text-bottle">
                            🎁 Ya es tuyo: lo entregamos con tu próximo pedido.
                          </p>
                          <Button asChild variant="bottle" className="mt-4 w-full">
                            <Link to="/mensajes" search={{ order: consolation.entryId }}>
                              Contactar con la tienda
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            className="btn-metallic mt-4 w-full"
                            onClick={onBuyConsolation}
                          >
                            {consolation.revealed
                              ? "Ver el premio y reclamar"
                              : consolation.discountedPrice > 0
                                ? `Comprar al 90 % (${consolation.discountedPrice.toFixed(2)} €)`
                                : "Descubrirlo y reclamar gratis"}
                          </Button>
                          <p className="mt-2 text-[11px] text-muted">
                            {result.code
                              ? `Oferta única ligada a tu giro ${result.code}.`
                              : "Oferta única: la guardamos desde tu giro perdedor."}{" "}
                            <Link
                              to="/soporte"
                              className="underline underline-offset-2 hover:text-paper"
                            >
                              ¿Dudas? Escríbenos
                            </Link>
                          </p>
                        </>
                      )}
                    </div>
                  ) : consolationLoaded ? null : (
                    <p className="mt-4 animate-pulse text-xs text-muted">
                      Buscando en la caja fuerte lo que podrías haber ganado…
                    </p>
                  )}
                  <Button variant="outline" className="mt-4" onClick={() => setPhase("idle")}>
                    Cerrar
                  </Button>
                </>
              ) : detail ? (
                <>
                  <div className="text-4xl">🏆</div>
                  <p className="mt-3 font-display text-2xl text-paper">{result.winMessage}</p>
                  <p className="mt-1 text-sm text-mist">
                    Has ganado:{" "}
                    <span className="font-semibold text-paper">{detail.revealedName}</span>
                  </p>
                  {detail.revealedImage ? (
                    <img
                      {...productImgProps(detail.revealedImage)}
                      alt={detail.revealedName}
                      className="mx-auto mt-4 h-36 w-36 rounded-2xl object-cover shadow-card"
                    />
                  ) : null}
                  <p className="mt-4 text-lg font-bold text-[#d4a437]">{detail.revealedName}</p>
                  {detail.revealedDescription ? (
                    <p className="mt-1 text-sm text-mist">{detail.revealedDescription}</p>
                  ) : null}
                  {detail.claimed ? (
                    <p className="mt-4 text-sm text-bottle">
                      Ya está reclamado: lo llevamos con tu próximo pedido.
                    </p>
                  ) : (
                    <Button
                      variant="bottle"
                      className="mt-4"
                      onClick={() => onClaim(result.entryId)}
                    >
                      Reclamar con mi próximo pedido
                    </Button>
                  )}
                </>
              ) : wonPub && !wonPub.secret ? (
                <>
                  {/* PREMIO VISIBLE: se enseña desde el primer momento (el admin
                    eligió que no fuera secreto); solo la reclamación puede
                    llevar el pequeño pago de gestión que él fijó. */}
                  <div className="text-4xl">🏆</div>
                  <p className="mt-3 font-display text-2xl text-paper">{result.winMessage}</p>
                  <p className="mt-1 text-sm text-mist">
                    Has ganado:{" "}
                    <span className="font-semibold text-paper">
                      {wonPub.publicName || wonPub.wheelLabel}
                    </span>
                  </p>
                  {wonPub.publicImage ? (
                    <img
                      {...productImgProps(wonPub.publicImage)}
                      alt={wonPub.publicName}
                      className="mx-auto mt-4 h-36 w-36 rounded-2xl object-cover shadow-card"
                    />
                  ) : null}
                  <p className="mt-4 text-lg font-bold text-[#d4a437]">
                    {wonPub.publicName || wonPub.wheelLabel}
                  </p>
                  <p className="mt-1 text-xs text-muted">Código de participación: {result.code}</p>
                  {result.amount > 0 ? (
                    <Button
                      variant="primary"
                      className="btn-metallic mt-4"
                      onClick={() => onPayOrReveal(result)}
                    >
                      Pagar {result.amount.toFixed(2)} € y reclamar
                    </Button>
                  ) : (
                    <Button
                      variant="bottle"
                      className="mt-4"
                      onClick={() => onClaim(result.entryId)}
                    >
                      Reclamar con mi próximo pedido
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {/* PREMIO OSCUTO con ? hasta pagar/revelar */}
                  <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-night shadow-[inset_0_0_24px_rgba(0,0,0,.8),0_0_24px_rgba(212,164,55,.25)]">
                    <span className="font-display text-6xl text-[#d4a437]">?</span>
                  </div>
                  <p className="mt-4 font-display text-2xl text-paper">{result.winMessage}</p>
                  <p className="mt-1 text-sm text-mist">
                    Has ganado:{" "}
                    <span className="font-semibold text-[#d4a437]">un premio secreto</span>
                  </p>
                  <p className="mt-2 text-sm text-mist">
                    Tu premio está en la caja fuerte.{" "}
                    {result.amount > 0
                      ? `Descúbrelo por solo ${result.amount.toFixed(2)} € (gastos de gestión de la reclamación).`
                      : "Descúbrelo ahora sin coste."}
                  </p>
                  <p className="mt-1 text-xs text-muted">Código de participación: {result.code}</p>
                  <Button
                    variant="primary"
                    className="btn-metallic mt-4"
                    onClick={() => onPayOrReveal(result)}
                  >
                    {result.amount > 0
                      ? `Pagar ${result.amount.toFixed(2)} € y descubrir`
                      : "Descubrir premio"}
                  </Button>
                  <button
                    type="button"
                    className="mt-3 block text-xs text-muted underline-offset-2 hover:underline"
                    onClick={() => setPhase("idle")}
                  >
                    Guardarlo para luego
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* cómo funciona */}
        <div className="mx-auto mt-12 max-w-xl rounded-2xl bg-surface p-5 text-left text-sm text-muted shadow-card">
          <p className="font-semibold text-ink">Cómo funciona</p>
          <p className="mt-2 whitespace-pre-line">
            {state.config.howItWorks ||
              `La ruleta se ve sin cuenta, pero para girar hay que tener un TICKET: cada pedido entregado de más de ${minTxt} € te regala 1 (lo verás al pagar). Cada giro gasta un ticket y el resultado lo decide el sorteo en el momento. Si toca premio, se descubre al reclamarlo y se entrega con el siguiente pedido.`}
          </p>
        </div>
      </div>
    </StoreShell>
  );
}
