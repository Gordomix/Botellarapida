import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";
import type { PaymentProvider } from "@/data/types";

/** Ejecuta una acción avisando en toast (mismo patrón que el resto del panel). */
function act(promise: Promise<unknown>, ok?: string) {
  void promise
    .then(() => ok && toast.success(ok))
    .catch((err) => toast.error((err as Error)?.message || "No se pudo completar."));
}

const fmtWhen = (ms: number) =>
  ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_TONE: Record<string, string> = {
  pagado: "text-bottle",
  abierto: "text-[#b8860b]",
  cancelado: "text-ember",
};

/**
 * Pestaña «Pagos» del panel: manda sobre la pasarela por la que Botella Rápida
 * RECIBE dinero (migraciones 0029 y 0030). Aquí se elige el proveedor (PayPal
 * por defecto, Stripe como alternativa), se enciende el MODO PRUEBAS para
 * validar el flujo completo sin cobrar nada, se corta el cobro online con el
 * INTERRUPTOR MAESTRO (para retirar la cuenta actual antes de añadir otra) y
 * se pegan las CLAVES PROPIAS — guardadas en la BD, sin tocar el despliegue.
 */
export function PagosAdmin() {
  const br = useBr();
  const data = br.adminPayments;

  const inputCls = "h-10 w-full rounded-xl bg-paper px-3 text-sm shadow-card";
  const [provider, setProvider] = useState<PaymentProvider>("paypal");
  const [testMode, setTestMode] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loadedFrom, setLoadedFrom] = useState(false);
  // Claves (migración 0030): se guardan EN BD desde este panel. Vacío al
  // guardar = no tocar esa clave; el botón «Retirar» la borra (envía '').
  const [kPaypalId, setKPaypalId] = useState("");
  const [kPaypalSecret, setKPaypalSecret] = useState("");
  const [kStripe, setKStripe] = useState("");
  const [busyKeys, setBusyKeys] = useState(false);

  // El formulario refleja lo que hay en servidor (una vez por carga), igual
  // que las pestañas «Sorteos» y «Chapas».
  useEffect(() => {
    if (!data || loadedFrom) return;
    setProvider(data.settings.provider);
    setTestMode(data.settings.testMode);
    setEnabled(data.settings.enabled);
    setLoadedFrom(true);
  }, [data, loadedFrom]);

  if (br.adminPaymentsLoading || !data) {
    return (
      <div className="grid place-items-center py-16 text-mist">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  function save() {
    act(
      br.savePaymentSettings({ provider, testMode, enabled }),
      !enabled
        ? "Guardado: cobro online APAGADO (los pedidos vuelven a pago en mano)"
        : testMode
          ? "Guardado: modo pruebas ACTIVO (no se cobra nada real)"
          : "Guardado: cobro real por " + (provider === "paypal" ? "PayPal" : "tarjeta"),
    );
  }

  /** Guarda solo las claves ESCRITAS (las vacías no viajan: no se tocan). */
  function saveKeys() {
    const patch: Parameters<typeof br.savePaymentSettings>[0] = {};
    if (kPaypalId.trim()) patch.paypalClientId = kPaypalId.trim();
    if (kPaypalSecret.trim()) patch.paypalSecret = kPaypalSecret.trim();
    if (kStripe.trim()) patch.stripeSecretKey = kStripe.trim();
    if (!patch.paypalClientId && !patch.paypalSecret && !patch.stripeSecretKey) {
      toast.message("Escribe alguna clave para guardarla: dejar vacío significa no tocar.");
      return;
    }
    setBusyKeys(true);
    br.savePaymentSettings(patch)
      .then(() => {
        toast.success("Claves guardadas: ya puedes activar el cobro real con esa cuenta.");
        setKPaypalId("");
        setKPaypalSecret("");
        setKStripe("");
      })
      .catch((err) => toast.error((err as Error)?.message || "No se pudo guardar la clave."))
      .finally(() => setBusyKeys(false));
  }

  /** `''` borra la clave de BD: ese método deja de cobrar (migración 0030). */
  function removeKey(which: "paypalClientId" | "paypalSecret" | "stripeSecretKey", label: string) {
    act(
      br.savePaymentSettings({ [which]: "" }),
      `Clave retirada: ${label} no cobrará hasta que añadas otra cuenta.`,
    );
  }

  const liveBlocker =
    provider === "paypal" && !data.paypalConfigured
      ? "Sin claves de PayPal: escríbelas abajo en «Tu cuenta de cobro» (o activa el modo pruebas)."
      : provider === "stripe" && !data.stripeConfigured
        ? "Sin clave Stripe: escríbela abajo en «Tu cuenta de cobro» (o activa el modo pruebas)."
        : provider === "paypal" && !data.hasPublicUrl
          ? "Ojo: PayPal real necesita volver a tu web tras pagar; pide al técnico que fije PUBLIC_APP_URL en el despliegue."
          : null;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------- proveedor y modo */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Cómo cobramos</h2>
        <p className="mt-2 text-xs text-muted">
          Elige por dónde quieres RECIBIR dinero y prueba todo antes de cobrar de verdad.
        </p>

        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#2f6d56]"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          💳 Cobro online ACTIVO (interruptor maestro, para PayPal y tarjeta)
        </label>
        <p className="mt-1 text-[11px] text-muted">
          Con él apagado nadie puede pagar online por ningún método: el checkout vuelve al pago en
          mano. Úsalo para RETIRAR la cuenta de cobro actual antes de poner otra distinta.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
              provider === "paypal" ? "border-bottle bg-bottle/5" : "border-line/40 bg-night/5"
            }`}
          >
            <input
              type="radio"
              name="pay-provider"
              className="mt-1 size-4 accent-[#2f6d56]"
              checked={provider === "paypal"}
              onChange={() => setProvider("paypal")}
            />
            <span>
              <span className="block text-sm font-semibold">PayPal (recomendado)</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                El cliente paga con su cuenta de PayPal o tarjeta desde PayPal. Tú recibes en
                tu cuenta.
              </span>
              <span className={`mt-1 block text-[11px] font-semibold ${data.paypalConfigured ? "text-bottle" : "text-ember"}`}>
                {data.paypalConfigured
                  ? data.keysInDb.paypalId || data.keysInDb.paypalSecret
                    ? "✓ Claves activas · guardadas en este panel"
                    : "✓ Claves activas · configuradas en el servidor"
                  : "✗ Sin claves: añádelas abajo en «Tu cuenta de cobro»"}
              </span>
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
              provider === "stripe" ? "border-bottle bg-bottle/5" : "border-line/40 bg-night/5"
            }`}
          >
            <input
              type="radio"
              name="pay-provider"
              className="mt-1 size-4 accent-[#2f6d56]"
              checked={provider === "stripe"}
              onChange={() => setProvider("stripe")}
            />
            <span>
              <span className="block text-sm font-semibold">Tarjeta con Stripe</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Checkout de Stripe (Visa / Mastercard). Ya estaba preparado desde el inicio.
              </span>
              <span className={`mt-1 block text-[11px] font-semibold ${data.stripeConfigured ? "text-bottle" : "text-ember"}`}>
                {data.stripeConfigured
                  ? data.keysInDb.stripe
                    ? "✓ Clave activa · guardada en este panel"
                    : "✓ Clave activa · configurada en el servidor"
                  : "✗ Sin clave: añádela abajo en «Tu cuenta de cobro»"}
              </span>
            </span>
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#b8860b]"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          🧪 Modo pruebas: los pagos pasan por una pasarela SIMULADA (no se cobra nada)
        </label>
        <p className="mt-1 text-[11px] text-muted">
          Con el modo pruebas activo, el «Pagar» del cliente abre una pantalla de pruebas donde
          aprobar el pago sin cargo real: ideal para comprobar el flujo completo (pedido pagado,
          premio descubierto, avisos). Apágalo cuando quieras cobrar de verdad.
        </p>
        {liveBlocker && !testMode ? (
          <p className="mt-3 rounded-xl bg-ember/10 p-3 text-xs font-medium text-ember">{liveBlocker}</p>
        ) : null}

        <Button className="mt-4" onClick={save}>
          <Save className="mr-1.5 h-4 w-4" /> Guardar pasarela
        </Button>
        <p className="mt-2 text-[11px] text-muted">
          Estado actual:{" "}
          <strong>
            {!enabled
              ? "cobro online APAGADO (pago en mano)"
              : testMode
                ? "🧪 MODO PRUEBAS (pagos simulados)"
                : `cobro real por ${provider === "paypal" ? "PayPal" : "Stripe"}`}
          </strong>
        </p>
      </section>

      {/* ------------------------------------------------- cuenta de cobro */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Tu cuenta de cobro</h2>
        <p className="mt-2 text-xs text-muted">
          Pega aquí las claves de TU cuenta (PayPal Business o Stripe). Se guardan en la base de
          datos del panel: cambiar de cuenta mañana es borrar estas y escribir las nuevas, sin
          tocar el despliegue. <strong>Dejar un campo vacío = no tocar esa clave.</strong>
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="k-pp-id">
              PayPal Client ID
            </label>
            <input
              id="k-pp-id"
              className={`mt-1 ${inputCls}`}
              value={kPaypalId}
              onChange={(e) => setKPaypalId(e.target.value)}
              placeholder={data.keysInDb.paypalId ? "Guardada en el panel: escribe otra para sustituirla" : "AX… (te la da developer.paypal.com)"}
              autoComplete="off"
            />
            {data.keysInDb.paypalId ? (
              <button type="button" className="mt-1 text-xs font-medium text-ember underline" onClick={() => removeKey("paypalClientId", "PayPal Client ID")}>
                Retirar esta clave
              </button>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="k-pp-secret">
              PayPal Secret
            </label>
            <input
              id="k-pp-secret"
              type="password"
              className={`mt-1 ${inputCls}`}
              value={kPaypalSecret}
              onChange={(e) => setKPaypalSecret(e.target.value)}
              placeholder={data.keysInDb.paypalSecret ? "Guardada en el panel: escribe otra para sustituirla" : "E… (el secret del mismo app)"}
              autoComplete="off"
            />
            {data.keysInDb.paypalSecret ? (
              <button type="button" className="mt-1 text-xs font-medium text-ember underline" onClick={() => removeKey("paypalSecret", "PayPal Secret")}>
                Retirar esta clave
              </button>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="k-stripe">
              Stripe Secret Key (alternativa de tarjeta)
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <input
                id="k-stripe"
                type="password"
                className={`${inputCls} max-w-md`}
                value={kStripe}
                onChange={(e) => setKStripe(e.target.value)}
                placeholder={data.keysInDb.stripe ? "Guardada en el panel: escribe otra para sustituirla" : "sk_live_… (opcional: solo si eliges Stripe)"}
                autoComplete="off"
              />
              {data.keysInDb.stripe ? (
                <button type="button" className="text-xs font-medium text-ember underline" onClick={() => removeKey("stripeSecretKey", "la clave Stripe")}>
                  Retirar esta clave
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <Button className="mt-4" onClick={saveKeys} disabled={busyKeys}>
          <Save className="mr-1.5 h-4 w-4" /> {busyKeys ? "Guardando claves…" : "Guardar claves"}
        </Button>
        <p className="mt-2 text-[11px] text-muted">
          ¿Vas a poner el PayPal real? Escribe aquí sus dos claves, guarda, deja el interruptor
          maestro activo y apaga el modo pruebas: es todo.
        </p>
      </section>

      {/* ------------------------------------------------- guía de pruebas */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Comprueba el pago como cliente</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Activa arriba el <strong>modo pruebas</strong> y guarda.
          </li>
          <li>
            Entra como cliente (o usa el botón «Crear pedido de prueba» de arriba del panel) y
            haz un pedido eligiendo <strong>PayPal / Tarjeta</strong> en el checkout: te abrirá la
            pantalla de pago de pruebas.
          </li>
          <li>
            Pulsa <strong>«Pagar (simulado)»</strong>: el pedido queda pagado de verdad en tu
            sistema (historial, delegación al repartidor…) pero sin cargo real.
          </li>
          <li>
            Para la ruleta: gana un premio con coste y pulsa «Pagar y descubrir» — en modo pruebas
            el premio se descubre al aprobar el pago simulado, igual que con PayPal real.
          </li>
          <li>
            Revisa abajo el <strong>histórico</strong>: cada intento sale con su proveedor
            (<code>demo</code> = simulado) y estado. También verás los avisos de «¡He ganado!»
            en la pestaña Sorteos.
          </li>
          <li>
            Cuando todo cuadre: apaga el modo pruebas, pega las claves reales de tu cuenta en
            «Tu cuenta de cobro» y deja el interruptor maestro activo para cobrar de verdad.
          </li>
        </ol>
      </section>

      {/* ------------------------------------------------- histórico */}
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="font-display text-xl font-semibold">Histórico de pagos</h2>
        <p className="mt-2 text-xs text-muted">
              Últimos intentos de pago (pedidos y reclamaciones de la ruleta). «Simulado» = aprobado
              en modo pruebas: no se cobró nada.
        </p>
        {data.payments.length === 0 ? (
          <p className="mt-3 rounded-xl bg-night/10 p-4 text-center text-sm text-muted">
            Todavía no hay ningún intento de pago: haz una prueba con el modo pruebas activo.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line/40 text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Referencia</th>
                  <th className="py-2 pr-3 text-right">Importe</th>
                  <th className="py-2 pr-3">Método</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={`${p.kind}-${p.id}`} className="border-b border-line/20">
                    <td className="py-2 pr-3 text-xs text-muted">{fmtWhen(p.createdAt)}</td>
                    <td className="py-2 pr-3">{p.kind === "pedido" ? "Pedido" : "Ruleta"}</td>
                    <td className="py-2 pr-3 font-semibold">{p.code}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.amount.toFixed(2)} €</td>
                    <td className="py-2 pr-3 text-xs">
                      {p.provider === "demo" ? "🧪 Simulado" : p.provider === "paypal" ? "PayPal" : "Stripe"}
                    </td>
                    <td className={`py-2 text-xs font-semibold ${STATUS_TONE[p.status] ?? "text-muted"}`}>
                      {p.status === "pagado" ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3.5" /> Pagado
                        </span>
                      ) : p.status === "cancelado" ? (
                        <span className="inline-flex items-center gap-1">
                          <XCircle className="size-3.5" /> Cancelado
                        </span>
                      ) : (
                        "Abierto"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
