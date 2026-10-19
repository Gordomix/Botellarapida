import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Coins } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";
import { OrderChat } from "@/components/chat/order-chat";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";
import { productImgProps } from "@/lib/product-img";
import type { ChapaReward } from "@/data/types";

export const Route = createFileRoute("/chapas")({ component: Page });

/**
 * Logo inventado para el programa: una CHAPA de botella metálica vista desde
 * arriba (corona dentada + interior con las siglas BR). Solo SVG en esta
 * sección nueva; no altera la identidad gráfica existente.
 */
export function ChapaIcon({ size = 44, className }: { size?: number; className?: string }) {
  const teeth = 18;
  const outer = 46;
  const inner = 38;
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i += 1) {
    const a = (Math.PI * i) / teeth;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <defs>
        <radialGradient id="chapa-metal" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#8fd6b2" />
          <stop offset="45%" stopColor="#2f6d56" />
          <stop offset="100%" stopColor="#1b4636" />
        </radialGradient>
      </defs>
      <polygon points={pts.join(" ")} fill="url(#chapa-metal)" stroke="#12241d" strokeWidth="2" />
      <circle cx="50" cy="50" r="30" fill="#f4ead8" stroke="#1b4636" strokeWidth="3" />
      <text
        x="50"
        y="56"
        textAnchor="middle"
        fontFamily="inherit"
        fontSize="22"
        fontWeight="900"
        fill="#1b4636"
      >
        BR
      </text>
    </svg>
  );
}

function Page() {
  const br = useBr();
  const state = br.chapa;
  const [redeeming, setRedeeming] = useState<string | null>(null);

  if (br.chapaLoading) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-3xl animate-pulse px-4 py-16">
          <div className="h-24 w-full rounded-2xl bg-surface/10" />
        </div>
      </StoreShell>
    );
  }

  // Query fallido: nunca dejar la página clavada en el skeleton.
  if (!state) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <ChapaIcon size={72} className="mx-auto" />
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-paper">
            Las chapas no han cargado
          </h1>
          <p className="mt-4 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
            Ha fallado la conexión con el programa de chapas. Reintenta en un momento: tu saldo
            está a salvo.
          </p>
          <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      </StoreShell>
    );
  }

  const { config, rewards, balance, ledger, myRedemptions } = state;
  const isCustomer = br.session && (br.session.role === "user" || br.session.role === "admin");

  if (!config.enabled) {
    return (
      <StoreShell>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <ChapaIcon size={72} className="mx-auto" />
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-paper">
            Chapas
          </h1>
          <p className="mt-4 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
            El programa de fidelización todavía no está disponible. Prepárate: muy pronto cada
            compra valdrá más que dinero.
          </p>
        </div>
      </StoreShell>
    );
  }

  async function redeem(r: ChapaReward) {
    if (!isCustomer) {
      toast.message("Necesitas cuenta de cliente para canjear chapas.");
      return;
    }
    setRedeeming(r.id);
    try {
      const res = await br.redeemChapa({ id: r.id });
      toast.success(`¡Canjeado! Código ${res.code}: lo entregamos con tu próximo pedido.`);
    } catch (err) {
      toast.error((err as Error)?.message || "No se pudo completar el canje.");
    } finally {
      setRedeeming(null);
    }
  }

  return (
    <StoreShell>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">
            <Coins className="mr-1 inline h-3.5 w-3.5" />
            Fidelidad
          </p>
          <h1 className="mt-2 flex items-center justify-center gap-3 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
            <ChapaIcon size={52} />
            {config.title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-mist">{config.subtitle}</p>
        </div>

        {/* saldo */}
        {isCustomer ? (
          <div className="mx-auto mt-8 flex max-w-sm items-center justify-center gap-4 rounded-[1.5rem] bg-surface p-5 shadow-card">
            <ChapaIcon size={46} />
            <div className="text-left">
              <p className="text-xs uppercase tracking-wide text-muted">Tu saldo</p>
              <p className="font-display text-3xl font-bold text-bottle">
                {balance ?? 0} <span className="text-lg">chapas</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl bg-surface p-5 text-center shadow-card">
            <p className="text-sm text-muted">
              Tus chapas se guardan en tu cuenta de cliente. Entra o créala para empezar a acumular.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <Button asChild variant="primary">
                <Link to="/login/cliente">Entrar</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/registro/cliente">Crear cuenta</Link>
              </Button>
            </div>
          </div>
        )}

        {/* cómo se gana */}
        <div className="mt-10 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
          <p className="font-semibold text-ink">Cómo se ganan las chapas</p>
          <p className="mt-2 whitespace-pre-line">
            {config.howItWorks ||
              `Cada pedido entregado suma chapas: 1 chapa por cada ${config.eurosPerChapa} € gastados, y algunos productos regalan chapas extra por unidad (mira su ficha). Las chapas se acumulan en tu cuenta y no caducan.`}
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-bottle/10 px-3 py-1.5 text-xs font-semibold text-bottle">
            <ChapaIcon size={16} />
            Equilibrio BR: 100 chapas = 12 € en regalos
          </p>
          {config.redeemNote ? (
            <p className="mt-2 border-t border-line/20 pt-2 text-xs">{config.redeemNote}</p>
          ) : null}
        </div>

        {/* catálogo de canjes */}
        <h2 className="mt-12 font-display text-2xl font-semibold text-paper">Canjea tus chapas</h2>
        {rewards.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-surface p-5 text-sm text-muted shadow-card">
            Aún no hay ofertas publicadas. Vuelve pronto.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {rewards.map((r) => {
              const affordable = balance !== null && (balance ?? 0) >= r.cost;
              const out = r.stock === 0;
              return (
                <div key={r.id} className="flex flex-col rounded-[1.5rem] bg-surface p-5 shadow-card">
                  <div className="flex items-start gap-3">
                    {r.image ? (
                      <img {...productImgProps(r.image)} alt={r.title} className="h-16 w-16 rounded-xl object-cover" />
                    ) : (
                      <ChapaIcon size={56} className="shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{r.title}</p>
                      {r.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted">{r.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-bottle">
                      <ChapaIcon size={20} />
                      {r.cost} chapas
                      {r.valueEuro > 0 ? (
                        <span className="ml-1 text-xs font-normal text-muted">· valor {r.valueEuro.toFixed(2).replace(/\.00$/, "")} €</span>
                      ) : null}
                      {r.stock > 0 ? (
                        <span className="ml-1 text-xs font-normal text-muted">· quedan {r.stock}</span>
                      ) : r.stock === 0 ? (
                        <span className="ml-1 text-xs font-normal text-ember">· agotado</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant={affordable && !out ? "bottle" : "outline"}
                      disabled={!isCustomer || out || !affordable || redeeming === r.id}
                      onClick={() => redeem(r)}
                    >
                      {redeeming === r.id ? "Canjeando…" : out ? "Agotado" : affordable ? "Canjear" : "Te faltan chapas"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* historial personal */}
        {isCustomer && (myRedemptions.length > 0 || ledger.length > 0) ? (
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {myRedemptions.length > 0 ? (
              <div className="rounded-2xl bg-surface p-5 shadow-card">
                <p className="font-semibold text-ink">Tus canjes</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {myRedemptions.map((rd) => (
                    <li key={rd.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-muted">
                          {rd.rewardTitle}{" "}
                          <span className="text-xs text-mist">({rd.code})</span>
                        </span>
                        <span
                          className={
                            rd.status === "entregado"
                              ? "text-xs font-semibold text-bottle"
                              : rd.status === "cancelado"
                                ? "text-xs font-semibold text-ember"
                                : "text-xs font-semibold text-muted"
                          }
                        >
                          {rd.status === "pendiente" ? "en camino" : rd.status}
                        </span>
                      </div>
                      {/* Chat con la tienda para coordinar la entrega del regalo. */}
                      {rd.status !== "cancelado" ? (
                        <OrderChat
                          orderId={rd.id}
                          label="Chat"
                          emptyHint="Escríbenos para acordar cómo te hacemos llegar el regalo."
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ledger.length > 0 ? (
              <div className="rounded-2xl bg-surface p-5 shadow-card">
                <p className="font-semibold text-ink">Movimientos de chapas</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {ledger.slice(0, 10).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted">{l.reason}</span>
                      <span
                        className={
                          l.delta >= 0 ? "text-xs font-bold text-bottle" : "text-xs font-bold text-ember"
                        }
                      >
                        {l.delta >= 0 ? "+" : ""}
                        {l.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </StoreShell>
  );
}
