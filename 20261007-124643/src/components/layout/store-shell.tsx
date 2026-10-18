import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CreditCard,
  Menu,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Smartphone,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/product/product-card";
import { CITIES } from "@/data/hero";
import { CATEGORIES, FREE_SHIPPING, SHIPPING_COST, type CategoryId, type DeliverySlot, type PaymentMethod, type Product } from "@/data/types";
import { isWithinServiceArea, SERVICE_AREA_LABEL } from "@/data/service-area";
import { SLOT_LABEL } from "@/lib/format";
import { useBr } from "@/lib/use-br";
import { cn, fmtEur } from "@/lib/utils";

const NAV = [
  { to: "/catalogo" as const, label: "Catálogo" },
  { to: "/soporte" as const, label: "Soporte" },
];

export function StoreShell({
  children,
  hero,
}: {
  children: ReactNode;
  hero?: ReactNode;
}) {
  const br = useBr();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menu, setMenu] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [query, setQuery] = useState("");
  const [ageOpen, setAgeOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // No abrir hasta haber leído el estado real de +18 (localStorage). Sin esta
    // espera, el primer render ve `ageOk=false` y reabre el gate en cada recarga
    // aunque el visitante ya lo haya aceptado.
    if (!br.sessionReady) return;
    if (!br.ageOk) setAgeOpen(true);
    const need = () => setAgeOpen(true);
    window.addEventListener("br-need-age", need);
    return () => window.removeEventListener("br-need-age", need);
  }, [br.ageOk, br.sessionReady]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const visible = useMemo(
    () => br.products.filter((p) => !p.alcohol || br.ageOk),
    [br.products, br.ageOk],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return visible
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, visible]);

  const count = br.cartItems.reduce((s, i) => s + i.qty, 0);
  const overlay = Boolean(hero) && !scrolled && !menu;

  return (
    <div className="grain-page flex min-h-dvh flex-col bg-night text-paper">
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          overlay ? "bg-transparent" : "bg-night/92 shadow-[0_1px_0_rgba(239,228,208,0.08)] backdrop-blur-xl",
        )}
      >
        <div className="border-b border-paper/10">
          <p className="mx-auto flex max-w-6xl items-center justify-center gap-x-3 px-4 py-2 text-center text-[0.72rem] tracking-[0.14em] text-mist">
            <span className="font-semibold uppercase text-ember">Express España</span>
            <span className="hidden text-paper/25 sm:inline">·</span>
            <span className="hidden sm:inline">Entrega media en menos de 90 min</span>
            <span className="hidden text-paper/25 md:inline">·</span>
            <span className="hidden md:inline">
              Envío gratis desde <strong className="tabular-nums text-paper">{fmtEur(FREE_SHIPPING)}</strong>
            </span>
          </p>
        </div>

        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Logo inverted />
          <nav className="ml-4 hidden items-center gap-5 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "text-sm font-medium text-paper/75 transition-colors hover:text-paper",
                  pathname.startsWith(n.to) && "text-paper",
                )}
              >
                {n.label}
              </Link>
            ))}
            <a href="/#pasillos" className="text-sm font-medium text-paper/75 hover:text-paper">
              Pasillos
            </a>
          </nav>

          <div className="relative ml-auto hidden min-w-0 flex-1 max-w-xs lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar snacks, refrescos…"
              className="h-11 w-full rounded-full bg-night/55 pl-10 pr-4 text-sm text-paper outline-none placeholder:text-paper/55 shadow-[0_0_0_1px_rgba(239,228,208,0.22)] backdrop-blur-md focus:bg-night/70"
              suppressHydrationWarning
            />
            {suggestions.length > 0 ? (
              <ul className="absolute top-[calc(100%+8px)] z-50 w-full overflow-hidden rounded-2xl bg-surface shadow-lift">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-paper"
                      onClick={() => {
                        setQuery("");
                        navigate({ to: "/producto/$id", params: { id: p.id } });
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="tabular-nums text-ember">{fmtEur(p.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5 lg:ml-2">
            <Link
              to="/acceso"
              className="hidden h-11 items-center rounded-full px-3.5 text-sm font-medium text-paper hover:bg-paper/10 sm:inline-flex"
            >
              {br.session ? br.session.name.split(" ")[0] : "Entrar"}
            </Link>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative inline-flex size-11 items-center justify-center rounded-full bg-ember text-paper"
              aria-label="Abrir cesta"
            >
              <ShoppingBag className="size-5" />
              {count > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-paper px-1 text-[0.65rem] font-semibold tabular-nums text-ink">
                  {count}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-full text-paper md:hidden"
              aria-label="Menú"
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {menu ? (
          <div className="border-t border-paper/10 bg-night px-4 py-4 md:hidden">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="h-11 w-full rounded-full bg-paper/10 pl-10 pr-4 text-sm text-paper outline-none placeholder:text-mist"
              />
            </div>
            <div className="flex flex-col gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className="rounded-xl px-3 py-3 font-medium text-paper"
                  onClick={() => setMenu(false)}
                >
                  {n.label}
                </Link>
              ))}
              <Link to="/acceso" className="rounded-xl px-3 py-3 font-medium text-paper" onClick={() => setMenu(false)}>
                {br.session ? "Mi cuenta" : "Zonas de acceso"}
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      {hero}

      <main className={cn("flex-1", !hero && "pt-28")}>{children}</main>

      <footer className="mt-auto bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo inverted />
            <p className="mt-5 max-w-sm text-sm text-mist">
              Express España. Ultramarinos urbanos a velocidad de patinete. Precios de supermercado, nevera fría, puerta
              en menos de 90 minutos.
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.16em] text-paper/40">
              Reparto en {CITIES.join(" · ")}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/45">Tienda</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link to="/catalogo" className="hover:text-ember">
                  Catálogo
                </Link>
              </li>
              <li>
                <Link to="/soporte" className="hover:text-ember">
                  Soporte
                </Link>
              </li>
              <li>
                <Link to="/acceso" className="hover:text-ember">
                  Acceso
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/45">Legal</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link to="/privacidad" className="hover:text-ember">
                  Privacidad
                </Link>
              </li>
              <li>
                <Link to="/terminos" className="hover:text-ember">
                  Términos
                </Link>
              </li>
              <li className="text-mist">Solo mayores de 18 años</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-paper/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-paper/40">
            © 2026 Botella Rápida S.L. · Express España · Consumo responsable. Si bebes, no conduzcas.
          </p>
        </div>
      </footer>

      {ageOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-[1.75rem] bg-surface p-6 text-center shadow-lift sm:rounded-[1.75rem] sm:p-8">
            <Logo />
            <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">¿Tienes 18 años o más?</h2>
            <p className="mt-3 text-sm text-muted">
              Vendemos bodega. La ley española exige confirmar mayoría de edad. Sin verificación, el alcohol no se muestra.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                onClick={() => {
                  br.setAgeVerified(true);
                  setAgeOpen(false);
                }}
              >
                Tengo 18 o más
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  br.setAgeVerified(false);
                  setAgeOpen(false);
                }}
              >
                Soy menor de 18
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted">
              Al continuar aceptas los{" "}
              <Link to="/terminos" className="underline">
                términos
              </Link>{" "}
              y la{" "}
              <Link to="/privacidad" className="underline">
                privacidad
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-night/60"
            aria-label="Cerrar cesta"
            onClick={() => setCartOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface shadow-lift">
            <div className="flex items-center justify-between border-b border-line/20 px-5 py-4">
              <h2 className="font-display text-xl font-semibold">Tu cesta</h2>
              <button type="button" className="grid size-10 place-items-center rounded-full hover:bg-paper" onClick={() => setCartOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {br.cartItems.length === 0 ? (
                <p className="py-16 text-center text-muted">La cesta está vacía.</p>
              ) : (
                <ul className="space-y-3">
                  {br.cartItems.map((item) => (
                    <li key={item.id} className="grid grid-cols-[64px_1fr_auto] gap-3 rounded-2xl bg-paper p-2">
                      <img src={item.product.image} alt="" className="media size-16 rounded-xl object-cover" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.product.name}</p>
                        <p className="text-xs text-muted">{fmtEur(item.product.price)}</p>
                        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-surface px-1 py-0.5 shadow-card">
                          <button type="button" className="grid size-7 place-items-center" onClick={() => br.setQty(item.id, item.qty - 1)}>
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-4 text-center text-sm tabular-nums">{item.qty}</span>
                          <button type="button" className="grid size-7 place-items-center" onClick={() => br.setQty(item.id, item.qty + 1)}>
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="pr-1 pt-1 text-sm font-semibold tabular-nums">{fmtEur(item.line)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-line/20 bg-paper p-5">
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full bg-bottle transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.round((br.subtotal / FREE_SHIPPING) * 100))}%` }}
                />
              </div>
              <p className="mb-4 text-xs text-muted">
                {br.subtotal >= FREE_SHIPPING
                  ? "Envío gratis aplicado."
                  : `Te faltan ${fmtEur(FREE_SHIPPING - br.subtotal)} para envío gratis.`}
              </p>
              <div className="mb-4 flex justify-between font-display text-lg">
                <span>Subtotal</span>
                <span className="tabular-nums text-ember">{fmtEur(br.subtotal)}</span>
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={!br.cartItems.length}
                onClick={() => {
                  if (!br.session || br.session.role !== "user") {
                    toast.message("Entra como cliente para pagar");
                    setCartOpen(false);
                    navigate({ to: "/login/cliente", search: { next: "/" } });
                    return;
                  }
                  setCheckout(true);
                }}
              >
                Finalizar pedido
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {checkout ? (
        <CheckoutDialog
          br={br}
          onClose={() => setCheckout(false)}
          onDone={() => {
            setCheckout(false);
            setCartOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CheckoutDialog({
  br,
  onClose,
  onDone,
}: {
  br: ReturnType<typeof useBr>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pay, setPay] = useState<PaymentMethod>("tarjeta");
  const [slot, setSlot] = useState<DeliverySlot>("inmediata");
  const [tip, setTip] = useState(0);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const shipping = br.subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
  const total = br.subtotal + shipping + tip;
  const hasAlcohol = br.cartItems.some((i) => i.product.alcohol);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!br.session) return;
    setErr("");
    // Validamos la zona antes de hablar con el servidor (el servidor vuelve a
    // comprobarlo: el formulario se puede manipular).
    const postal = String(fd.get("postalCode") || "").trim();
    if (!/^\d{5}$/.test(postal)) {
      setErr("Introduce un código postal de 5 dígitos.");
      return;
    }
    if (!isWithinServiceArea(postal)) {
      setErr(`De momento solo repartimos en ${SERVICE_AREA_LABEL}.`);
      return;
    }
    setBusy(true);
    try {
      // `customer`/`customerName` ya no se mandan: el servidor los toma de la
      // sesión y recalcula el importe (el precio del navegador no es de fiar).
      const order = await br.createOrder({
        items: br.cartItems.map((i) => ({
          id: i.id,
          name: i.product.name,
          qty: i.qty,
          price: i.product.price,
        })),
        subtotal: br.subtotal,
        shippingCost: shipping,
        tip,
        total,
        paymentMethod: pay,
        deliverySlot: slot,
        address: String(fd.get("address") || ""),
        postalCode: postal,
        phone: String(fd.get("phone") || ""),
        notes: String(fd.get("notes") || ""),
      });
      br.clearCart();
      setOk(order.code);
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo confirmar el pedido.");
    } finally {
      setBusy(false);
    }
  }

  const pays: { id: PaymentMethod; label: string; hint: string; icon: typeof CreditCard }[] = [
    { id: "tarjeta", label: "Tarjeta", hint: "Visa / Mastercard", icon: CreditCard },
    { id: "bizum", label: "Bizum", hint: "Pago móvil", icon: Smartphone },
    { id: "apple_google_pay", label: "Pay", hint: "Apple / Google", icon: Wallet },
    { id: "efectivo", label: "En mano", hint: "Efectivo o TPV", icon: Truck },
  ];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]">
        {ok ? (
          <div className="py-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bottle">Pedido confirmado</p>
            <h2 className="mt-3 font-display text-3xl font-semibold">{ok}</h2>
            <p className="mt-3 text-sm text-muted">
              Guarda el código. El admin lo delega y el repartidor lo lleva a tu puerta.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button asChild>
                <Link to="/cuenta">Ver seguimiento</Link>
              </Button>
              <Button variant="ghost" onClick={onDone}>
                Seguir comprando
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-2xl font-semibold">Checkout express</h2>
                <p className="text-sm text-muted">
                  {fmtEur(total)} · {SLOT_LABEL[slot]}
                </p>
              </div>
              <button type="button" className="grid size-10 place-items-center rounded-full hover:bg-paper" onClick={onClose}>
                <X className="size-5" />
              </button>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Entrega</legend>
              <Field name="address" label="Dirección" placeholder="Carrer de Maragall 20, 2n 1a" required />
              <Field name="postalCode" label="Código postal" placeholder="08911" required />
              <p className="text-xs text-muted">De momento solo repartimos en {SERVICE_AREA_LABEL}.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="phone" label="Teléfono" placeholder="600 000 000" required />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Franja</span>
                  <select
                    value={slot}
                    onChange={(e) => setSlot(e.target.value as DeliverySlot)}
                    className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
                  >
                    {Object.entries(SLOT_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Field name="notes" label="Indicaciones (opcional)" placeholder="Portal, telefonillo…" />
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Pago</legend>
              <div className="grid grid-cols-2 gap-2">
                {pays.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPay(p.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl px-3 py-3 text-left shadow-card",
                      pay === p.id ? "bg-ink text-paper" : "bg-paper",
                    )}
                  >
                    <p.icon className="size-4 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className={cn("text-xs", pay === p.id ? "text-paper/70" : "text-muted")}>{p.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Propina repartidor</legend>
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTip(n)}
                    className={cn(
                      "h-10 flex-1 rounded-full text-sm font-medium",
                      tip === n ? "bg-ink text-paper" : "bg-paper",
                    )}
                  >
                    {n === 0 ? "0" : `+${n} €`}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1 rounded-2xl bg-paper p-4 text-sm">
              <Row k="Productos" v={fmtEur(br.subtotal)} />
              <Row k="Envío" v={shipping === 0 ? "Gratis" : fmtEur(shipping)} />
              <Row k="Propina" v={fmtEur(tip)} />
              <Row k="Total" v={fmtEur(total)} strong />
            </div>
            {hasAlcohol ? (
              <p className="rounded-2xl bg-adult/8 px-4 py-3 text-sm text-adult">
                Hay alcohol en el pedido. El repartidor verificará el DNI en la entrega.
              </p>
            ) : null}
            {err ? <p className="text-sm text-ember">{err}</p> : null}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? "Confirmando…" : "Confirmar y pagar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card placeholder:text-muted"
      />
    </label>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "pt-2 font-display text-base")}>
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

export function useStorefront() {
  return useBr();
}

export function CatalogBlock({
  products,
  title,
  lead,
}: {
  products: Product[];
  title?: string;
  lead?: string;
}) {
  const br = useBr();
  const visible = products.filter((p) => !p.alcohol || br.ageOk);
  function add(p: Product) {
    const r = br.addToCart(p);
    if (r.ok) toast.success(`${p.name} en la cesta`);
  }
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      {title ? (
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Nevera</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">{title}</h2>
          {lead ? <p className="mt-2 text-mist">{lead}</p> : null}
        </div>
      ) : null}
      <ProductGrid products={visible} onAdd={add} />
    </section>
  );
}

export function PasilloTiles({ ageOk }: { ageOk: boolean }) {
  const cats = (Object.keys(CATEGORIES) as CategoryId[]).filter((c) => c !== "alcohol" || ageOk);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      {cats.map((id) => {
        const c = CATEGORIES[id];
        return (
          <Link
            key={id}
            to="/catalogo"
            search={{ cat: id }}
            className="group relative aspect-[3/4] overflow-hidden rounded-[1.5rem] bg-ink"
          >
            <img
              src={c.image}
              alt=""
              className="size-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-night/90 via-night/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-paper">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-mist">{c.kicker}</p>
              <p className="font-display text-xl font-semibold">{c.label}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
