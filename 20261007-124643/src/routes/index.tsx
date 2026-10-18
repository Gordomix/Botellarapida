import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, MapPin, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CityMarquee, HeroCarousel } from "@/components/layout/hero-carousel";
import { CatalogBlock, PasilloTiles, StoreShell } from "@/components/layout/store-shell";
import { CITIES } from "@/data/hero";
import { SERVICE_AREA_LABEL } from "@/data/service-area";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const br = useBr();
  const featured = br.products.filter((p) => p.oferta || p.id === "set-rayo-demo");

  return (
    <StoreShell hero={<HeroCarousel />}>
      <CityMarquee />

      <section id="pasillos" className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Pasillos</p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
              Como el súper, sin la cola.
            </h2>
          </div>
          <Link to="/catalogo" className="hidden text-sm font-medium text-mist hover:text-paper sm:inline">
            Catálogo completo
          </Link>
        </div>
        <PasilloTiles ageOk={br.ageOk} />
      </section>

      <CatalogBlock
        products={featured.length ? featured : br.products.slice(0, 8)}
        title="Lo que pide la nevera"
        lead="Ofertas y la caja degustación de la casa. Añade y lo mandamos frío."
      />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src="/brand/slides/despensa.jpg" alt="" className="size-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/40" />
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">La casa</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
              Despensa de barrio, velocidad de ciudad.
            </h2>
            <p className="mt-5 max-w-md text-mist">
              Aceite, arroz, café y lo de siempre, a precio de lineal. No es un dark store de plástico: es el ultramarino
              que llega en patinete por el barrio.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link to="/catalogo" search={{ cat: "basicos" }}>
                Ver despensa
                <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <img src="/brand/slides/mesa.jpg" alt="" className="media aspect-[3/4] rounded-[1.5rem] object-cover" />
            <img
              src="/brand/slides/nevera.jpg"
              alt=""
              className="media mt-8 aspect-[3/4] rounded-[1.5rem] object-cover"
            />
          </div>
        </div>
      </section>

      <section id="como-funciona" className="bg-ink">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Cómo va</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
            Pides. Enfriamos. Llega.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Clock,
                t: "Pides",
                d: "Catálogo de ultramarinos con precios de DIA, Lidl y Consum. Cesta en un toque.",
                img: "/brand/slides/mesa.jpg",
              },
              {
                icon: Snowflake,
                t: "Enfriamos",
                d: "Bebidas de nevera, snacks y despensa. Alcohol solo con mayoría de edad.",
                img: "/brand/slides/nevera.jpg",
              },
              {
                icon: MapPin,
                t: "Llega",
                d: "Patinete por el barrio. Código BR-XXXX, timeline en tu cuenta, DNI si hay bodega.",
                img: "/brand/slides/patinete.jpg",
              },
            ].map((s) => (
              <div key={s.t} className="overflow-hidden rounded-[1.5rem] bg-night shadow-card">
                <div className="aspect-[16/10] overflow-hidden">
                  <img src={s.img} alt="" className="size-full object-cover" />
                </div>
                <div className="p-6">
                  <s.icon className="size-5 text-ember" />
                  <h3 className="mt-4 font-display text-2xl font-semibold text-paper">{s.t}</h3>
                  <p className="mt-2 text-sm text-mist">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="overflow-hidden rounded-[1.75rem] lg:col-span-2">
            <img src="/brand/slides/azotea.jpg" alt="" className="media aspect-[16/9] w-full object-cover lg:aspect-[2/1]" />
          </div>
          <blockquote className="flex flex-col justify-end rounded-[1.75rem] bg-ember p-8 text-paper">
            <p className="font-display text-2xl font-semibold leading-snug">
              “Pedí el vermú y las aceitunas desde la azotea. El patinete llegó antes que el atardecer.”
            </p>
            <footer className="mt-6 text-sm text-paper/80">Clara · Badalona</footer>
          </blockquote>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { q: "Nunca más bajar a por hielo y snacks a las once.", who: "Martín · Ripollet" },
            { q: "Precios de lineal, no de terraza turística.", who: "Núria · Sant Adrià de Besòs" },
            { q: "La caja rayo resolvió el cumple de la oficina.", who: "Iago · Badalona" },
          ].map((t) => (
            <figure key={t.who} className="rounded-[1.5rem] bg-ink p-6">
              <blockquote className="text-sm text-paper">{t.q}</blockquote>
              <figcaption className="mt-4 text-xs uppercase tracking-[0.14em] text-mist">{t.who}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="border-y border-paper/10 bg-ink">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Cobertura</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-paper">De momento, tu barrio.</h2>
          <p className="mt-3 max-w-xl text-mist">
            Salimos desde un almacén urbano y repartimos en {SERVICE_AREA_LABEL}. Si tu calle está en la lista, el
            patinete entra. Si no, dínoslo: vamos abriendo barrio a barrio.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {CITIES.map((city) => (
              <li
                key={city}
                className="rounded-2xl bg-night px-4 py-3 text-sm font-medium text-paper shadow-[0_0_0_1px_rgba(239,228,208,0.08)]"
              >
                {city}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="overflow-hidden rounded-[2rem] bg-ember px-6 py-12 text-paper sm:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/70">Buzón</p>
          <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Rayos de ofertas, sin spam.</h2>
          <p className="mt-2 max-w-lg text-paper/85">
            Un correo cuando hay reposición relámpago o envío gratis extra. Express España, en la bandeja.
          </p>
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
              placeholder="tu@email.com"
              className="h-12 flex-1 rounded-full bg-paper px-5 text-ink outline-none placeholder:text-muted"
              suppressHydrationWarning
            />
            <Button type="submit" variant="ink" size="lg">
              Apuntarme
            </Button>
          </form>
        </div>
      </section>
    </StoreShell>
  );
}
