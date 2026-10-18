import { createFileRoute, Link } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { ProductGrid } from "@/components/product/product-card";
import { CATEGORIES, type CategoryId } from "@/data/types";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Search = { cat?: CategoryId; q?: string };

export const Route = createFileRoute("/catalogo")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    cat: typeof s.cat === "string" && s.cat in CATEGORIES ? (s.cat as CategoryId) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: Catalogo,
});

function Catalogo() {
  const { cat } = Route.useSearch();
  const br = useBr();
  const cats = (Object.keys(CATEGORIES) as CategoryId[]).filter((c) => c !== "alcohol" || br.ageOk);
  const list = br.products.filter((p) => {
    if (p.alcohol && !br.ageOk) return false;
    if (cat && p.cat !== cat) return false;
    return true;
  });
  const banner = cat ? CATEGORIES[cat].image : "/brand/slides/terraza.jpg";

  return (
    <StoreShell>
      <section className="relative min-h-72 overflow-hidden sm:min-h-80">
        <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/70 to-night/45" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Express España</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
            {cat ? CATEGORIES[cat].label : "Todos los pasillos"}
          </h1>
          <p className="mt-3 max-w-xl text-mist">
            Ultramarinos a precio de supermercado. Filtra, añade, y lo mandamos en patinete.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              to="/catalogo"
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium leading-10",
                !cat ? "bg-ember text-paper" : "bg-paper/10 text-paper hover:bg-paper/16",
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
                  cat === id ? "bg-ember text-paper" : "bg-paper/10 text-paper hover:bg-paper/16",
                )}
              >
                {CATEGORIES[id].label}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-10">
        {br.dbError ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-ember shadow-card">
            Sin conexión con la base de datos ({br.dbError}). Revisa las variables MySQL del servidor.
          </p>
        ) : br.isLoading ? (
          <p className="text-sm text-mist">Cargando catálogo…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-mist">No hay productos en este pasillo.</p>
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
