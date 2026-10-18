import { Link } from "@tanstack/react-router";
import { Heart, Plus, Zap } from "lucide-react";
import { useRef } from "react";
import type { Product } from "@/data/types";
import { CATEGORIES } from "@/data/types";
import { flyToCart } from "@/lib/cart-fx";
import { productImgProps, safeImgSrc } from "@/lib/product-img";
import { flashActive, isLowStock, isSoldOut, stockLabel } from "@/lib/stock";
import { FlashCountdown } from "@/components/product/flash";
import { useBr } from "@/lib/use-br";
import { cn, fmtEur } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (p: Product) => void;
}) {
  // Corazón de wishlist: localStorage por dispositivo (ver `br.toggleFav`),
  // sin red — por eso re-pinta al instante y no interfiere con el enlace.
  const br = useBr();
  const fav = br.isFav(product.id);
  // Oferta «de verdad»: con precio anterior mayor que el de venta. Entonces el
  // borde se tiñe de ember, el anterior se tacha y la insignia muestra el dto.
  const enOferta =
    Boolean(product.oferta) && product.oldPrice != null && product.oldPrice > product.price;
  const dct = enOferta ? Math.round((1 - product.price / product.oldPrice!) * 100) : 0;
  // Stock y oferta flash (los fija el admin en Productos): agotado bloquea el
  // botón; la escasez (>0 y ≤5) se avisa en rojo; la flash pinta cuenta atrás.
  const soldOut = isSoldOut(product);
  const escasez = soldOut ? null : stockLabel(product);
  const baja = isLowStock(product);
  const flash = flashActive(product);
  // Vuelo de la imagen al carrito: la tarjeta conoce su foto, el sonido y el
  // rebote los dispara `addToCart` (un único punto para toda la web).
  const imgRef = useRef<HTMLImageElement>(null);
  function add() {
    if (soldOut) return;
    const el = imgRef.current;
    flyToCart(safeImgSrc(product.image), el ? el.getBoundingClientRect() : null);
    onAdd(product);
  }
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[1.75rem] bg-surface shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-lift",
        enOferta && "ring-2 ring-ember",
      )}
    >
      <Link
        to="/producto/$id"
        params={{ id: product.id }}
        className="relative block aspect-[4/5] overflow-hidden bg-paper"
      >
        <img
          ref={imgRef}
          {...productImgProps(product.image)}
          alt={product.name}
          loading="lazy"
          decoding="async"
          className="media size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {product.oferta ? (
            <span className="rounded-full bg-ember px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-surface">
              {enOferta ? `Oferta −${dct}%` : "Oferta"}
            </span>
          ) : null}
          {product.alcohol ? (
            <span className="rounded-full bg-adult px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-adult-fg">
              +18
            </span>
          ) : null}
          {flash ? (
            <span className="flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-ember">
              <Zap className="size-3 fill-current" /> Flash <FlashCountdown until={product.flashUntil!} />
            </span>
          ) : null}
        </div>
        {soldOut ? (
          <div className="absolute inset-0 grid place-items-center bg-ink/55">
            <span className="rounded-full bg-paper px-4 py-1.5 text-sm font-bold uppercase tracking-wider text-ink">
              Agotado
            </span>
          </div>
        ) : null}
      </Link>
      <button
        type="button"
        aria-pressed={fav}
        aria-label={fav ? `Quitar ${product.name} de favoritos` : `Guardar ${product.name} en favoritos`}
        title={fav ? "Quitar de favoritos" : "Guardar para luego"}
        onClick={() => br.toggleFav(product.id)}
        className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-paper/90 shadow-card backdrop-blur transition-transform hover:scale-105"
      >
        <Heart className={cn("size-5 transition-colors", fav ? "fill-ember text-ember" : "text-muted")} />
      </button>
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
              {enOferta ? (
                <span className="mr-2 align-middle text-sm font-medium text-muted line-through">
                  {fmtEur(product.oldPrice!)}
                </span>
              ) : null}
              {fmtEur(product.price)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {product.unit}
              {escasez ? (
                <span className={cn("ml-2 font-semibold", baja ? "text-ember" : "text-bottle")}>
                  {escasez}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {/* Botón a ancho completo y 44 px de alto: en móvil se ve claro y se
            pulsa fácil aunque la descripción ocupe dos líneas. */}
        <Button
          size="md"
          variant="bottle"
          onClick={add}
          disabled={soldOut}
          aria-label={soldOut ? `${product.name} agotado` : `Añadir ${product.name} al carrito`}
          className="mt-3 w-full"
        >
          {soldOut ? "Agotado" : (<><Plus /> Añadir</>)}
        </Button>
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
