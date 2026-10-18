import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { StoreShell } from "@/components/layout/store-shell";
import { ProductGrid } from "@/components/product/product-card";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/data/types";
import { useBr } from "@/lib/use-br";
import { fmtEur } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/producto/$id")({
  component: Ficha,
});

function Ficha() {
  const { id } = Route.useParams();
  const br = useBr();
  const p = br.products.find((x) => x.id === id);
  if (!p) {
    // El catálogo ahora llega de MySQL: mientras carga (o si falla la conexión)
    // no es un 404, es que aún no tenemos el producto delante.
    if (br.isLoading || br.dbError) {
      return (
        <StoreShell>
          <div className="mx-auto max-w-6xl px-4 py-20 text-mist">
            {br.dbError ? `Sin conexión con la base de datos (${br.dbError}).` : "Cargando producto…"}
          </div>
        </StoreShell>
      );
    }
    throw notFound();
  }
  const related = br.products.filter((x) => x.cat === p.cat && x.id !== p.id && (!x.alcohol || br.ageOk)).slice(0, 4);

  return (
    <StoreShell>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[2rem] bg-ink shadow-lift">
          <img src={p.image} alt={p.name} className="media aspect-square w-full object-cover" />
        </div>
        <div>
          <nav className="text-sm text-mist">
            <Link to="/" className="hover:text-paper">
              Inicio
            </Link>
            <span> / </span>
            <Link to="/catalogo" search={{ cat: p.cat }} className="hover:text-paper">
              {CATEGORIES[p.cat].label}
            </Link>
          </nav>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ember">
            {p.brand} · {p.unit}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper">{p.name}</h1>
          <p className="mt-4 font-display text-3xl tabular-nums text-ember">{fmtEur(p.price)}</p>
          <p className="mt-5 max-w-prose text-mist">{p.long}</p>
          {p.alcohol ? (
            <p className="mt-5 rounded-2xl bg-adult px-4 py-3 text-sm text-adult-fg">
              Venta prohibida a menores de 18 años. Verificación de DNI en la entrega. Graduación {p.grad}.
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={() => {
                if (br.addToCart(p).ok) toast.success(`${p.name} en la cesta`);
              }}
            >
              Añadir a la cesta
            </Button>
            <Button asChild size="lg" variant="line">
              <Link to="/catalogo">Seguir en el pasillo</Link>
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
