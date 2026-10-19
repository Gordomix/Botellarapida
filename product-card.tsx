import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { Product } from "@/data/types";
import { CATEGORIES } from "@/data/types";
import { cn, fmtEur } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (p: Product) => void;
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[1.75rem] bg-surface shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-lift">
      <Link
        to="/producto/$id"
        params={{ id: product.id }}
        className="relative block aspect-[4/5] overflow-hidden bg-paper"
      >
        <img
          src={product.image}
          alt={product.name}
          className="media size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {product.oferta ? (
            <span className="rounded-full bg-ember px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-surface">
              Oferta
            </span>
          ) : null}
          {product.alcohol ? (
            <span className="rounded-full bg-adult px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-adult-fg">
              +18
            </span>
          ) : null}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4 pb-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-bottle">
          {product.brand} · {CATEGORIES[product.cat].label}
        </p>
        <h3 className="font-display text-[1.05rem] font-semibold leading-snug tracking-tight">
          <Link to="/producto/$id" params={{ id: product.id }} className="hover:text-ember">
            {product.name}
          </Link>
        </h3>
        <p className="line-clamp-2 text-sm text-muted">{product.desc}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <div>
            <p className="font-display text-xl font-semibold tabular-nums text-ember leading-none">
              {fmtEur(product.price)}
            </p>
            <p className="mt-1 text-xs text-muted">{product.unit}</p>
          </div>
          <Button
            size="sm"
            variant="bottle"
            onClick={() => onAdd(product)}
            aria-label={`Añadir ${product.name}`}
            className="pr-3.5"
          >
            <Plus />
            Añadir
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  onAdd,
  className,
}: {
  products: Product[];
  onAdd: (p: Product) => void;
  className?: string;
}) {
  if (!products.length) {
    return (
      <p className="py-16 text-center text-muted">No hay productos en este pasillo.</p>
    );
  }
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} onAdd={onAdd} />
      ))}
    </div>
  );
}
