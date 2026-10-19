import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { PanelShell, Pill, statusTone } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/format";
import { useBr } from "@/lib/use-br";
import { fmtDate, fmtEur } from "@/lib/utils";

export const Route = createFileRoute("/cuenta")({ component: Page });

function Page() {
  return (
    <PanelShell role="user">
      <CuentaInner />
    </PanelShell>
  );
}

function CuentaInner() {
  const br = useBr();
  const mine = br.orders
    .filter((o) => o.customer === br.session?.email)
    .sort((a, b) => b.createdAt - a.createdAt);
  const claims = br.claims.filter((c) => c.email === br.session?.email);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Área cliente</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-paper">Tus pedidos</h1>
      </div>
      {mine.length === 0 ? (
        <p className="text-mist">Aún no hay pedidos. La cesta de la tienda termina aquí.</p>
      ) : (
        <ul className="space-y-4">
          {mine.map((o) => (
            <li key={o.id} className="rounded-[1.5rem] bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-xl font-semibold tabular-nums">{o.code}</p>
                <Pill tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Pill>
              </div>
              <p className="mt-1 text-sm text-muted">
                {fmtDate(o.createdAt)} · {fmtEur(o.total)} · {o.address}
              </p>
              <ol className="mt-4 space-y-1.5 border-l border-line pl-4 text-sm">
                {o.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-muted">{fmtDate(h.at)}</span> · {h.what}{" "}
                    <span className="text-muted">({h.by})</span>
                  </li>
                ))}
              </ol>
              <ul className="mt-3 text-sm text-muted">
                {o.items.map((it) => (
                  <li key={it.id}>
                    {it.qty} × {it.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ClaimForm />

      {claims.length ? (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Reclamaciones</h2>
          <ul className="space-y-3">
            {claims.map((c) => (
              <li key={c.id} className="rounded-2xl bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.orderCode || "Sin código"} · {c.type}</p>
                  <Pill tone={statusTone(c.status)}>{c.status}</Pill>
                </div>
                <p className="mt-2 text-sm">{c.text}</p>
                {c.answer ? <p className="mt-2 text-sm text-bottle">{c.answer}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ClaimForm() {
  const br = useBr();
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOk("");
    setErr("");
    const fd = new FormData(e.currentTarget);
    try {
      // El servidor fija el `email` desde la sesión; el cliente no lo manda.
      await br.addClaim({
        orderCode: String(fd.get("code")),
        type: String(fd.get("type")) as "retraso" | "faltante" | "roto" | "otro",
        text: String(fd.get("text")),
      });
      setOk("Reclamación enviada.");
      e.currentTarget.reset();
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo enviar la reclamación.");
    }
  }
  return (
    <section className="rounded-[1.5rem] bg-surface p-5 shadow-card">
      <h2 className="font-display text-2xl font-semibold">Abrir reclamación</h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input name="code" placeholder="Código BR-XXXX" className="h-11 rounded-2xl bg-paper px-3 text-sm shadow-card" />
        <select name="type" className="h-11 rounded-2xl bg-paper px-3 text-sm shadow-card">
          <option value="retraso">Retraso</option>
          <option value="faltante">Faltante</option>
          <option value="roto">Producto dañado</option>
          <option value="otro">Otro</option>
        </select>
        <textarea
          name="text"
          required
          placeholder="Qué ha pasado"
          className="min-h-24 rounded-2xl bg-paper p-3 text-sm shadow-card sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <Button type="submit">Enviar</Button>
          {ok ? <span className="ml-3 text-sm text-bottle">{ok}</span> : null}
          {err ? <span className="ml-3 text-sm text-ember">{err}</span> : null}
        </div>
      </form>
    </section>
  );
}
