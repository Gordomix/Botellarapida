import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  ChevronDown,
  Coins,
  CreditCard,
  Heart,
  MapPin,
  Menu,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trash2,
  Truck,
  Volume2,
  VolumeX,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/product/product-card";
import {
  CATEGORIES,
  FREE_SHIPPING,
  NIGHT_SURCHARGE,
  SHIPPING_COST,
  type CategoryId,
  type DeliverySlot,
  type PaymentMethod,
  type Product,
} from "@/data/types";
import {
  mergeSection,
  SITE_DEFAULTS,
  type AgeGateSection,
  type AvisoSection,
  type BrandSection,
  type CategoriesSection,
  type CheckoutSection,
  type CoberturaSection,
  type ContactSection,
  type FooterSection,
  type MantenimientoSection,
  type NavSection,
  type RepartoSection,
} from "@/data/site-defaults";
import { isWithinServiceArea, SERVICE_AREA_LABEL } from "@/data/service-area";
import { coordsForCp, nearestStores, type NearbyStore } from "@/data/stores";
import { SLOT_LABEL } from "@/lib/format";
import {
  deliveryDaysLabel,
  fmtDeliveryDate,
  isDeliveryDay,
  nextDeliveryDate,
} from "@/lib/delivery-days";
import { isSfxMuted, setSfxMuted } from "@/lib/cart-fx";
import { matchesQuery } from "@/lib/product-search";
import { usePwaInstall } from "@/lib/pwa-install";
import { productImgProps } from "@/lib/product-img";
import { useBr } from "@/lib/use-br";
import { cn, fmtDate, fmtEur } from "@/lib/utils";

// El mapa (Leaflet) se carga solo al abrirlo: así no entra en el bundle crítico
// ni se ejecuta en servidor.
const NearbyStoresDialog = lazy(() =>
  import("@/components/map/nearby-stores").then((m) => ({
    default: m.NearbyStoresDialog,
  })),
);

export function StoreShell({ children, hero }: { children: ReactNode; hero?: ReactNode }) {
  const br = useBr();
  // Contenido editable: sin override = los literales de hoy (ver site-defaults).
  const brand = mergeSection(SITE_DEFAULTS.brand, br.content.brand as BrandSection);
  const nav = mergeSection(SITE_DEFAULTS.nav, br.content.nav as NavSection);
  // Enlaces fijos de las secciones nuevas (Sorteo y Chapas): entran siempre en
  // «Más ▾» y en el menú móvil, aunque el nav guardado en el CMS no los traiga
  // (mergeSection reemplaza la lista entera). Si el editor ya los pone, no se duplican.
  const baseNavItems = nav.items.length ? nav.items : SITE_DEFAULTS.nav.items;
  const navItems = [
    ...baseNavItems,
    ...[
      { to: "/sorteo", label: "Sorteo!" },
      { to: "/chapas", label: "Chapas" },
    ].filter((x) => !baseNavItems.some((n) => n.to === x.to)),
  ];
  const footer = mergeSection(SITE_DEFAULTS.footer, br.content.footer as FooterSection);
  const contacto = mergeSection(SITE_DEFAULTS.contacto, br.content.contacto as ContactSection);
  const age = mergeSection(SITE_DEFAULTS.agegate, br.content.agegate as AgeGateSection);
  const checkoutCopy = mergeSection(SITE_DEFAULTS.checkout, br.content.checkout as CheckoutSection);
  const cobertura = mergeSection(
    SITE_DEFAULTS["home.cobertura"],
    br.content["home.cobertura"] as CoberturaSection,
  );
  const footerCities = cobertura.cities.length
    ? cobertura.cities
    : SITE_DEFAULTS["home.cobertura"].cities;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menu, setMenu] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [query, setQuery] = useState("");
  const [ageOpen, setAgeOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [nearby, setNearby] = useState(false);
  // «Apóyanos»: diálogo discreto de donación (corazón en la cabecera).
  const [support, setSupport] = useState(false);
  // Sonido del carrito: el estado del botoncito se sincroniza por evento para
  // que siempre refleje lo que hay en localStorage, pase lo que pase.
  const [sfxMuted, setSfxMutedUi] = useState(false);
  // Acceso directo a la pantalla de inicio (PWA): diálogo nativo donde exista
  // y tutorial del dominio en iOS, donde el navegador no lo ofrece.
  const pwa = usePwaInstall();
  useEffect(() => {
    setSfxMutedUi(isSfxMuted());
    const onToggle = (e: Event) => setSfxMutedUi(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("br-sfx-muted", onToggle);
    return () => window.removeEventListener("br-sfx-muted", onToggle);
  }, []);
  // Tienda de origen elegida desde el mapa; se pasa al checkout como preselección.
  const [preferredStore, setPreferredStore] = useState<NearbyStore | null>(null);

  // Enlaces de invitación (migración 0030): si la URL trae `?ref=AF-XXXXXX`, se
  // recuerda en el navegador para que el registro y el primer pedido lo adjunten
  // solos. Con sesión ya abierta, se vincula la referida de inmediato.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
    if (!raw || !/^AF-[0-9A-F]{6}$/.test(raw)) return;
    try {
      localStorage.setItem("br_ref", raw);
    } catch {
      /* navegador en modo privado: sin remember, el pedido puede llevarlo a mano */
    }
    if (br.session) void br.attachReferral(raw).catch(() => undefined);
  }, [br.session]);

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
    const q = query.trim();
    if (q.length < 2) return [];
    // Buscamos por nombre, marca, descripción… y TAMBIÉN por etiquetas SEO
    // derivadas (Fase 12): así «bebida», «frío» o «energética» sacan un Monster.
    return visible.filter((p) => matchesQuery(p, q)).slice(0, 6);
  }, [query, visible]);

  // Enter en el buscador: lleva al catálogo con la consulta, donde se ven TODOS
  // los resultados (no solo las 6 sugerencias del desplegable).
  function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setQuery("");
    void navigate({ to: "/catalogo", search: { q } });
  }

  const count = br.cartItems.reduce((s, i) => s + i.qty, 0);
  const overlay = Boolean(hero) && !scrolled && !menu;

  // Alto REAL de la cabecera: al envolver en dos filas (pantallas estrechas,
  // ver el `flex-wrap` de la barra) el `pt-28` fijo se queda corto y taparía
  // contenido. Solo se mide desde md hacia arriba: por debajo, la barra siempre
  // cabe en una fila y el menú hamburguesa abierto cambiaría la altura a saltos.
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState<number | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof window === "undefined") return;
    const update = () => {
      if (window.matchMedia("(min-width: 768px)").matches) setHeaderH(el.offsetHeight);
      else setHeaderH(null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Aviso deslizante y cierre por mantenimiento: dos secciones nuevas del CMS
  // (apagadas por defecto: sin override la web es idéntica a hoy).
  const aviso = mergeSection(SITE_DEFAULTS.aviso, br.content.aviso as AvisoSection);
  const maint = mergeSection(
    SITE_DEFAULTS.mantenimiento,
    br.content.mantenimiento as MantenimientoSection,
  );
  const avisoText = aviso.activo ? aviso.texto.trim() : "";
  // El login NUNCA se bloquea: si no, el admin no podría entrar a reabrir la tienda.
  const authPath = ["/acceso", "/login", "/restablecer"].some((p) => pathname.startsWith(p));
  // Clientes y anónimos ven el cierre; admin y repartidor siguen operando (el
  // repartidor tiene pedidos en calle que debe poder cerrar).
  const maintBlocked =
    maint.activo &&
    br.sessionReady &&
    !authPath &&
    br.session?.role !== "admin" &&
    br.session?.role !== "repartidor";

  if (maintBlocked) {
    return (
      <div className="grain-page flex min-h-dvh flex-col items-center justify-center bg-night px-6 text-center text-paper">
        <div className="w-full max-w-md rounded-[1.5rem] bg-surface p-6 shadow-lift">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-ember/15">
            <Wrench className="size-6 text-ember" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold">{maint.titulo}</h1>
          {/* La tarjeta es CLARA (bg-surface): los tonos paper/mist, pensados para
              fondo noche, aquí no se ven. Se usan muted/ink, los legibles. */}
          <p className="mt-2 text-sm leading-relaxed text-muted">{maint.mensaje}</p>
          {maint.vuelta.trim() ? (
            <p className="mt-4 rounded-2xl bg-ember/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ember-dark">
              {maint.vuelta}
            </p>
          ) : null}
          {/* Puerta de servicio discreta: por aquí entra el equipo a reabrir. */}
          <Link
            to="/acceso"
            className="mt-6 inline-flex h-11 items-center rounded-full border border-ink/25 px-4 text-sm font-medium text-ink/75 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            Acceso equipo
          </Link>
        </div>
      </div>
    );
  }

  // Elementos de la cabecera que caben o no según el ancho. Los enlaces de
  // navegación (texto) van primero y los botones de servicio (pastilla) después:
  // al faltar sitio, entran por la derecha al desplegable «Más ▾» (NavOverflow).
  // Así la barra es SIEMPRE una sola fila y el buscador nunca se aplasta.
  const navEntries: NavEntry[] = [
    ...navItems
      // Sorteo y Chapas salen de la tira de texto: viajan como pastilla junto
      // a «Apóyanos» (más abajo), que es donde los pide la gente.
      .filter((n) => n.to !== "/sorteo" && n.to !== "/chapas")
      .map((n) => ({
        key: n.to,
        label: n.label,
        kind: "text" as const,
        to: n.to,
        active: pathname.startsWith(n.to),
      })),
    { key: "pasillos", label: nav.pasillosLabel, kind: "text" as const, href: "/#pasillos" },
    {
      key: "tiendas",
      label: "Tiendas",
      kind: "pill" as const,
      icon: <MapPin className="size-4" />,
      onClick: () => setNearby(true),
    },
    ...(br.session?.role === "user"
      ? ([
          { key: "cuenta", label: "Mi cuenta", kind: "pill" as const, to: "/cuenta" },
          { key: "mensajes", label: "Mensajes", kind: "pill" as const, to: "/mensajes" },
        ] as NavEntry[])
      : []),
    {
      key: "acceso",
      label: br.session ? br.session.name.split(" ")[0] : "Entrar",
      kind: "pill" as const,
      to: "/acceso",
      title: br.session?.name,
    },
    {
      key: "sorteo",
      label: "Sorteo",
      kind: "pill" as const,
      icon: <Sparkles className="size-4 text-ember" />,
      to: "/sorteo",
      active: pathname.startsWith("/sorteo"),
      title: "Ruleta de premios",
      // Fijo en el desplegable «Más»: la barra de arriba se queda como era.
      menuOnly: true,
    },
    {
      key: "chapas",
      label: "Chapas",
      kind: "pill" as const,
      icon: <Coins className="size-4 text-bottle" />,
      to: "/chapas",
      active: pathname.startsWith("/chapas"),
      title: "Programa de fidelización",
      menuOnly: true,
    },
    {
      key: "apoyanos",
      label: "Apóyanos",
      kind: "pill" as const,
      icon: <Heart className="size-4 text-ember" />,
      onClick: () => setSupport(true),
    },
  ];

  return (
    <div className="grain-page flex min-h-dvh flex-col bg-night text-paper">
      <header
        ref={headerRef}
        className={cn(
          "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          overlay
            ? "bg-transparent"
            : "bg-night/92 shadow-[0_1px_0_rgba(239,228,208,0.08)] backdrop-blur-xl",
        )}
      >
        {/* Banner interno de mantenimiento: solo lo ve el admin (recordatorio de
            que la tienda está cerrada para clientes). */}
        {maint.activo && br.session?.role === "admin" ? (
          <div className="border-b border-paper/10 bg-bottle px-4 py-1.5 text-center text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-paper">
            Mantenimiento activo · los clientes ven la pantalla de cierre
          </div>
        ) : null}
        {/* Aviso deslizante (derecha → izquierda): dos copias idénticas y
            translateX(-50%) = bucle continuo sin costura (keyframe `marquee`). */}
        {avisoText ? (
          <div className="overflow-hidden border-b border-paper/10 bg-ember">
            <div className="flex w-max animate-[marquee_22s_linear_infinite] whitespace-nowrap py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-night">
              <span className="px-10">{avisoText}</span>
              <span className="px-10" aria-hidden>
                {avisoText}
              </span>
            </div>
          </div>
        ) : null}
        <div className="border-b border-paper/10">
          <p className="mx-auto flex max-w-6xl items-center justify-center gap-x-3 px-4 py-2 text-center text-[0.72rem] tracking-[0.14em] text-mist">
            <span className="font-semibold uppercase text-ember">{brand.topBadge}</span>
            <span className="hidden text-paper/25 sm:inline">·</span>
            <span className="hidden sm:inline">{brand.topDelivery}</span>
            <span className="hidden text-paper/25 md:inline">·</span>
            <span className="hidden md:inline">
              {brand.topShippingLabel}{" "}
              <strong className="tabular-nums text-paper">{fmtEur(FREE_SHIPPING)}</strong>
            </span>
          </p>
        </div>

        {/* Cabecera: UNA sola fila. Lo que no cabe entra en el desplegable
            «Más ▾» (NavOverflow) en vez de partir la barra o aplastar el buscador. */}
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="shrink-0">
            <Logo inverted />
          </div>
          <NavOverflow
            entries={navEntries}
            className="ml-2 hidden min-w-0 flex-1 items-center gap-4 md:flex"
          />

          {/* Buscador: fijo a la derecha (shrink-0), nunca se encoge por encima
              de su ancho mínimo; el «Más» absorbe la falta de sitio. */}
          <div className="relative ml-auto hidden w-40 shrink-0 md:block lg:w-52 xl:w-64 xl:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
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

          {/* Acciones compactas SIEMPRE visibles: campanita, sonido, cesta y menú (móvil). */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-2">
            {br.session ? <NotificationBell br={br} /> : null}
            <button
              type="button"
              onClick={() => setSfxMuted(!sfxMuted)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-mist transition-[background-color,color,transform] duration-150 hover:bg-paper/10 hover:text-paper active:scale-90"
              aria-label={sfxMuted ? "Activar sonido al añadir" : "Silenciar sonido al añadir"}
              aria-pressed={sfxMuted}
              title={sfxMuted ? "Sonido apagado" : "Sonido activado"}
            >
              {sfxMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              data-cart-target=""
              className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ember text-paper transition-transform duration-150 hover:brightness-105 active:scale-90"
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
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-paper transition-[background-color,transform] duration-150 hover:bg-paper/10 active:scale-90 md:hidden"
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setMenu(false);
                    runSearch();
                  }
                }}
                placeholder="Buscar…"
                className="h-11 w-full rounded-full bg-paper/10 pl-10 pr-4 text-sm text-paper outline-none placeholder:text-mist"
              />
            </div>
            <div className="flex flex-col gap-1">
              {navItems.map((n) => (
                <Link
                  key={n.to}
                  to={n.to as never}
                  className="rounded-xl px-3 py-3 font-medium text-paper"
                  onClick={() => setMenu(false)}
                >
                  {n.label}
                </Link>
              ))}
              {/* Mapa: en móvil el botón de cabecera va oculto (hidden sm:inline-flex),
                  así que el acceso vive aquí. El diálogo ya es responsive. */}
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setNearby(true);
                }}
                className="flex items-center gap-2 rounded-xl px-3 py-3 text-left font-medium text-paper"
              >
                <MapPin className="size-4" />
                Tiendas cerca de ti
              </button>

              {/* Instalar como app: solo se muestra si aún no se ve a pantalla
                  completa; al aceptar, el botón desaparece solo. */}
              {!pwa.installed ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    void pwa.promptInstall().then((r) => {
                      // iOS (y navegadores sin diálogo): tutorial del dominio.
                      if (r === "fallback") window.location.href = "/?install=1";
                    });
                  }}
                  className="flex items-center gap-2 rounded-xl px-3 py-3 text-left font-medium text-paper"
                >
                  <Smartphone className="size-4 text-ember" />
                  Añadir a la pantalla de inicio
                </button>
              ) : null}

              {br.session ? (
                <>
                  <Link
                    to="/cuenta"
                    className="rounded-xl px-3 py-3 font-medium text-paper"
                    onClick={() => setMenu(false)}
                  >
                    Tu cuenta y pedidos
                  </Link>
                  <Link
                    to="/mensajes"
                    className="rounded-xl px-3 py-3 font-medium text-paper"
                    onClick={() => setMenu(false)}
                  >
                    Mensajes
                  </Link>
                  <Link
                    to="/acceso"
                    className="rounded-xl px-3 py-3 text-left text-sm font-medium text-mist"
                    onClick={() => setMenu(false)}
                  >
                    Zonas de acceso
                  </Link>
                </>
              ) : (
                <Link
                  to="/acceso"
                  className="rounded-xl px-3 py-3 font-medium text-paper"
                  onClick={() => setMenu(false)}
                >
                  Zonas de acceso
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </header>

      {hero}

      <main
        className={cn("flex-1", !hero && "pt-28")}
        style={!hero && headerH ? { paddingTop: headerH + 12 } : undefined}
      >
        {children}
      </main>

      <footer className="mt-auto bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo inverted />
            <p className="mt-5 max-w-sm text-sm text-mist">{footer.tagline}</p>
            <p className="mt-4 text-xs uppercase tracking-[0.16em] text-paper/40">
              {footer.coverageLabel} {footerCities.join(" · ")}
            </p>
            <div className="mt-5 space-y-1.5 text-sm text-mist">
              <a href={`mailto:${contacto.supportEmail}`} className="block hover:text-ember">
                {contacto.supportEmail}
              </a>
              {contacto.phone ? (
                <a
                  href={`tel:${contacto.phone.replace(/[^0-9+]/g, "")}`}
                  className="block hover:text-ember"
                >
                  {contacto.phone}
                </a>
              ) : null}
              {contacto.hours ? <p className="text-xs text-paper/40">{contacto.hours}</p> : null}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/45">
              {footer.storeTitle}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {footer.storeLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to as never} className="hover:text-ember">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/45">
              {footer.legalTitle}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {footer.legalLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to as never} className="hover:text-ember">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li className="text-mist">{footer.legalNote}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-paper/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-paper/40">{footer.copyright}</p>
        </div>
      </footer>

      {ageOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-[1.75rem] bg-surface p-6 text-center shadow-lift sm:rounded-[1.75rem] sm:p-8">
            <Logo />
            <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">{age.title}</h2>
            <p className="mt-3 text-sm text-muted">{age.body}</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                onClick={() => {
                  br.setAgeVerified(true);
                  setAgeOpen(false);
                  // Si ya hay sesión de cliente, registramos la declaración en
                  // servidor (migración 0023); así el +18 no depende solo del
                  // navegador. Fire-and-forget: sin sesión o si falla, el pedido
                  // con alcohol volverá a pedir la confirmación.
                  if (br.session?.role === "user") void br.declareAdult().catch(() => undefined);
                }}
              >
                {age.ok}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  br.setAgeVerified(false);
                  setAgeOpen(false);
                }}
              >
                {age.no}
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted">
              {age.notePrefix}{" "}
              <Link to="/terminos" className="underline">
                {age.termsLink}
              </Link>{" "}
              y la{" "}
              <Link to="/privacidad" className="underline">
                {age.privacyLink}
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
              <h2 className="font-display text-xl font-semibold">{checkoutCopy.cartTitle}</h2>
              <button
                type="button"
                className="grid size-10 place-items-center rounded-full hover:bg-paper"
                onClick={() => setCartOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {br.cartItems.length === 0 ? (
                <p className="py-16 text-center text-muted">{checkoutCopy.empty}</p>
              ) : (
                <ul className="space-y-3">
                  {br.cartItems.map((item) => (
                    <li
                      key={item.id}
                      className="grid grid-cols-[64px_1fr_auto] gap-3 rounded-2xl bg-paper p-2"
                    >
                      <img
                        {...productImgProps(item.product.image)}
                        alt=""
                        className="media size-16 rounded-xl object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.product.name}</p>
                        <p className="text-xs text-muted">{fmtEur(item.product.price)}</p>
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-surface px-1 py-0.5 shadow-card">
                          <button
                            type="button"
                            className="grid size-9 place-items-center rounded-full hover:bg-paper"
                            aria-label={`Quitar una unidad de ${item.product.name}`}
                            onClick={() => br.setQty(item.id, item.qty - 1)}
                          >
                            <Minus className="size-4" />
                          </button>
                          <span className="min-w-6 text-center text-sm tabular-nums">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            className="grid size-9 place-items-center rounded-full hover:bg-paper"
                            aria-label={`Añadir una unidad de ${item.product.name}`}
                            onClick={() => br.setQty(item.id, item.qty + 1)}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-between gap-2 pr-1 pt-1">
                        <p className="text-sm font-semibold tabular-nums">{fmtEur(item.line)}</p>
                        {/* Borrado directo: hasta ahora había que darle al «−» tantas
                            veces como unidades, y en móvil parecía que el producto no
                            se quitaba nunca. */}
                        <button
                          type="button"
                          className="grid size-9 place-items-center rounded-full text-muted hover:bg-ember/10 hover:text-ember"
                          aria-label={`Eliminar ${item.product.name} de la cesta`}
                          title="Eliminar de la cesta"
                          onClick={() => br.setQty(item.id, 0)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-line/20 bg-paper p-5">
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full bg-bottle transition-[width] duration-300"
                  style={{
                    width: `${Math.min(100, Math.round((br.subtotal / FREE_SHIPPING) * 100))}%`,
                  }}
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
                {checkoutCopy.submit}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {checkout ? (
        <CheckoutDialog
          br={br}
          initialStore={preferredStore}
          onClose={() => setCheckout(false)}
          onDone={() => {
            setCheckout(false);
            setCartOpen(false);
          }}
        />
      ) : null}

      {nearby ? (
        <Suspense fallback={null}>
          <NearbyStoresDialog
            onClose={() => setNearby(false)}
            onPickStore={(s) => {
              setPreferredStore(s);
              setNearby(false);
              toast.success(`Prepararemos tu pedido en ${s.name}`);
            }}
          />
        </Suspense>
      ) : null}

      {support ? <SupportDialog onClose={() => setSupport(false)} /> : null}

      <CookieBanner />
    </div>
  );
}

/**
 * Aviso legal de cookies/almacenamiento local (LSSI-RGPD). Sale una sola vez por
 * navegador (se recuerda en `localStorage`), no bloquea la página y enlaza con
 * Privacidad. Botella Rápida solo usa almacenamiento técnico (cesta, +18, sesión
 * httpOnly), no cookies publicitarias: el texto lo dice claro.
 *
 * Se pinta solo tras montar (nunca en SSR) para no desalinearse en la hidratación.
 */
function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("br_cookie_ok")) setOpen(true);
    } catch {
      /* almacenamiento bloqueado: no insistir */
    }
  }, []);
  if (!open) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-2xl bg-surface p-4 text-center shadow-lift sm:flex-row sm:text-left">
        <p className="flex-1 text-xs text-muted">
          Usamos únicamente almacenamiento técnico (tu cesta, la declaración de mayoría de edad y la
          sesión) para que la tienda funcione. No empleamos cookies publicitarias. Puedes leer los
          detalles en{" "}
          <Link to="/privacidad" className="font-medium text-bottle underline">
            Política de Privacidad
          </Link>
          .
        </p>
        <Button
          size="sm"
          onClick={() => {
            try {
              localStorage.setItem("br_cookie_ok", String(Date.now()));
            } catch {
              /* si no persiste, al menos se cierra esta visita */
            }
            setOpen(false);
          }}
        >
          Aceptar
        </Button>
      </div>
    </div>
  );
}

function CheckoutDialog({
  br,
  onClose,
  onDone,
  initialStore,
}: {
  br: ReturnType<typeof useBr>;
  onClose: () => void;
  onDone: () => void;
  /** Tienda preseleccionada desde el mapa (si el cliente eligió una). */
  initialStore?: NearbyStore | null;
}) {
  const [pay, setPay] = useState<PaymentMethod>("tarjeta");
  // El método «online» solo es real si el servidor tiene la pasarela activa
  // (proveedor configurado o modo pruebas, 0029); sin ella, la selección cae en
  // «En mano» (pago al recibir), que es lo que el pedido era hoy aunque se
  // llamara «pagar».
  const cardLive = br.paymentsEnabled;
  // Nombre y pista del método online según lo que el admin tenga montado:
  // PayPal (nuestro cobro real), tarjeta con Stripe, o la pasarela de pruebas.
  const pStatus = br.paymentStatus;
  const onlineLabel = pStatus?.provider === "stripe" ? "Tarjeta" : "PayPal";
  const onlineHint = !cardLive
    ? "Muy pronto"
    : pStatus?.testMode
      ? "🧪 Modo pruebas: no se cobra nada"
      : pStatus?.provider === "stripe"
        ? "Visa / Mastercard"
        : "Con tu cuenta de PayPal";
  const chosenPay: PaymentMethod = pay === "tarjeta" && !cardLive ? "efectivo" : pay;
  const [slot, setSlot] = useState<DeliverySlot>("inmediata");
  // Fase 11 — días de reparto (los fija el admin en Panel → Ajustes). Si hoy
  // no toca, el pedido NO se bloquea: queda como RESERVA para el próximo día
  // de reparto. Aquí se muestra la fecha según el reloj del cliente (España);
  // el servidor recalcula el ancla en hora de Madrid, remapea la franja si
  // hace falta y guarda `scheduled_for`: manda él.
  const reparto = mergeSection(SITE_DEFAULTS.reparto, br.content.reparto as RepartoSection);
  const todayOk = isDeliveryDay(reparto.dias, new Date());
  const nextDeliv = todayOk ? null : nextDeliveryDate(reparto.dias, new Date());
  const isReserva = !todayOk && Boolean(nextDeliv);
  const resvLabel = nextDeliv ? fmtDeliveryDate(nextDeliv.getTime()) : "";
  useEffect(() => {
    // Lo «inmediato» no existe en un día sin reparto: se elige de día/madrugada.
    if (isReserva && slot === "inmediata") setSlot("programada_hoy");
  }, [isReserva, slot]);
  const slotCaption = isReserva
    ? slot === "programada_noche"
      ? `Reserva · madrugada del ${resvLabel}`
      : `Reserva · entrega el ${resvLabel}`
    : SLOT_LABEL[slot];
  const [tip, setTip] = useState(0);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // CP y tienda de origen: controlados, para listar las tiendas cercanas al CP.
  const [postal, setPostal] = useState(initialStore?.cp ?? "");
  const [storeId, setStoreId] = useState<string | null>(initialStore?.id ?? null);
  // Fase 10 — autocompletado de calles por CP: el campo pasa a controlado y
  // `picked` guarda las coordenadas EXACTAS de la sugerencia elegida. Así el
  // pedido ya no depende de una geocodificación a ciegas que a veces llevaba
  // al repartidor a una calle homónima de otra ciudad.
  const [addr, setAddr] = useState("");
  const [suggestions, setSuggestions] = useState<
    { street: string; full: string; lat: number; lng: number }[]
  >([]);
  const [picked, setPicked] = useState<{ street: string; lat: number; lng: number } | null>(null);
  // Cupón: la pre-visualización la valida el servidor (`br.checkCoupon`); al
  // confirmar viaja solo el código y el servidor recalcula el descuento real
  // contra el subtotal de catálogo. Si la cesta cambia, el cupón aplicado se
  // retira: la cifra vista no volvería a cuadrar y preferimos ser honestos.
  const [couponInput, setCouponInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  useEffect(() => {
    setApplied(null);
  }, [br.subtotal]);
  const shipping = br.subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
  // Madrugada: como en el servidor, el recargo lo dispara la FRANJA elegida.
  // Ya no es informativo: entra en el total real (el servidor lo recalcula).
  const night = slot === "programada_noche" ? NIGHT_SURCHARGE : 0;
  const discount = applied ? applied.discount : 0;
  const total = Math.max(0, br.subtotal - discount) + shipping + night + tip;
  const hasAlcohol = br.cartItems.some((i) => i.product.alcohol);

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) {
      setApplied(null);
      return;
    }
    setCouponBusy(true);
    try {
      const res = await br.checkCoupon(code, br.subtotal);
      if (res.ok) {
        setApplied({ code: res.code, discount: res.discount });
        toast.success(res.msg);
      } else {
        setApplied(null);
        toast.error(res.msg);
      }
    } catch (cause) {
      setApplied(null);
      toast.error((cause as Error)?.message || "No se pudo comprobar el código.");
    } finally {
      setCouponBusy(false);
    }
  }

  // Tiendas más cercanas al CP introducido (dentro de la zona de reparto).
  const storesHere = useMemo(
    () =>
      /^\d{5}$/.test(postal) && isWithinServiceArea(postal)
        ? nearestStores(coordsForCp(postal)).slice(0, 5)
        : [],
    [postal],
  );

  // Sugerencias de calle (Fase 10): 400 ms después de dejar de escribir, con
  // CP válido y mín. 3 caracteres. `br.addressSuggestions` es estable
  // (useCallback en use-br), el efecto no se re-dispara en cada render.
  useEffect(() => {
    const term = addr.trim();
    if (term.length < 3 || !/^\d{5}$/.test(postal) || !isWithinServiceArea(postal)) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      br.addressSuggestions(postal, term)
        .then((res) => {
          if (alive) setSuggestions(res);
        })
        .catch(() => {
          if (alive) setSuggestions([]);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [addr, postal, br.addressSuggestions]);
  // Sin elección manual, cae en la más cercana: así el pedido siempre tiene origen.
  const chosen = storesHere.find((s) => s.id === storeId) ?? storesHere[0] ?? null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!br.session) return;
    setErr("");
    // Validamos la zona antes de hablar con el servidor (el servidor vuelve a
    // comprobarlo: el formulario se puede manipular).
    const postalValue = postal.trim();
    if (!/^\d{5}$/.test(postalValue)) {
      setErr("Introduce un código postal de 5 dígitos.");
      return;
    }
    if (!isWithinServiceArea(postalValue)) {
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
        paymentMethod: chosenPay,
        deliverySlot: slot,
        address: addr.trim(),
        postalCode: postalValue,
        phone: String(fd.get("phone") || ""),
        notes: String(fd.get("notes") || ""),
        store: chosen ? { id: chosen.id } : undefined,
        // Coordenadas exactas SOLO si siguen siendo las de la calle elegida
        // (si el usuario escribió encima, `picked` queda descartado y el
        // servidor geocodifica el texto con el sesgo del CP). El servidor
        // rechaza además cualquier punto que caiga fuera de la zona del CP.
        destLat: picked && picked.street === addr.trim() ? picked.lat : null,
        destLng: picked && picked.street === addr.trim() ? picked.lng : null,
        // Solo viaja el código: el descuento lo recalcula el servidor.
        coupon: applied?.code,
        // Declaración +18 del gate: el servidor la registra en la cuenta y la
        // exige si la cesta lleva alcohol (el gate de pantalla no es un candado).
        ageConfirmed: br.ageOk,
      });
      br.clearCart();
      // Método online con pasarela viva: el pedido queda creado y se lanza el
      // pago (PayPal, Stripe o la pasarela de pruebas); el cobro se confirma al
      // volver a /gracias.
      if (chosenPay === "tarjeta" && cardLive) {
        const { url } = await br.payByCard({ id: order.id });
        window.location.href = url;
        return;
      }
      setOk(order.code);
    } catch (cause) {
      const msg = (cause as Error)?.message || "No se pudo confirmar el pedido.";
      setErr(msg);
      // Si el servidor rechaza por la edad (p. ej. cambió el flag +18 a mitad),
      // reabrimos el gate para que pueda confirmar y reintentar.
      if (/mayor de 18|edad/i.test(msg) && !br.ageOk) {
        window.dispatchEvent(new Event("br-need-age"));
      }
    } finally {
      setBusy(false);
    }
  }

  const pays: { id: PaymentMethod; label: string; hint: string; icon: typeof CreditCard }[] = [
    {
      id: "tarjeta",
      label: onlineLabel,
      hint: onlineHint,
      icon: CreditCard,
    },
    { id: "bizum", label: "Bizum", hint: "Pago móvil", icon: Smartphone },
    { id: "apple_google_pay", label: "Pay", hint: "Apple / Google", icon: Wallet },
    { id: "efectivo", label: "En mano", hint: "Efectivo o TPV", icon: Truck },
  ];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] bg-surface p-6 shadow-lift sm:max-h-[92dvh] sm:rounded-[1.75rem]">
        {ok ? (
          <div className="py-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bottle">
              Pedido confirmado
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold">{ok}</h2>
            <p className="mt-3 text-sm text-muted">
              Guarda el código. El admin lo delega y el repartidor lo lleva a tu puerta.
            </p>
            {chosen ? (
              <p className="mt-1 text-sm text-muted">
                Origen: <strong className="text-ink">{chosen.name}</strong>
              </p>
            ) : null}
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
                  {fmtEur(total)} · {slotCaption}
                </p>
              </div>
              <button
                type="button"
                className="grid size-10 place-items-center rounded-full hover:bg-paper"
                onClick={onClose}
              >
                <X className="size-5" />
              </button>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Entrega
              </legend>
              {isReserva ? (
                <p className="rounded-2xl bg-bottle/10 px-4 py-3 text-sm">
                  📅 <strong>Hoy no hay reparto.</strong> Tu pedido queda{" "}
                  <strong>reservado para el {resvLabel}</strong>: el repartidor lo verá así en su
                  portal.
                </p>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Dirección</span>
                <div className="relative">
                  <input
                    name="address"
                    value={addr}
                    onChange={(e) => {
                      setAddr(e.target.value);
                      // Al escribir se abandona la elección exacta: las
                      // sugerencias vuelven por debounce.
                      setPicked(null);
                    }}
                    placeholder="Carrer de Maragall 20, 2n 1a"
                    required
                    className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card placeholder:text-muted"
                  />
                  {suggestions.length ? (
                    <ul
                      role="listbox"
                      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-2xl bg-surface p-1 shadow-lift"
                    >
                      {suggestions.map((s) => (
                        <li key={`${s.lat},${s.lng}`}>
                          <button
                            type="button"
                            title={s.full}
                            onClick={() => {
                              setAddr(s.street);
                              setPicked({ street: s.street, lat: s.lat, lng: s.lng });
                              setSuggestions([]);
                            }}
                            className="w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-colors hover:bg-paper"
                          >
                            <span className="block text-xs font-semibold text-ink">{s.street}</span>
                            <span className="block truncate text-[0.65rem] text-muted">
                              {s.full}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {picked && picked.street === addr.trim() ? (
                  <p className="mt-1 text-[0.7rem] font-medium text-bottle">
                    ✓ Calle elegida dentro del CP {postal}: el repartidor irá justo aquí.
                  </p>
                ) : null}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Código postal</span>
                <input
                  name="postalCode"
                  inputMode="numeric"
                  value={postal}
                  onChange={(e) => {
                    setPostal(e.target.value.replace(/\D/g, "").slice(0, 5));
                    setStoreId(null);
                    // Otro CP: las coordenadas elegidas ya no valen (Fase 10).
                    setPicked(null);
                    setSuggestions([]);
                  }}
                  placeholder="08911"
                  required
                  className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card placeholder:text-muted"
                />
              </label>
              <p className="text-xs text-muted">
                De momento solo repartimos en {SERVICE_AREA_LABEL}.
              </p>
              {storesHere.length ? (
                <div>
                  <span className="mb-1.5 block text-sm font-medium">Tienda de origen</span>
                  <div className="space-y-1.5">
                    {storesHere.map((s) => {
                      const active = chosen?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStoreId(s.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left shadow-card",
                            active ? "bg-ink text-paper" : "bg-paper",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{s.name}</span>
                            <span
                              className={cn(
                                "block truncate text-xs",
                                active ? "text-paper/70" : "text-muted",
                              )}
                            >
                              {s.town} · {s.distanceKm.toFixed(1)} km
                            </span>
                          </span>
                          {active ? (
                            <span className="shrink-0 text-xs font-semibold">Elegida</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="phone" label="Teléfono" placeholder="600 000 000" required />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    {isReserva ? "Entrega (reserva)" : "Franja"}
                  </span>
                  <select
                    value={slot}
                    onChange={(e) => setSlot(e.target.value as DeliverySlot)}
                    className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
                  >
                    {isReserva ? (
                      <>
                        <option value="programada_hoy">{resvLabel} · de día</option>
                        <option value="programada_noche">
                          {resvLabel} · madrugada (+{NIGHT_SURCHARGE} €)
                        </option>
                      </>
                    ) : (
                      Object.entries(SLOT_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))
                    )}
                  </select>
                  <span className="mt-1 block text-xs text-muted">
                    {isReserva
                      ? `Repartimos ${deliveryDaysLabel(reparto.dias)}: hoy queda reservado.`
                      : reparto.dias.length > 0 && reparto.dias.length < 7
                        ? `Repartimos ${deliveryDaysLabel(reparto.dias)}.`
                        : "Reparto 24 h, todos los días."}
                  </span>
                </label>
              </div>
              <Field
                name="notes"
                label="Indicaciones (opcional)"
                placeholder="Portal, telefonillo…"
              />
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Pago
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {pays.map((p) => {
                  const off = p.id === "tarjeta" && !cardLive;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={off}
                      onClick={() => setPay(p.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-2xl px-3 py-3 text-left shadow-card",
                        off && "cursor-not-allowed opacity-50",
                        chosenPay === p.id ? "bg-ink text-paper" : "bg-paper",
                      )}
                    >
                      <p.icon className="size-4 shrink-0" />
                      <span>
                        <span className="block text-sm font-medium">{p.label}</span>
                        <span
                          className={cn(
                            "text-xs",
                            chosenPay === p.id ? "text-paper/70" : "text-muted",
                          )}
                        >
                          {p.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Descuentos
              </legend>
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Código (p. ej. BIENVENIDO10)"
                  className="h-11 min-w-0 flex-1 rounded-2xl bg-paper px-3 text-sm uppercase outline-none shadow-card placeholder:normal-case placeholder:text-muted"
                />
                <Button type="button" variant="bottle" onClick={applyCoupon} disabled={couponBusy}>
                  {couponBusy ? "Comprobando…" : "Aplicar"}
                </Button>
              </div>
              {applied ? (
                <p className="mt-2 text-xs font-medium text-bottle">
                  Cupón <strong>{applied.code}</strong> activo · −{fmtEur(applied.discount)}
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      setApplied(null);
                      setCouponInput("");
                    }}
                  >
                    Quitar
                  </button>
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Un solo cupón por pedido · no acumulable con otros descuentos.
                </p>
              )}
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Propina repartidor
              </legend>
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
              <p className="mt-2 text-xs text-muted">
                <span className="font-semibold text-ink">Madrugada +{NIGHT_SURCHARGE} €</span> · se
                suma al total si eliges la franja 23:00–07:00.
              </p>
            </fieldset>
            <div className="space-y-1 rounded-2xl bg-paper p-4 text-sm">
              <Row k="Productos" v={fmtEur(br.subtotal)} />
              {applied ? (
                <Row k={`Cupón ${applied.code}`} v={`−${fmtEur(applied.discount)}`} />
              ) : null}
              <Row k="Envío" v={shipping === 0 ? "Gratis" : fmtEur(shipping)} />
              {night > 0 ? <Row k="Madrugada (23–07)" v={fmtEur(night)} /> : null}
              <Row k="Propina" v={fmtEur(tip)} />
              <Row k="Total" v={fmtEur(total)} strong />
              {/* Regalos por comprar (migración 0028): ticket de ruleta con
                  pedidos de más de 10 € (lo decide el servidor al ENTREGAR, no
                  aquí: si se cancela, el ticket nunca llega) y chapas ≈ 1 por
                  cada 12 € gastados. Informativo, nunca un cobro. */}
              {br.raffle?.config.enabled ? (
                total > (br.raffle.config.ticketMinEuro ?? 10) ? (
                  <p className="mt-1.5 flex items-center gap-1.5 rounded-xl bg-bottle/10 px-3 py-2 text-xs font-semibold text-bottle">
                    🎡 +1 ticket de la Ruleta BR al entregar este pedido
                  </p>
                ) : (
                  <p className="mt-1.5 px-1 text-[11px] text-muted">
                    Con más de{" "}
                    {(br.raffle.config.ticketMinEuro ?? 10).toFixed(2).replace(/\.00$/, "")} € tu
                    pedido entregado suma 🎡 1 ticket de la Ruleta BR
                  </p>
                )
              ) : null}
              {br.chapa?.config.enabled && br.chapa.config.eurosPerChapa > 0 ? (
                <p className="px-1 text-[11px] text-muted">
                  🪙 Te llevarás ≈ {Math.floor(total / br.chapa.config.eurosPerChapa)} chapas (1 por
                  cada {br.chapa.config.eurosPerChapa} € · 100 chapas = 12 € en regalos)
                </p>
              ) : null}
            </div>
            {hasAlcohol ? (
              <p className="rounded-2xl bg-adult/8 px-4 py-3 text-sm text-adult">
                Hay alcohol en el pedido. El repartidor verificará el DNI en la entrega.
              </p>
            ) : null}
            {err ? <p className="text-sm text-ember">{err}</p> : null}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy
                ? "Confirmando…"
                : chosenPay === "tarjeta" && cardLive
                  ? `Pagar con ${onlineLabel}`
                  : "Confirmar pedido"}
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
  kicker,
}: {
  products: Product[];
  title?: string;
  lead?: string;
  kicker?: string;
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">
            {kicker ?? SITE_DEFAULTS["home.nevera"].kicker}
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
            {title}
          </h2>
          {lead ? <p className="mt-2 text-mist">{lead}</p> : null}
        </div>
      ) : null}
      <ProductGrid products={visible} onAdd={add} />
    </section>
  );
}

export function PasilloTiles({ ageOk }: { ageOk: boolean }) {
  const br = useBr();
  const cats = mergeSection(SITE_DEFAULTS.categories, br.content.categories as CategoriesSection);
  const ids = (Object.keys(CATEGORIES) as CategoryId[]).filter((c) => c !== "alcohol" || ageOk);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      {ids.map((id) => {
        const c = cats[id];
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

/** Importes rápidos del diálogo de apoyo (el cliente también puede escribir otro). */
const SUPPORT_PRESETS = [2, 5, 10, 25];

/**
 * Diálogo «Apóyanos»: donación voluntaria de 1 a 999 €.
 * Es un gesto de agradecimiento QUEDAMENTE REGISTRADO para la tienda: no se
 * cobra nada al enviar (la pasarela real depende de Stripe, aún no activada),
 * así que el diálogo lo dice con todas las letras — nada de sorpresas.
 */
function SupportDialog({ onClose }: { onClose: () => void }) {
  const br = useBr();
  const [amount, setAmount] = useState(5);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);

  const valid = amount >= 1 && amount <= 999;

  async function submit() {
    if (!valid) {
      toast.error("El importe debe estar entre 1 y 999 €.");
      return;
    }
    setBusy(true);
    try {
      await br.donate({ amount, message: message.trim() || undefined });
      setThanks(true);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo registrar el apoyo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end overflow-y-auto bg-night/70 p-0 sm:place-items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-[1.75rem] bg-surface p-6 shadow-lift sm:rounded-[1.75rem]">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-ember">
              <Heart className="size-3.5 fill-ember" /> Apóyanos
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              {thanks ? "¡Gracias de corazón!" : "Un guiño para el proyecto"}
            </h2>
          </div>
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full hover:bg-paper"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        {thanks ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">
              Tu apoyo de <strong className="text-ink">{fmtEur(amount)}</strong> queda registrado.
              Cuando activemos el cobro online podrás formalizarlo; por ahora, saber que cuentas con
              nosotros ya es muchísimo.
            </p>
            <Button className="w-full" onClick={onClose}>
              Seguir comprando
            </Button>
          </div>
        ) : br.session?.role !== "user" && br.session?.role !== "admin" ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">
              Para registrar tu apoyo necesitas entrar en tu cuenta: así sabemos de quién es el
              guiño y podemos agradecértelo como toca.
            </p>
            <Button asChild className="w-full">
              <Link to="/acceso" onClick={onClose}>
                Entrar en mi cuenta
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {SUPPORT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={cn(
                    "h-11 flex-1 rounded-2xl text-sm font-semibold tabular-nums shadow-card transition",
                    amount === p ? "bg-ink text-paper" : "bg-paper hover:bg-line",
                  )}
                >
                  {p} €
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                O escribe un importe (1–999 €)
              </span>
              <input
                type="number"
                min={1}
                max={999}
                step={1}
                value={amount}
                onChange={(e) =>
                  setAmount(Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0))))
                }
                className="h-11 w-full rounded-2xl bg-paper px-3 text-sm tabular-nums outline-none shadow-card"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Mensaje (opcional)</span>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                placeholder="¡Ánimo con el proyecto!"
                className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card placeholder:text-muted"
              />
            </label>
            <p className="text-xs text-muted">
              No se cobra nada al enviar: tu apoyo queda registrado y la tienda lo ve en su panel.
              El cobro online llegará con la pasarela de pago.
            </p>
            <Button className="w-full" disabled={busy || !valid} onClick={() => void submit()}>
              {busy ? "Registrando…" : `Donar ${fmtEur(amount)}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Cabecera con desbordamiento ─────────────────── */

// Efecto de medición que NO avisa en servidor (evita el warning de
// useLayoutEffect durante el SSR de TanStack Start, sin sacrificar el primer
// pintado: en cliente mide antes de repintar, así no se ve nunca la fila ancha.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type NavEntry = {
  key: string;
  label: string;
  // "text" = enlace de navegación plano; "pill" = botón pastilla con icono.
  kind: "text" | "pill";
  to?: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  title?: string;
  active?: boolean;
  /** true = nunca entra en «Más ▾»: se queda en la barra aunque falte sitio. */
  pinned?: boolean;
  /** true = vive SIEMPRE dentro de «Más ▾»: no ocupa sitio en la barra. */
  menuOnly?: boolean;
};

/**
 * Tira de enlaces/botones de la cabecera que, cuando no cabe todo en una sola
 * fila, mete los que sobresobran en un desplegable «Más ▾» (la flechita a la
 * derecha). Mide el ancho disponible y decide cuántos entrar inline; el resto
 * pasan al menú. Nunca parte la barra en dos filas ni aplasta el buscador.
 */
function NavOverflow({ entries, className }: { entries: NavEntry[]; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  // Claves de las entradas que NO caben (las `pinned` nunca entran aquí).
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);

  // gap-4 (16px) entre elementos inline y el botón «Más»; se corresponde con el
  // `gap-4` que pone quien usa el componente.
  const GAP = 16;
  const MORE_W = 78; // reserva para el propio «Más ▾»

  const measure = useCallback(() => {
    const root = rootRef.current;
    const mirror = mirrorRef.current;
    if (!root || !mirror) return;
    const kids = Array.from(mirror.children) as HTMLElement[];
    if (!kids.length) return;
    const widths = kids.map((k) => k.offsetWidth);
    const avail = root.clientWidth;
    // Las `menuOnly` nunca van inline: no suman ancho ni compiten por él.
    const inlineIdx = entries.map((e, i) => (e.menuOnly ? -1 : i)).filter((i) => i >= 0);
    const total = inlineIdx.reduce((a, i, k) => a + widths[i] + (k > 0 ? GAP : 0), 0);
    if (total <= avail) {
      setHiddenKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    // Las fijadas pagan primero su sitio; con lo que queda compiten las demas,
    // en orden. Si aun asi algo no cabe, va al «Más» (que tambien descuenta).
    const anyPinned = inlineIdx.some((i) => entries[i].pinned);
    const pinnedW = inlineIdx.reduce(
      (sum, i) => sum + (entries[i].pinned ? widths[i] + GAP : 0),
      0,
    );
    let used = Math.max(0, pinnedW - (anyPinned ? GAP : 0)) + MORE_W;
    const next = new Set<string>();
    entries.forEach((e, i) => {
      if (e.pinned || e.menuOnly) return;
      const add = widths[i] + GAP;
      if (used + add <= avail) used += add;
      else next.add(e.key);
    });
    setHiddenKeys((prev) => {
      if (prev.size === next.size && [...next].every((k) => prev.has(k))) return prev;
      return next;
    });
  }, [entries]);

  // entries cambia (login/logout): remedir.
  useIsoLayoutEffect(() => {
    measure();
  }, [entries, measure]);

  // Redimensionar la ventana: remedir (las etiquetas fijas ya no caben igual).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === "undefined") return;
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(onResize);
      ro.observe(el);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [measure]);

  // Si vuelve el sitio suficiente, se cierra solo el desplegable.
  useEffect(() => {
    if (hiddenKeys.size === 0) setOpen(false);
  }, [hiddenKeys]);

  // Cerrar al hacer clic fuera o pulsar Escape.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const renderItem = (e: NavEntry, onFire?: () => void) => {
    const cls =
      e.kind === "text"
        ? cn(
            "shrink-0 cursor-pointer whitespace-nowrap text-sm font-medium transition-[color,transform] duration-150 hover:text-paper active:scale-95",
            e.active ? "text-paper" : "text-paper/75",
          )
        : "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-paper/10 active:scale-95";
    const inner =
      e.kind === "pill" ? (
        <>
          {e.icon}
          <span className="max-w-[9rem] truncate">{e.label}</span>
        </>
      ) : (
        e.label
      );
    if (e.to) {
      return (
        <Link key={e.key} to={e.to as never} title={e.title} className={cls} onClick={onFire}>
          {inner}
        </Link>
      );
    }
    if (e.href) {
      return (
        <a key={e.key} href={e.href} title={e.title} className={cls} onClick={onFire}>
          {inner}
        </a>
      );
    }
    return (
      <button
        key={e.key}
        type="button"
        title={e.title}
        className={cls}
        onClick={
          onFire
            ? () => {
                e.onClick?.();
                onFire();
              }
            : e.onClick
        }
      >
        {inner}
      </button>
    );
  };

  const shown = entries.filter((e) => !e.menuOnly && !hiddenKeys.has(e.key));
  const hidden = entries.filter((e) => e.menuOnly || hiddenKeys.has(e.key));

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {shown.map((e) => renderItem(e))}

      {hidden.length > 0 ? (
        <div ref={moreRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-paper/10 active:scale-95"
          >
            Más
            <ChevronDown
              className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
            />
          </button>
          {open ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+10px)] z-50 min-w-56 origin-top-right animate-[pop_.16s_ease-out] overflow-hidden rounded-2xl bg-surface py-1.5 shadow-lift"
            >
              {hidden.map((e) => {
                const rowCls = cn(
                  "flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-paper hover:text-ink active:bg-paper",
                  // La página en la que ya estás se marca un punto más fuerte.
                  e.active ? "text-ink" : "text-ink/80",
                );
                const onNav = () => setOpen(false);
                if (e.to) {
                  return (
                    <Link
                      key={e.key}
                      to={e.to as never}
                      title={e.title}
                      className={rowCls}
                      onClick={onNav}
                    >
                      {e.icon}
                      {e.label}
                    </Link>
                  );
                }
                if (e.href) {
                  return (
                    <a key={e.key} href={e.href} title={e.title} className={rowCls} onClick={onNav}>
                      {e.icon}
                      {e.label}
                    </a>
                  );
                }
                return (
                  <button
                    key={e.key}
                    type="button"
                    title={e.title}
                    className={rowCls}
                    onClick={() => {
                      e.onClick?.();
                      onNav();
                    }}
                  >
                    {e.icon}
                    {e.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Capa oculta de medición: reproduce TODOS los elementos para conocer su
          ancho natural; el componente decide cuántos caben y cuáles van al «Más». */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 -z-50 flex flex-nowrap items-center gap-4 opacity-0"
      >
        {entries.map((e) => renderItem(e))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ campanita */

/** Icono por tipo de notificación (migración 0030): da color a cada fila. */
const NOTIF_ICON: Record<string, string> = {
  premio: "🎁",
  chapa: "🪙",
  mensaje: "💬",
  pedido: "🛵",
  afiliado: "🤝",
  info: "ℹ️",
};

/**
 * Campanita de la cabecera: acumula premios, chapas, mensajes, pedidos e
 * invitaciones de la cuenta con sesión. Cada aviso lleva su enlace interno
 * (un mensaje abre la conversación del pedido, un premio va al sorteo…). El
 * listado lo sirve `br.notifications` (sondeo de 30 s en `useBr`).
 */
function NotificationBell({ br }: { br: ReturnType<typeof useBr> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const unread = br.notificationsUnread;
  const items = br.notifications;

  // Cierre al clicar fuera, igual que el desplegable «Más» de la navegación.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const time = (ts: number) => {
    const d = new Date(ts);
    if (d.toDateString() === new Date().toDateString())
      return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    return fmtDate(ts);
  };

  // Abrir el aviso: marca leída la fila y navega a su enlace (/mensajes?order=…,
  // /sorteo, /cuenta…). Sin enlace, solo la marca como vista.
  const go = (link: string | null, id: string) => {
    setOpen(false);
    void br.markNotificationsRead({ id }).catch(() => undefined);
    if (!link) return;
    const [path, qs] = link.split("?");
    const search = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
    void navigate({ to: path as never, search: search as never }).catch(() => undefined);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : "Notificaciones"}
        title="Notificaciones"
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-mist transition-[background-color,color,transform] duration-150 hover:bg-paper/10 hover:text-paper active:scale-90"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-ember px-1 text-[0.6rem] font-semibold tabular-nums text-night">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(20rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] origin-top-right animate-[pop_.16s_ease-out] overflow-hidden rounded-2xl bg-surface shadow-lift"
        >
          <div className="flex items-center justify-between border-b border-line/30 px-3.5 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Notificaciones
            </p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void br.markNotificationsRead().catch(() => undefined)}
                className="text-xs font-medium text-bottle hover:underline"
              >
                Marcar leídas
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Todo tranquilo por aquí. Cuando ganes un premio o te escriban, aparecerá aquí mismo.
              </p>
            ) : (
              <ul className="divide-y divide-line/20">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => go(n.link, n.id)}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-paper",
                        !n.readAt && "bg-ember/5",
                      )}
                    >
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-paper text-xs">
                        {NOTIF_ICON[n.kind] ?? "ℹ️"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-[0.82rem] font-medium leading-snug text-ink">
                          {n.title}
                        </span>
                        {n.body ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                            {n.body}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[0.65rem] uppercase tracking-wide text-muted/80">
                          {time(n.createdAt)}
                          {n.link ? " · tocar para abrir" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {br.session?.role === "user" ? (
            <div className="border-t border-line/30 px-3.5 py-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/mensajes" }).catch(() => undefined);
                }}
                className="text-xs font-medium text-bottle hover:underline"
              >
                Ir al chat de tus pedidos
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
