import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/gate";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";

function searchToken(s: Record<string, unknown>): { token?: string } {
  return { token: typeof s.token === "string" ? s.token : undefined };
}

export const Route = createFileRoute("/restablecer")({
  validateSearch: searchToken,
  component: Page,
});

/**
 * Destino del enlace de recuperación (`/restablecer?token=…`). Escribe la nueva
 * contraseña dos veces y la aplica en servidor con el token de un solo uso.
 *
 * Si el enlace no llegó bien (correo sin `PUBLIC_APP_URL`, cliente de email que
 * rompió la URL, etc.) se puede PEGAR el código suelto que también manda el
 * correo: sin `?token=` en la URL aparece un campo para ello.
 */
function Page() {
  const { token: urlToken } = Route.useSearch();
  const br = useBr();
  const [manual, setManual] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const token = (urlToken || manual).trim();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (!token) {
      setErr("Pega el código de recuperación que te enviamos por correo.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const pass = String(fd.get("pass") || "");
    const pass2 = String(fd.get("pass2") || "");
    if (pass.length < 8) {
      setErr("La contraseña necesita al menos 8 caracteres.");
      return;
    }
    if (pass !== pass2) {
      setErr("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const res = await br.resetPassword({ token, pass });
      if (res.ok) setDone(true);
      else setErr(res.msg);
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Nueva contraseña" sub="Elige una contraseña para tu cuenta.">
      {done ? (
        <div className="space-y-4">
          <p className="text-sm">
            Listo. Tu contraseña se ha actualizado y se han cerrado las sesiones
            anteriores por seguridad.
          </p>
          <Button asChild className="w-full">
            <Link to="/login/cliente">Entrar con la nueva</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          {!urlToken ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Código de recuperación
              </span>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoComplete="one-time-code"
                placeholder="Pega aquí el código del correo"
                className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
              />
              <span className="mt-1 block text-xs text-muted">
                ¿El enlace del correo no funcionó? Copia y pega aquí el código que
                va en el mensaje.
              </span>
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Contraseña nueva</span>
            <input
              name="pass"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Repite la contraseña</span>
            <input
              name="pass2"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          {err ? <p className="text-sm text-ember">{err}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Guardando…" : "Guardar contraseña"}
          </Button>
          <p className="text-center text-sm text-muted">
            ¿No tienes el código?{" "}
            <Link to="/recuperar" className="font-medium text-ember">
              Solicitar uno nuevo
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
