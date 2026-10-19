import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, MailX, Loader2 } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";
import { verifyEmailFn } from "@/lib/br-api";
import { setSession } from "@/lib/br-db";

export const Route = createFileRoute("/verificar")({
  component: Verificar,
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

type Phase = "sending" | "ok" | "fail";

/**
 * Confirmación de email tras registrarse con contraseña. El enlace que envía
 * `botellarapidadmin@gmail.com` apunta aquí con `?token=...`. Se canjea UNA sola
 * vez contra el servidor (el token caduca y es de un solo uso). Desde la
 * Fase 13, si el servidor devuelve sesión (cuenta ya activa), la página la
 * aplica igual que el login y te lleva a la tienda: un clic = confirmado +
 * dentro. Sin sesión (p. ej. repartidor pendiente de aprobación) manda a entrar
 * a mano, como siempre.
 */
function Verificar() {
  const { token } = Route.useSearch();
  const [phase, setPhase] = useState<Phase>(token ? "sending" : "fail");
  const [msg, setMsg] = useState(
    token ? "" : "El enlace no es válido. Pide uno nuevo desde el inicio de sesión.",
  );
  // true = hay sesión aplicada y la página va a saltar a la tienda sola.
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;
    verifyEmailFn({ data: { token } })
      .then((r) => {
        if (!alive) return;
        setPhase(r.ok ? "ok" : "fail");
        setMsg(r.msg);
        // Auto-entrada: mismo canal que el login (sessionStorage + evento) y
        // además la cookie httpOnly que ya fijó el servidor. El redirect con
        // recarga completa arranca la app con la sesión recién creada limpia.
        if (r.ok && r.session) {
          setSession(r.session);
          setEntering(true);
          redirectTimer = setTimeout(() => window.location.assign("/"), 1600);
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setPhase("fail");
        setMsg(e instanceof Error ? e.message : "No se pudo confirmar el correo.");
      });
    return () => {
      alive = false;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
    // El token se canjea una única vez por montaje; no se re-lanza al re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StoreShell>
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full rounded-[1.5rem] bg-surface p-8 text-ink shadow-card">
          {phase === "sending" ? (
            <>
              <Loader2 className="mx-auto size-10 animate-spin text-ember" />
              <h1 className="mt-4 font-display text-2xl font-semibold">Confirmando tu correo…</h1>
              <p className="mt-2 text-sm text-muted">Un momento, estamos activando tu cuenta.</p>
            </>
          ) : phase === "ok" ? (
            <>
              <CheckCircle2 className="mx-auto size-10 text-bottle" />
              <h1 className="mt-4 font-display text-2xl font-semibold">
                {entering ? "¡Listo! Entrando…" : "¡Correo confirmado!"}
              </h1>
              <p className="mt-2 text-sm text-muted">{msg}</p>
              {entering ? (
                <Loader2 className="mx-auto mt-6 size-6 animate-spin text-ember" aria-hidden />
              ) : (
                <a
                  href="/acceso"
                  className="mt-6 inline-block rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-paper"
                >
                  Ir a iniciar sesión
                </a>
              )}
            </>
          ) : (
            <>
              <MailX className="mx-auto size-10 text-ember" />
              <h1 className="mt-4 font-display text-2xl font-semibold">No se pudo confirmar</h1>
              <p className="mt-2 text-sm text-muted">{msg}</p>
              <a
                href="/acceso"
                className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper"
              >
                Volver al acceso
              </a>
            </>
          )}
        </div>
      </div>
    </StoreShell>
  );
}
