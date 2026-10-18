import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  mergeSection,
  SITE_DEFAULTS,
  type CoberturaSection,
  type HeroSection,
} from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";

export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  // Slides desde el contenido editable; sin override = defaults de hoy. Si el
  // admin deja la lista vacía, se cae a los defaults para no romper el render.
  const br = useBr();
  const hero = mergeSection(SITE_DEFAULTS.hero, br.content.hero as HeroSection);
  const slides = hero.slides.length ? hero.slides : SITE_DEFAULTS.hero.slides;
  const total = slides.length;
  const slide = slides[index] ?? slides[0];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (paused || reduce) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % total), 6500);
    return () => window.clearInterval(t);
  }, [paused, reduce, total, index]);

  function go(dir: number) {
    setIndex((i) => (i + dir + total) % total);
  }

  return (
    <section
      className="relative min-h-dvh overflow-hidden bg-night"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carrusel"
      aria-label="Escenas Express España"
    >
      {slides.map((s, i) => (
        <div
          key={`${s.src}-${i}`}
          className={cn("absolute inset-0 slide-fade", i === index ? "opacity-100" : "opacity-0")}
          aria-hidden={i !== index}
        >
          <img
            src={s.src}
            alt=""
            className={cn("size-full object-cover", i === index && !reduce && "ken")}
          />
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-night/88 via-night/45 to-night/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-night via-night/15 to-night/50" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col justify-end px-4 pb-10 pt-32 sm:pb-14 sm:pt-36">
        <p className="inline-flex w-fit rounded-full bg-ember px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-paper">
          Express España
        </p>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-mist">{slide.kicker}</p>
        <h1
          key={slide.title}
          className="mt-3 max-w-3xl font-display text-[2.5rem] font-semibold leading-[1.02] tracking-tight text-paper sm:text-6xl lg:text-7xl"
        >
          {slide.title}
        </h1>
        <p className="mt-5 max-w-lg text-base text-mist sm:text-lg">{slide.caption}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/catalogo">
              Ver catálogo
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="line">
            <a href="#pasillos">Explorar pasillos</a>
          </Button>
        </div>

        <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
          <ul className="flex flex-wrap gap-8 text-sm text-mist">
            <li>
              <strong className="block font-display text-2xl text-paper">30 min</strong>
              entrega media
            </li>
            <li>
              <strong className="block font-display text-2xl text-paper">25 €</strong>
              envío gratis
            </li>
            <li>
              <strong className="block font-display text-2xl text-paper">+18</strong>
              bodega verificada
            </li>
            <li>
              <strong className="block font-display text-2xl text-paper">24 h</strong>
              abierto y reparto
            </li>
          </ul>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full bg-paper/10 text-paper hover:bg-paper/18"
              aria-label="Anterior"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full bg-paper/10 text-paper hover:bg-paper/18"
              aria-label={paused ? "Reanudar" : "Pausar"}
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full bg-paper/10 text-paper hover:bg-paper/18"
              aria-label="Siguiente"
              onClick={() => go(1)}
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="ml-2 flex gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={`${s.src}-${i}`}
                  type="button"
                  aria-label={`Escena ${i + 1}: ${s.kicker}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-[width,background-color] duration-300",
                    i === index ? "w-8 bg-ember" : "w-2.5 bg-paper/35 hover:bg-paper/60",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CityMarquee() {
  const br = useBr();
  const cobertura = mergeSection(
    SITE_DEFAULTS["home.cobertura"],
    br.content["home.cobertura"] as CoberturaSection,
  );
  const cities = cobertura.cities.length
    ? cobertura.cities
    : SITE_DEFAULTS["home.cobertura"].cities;
  const row = [...cities, ...cities];
  return (
    <div className="overflow-hidden border-y border-paper/10 bg-ink">
      <div className="marquee-track flex w-max gap-0 py-3">
        {row.map((city, i) => (
          <span
            key={`${city}-${i}`}
            className="flex items-center gap-4 px-5 text-xs font-semibold uppercase tracking-[0.22em] text-mist"
          >
            {city}
            <span className="text-ember">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
