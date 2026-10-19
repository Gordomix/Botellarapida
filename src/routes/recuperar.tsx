import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth/gate";
import { Button } from "@/components/ui/button";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/recuperar")({
  component: Page,
});

/**
 * "¿Has olvidado tu contraseña?" — pide un enlace de restablecimiento por email.
 * Si el correo no tiene cuenta, el servidor lo dice claro y aquí se enlaza a
 * «Crear cuenta»; con cuenta, mostramos el aviso de "revisa tu correo".
 */
function Page() {
  const br = useBr();
  const [sent, setSent] = useState(false);
  const [noAccount, setNoAccount] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setNoAccount(false);
    const email = String(new FormData(e.currentTarget).get("email") || "").trim();
    if (!email) {
      setErr("Introduce tu email.");
      return;
    }
    setBusy(true);
    try {
      const res = await br.requestPasswordReset(email);
      if (res.ok) setSent(true);
      else {
        setErr(res.msg);
        setNoAccount(res.exists === false);
      }
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Recuperar acceso"
      sub="Rellena tu email y te devolvemos el acceso lo antes posible."
    >
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm">
            Hemos <strong>registrado tu solicitud</strong>. Si tu correo tiene cuenta, te
            llegará un <strong>enlace válido 1 hora</strong> para elegir contraseña nueva
            (revisa también spam). Si no, <strong>nuestro equipo revisará la petición</strong>
            y te hará llegar el acceso por tu canal de contacto.
          </p>
          <p className="text-sm text-muted">
            Por tu seguridad, una persona valida la identidad antes de restablecer la clave.
          </p>
          <Button asChild className="w-full">
            <Link to="/login/cliente">Ya la tengo, entrar</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
          </label>
          {err ? <p className="text-sm text-ember">{err}</p> : null}
          {noAccount ? (
            <p className="text-sm">
              ¿Aún no la tienes?{" "}
              <Link to="/registro/cliente" className="font-medium text-ember">
                Crear cuenta
              </Link>
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Enviando…" : "Solicitar recuperación"}
          </Button>
          <p className="text-center text-sm text-muted">
            ¿Lo recuerdas?{" "}
            <Link to="/login/cliente" className="font-medium text-ember">
              Volver a entrar
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
