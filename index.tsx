import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Clock, MapPin, Navigation, Snowflake, Star, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { CityMarquee, HeroCarousel } from "@/components/layout/hero-carousel";
import { CatalogBlock, PasilloTiles, StoreShell } from "@/components/layout/store-shell";
import {
  HOME_SECTION_IDS,
  mergeSection,
  SITE_DEFAULTS,
  type BuzonSection,
  type CasaSection,
  type CoberturaSection,
  type ComoSection,
  type HomeOrderSection,
  type HomeSectionId,
  type IconKey,
  type NeveraSection,
  type PasillosSection,
  type TestimoniosSection,
} from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";
import { STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/data/types";

export const Route = createFileRoute("/")({ component: Home });

const STEP_ICONS: Record<IconKey, LucideIcon> = { clock: Clock, snow: Snowflake, pin: MapPin };

function Home() {
  const br = useBr();
  // Bloque «Nevera»: las ofertas van PRIMERO, pero el hueco se rellena siempre
  // hasta 8 productos. Antes, en cuanto existía una sola oferta, `featured`
  // tenía 1 elemento y el bloque dejaba de mostrar el resto del catálogo.
  const ofertas = br.products.filter((p) => p.oferta || p.id === "set-rayo-demo");
  const featured = [
    ...ofertas,
    ...br.products.filter((p) => !ofertas.includes(p)),
  ].slice(0, 8);

  // Cada sección = default de hoy mezclado con el override del admin si existe.
  const pasillos = mergeSection(SITE_DEFAULTS["home.pasillos"], br.content["home.pasillos"] as PasillosSection);
  const nevera = mergeSection(SITE_DEFAULTS["home.nevera"], br.content["home.nevera"] as NeveraSection);
  const casa = mergeSection(SITE_DEFAULTS["home.casa"], br.content["home.casa"] as CasaSection);
  const como = mergeSection(SITE_DEFAULTS["home.como"], br.content["home.como"] as ComoSection);
  const testimonios = mergeSection(
    SITE_DEFAULTS["home.testimonios"],
    br.content["home.testimonios"] as TestimoniosSection,
  );
  const cobertura = mergeSection(
    SITE_DEFAULTS["home.cobertura"],
    br.content["home.cobertura"] as CoberturaSection,
  );
  const buzon = mergeSection(SITE_DEFAULTS["home.buzon"], br.content["home.buzon"] as BuzonSection);

  // Listas: si el admin las deja vacías, se cae al default para no pintar huecos.
  const steps = como.steps.length ? como.steps : SITE_DEFAULTS["home.como"].steps;
  const tItems = testimonios.items.length
    ? testimonios.items
    : SITE_DEFAULTS["home.testimonios"].items;
  const cities = cobertura.cities.length
    ? cobertura.cities
    : SITE_DEFAULTS["home.cobertura"].cities;

  // Orden de las secciones de la portada: decide el override que guarda el
  // admin («Inicio · orden»). Se filtran ids válidas, se eliminan duplicados y
  // se rellenan las que faltarán: pase lo que pase, las 7 secciones pintan
  // siempre exactamente una vez. Sin override = el orden de siempre.
  const orderSec = mergeSection(
    SITE_DEFAULTS["home.order"],
    br.content["home.order"] as HomeOrderSection,
  );
  const listed = [
    ...new Set(orderSec.sections.filter((s) => (HOME_SECTION_IDS as readonly string[]).includes(s))),
  ];
  const order: HomeSectionId[] = [...listed, ...HOME_SECTION_IDS.filter((s) => !listed.includes(s))];

  // Mini-player de seguimiento: si el cliente logueado tiene un pedido en juego
  // (aceptado o en ruta), la portada se convierte en su pantalla de estado sin
  // que tenga que buscar el código. La lista de pedidos ya se sondea cada 15 s,
  // así que el estado aquí es casi en directo sin peticiones extra.
  const activeOrder =
    br.orders
      .filter(
        (o) =>
          o.customer === br.session?.email &&
          (o.status === "asignado" || o.status === "en_reparto"),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  // El JSX de cada sección vive idéntico a como estaba; solo cambia QUE se
  // pinta en el orden elegido (antes el orden estaba fijado por el código).
  const nodes: Record<HomeSectionId, ReactNode> = {
    nevera: (
      <CatalogBlock
        products={featured}
        kicker={nevera.kicker}
        title={nevera.title}
        lead={nevera.lead}
      />
    ),
    pasillos: (
      <section id="pasillos" className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">{pasillos.kicker}</p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
              {pasillos.title}
            </h2>
          </div>
          <Link to="/catalogo" className="hidden text-sm font-medium text-mist hover:text-paper sm:inline">
            {pasillos.linkLabel}
          </Link>
        </div>
        <PasilloTiles ageOk={br.ageOk} />
      </section>
    ),
    casa: (
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={casa.imgBg} alt="" className="size-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/40" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">{casa.kicker}</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
              {casa.title}
            </h2>
            <p className="mt-5 max-w-md text-mist">{casa.body}</p>
            <Button asChild size="lg" className="mt-8">
              <Link to="/catalogo" search={{ cat: "basicos" }}>
                {casa.ctaLabel}
                <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <img src={casa.img1} alt="" className="media aspect-[3/4] rounded-[1.5rem] object-cover" />
            <img
              src={casa.img2}
              alt=""
              className="media mt-8 aspect-[3/4] rounded-[1.5rem] object-cover"
            />
          </div>
        </div>
      </section>
    ),
    como: (
      <section id="como-funciona" className="bg-ink">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">{como.kicker}</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
            {como.title}
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => {
              const Icon = STEP_ICONS[s.iconKey] ?? Clock;
              return (
                <div key={`${s.t}-${i}`} className="overflow-hidden rounded-[1.5rem] bg-night shadow-card">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img src={s.img} alt="" className="size-full object-cover" />
                  </div>
                  <div className="p-6">
                    <Icon className="size-5 text-ember" />
                    <h3 className="mt-4 font-display text-2xl font-semibold text-paper">{s.t}</h3>
                    <p className="mt-2 text-sm text-mist">{s.d}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    ),
    testimonios: (
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="overflow-hidden rounded-[1.75rem] lg:col-span-2">
            <img src={testimonios.heroImg} alt="" className="media aspect-[16/9] w-full object-cover lg:aspect-[2/1]" />
          </div>
          <blockquote className="flex flex-col justify-end rounded-[1.75rem] bg-ember p-8 text-paper">
            <p className="font-display text-2xl font-semibold leading-snug">{testimonios.heroQuote}</p>
            <footer className="mt-6 text-sm text-paper/80">{testimonios.heroWho}</footer>
          </blockquote>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {tItems.map((t, i) => (
            <figure key={`${t.who}-${i}`} className="rounded-[1.5rem] bg-ink p-6">
              <blockquote className="text-sm text-paper">{t.q}</blockquote>
              <figcaption className="mt-4 text-xs uppercase tracking-[0.14em] text-mist">{t.who}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    ),
    cobertura: (
      <section className="border-y border-paper/10 bg-ink">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">{cobertura.kicker}</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-paper">{cobertura.title}</h2>
          <p className="mt-3 max-w-xl text-mist">{cobertura.body}</p>
          <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {cities.map((city, i) => (
              <li
                key={`${city}-${i}`}
                className="rounded-2xl bg-night px-4 py-3 text-sm font-medium text-paper shadow-[0_0_0_1px_rgba(239,228,208,0.08)]"
              >
                {city}
              </li>
            ))}
          </ul>
        </div>
      </section>
    ),
    buzon: (
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="overflow-hidden rounded-[2rem] bg-ember px-6 py-12 text-paper sm:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/70">{buzon.kicker}</p>
          <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{buzon.title}</h2>
          <p className="mt-2 max-w-lg text-paper/85">{buzon.body}</p>
          <form
            className="mt-6 flex max-w-md flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              (e.currentTarget.elements.namedItem("email") as HTMLInputElement).value = "";
            }}
          >
            <input
              name="email"
              type="email"
              required
              placeholder={buzon.placeholder}
              className="h-12 flex-1 rounded-full bg-paper px-5 text-ink outline-none placeholder:text-muted"
              suppressHydrationWarning
            />
            <Button type="submit" variant="ink" size="lg">
              {buzon.ctaLabel}
            </Button>
          </form>
        </div>
      </section>
    ),
  };

  return (
    <StoreShell hero={<HeroCarousel />}>
      {activeOrder ? (
        <section className="mx-auto max-w-6xl px-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] bg-ink px-5 py-4 shadow-card">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ember/15">
                <Navigation className="size-5 text-ember" />
              </span>
              <div>
                <p className="text-sm font-semibold text-paper">
                  Tu pedido {activeOrder.code} · {STATUS_LABEL[activeOrder.status as OrderStatus]}
                </p>
                <p className="text-xs text-mist">Sigue la ruta del repartidor en directo.</p>
              </div>
            </div>
            <Button asChild size="md" className="shrink-0">
              <Link to="/seguimiento/$code" params={{ code: activeOrder.code }}>
                Ver en el mapa
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      ) : null}
      <CityMarquee />
      {order.map((id) => (
        <Fragment key={id}>{nodes[id]}</Fragment>
      ))}
      <PublishedReviews />
    </StoreShell>
  );
}

/**
 * Vitrina de reseñas: desplegable al final de la portada (título «Reseñas» con
 * flechita). Solo muestra las reseñas que el admin ha PUBLICADO: foto del
 * cliente si la compartió, comentario y barra de estrellas. Si no hay ninguna
 * publicada, el bloque no aparece (nada de huecos vacíos ni textos de prueba).
 */
function PublishedReviews() {
  const br = useBr();
  const [open, setOpen] = useState(false);
  const items = br.reviews;
  if (items.length === 0) return null;
  const avg = items.reduce((s, r) => s + r.stars, 0) / items.length;
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16">
      <div className="overflow-hidden rounded-[1.75rem] bg-ink shadow-card">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left transition hover:bg-night"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-ember">
              Lo que dice la clientela
            </span>
            <span className="mt-1 flex items-center gap-2">
              <span className="font-display text-2xl font-semibold text-paper">Reseñas</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-night px-2.5 py-1 text-xs font-semibold tabular-nums text-paper">
                <Star className="size-3.5 fill-[#e0a458] text-[#e0a458]" />
                {avg.toFixed(1)} · {items.length}
              </span>
            </span>
          </span>
          <ChevronDown
            className={cnSize(open)}
            aria-hidden
          />
        </button>
        {open ? (
          <ul className="grid gap-3 border-t border-paper/10 px-6 py-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => (
              <li key={r.id} className="rounded-2xl bg-night p-4">
                {r.image ? (
                  <img
                    src={r.image}
                    alt={`Foto de la reseña de ${r.customerName}`}
                    loading="lazy"
                    className="mb-3 aspect-[4/3] w-full rounded-xl object-cover"
                  />
                ) : null}
                {/* Barra de satisfacción: estrellas llenas hasta su nota. */}
                <div className="flex items-center gap-0.5" role="img" aria-label={`${r.stars} de 5 estrellas`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={
                        n <= r.stars
                          ? "size-3.5 fill-[#e0a458] text-[#e0a458]"
                          : "size-3.5 text-paper/25"
                      }
                    />
                  ))}
                </div>
                {r.text ? <p className="mt-2 text-sm text-paper">{r.text}</p> : null}
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-mist">
                  {r.customerName} · {r.orderCode}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Flecha del desplegable: gira 180° al abrir, igual que un acordeón clásico. */
function cnSize(open: boolean) {
  return `size-5 shrink-0 text-mist transition-transform duration-200 ${open ? "rotate-180" : ""}`;
}
