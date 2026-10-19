import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { Loader2, Search, Trash2, Upload } from "lucide-react";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { BASE_PRODUCTOS } from "@/data/productdb";
import { CATEGORIES, type CategoryId, type Product } from "@/data/types";
import { STATUS_LABEL } from "@/lib/format";
import { buildImageAlt, fileToOptimizedImage, humanBytes } from "@/lib/image-opt";
import { useBr } from "@/lib/use-br";
import { fmtDate, fmtEur, slugify } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({ component: Page });

/**
 * Ejecuta una acción del panel sin bloquear la UI. Cada mutación de `useBr`
 * devuelve una `Promise`: si el servidor la rechaza (rol, estado, sesión), se
 * avisa en un toast en vez de romper el render.
 */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

const TABS = ["Pedidos", "Repartidores", "Productos", "Reclamaciones", "Soporte"] as const;

function Page() {
  return (
    <PanelShell role="admin">
      <AdminInner />
    </PanelShell>
  );
}

function AdminInner() {
  const br = useBr();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pedidos");
  const pending = br.orders.filter((o) => o.status === "pendiente").length;
  const reqs = br.users.filter((u) => u.role === "repartidor" && u.status === "solicitud").length;
  const openC = br.claims.filter((c) => c.status === "abierta").length;
  const openM = br.messages.filter((m) => m.status === "abierto").length;

  const kpis = [
    { n: br.orders.length, l: "Pedidos" },
    { n: pending, l: "Por delegar" },
    { n: br.orders.filter((o) => o.status === "en_reparto").length, l: "En calle" },
    { n: br.couriers.length, l: "Repartidores" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Logística</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">Panel</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="line"
            onClick={() => {
              const p = br.products.find((x) => !x.alcohol);
              if (!p) return;
              act(
                br.createOrder({
                  items: [{ id: p.id, name: p.name, qty: 1, price: p.price }],
                  subtotal: p.price,
                  shippingCost: 2.9,
                  tip: 0,
                  total: p.price + 2.9,
                  paymentMethod: "tarjeta",
                  deliverySlot: "inmediata",
                  address: "Carrer de Maragall 20, Badalona",
                  postalCode: "08911",
                  phone: "600 000 000",
                  notes: "Pedido de prueba",
                }),
                "Pedido de prueba creado",
              );
            }}
          >
            Crear pedido de prueba
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.l} className="rounded-2xl bg-surface p-4 shadow-card">
            <p className="font-display text-2xl font-semibold tabular-nums">{k.n}</p>
            <p className="text-xs text-muted">{k.l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`relative h-10 rounded-full px-4 text-sm font-medium ${
              tab === t ? "bg-ink text-surface" : "bg-surface shadow-card"
            }`}
          >
            {t}
            {t === "Pedidos" && pending ? <Badge n={pending} /> : null}
            {t === "Repartidores" && reqs ? <Badge n={reqs} /> : null}
            {t === "Reclamaciones" && openC ? <Badge n={openC} /> : null}
            {t === "Soporte" && openM ? <Badge n={openM} /> : null}
          </button>
        ))}
      </div>

      {tab === "Pedidos" ? <Pedidos /> : null}
      {tab === "Repartidores" ? <Repartidores /> : null}
      {tab === "Productos" ? <Productos /> : null}
      {tab === "Reclamaciones" ? <Reclamos /> : null}
      {tab === "Soporte" ? <SoporteAdmin /> : null}
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-ember px-1 text-[0.65rem] text-surface">
      {n}
    </span>
  );
}

function Pedidos() {
  const br = useBr();
  const orders = [...br.orders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="overflow-x-auto rounded-[1.25rem] bg-surface shadow-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-ink text-surface">
          <tr>
            {["Código", "Cliente", "Total", "Estado", "Repartidor", ""].map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-line">
              <td className="px-4 py-3 font-semibold tabular-nums text-ember">{o.code}</td>
              <td className="px-4 py-3">
                {o.customerName}
                <div className="text-xs text-muted">{fmtDate(o.createdAt)}</div>
              </td>
              <td className="px-4 py-3 tabular-nums">{fmtEur(o.total)}</td>
              <td className="px-4 py-3">
                <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
              </td>
              <td className="px-4 py-3 text-xs">{o.courier || "—"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {o.status === "pendiente" || o.status === "asignado" ? (
                    <select
                      className="h-9 rounded-lg bg-paper px-2 text-xs"
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        act(br.assignCourier({ id: o.id, courier: e.target.value }), "Repartidor asignado");
                      }}
                    >
                      <option value="">Delegar…</option>
                      {br.couriers.map((c) => (
                        <option key={c.email} value={c.email}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {o.status !== "entregado" && o.status !== "cancelado" ? (
                    <button
                      type="button"
                      className="h-9 rounded-lg bg-paper px-2 text-xs"
                      onClick={() => act(br.cancelOrder({ id: o.id }), "Pedido cancelado")}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Repartidores() {
  const br = useBr();
  const list = br.users.filter((u) => u.role === "repartidor");
  return (
    <ul className="space-y-3">
      {list.map((u) => (
        <li key={u.email} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 shadow-card">
          <div>
            <p className="font-medium">{u.name}</p>
            <p className="text-xs text-muted">
              {u.email} · DNI {u.dni} · {u.vehicle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={statusTone(u.status)}>{u.status}</Pill>
            {u.status === "solicitud" ? (
              <>
                <Button size="sm" onClick={() => act(br.setUserStatus({ email: u.email, status: "activo" }), "Repartidor aprobado")}>
                  Aprobar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act(br.setUserStatus({ email: u.email, status: "rechazado" }), "Solicitud rechazada")}>
                  Rechazar
                </Button>
              </>
            ) : u.status === "activo" ? (
              <Button size="sm" variant="ghost" onClick={() => act(br.setUserStatus({ email: u.email, status: "suspendido" }), "Cuenta suspendida")}>
                Suspender
              </Button>
            ) : u.status === "suspendido" ? (
              <Button size="sm" onClick={() => act(br.setUserStatus({ email: u.email, status: "activo" }), "Cuenta reactivada")}>
                Reactivar
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const EMPTY_FORM = {
  name: "",
  brand: "",
  price: "",
  unit: "",
  cat: "snacks" as CategoryId,
  alcohol: false,
  grad: "",
  desc: "",
  long: "",
};

type ImgState = { dataUrl: string; w: number; h: number; bytes: number; orig: number; mime: string };

function Productos() {
  const br = useBr();
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [nutr, setNutr] = useState<{ k: string; v: string }[]>([]);
  const [img, setImg] = useState<ImgState | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }));

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return BASE_PRODUCTOS.filter(
      (p) =>
        p.name.toLowerCase().includes(n) ||
        p.ean.includes(n) ||
        p.brand.toLowerCase().includes(n),
    ).slice(0, 6);
  }, [q]);

  // Rellenar el formulario desde la base española (por EAN o nombre): NO publica,
  // para que el admin pueda añadir la foto y ajustar precio/descripción.
  function fillFromDraft(d: (typeof BASE_PRODUCTOS)[number]) {
    set({
      name: d.name,
      brand: d.brand,
      price: String(d.price),
      unit: d.unit,
      cat: d.cat,
      alcohol: !!d.alcohol,
      grad: d.grad || "",
      desc: `${d.name} de ${d.brand}.`,
      long: `${d.name} (${d.unit}). Precio de supermercado, entrega express en tu zona.`,
    });
    setNutr(Object.entries(d.nutrition).map(([k, v]) => ({ k, v })));
    toast.success(`Base cargada: ${d.name}. Añade la foto y pulsa Publicar.`);
  }

  async function handleFile(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      // Recorte 4:5 (proporción de la ficha) + WebP q0.82 a 800 px de lado largo.
      const o = await fileToOptimizedImage(file, { maxDim: 800, quality: 0.82, cropAspect: 4 / 5 });
      setImg({ dataUrl: o.dataUrl, w: o.width, h: o.height, bytes: o.bytes, orig: o.originalBytes, mime: o.mime });
      const saved = o.originalBytes > 0 ? Math.max(0, Math.round((1 - o.bytes / o.originalBytes) * 100)) : 0;
      toast.success(`Imagen optimizada: ${o.width}×${o.height} · ${humanBytes(o.bytes)} (−${saved}%).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const price = Number(form.price);
    if (!form.name.trim()) return toast.error("Ponle un nombre al producto.");
    if (!(price > 0)) return toast.error("El precio debe ser mayor que 0.");
    const nutrition = Object.fromEntries(
      nutr.filter((n) => n.k.trim()).map((n) => [n.k.trim(), n.v.trim()]),
    );
    const p: Product = {
      id: slugify(form.name) + "-" + Math.random().toString(36).slice(2, 5),
      name: form.name.trim(),
      cat: form.cat,
      brand: form.brand.trim() || "Botella Rápida",
      price,
      unit: form.unit.trim() || "ud",
      desc: form.desc.trim() || `${form.name.trim()} de ${form.brand.trim() || "Botella Rápida"}.`,
      long: form.long.trim() || form.desc.trim() || `${form.name.trim()} (${form.unit.trim() || "ud"}).`,
      nutrition,
      image: img?.dataUrl || `/categories/${form.cat}.jpg`,
      alcohol: form.cat === "alcohol" ? true : form.alcohol,
      grad: form.grad.trim() || undefined,
    };
    act(
      br.addCustomProduct({ product: p }).then(() => {
        setForm(EMPTY_FORM);
        setNutr([]);
        setImg(null);
        setQ("");
      }),
      `${p.name} publicado en el catálogo`,
    );
  }

  const altText = buildImageAlt(form.name || "Producto", form.brand, form.unit);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Columna principal: el alta guiada */}
      <form
        onSubmit={publish}
        className="space-y-6 rounded-[1.5rem] bg-surface p-5 shadow-card lg:col-span-3"
      >
        <div>
          <h2 className="font-display text-xl font-semibold">Subir producto</h2>
          <p className="mt-1 text-sm text-muted">
            Rellena desde la base española por EAN o nombre, sube la foto (se convierte sola a WebP
            optimizado) y publica.
          </p>
        </div>

        {/* 1 · Imagen */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">1 · Foto</p>
          <label
            onDragOver={(ev) => {
              ev.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(ev) => {
              ev.preventDefault();
              setDrag(false);
              void handleFile(ev.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-3 transition ${
              drag ? "border-ember bg-paper" : "border-line bg-paper"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(ev) => void handleFile(ev.target.files?.[0])}
            />
            <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface shadow-card">
              {busy ? (
                <Loader2 className="animate-spin text-muted" />
              ) : img ? (
                <img src={img.dataUrl} alt="Vista previa" className="size-full object-cover" />
              ) : (
                <Upload className="text-muted" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              {img ? (
                <>
                  <p className="font-medium">
                    {img.w}×{img.h} · {humanBytes(img.bytes)}
                  </p>
                  <p className="text-xs text-muted">
                    WebP listo para SEO (antes {humanBytes(img.orig)}). Alt: “{altText}”.
                  </p>
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-ember"
                    onClick={() => setImg(null)}
                  >
                    <Trash2 size={14} /> Quitar imagen
                  </button>
                </>
              ) : (
                <>
                  <p className="font-medium">Arrastra una foto o haz clic</p>
                  <p className="text-xs text-muted">
                    JPG · PNG · WebP · AVIF — se redimensiona a 800 px y se guarda como WebP.
                  </p>
                </>
              )}
            </div>
          </label>
        </section>

        {/* 2 · Básicos */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">2 · Datos</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nombre *" value={form.name} onChange={(v) => set({ name: v })} required placeholder="Palitos de pan" />
            <Input label="Marca" value={form.brand} onChange={(v) => set({ brand: v })} placeholder="DIA" />
            <Input label="Precio (€) *" value={form.price} onChange={(v) => set({ price: v })} type="number" step="0.01" placeholder="0.79" />
            <Input label="Unidad" value={form.unit} onChange={(v) => set({ unit: v })} placeholder="bolsa 250 g" />
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-muted">Categoría</span>
              <select
                value={form.cat}
                onChange={(ev) => set({ cat: ev.target.value as CategoryId })}
                className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
              >
                {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
              </select>
            </label>
            {form.cat === "alcohol" ? (
              <>
                <Input label="Graduación" value={form.grad} onChange={(v) => set({ grad: v })} placeholder="5,5°" />
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked readOnly className="size-4 accent-[#c2410c]" />
                  +18 automático (alcohol)
                </label>
              </>
            ) : (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.alcohol}
                  onChange={(ev) => set({ alcohol: ev.target.checked })}
                  className="size-4 accent-[#c2410c]"
                />
                Producto con alcohol (+18)
              </label>
            )}
          </div>
        </section>

        {/* 3 · Texto SEO */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">3 · Descripción</p>
          <label className="block">
            <span className="text-xs font-medium text-muted">Resumen (lista de productos)</span>
            <textarea
              value={form.desc}
              onChange={(ev) => set({ desc: ev.target.value })}
              rows={2}
              placeholder="Una línea que se ve en la ficha."
              className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Descripción larga (página de producto)</span>
            <textarea
              value={form.long}
              onChange={(ev) => set({ long: ev.target.value })}
              rows={3}
              placeholder="Detalle, formato, conservación…"
              className="mt-1 w-full rounded-2xl bg-paper p-3 text-sm shadow-card"
            />
          </label>
        </section>

        {/* 4 · Nutrición */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bottle">4 · Nutrición</p>
            <button
              type="button"
              className="text-xs text-ember"
              onClick={() => setNutr((n) => [...n, { k: "", v: "" }])}
            >
              + Añadir fila
            </button>
          </div>
          {nutr.length === 0 ? (
            <p className="text-sm text-muted">Sin información nutricional (opcional).</p>
          ) : (
            <div className="space-y-2">
              {nutr.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.k}
                    onChange={(ev) =>
                      setNutr((all) => all.map((r, j) => (j === i ? { ...r, k: ev.target.value } : r)))
                    }
                    placeholder="Grasas"
                    className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm"
                  />
                  <input
                    value={row.v}
                    onChange={(ev) =>
                      setNutr((all) => all.map((r, j) => (j === i ? { ...r, v: ev.target.value } : r)))
                    }
                    placeholder="1.8 g"
                    className="h-24 w-24 rounded-xl bg-paper px-3 text-sm"
                  />
                  <button
                    type="button"
                    aria-label="Quitar fila"
                    className="text-muted hover:text-ember"
                    onClick={() => setNutr((all) => all.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Procesando imagen…" : "Publicar producto"}
        </Button>
      </form>

      {/* Columna lateral: búsqueda EAN + catálogo subido */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-[1.5rem] bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Base española (por EAN)</h2>
          <p className="mt-1 text-sm text-muted">Escribe nombre o EAN y pulsa “Rellenar”.</p>
          <div className="relative mt-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="palitos, rioja, 8410…"
              className="h-11 w-full rounded-2xl bg-paper pl-9 pr-3 text-sm shadow-card"
            />
          </div>
          <ul className="mt-3 space-y-2">
            {hits.map((h) => (
              <li key={h.ean} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{h.name}</p>
                  <p className="text-xs text-muted">
                    {h.brand} · {fmtEur(h.price)} · {h.ean}
                  </p>
                </div>
                <Button size="sm" variant="bottle" type="button" onClick={() => fillFromDraft(h)}>
                  Rellenar
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 font-display text-lg font-semibold">
            Subidos por el admin ({br.custom.length})
          </h2>
          {br.custom.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay altas.</p>
          ) : (
            <ul className="space-y-2">
              {br.custom.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface px-3 py-2 shadow-card">
                  <img src={p.image} alt={p.name} className="h-12 w-10 shrink-0 rounded-lg bg-paper object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <p className="text-xs text-muted">{fmtEur(p.price)}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-ember"
                    onClick={() => act(br.removeCustomProduct({ id: p.id }), "Producto quitado")}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  step,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        className="mt-1 h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card"
      />
    </label>
  );
}

function Reclamos() {
  const br = useBr();
  return (
    <ul className="space-y-3">
      {br.claims.map((c) => (
        <li key={c.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {c.email} · {c.orderCode} · {c.type}
            </p>
            <Pill tone={statusTone(c.status)}>{c.status}</Pill>
          </div>
          <p className="mt-2 text-sm">{c.text}</p>
          {c.status === "abierta" ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                act(br.resolveClaim({ id: c.id, answer: String(fd.get("answer")) }), "Reclamación resuelta");
              }}
            >
              <input name="answer" required placeholder="Respuesta" className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm" />
              <Button size="sm" type="submit">
                Resolver
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-bottle">{c.answer}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function SoporteAdmin() {
  const br = useBr();
  return (
    <ul className="space-y-3">
      {br.messages.map((m) => (
        <li key={m.id} className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{m.email}</p>
            <Pill tone={statusTone(m.status)}>{m.status}</Pill>
          </div>
          <p className="mt-2 text-sm">{m.text}</p>
          {m.status === "abierto" ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                act(br.replyMessage({ id: m.id, answer: String(fd.get("answer")) }), "Mensaje respondido");
              }}
            >
              <input name="answer" required placeholder="Respuesta" className="h-10 flex-1 rounded-xl bg-paper px-3 text-sm" />
              <Button size="sm" type="submit">
                Responder
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-bottle">{m.answer}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
