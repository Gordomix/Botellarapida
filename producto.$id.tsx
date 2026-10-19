import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Heart, Zap } from "lucide-react";
import { useRef } from "react";
import { StoreShell } from "@/components/layout/store-shell";
import { ProductGrid } from "@/components/product/product-card";
import { FlashCountdown } from "@/components/product/flash";
import { Button } from "@/components/ui/button";
import { mergeSection, SITE_DEFAULTS, type CategoriesSection } from "@/data/site-defaults";
import { flashActive, isLowStock, isSoldOut, stockLabel } from "@/lib/stock";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";
import { flyToCart } from "@/lib/cart-fx";
import { productImgProps, safeImgSrc } from "@/lib/product-img";
import { fmtEur } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/producto/$id")({
  component: Ficha,
});

function Ficha() {
  const { id } = Route.useParams();
  const br = useBr();
  // Foto grande de la ficha: punto de salida del vuelo al carrito.
  const bigImgRef = useRef<HTMLImageElement>(null);
  const p = br.products.find((x) => x.id === id);
  if (!p) {
    // El catálogo ahora llega de MySQL: mientras carga (o si falla la conexión)
    // no es un 404, es que aún no tenemos el producto delante.
    if (br.isLoading || br.dbError) {
      return (
        <StoreShell>
          <div className="mx-auto max-w-6xl px-4 py-20 text-mist">
            {br.dbError && !br.dbRateLimited
              ? `Sin conexión con la base de datos (${br.dbError}).`
              : "Cargando producto…"}
          </div>
        </StoreShell>
      );
    }
    throw notFound();
  }
  const related = br.products.filter((x) => x.cat === p.cat && x.id !== p.id && (!x.alcohol || br.ageOk)).slice(0, 4);
  const catsCopy = mergeSection(SITE_DEFAULTS.categories, br.content.categories as CategoriesSection);
  // Stock y flash (campos que gestiona el admin en Productos): agotado bloquea
  // la cesta, la escasez se avisa y la flash muestra cuenta atrás en directo.
  const soldOut = isSoldOut(p);
  const escasez = soldOut ? null : stockLabel(p);
  const baja = isLowStock(p);
  const flash = flashActive(p);

  return (
    <StoreShell>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[2rem] bg-ink shadow-lift">
          <img
            ref={bigImgRef}
            {...productImgProps(p.image)}
            alt={p.name}
            className="media aspect-square w-full object-cover"
          />
        </div>
        <div>
          <nav className="text-sm text-mist">
            <Link to="/" className="hover:text-paper">
              Inicio
            </Link>
            <span> / </span>
            <Link to="/catalogo" search={{ cat: p.cat }} className="hover:text-paper">
              {catsCopy[p.cat].label}
            </Link>
          </nav>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ember">
            {p.brand} · {p.unit}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper">{p.name}</h1>
          <p className="mt-4 font-display text-3xl tabular-nums text-ember">
            {flash ? (
              <span className="mr-3 inline-flex items-center gap-1 align-middle rounded-full bg-ink px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-ember">
                <Zap className="size-3 fill-current" /> Flash · <FlashCountdown until={p.flashUntil!} />
              </span>
            ) : null}
            {p.oferta && p.oldPrice != null && p.oldPrice > p.price ? (
              <>
                <span className="mr-3 align-middle rounded-full bg-ember px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-surface">
                  Oferta −{Math.round((1 - p.price / p.oldPrice) * 100)}%
                </span>
                <span className="mr-3 align-middle text-lg text-mist line-through">{fmtEur(p.oldPrice)}</span>
              </>
            ) : null}
            {fmtEur(p.price)}
          </p>
          <p className="mt-5 max-w-prose text-mist">{p.long}</p>
          {soldOut ? (
            <p className="mt-5 rounded-2xl bg-adult px-4 py-3 text-sm font-semibold text-adult-fg">
              Agotado por ahora: el admin puede reponer el stock en cualquier momento.
            </p>
          ) : escasez ? (
            <p className={cn("mt-5 text-sm font-semibold", baja ? "text-ember" : "text-bottle")}>
              {escasez}
            </p>
          ) : null}
          {p.alcohol ? (
            <p className="mt-5 rounded-2xl bg-adult px-4 py-3 text-sm text-adult-fg">
              Venta prohibida a menores de 18 años. Verificación de DNI en la entrega. Graduación {p.grad}.
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              disabled={soldOut}
              onClick={() => {
                if (soldOut) return;
                const el = bigImgRef.current;
                flyToCart(safeImgSrc(p.image), el ? el.getBoundingClientRect() : null);
                if (br.addToCart(p).ok) toast.success(`${p.name} en la cesta`);
              }}
            >
              {soldOut ? "Agotado" : "Añadir a la cesta"}
            </Button>
            <Button asChild size="lg" variant="line">
              <Link to="/catalogo">Seguir en el pasillo</Link>
            </Button>
            {/* Wishlist: mismo corazón que las tarjetas, con estado visible. */}
            <Button
              size="lg"
              variant="line"
              aria-pressed={br.isFav(p.id)}
              onClick={() => {
                const now = br.toggleFav(p.id);
                toast.success(now ? `${p.name} guardado en favoritos` : "Quitado de favoritos");
              }}
            >
              <Heart className={cn(br.isFav(p.id) && "fill-current")} />
              {br.isFav(p.id) ? "Guardado" : "Guardar"}
            </Button>
          </div>
          <div className="mt-10 overflow-hidden rounded-2xl bg-surface shadow-card">
            <table className="w-full text-sm">
              <caption className="bg-ink px-4 py-3 text-left font-medium text-paper">
                Información nutricional / 100 g o 100 ml
              </caption>
              <tbody>
                {Object.entries(p.nutrition).map(([k, v]) => (
                  <tr key={k} className="border-t border-line/15">
                    <th className="px-4 py-2 text-left font-medium">{k}</th>
                    <td className="px-4 py-2 tabular-nums text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {related.length ? (
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <h2 className="mb-6 font-display text-2xl font-semibold text-paper">Del mismo pasillo</h2>
          <ProductGrid
            products={related}
            onAdd={(prod) => {
              if (br.addToCart(prod).ok) toast.success(`${prod.name} en la cesta`);
            }}
          />
        </section>
      ) : null}
    </StoreShell>
  );
}
