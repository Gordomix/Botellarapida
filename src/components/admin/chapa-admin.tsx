import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";
import type { ChapaReward } from "@/data/types";
import { ChapaIcon } from "@/routes/chapas";

/** Como `act()` del panel: fire-and-forget con toast de error. */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

type RewardDraft = {
  id?: string;
  title: string;
  description: string;
  image: string;
  cost: number;
  /** Valor en € del regalo: si > 0, el coste en chapas se deriva solo (0028). */
  valueEuro: number;
  stock: number;
  productId: string;
  active: boolean;
  sort: number;
};

const EMPTY_DRAFT: RewardDraft = {
  title: "",
  description: "",
  image: "",
  cost: 20,
  valueEuro: 0,
  stock: -1,
  productId: "",
  active: true,
  sort: 0,
};

/** Equilibrio del programa (migración 0028): 100 chapas ↔ 12 € de regalo. */
const EQUIV_CHAPAS = 100;
const EQUIV_EURO = 12;
/** Chapas que le tocan a un regalo de `v` € con la equivalencia arriba. */
function chapaCostFromValue(v: number) {
  return Math.max(1, Math.round((v * EQUIV_CHAPAS) / EQUIV_EURO));
}

/** Pestaña «Chapas» del panel: fidelización 100% editable. */
export function ChapasAdmin() {
  const br = useBr();
  const data = br.adminChapa;
  const [cfg, setCfg] = useState(() => ({
    enabled: false,
    title: "",
    subtitle: "",
    howItWorks: "",
    redeemNote: "",
    eurosPerChapa: 12,
  }));
  const [draft, setDraft] = useState<RewardDraft | null>(null);
  const [prodSearch, setProdSearch] = useState("");
  const [overrideFor, setOverrideFor] = useState<{ productId: string; name: string; chapas: string } | null>(null);
  const [adjust, setAdjust] = useState({ email: "", delta: "", reason: "" });

  useEffect(() => {
    if (!data) return;
    setCfg({
      enabled: data.config.enabled,
      title: data.config.title,
      subtitle: data.config.subtitle,
      howItWorks: data.config.howItWorks,
      redeemNote: data.config.redeemNote,
      eurosPerChapa: data.config.eurosPerChapa,
    });
  }, [data]);

  if (br.adminChapaLoading || !data) {
    return (
      <div className="grid place-items-center py-16 text-mist">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const inputCls = "h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const overrideMap = new Map(data.overrides.map((o) => [o.productId, o.chapas]));

  const filteredProducts = prodSearch.trim()
    ? br.products.filter((p) => p.name.toLowerCase().includes(prodSearch.trim().toLowerCase()))
    : br.products.filter((p) => overrideMap.has(p.id));

  function saveReward() {
    if (!draft || !draft.title.trim()) {
      toast.message("La oferta necesita un título.");
      return;
    }
    act(
      br.upsertChapaReward({
        id: draft.id,
        title: draft.title,
        description: draft.description || null,
        image: draft.image ? draft.image : null,
        cost: Math.max(1, Math.floor(Number(draft.cost) || 1)),
        valueEuro: Math.max(0, Number(draft.valueEuro) || 0),
        stock: Math.round(draft.stock) === -1 ? -1 : Math.max(0, Math.floor(Number(draft.stock) || 0)),
        productId: draft.productId || null,
        active: draft.active,
        sort: Math.floor(Number(draft.sort) || 0),
      }),
      draft.id ? "Oferta actualizada" : "Oferta publicada",
    );
    setDraft(null);
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ config */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Programa de chapas</h2>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#2f6d56]"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
          Chapas activas (los pedidos entregados suman chapas y la página «Chapas» se abre)
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelCls}>Título</span>
            <input className={inputCls} value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
          </label>
          <label>
            <span className={labelCls}>€ gastados que regalan 1 chapa (equilibrio)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              className={inputCls}
              value={cfg.eurosPerChapa}
              onChange={(e) => setCfg({ ...cfg, eurosPerChapa: Number(e.target.value) })}
            />
            <span className="mt-1 block text-[11px] text-muted">
              Con 12 € por chapa, para 100 chapas hay que gastar ~1.200 €: así 100 chapas = 12 € de
              regalo queda equilibrado.
            </span>
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Subtítulo</span>
            <input className={inputCls} value={cfg.subtitle} onChange={(e) => setCfg({ ...cfg, subtitle: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Cómo se ganan (texto de la página)</span>
            <textarea
              className="min-h-20 w-full rounded-xl bg-paper p-3 text-sm shadow-card"
              value={cfg.howItWorks}
              onChange={(e) => setCfg({ ...cfg, howItWorks: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={labelCls}>Nota de canje (letra pequeña)</span>
            <input className={inputCls} value={cfg.redeemNote} onChange={(e) => setCfg({ ...cfg, redeemNote: e.target.value })} />
          </label>
        </div>
        <Button
          className="mt-4"
          onClick={() =>
            act(
              br.saveChapaConfig({
                enabled: cfg.enabled,
                title: cfg.title,
                subtitle: cfg.subtitle,
                howItWorks: cfg.howItWorks,
                redeemNote: cfg.redeemNote,
                eurosPerChapa: Math.max(0, Number(cfg.eurosPerChapa) || 0),
              }),
              "Configuración guardada",
            )
          }
        >
          <Save className="mr-1.5 h-4 w-4" /> Guardar configuración
        </Button>
      </section>

      {/* ------------------------------------------------ chapas por producto */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Chapas por producto (packs)</h2>
        <p className="mt-2 text-xs text-muted">
          Fija cuántas chapas REGALA cada unidad de un producto al comprarlo (ideal para packs). Sin
          override, el producto suma por la regla general de € gastado.
        </p>
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className={cn(inputCls, "pl-9")}
              placeholder="Busca un producto para ver/poner su chapa…"
              value={prodSearch}
              onChange={(e) => setProdSearch(e.target.value)}
            />
          </div>
        </div>
        <ul className="mt-3 divide-y divide-line/20">
          {filteredProducts.slice(0, 30).map((p) => {
            const val = overrideMap.get(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                {val === undefined ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOverrideFor({ productId: p.id, name: p.name, chapas: "" })}
                  >
                    Poner chapa
                  </Button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1 font-semibold text-bottle">
                      <ChapaIcon size={18} /> +{val} /ud
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOverrideFor({ productId: p.id, name: p.name, chapas: String(val) })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(br.setChapaProduct({ productId: p.id, chapas: null }), "Override quitado")}
                    >
                      <Trash2 className="h-4 w-4 text-ember" />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
          {filteredProducts.length === 0 ? (
            <li className="py-4 text-center text-sm text-muted">
              {prodSearch ? "Ningún producto coincide." : "Todavía no hay productos con chapa propia: busca uno arriba."}
            </li>
          ) : null}
        </ul>
        {overrideFor ? (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line/30 bg-night/5 p-3">
            <label className="flex-1">
              <span className={labelCls}>Chapa extra por unidad de «{overrideFor.name}»</span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={overrideFor.chapas}
                onChange={(e) => setOverrideFor({ ...overrideFor, chapas: e.target.value })}
                placeholder="p. ej. 5"
              />
            </label>
            <Button
              size="sm"
              onClick={() => {
                const v = Math.max(0, Math.floor(Number(overrideFor.chapas)));
                act(br.setChapaProduct({ productId: overrideFor.productId, chapas: v }), "Chapa guardada");
                setOverrideFor(null);
              }}
            >
              Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOverrideFor(null)}>
              Cancelar
            </Button>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ ofertas de canje */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Ofertas canjeables por chapas</h2>
          <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT, sort: data.rewards.length })}>
            <Plus className="mr-1.5 h-4 w-4" /> Nueva oferta
          </Button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-140 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Oferta</th>
                <th className="py-2 pr-3">Cuesta</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rewards.map((r) => (
                <tr key={r.id} className="border-t border-line/20">
                  <td className="py-2 pr-3">
                    {r.title}
                    {r.productId ? <span className="ml-1 text-xs text-muted">· producto del catálogo</span> : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {r.cost} chapas
                    {r.valueEuro > 0 ? (
                      <span className="ml-1 text-xs text-muted">· valor {r.valueEuro.toFixed(2).replace(/\.00$/, "")} €</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.stock === -1 ? "∞" : r.stock}</td>
                  <td className="py-2 pr-3">
                    <span className={cn("text-xs font-semibold", r.active ? "text-bottle" : "text-muted")}>
                      {r.active ? "activa" : "oculta"}
                    </span>
                  </td>
                  <td className="py-2 whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          id: r.id,
                          title: r.title,
                          description: r.description ?? "",
                          image: r.image ?? "",
                          cost: r.cost,
                          valueEuro: r.valueEuro,
                          stock: r.stock,
                          productId: r.productId ?? "",
                          active: r.active,
                          sort: r.sort,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(br.deleteChapaReward({ id: r.id }), "Oferta eliminada")}>
                      <Trash2 className="h-4 w-4 text-ember" />
                    </Button>
                  </td>
                </tr>
              ))}
              {data.rewards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-muted">
                    Sin ofertas publicadas. Crea la primera: se paga en chapas, no en dinero.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {draft ? (
          <div className="mt-4 rounded-2xl border border-line/30 bg-night/5 p-4">
            <p className="text-sm font-semibold">{draft.id ? "Editar oferta" : "Nueva oferta"}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelCls}>Título</span>
                <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label>
                <span className={labelCls}>Chapas que cuesta</span>
                <input type="number" min={1} className={inputCls} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })} />
              </label>
              <label>
                <span className={labelCls}>Valor del regalo en € (0 = coste a mano)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className={inputCls}
                  value={draft.valueEuro}
                  onChange={(e) => setDraft({ ...draft, valueEuro: Number(e.target.value) })}
                />
                {draft.valueEuro > 0 ? (
                  <span className="mt-1 block text-[11px] text-bottle">
                    Con valor &gt; 0 el coste se fija solo: {chapaCostFromValue(draft.valueEuro)} chapas
                    (equiv. {EQUIV_CHAPAS} chapas = {EQUIV_EURO} €).
                  </span>
                ) : null}
              </label>
              <label>
                <span className={labelCls}>Stock (-1 = ilimitado)</span>
                <input type="number" min={-1} className={inputCls} value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
              </label>
              <label>
                <span className={labelCls}>Producto del catálogo a entregar (opcional)</span>
                <select className={inputCls} value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}>
                  <option value="">— sin producto —</option>
                  {br.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className={labelCls}>Descripción</span>
                <input className={inputCls} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <label className="sm:col-span-2">
                <span className={labelCls}>Imagen (URL o data URL)</span>
                <input className={inputCls} value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} placeholder="/products/… o https://…" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[#2f6d56]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Oferta visible
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={saveReward}>
                <Save className="mr-1.5 h-4 w-4" /> Guardar oferta
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ saldos */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Saldos de chapas</h2>
        <div className="mt-3 max-h-64 overflow-y-auto">
          <ul className="divide-y divide-line/20 text-sm">
            {data.balances.map((b) => (
              <li key={b.customer} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-muted">{b.customer}</span>
                <span className="flex items-center gap-1 font-semibold tabular-nums text-bottle">
                  <ChapaIcon size={16} /> {b.balance}
                </span>
              </li>
            ))}
            {data.balances.length === 0 ? (
              <li className="py-4 text-center text-sm text-muted">Todavía nadie tiene chapas.</li>
            ) : null}
          </ul>
        </div>
        <p className="mt-4 text-xs font-medium">Ajuste manual (regalo o corrección; queda registrado)</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-40">
            <span className={labelCls}>Email del cliente</span>
            <input className={inputCls} value={adjust.email} onChange={(e) => setAdjust({ ...adjust, email: e.target.value })} placeholder="cliente@correo.es" />
          </label>
          <label className="w-28">
            <span className={labelCls}>Δ chapas</span>
            <input type="number" className={inputCls} value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })} placeholder="+25" />
          </label>
          <label className="flex-1 min-w-40">
            <span className={labelCls}>Motivo</span>
            <input className={inputCls} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Sorteo interno, error…" />
          </label>
          <Button
            size="sm"
            onClick={() => {
              const d = Math.trunc(Number(adjust.delta));
              if (!adjust.email.trim() || !d) {
                toast.message("Pon email y un cambio distinto de 0.");
                return;
              }
              act(
                br.adjustChapaBalance({ email: adjust.email.trim(), delta: d, reason: adjust.reason.trim() || "Ajuste admin" }),
                "Saldo ajustado",
              );
              setAdjust({ email: "", delta: "", reason: "" });
            }}
          >
            Aplicar
          </Button>
        </div>
      </section>
    </div>
  );
}
