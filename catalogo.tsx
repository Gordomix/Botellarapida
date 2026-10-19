import { createFileRoute, Link } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { ProductGrid } from "@/components/product/product-card";
import { CATEGORIES, type CategoryId } from "@/data/types";
import {
  mergeSection,
  SITE_DEFAULTS,
  type BrandSection,
  type CategoriesSection,
} from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";
import { matchesQuery } from "@/lib/product-search";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Heart } from "lucide-react";

type Search = { cat?: CategoryId; q?: string; fav?: 1 };

export const Route = createFileRoute("/catalogo")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    cat: typeof s.cat === "string" && s.cat in CATEGORIES ? (s.cat as CategoryId) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    // Ver los guardados con el corazón: filtro por parámetro, sin ruta nueva.
    fav: s.fav === "1" || s.fav === 1 ? 1 : undefined,
  }),
  component: Catalogo,
});

function Catalogo() {
  const { cat, fav, q } = Route.useSearch();
  const br = useBr();
  const brand = mergeSection(SITE_DEFAULTS.brand, br.content.brand as BrandSection);
  const catsCopy = mergeSection(
    SITE_DEFAULTS.categories,
    br.content.categories as CategoriesSection,
  );
  const cats = (Object.keys(CATEGORIES) as CategoryId[]).filter((c) => c !== "alcohol" || br.ageOk);
  const term = (q ?? "").trim();
  const list = br.products.filter((p) => {
    if (p.alcohol && !br.ageOk) return false;
    if (cat && p.cat !== cat) return false;
    if (fav && !br.favs.includes(p.id)) return false;
    // Búsqueda (Fase 12): el parámetro `q` ahora SÍ filtra, por nombre, marca,
    // descripción y etiquetas SEO derivadas («bebida», «frío», «energética»…).
    if (term && !matchesQuery(p, term)) return false;
    return true;
  });
  const banner = cat ? catsCopy[cat].image : "/brand/slides/terraza.jpg";

  return (
    <StoreShell>
      <section className="relative min-h-72 overflow-hidden sm:min-h-80">
        <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/70 to-night/45" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">
            {brand.catalogKicker}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
            {term
              ? `Resultados para «${term}»`
              : fav
                ? "Tus favoritos"
                : cat
                  ? catsCopy[cat].label
                  : brand.catalogFallbackTitle}
          </h1>
          <p className="mt-3 max-w-xl text-mist">{brand.catalogLead}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              to="/catalogo"
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium leading-10",
                !cat && !fav ? "bg-ember text-paper" : "bg-paper/10 text-paper hover:bg-paper/16",
              )}
            >
              Todo
            </Link>
            {cats.map((id) => (
              <Link
                key={id}
                to="/catalogo"
                search={{ cat: id }}
                className={cn(
                  "h-10 rounded-full px-4 text-sm font-medium leading-10",
                  cat === id && !fav
                    ? "bg-ember text-paper"
                    : "bg-paper/10 text-paper hover:bg-paper/16",
                )}
              >
                {catsCopy[id].label}
              </Link>
            ))}
            <Link
              to="/catalogo"
              search={{ fav: 1 }}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium",
                fav ? "bg-ember text-paper" : "bg-paper/10 text-paper hover:bg-paper/16",
              )}
            >
              <Heart className={cn("size-4", fav ? "fill-current" : "fill-none")} />
              Favoritos
              {br.favs.length ? (
                <span className="tabular-nums opacity-80">({br.favs.length})</span>
              ) : null}
            </Link>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-10">
        {br.dbError ? (
          br.dbRateLimited ? (
            <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-card">
              Hay muchas peticiones ahora mismo. Espera unos segundos y se recargará solo.
            </p>
          ) : (
            <p className="rounded-2xl bg-surface p-4 text-sm text-ember shadow-card">
              Sin conexión con la base de datos ({br.dbError}). Revisa las variables MySQL del
              servidor.
            </p>
          )
        ) : br.isLoading ? (
          <p className="text-sm text-mist">Cargando catálogo…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-mist">
            {term
              ? `Nada coincide con «${term}». Prueba con otra palabra (por ejemplo «bebida», «snack» o el nombre de una marca).`
              : fav
                ? "Aún no has guardado nada. Toca el corazón de cualquier producto y aparecerá aquí."
                : "No hay productos en este pasillo."}
          </p>
        ) : (
          <ProductGrid
            products={list}
            onAdd={(p) => {
              if (br.addToCart(p).ok) toast.success(`${p.name} en la cesta`);
            }}
          />
        )}
      </section>
    </StoreShell>
  );
}
