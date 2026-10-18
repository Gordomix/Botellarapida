import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { StoreShell } from "@/components/layout/store-shell";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/soporte")({ component: Page });

function Page() {
  const br = useBr();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    const fd = new FormData(e.currentTarget);
    try {
      await br.sendMessage({ email: String(fd.get("email")), text: String(fd.get("text")) });
      setOk(true);
      e.currentTarget.reset();
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo enviar el mensaje.");
    }
  }
  return (
    <StoreShell>
      <div className="mx-auto max-w-lg px-4 py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Soporte</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper">Te leemos.</h1>
        <p className="mt-3 text-mist">Sin cuenta. Un email y el recado. El admin responde desde el panel.</p>
        {ok ? (
          <p className="mt-8 rounded-2xl bg-surface p-5 text-sm text-bottle shadow-card">Mensaje enviado. Si hace falta, te escribimos.</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-3 rounded-[1.5rem] bg-surface p-6 shadow-card">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Email</span>
              <input name="email" type="email" required className="h-11 w-full rounded-2xl bg-paper px-3 text-sm shadow-card" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Mensaje</span>
              <textarea name="text" required className="min-h-32 w-full rounded-2xl bg-paper p-3 text-sm shadow-card" />
            </label>
            {err ? <p className="text-sm text-ember">{err}</p> : null}
            <Button type="submit" className="w-full">
              Enviar
            </Button>
          </form>
        )}
      </div>
    </StoreShell>
  );
}
