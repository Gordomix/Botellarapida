import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Lock, ShoppingBag, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreShell } from "@/components/layout/store-shell";
import type { Role } from "@/data/types";
import { googleSignInFn, googleStatusFn } from "@/lib/br-api";
import { setSession } from "@/lib/br-db";
import { useBr } from "@/lib/use-br";

const HOME: Record<Role, string> = {
  user: "/cuenta",
  repartidor: "/repartidor",
  admin: "/admin",
};

export function AuthLayout({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <StoreShell>
      <div className="mx-auto grid max-w-5xl gap-0 px-4 py-10 lg:grid-cols-2 lg:overflow-hidden lg:rounded-[1.75rem] lg:bg-ink">
        <div className="relative hidden min-h-80 overflow-hidden lg:block">
          <img src="/brand/slides/nevera.jpg" alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-night/80 to-night/10" />
          <p className="absolute bottom-6 left-6 right-6 font-display text-2xl font-semibold text-paper">
            Express España. Entras, pides, llega.
          </p>
        </div>
        <div className="p-1 lg:p-10">
          <Link to="/acceso" className="text-sm text-mist hover:text-paper">
            ← Zonas de acceso
          </Link>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-paper">{title}</h1>
          <p className="mt-2 text-sm text-mist">{sub}</p>
          <div className="mt-8 rounded-[1.5rem] bg-surface p-6 shadow-card">{children}</div>
        </div>
      </div>
    </StoreShell>
  );
}

export function LoginForm({
  role,
  next,
}: {
  role: Role;
  next?: string;
}) {
  const br = useBr();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  // Fase 2 (2FA de admin): el campo de código SOLO aparece cuando el servidor
  // responde `totpRequired`. Para cualquier otra cuenta el formulario es
  // idéntico al de siempre — no cambia la estética ni un píxel.
  const [needCode, setNeedCode] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    const fd = new FormData(e.currentTarget);
    const code = needCode ? String(fd.get("code") ?? "").trim() : undefined;
    if (needCode && !code) {
      setErr("Introduce el código de tu app autenticadora (o el código maestro de acceso).");
      return;
    }
    // `br.login` es ahora asíncrono: habla con MySQL por `createServerFn`.
    // El servidor emite el token de sesión y lo guarda en `sessionStorage`
    // (`@/lib/br-db`); el rol se lee de esa sesión, nunca de un campo del cliente.
    let res;
    try {
      res = await br.login({
        email: String(fd.get("email")),
        pass: String(fd.get("pass")),
        code,
      });
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo conectar con el servidor.");
      return;
    }
    if (!res.ok && res.totpRequired) {
      // Contraseña correcta y 2FA activo: pedimos el segundo factor.
      setNeedCode(true);
      return;
    }
    if (!res.ok) {
      setErr(res.msg);
      return;
    }
    if (res.session && res.session.role !== role) {
      setErr("Esta puerta es de otro rol. Usa la zona de acceso correcta.");
      br.logout();
      return;
    }
    const dest = next && next.startsWith("/") ? next : HOME[role];
    if (dest === "/cuenta" || dest === "/repartidor" || dest === "/admin" || dest === "/") {
      void navigate({ to: dest });
    } else {
      window.location.assign(dest);
    }
  }

  return (
    <>
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
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Contraseña</span>
          <input
            name="pass"
            type="password"
            required
            autoComplete="current-password"
            className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
          />
        </label>
        {needCode ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Código de verificación</span>
            <input
              name="code"
              // `text` (no `numeric`): además de los 6 dígitos de la app cabe
              // el código maestro de emergencia del equipo, si hace falta.
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="123456"
              className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            />
            <span className="mt-1 block text-xs text-muted">
              El de tu app autenticadora o, en un apuro, el código maestro del equipo.
            </span>
          </label>
        ) : null}
        {err ? <p className="text-sm text-ember">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={br.loginPending}>
          {br.loginPending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      {/* Puerta de contraseña para TODOS los roles: clientes (correo y
          contraseña de siempre, con Google como opción secundaria debajo),
          repartidores y admin — la puerta NORMAL del equipo. */}
    </>
  );
}

/* ------------------------------------------------------------ con Google */

/**
 * Tipado MÍNIMO de Google Identity Services: el script vive solo en el
 * navegador y aquí se usan tres llamadas (cargar, inicializar, pintar el
 * botón). Sin dependencia npm: el SDK pesado no aporta nada a este flujo.
 */
type GsiId = {
  initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void }): void;
  renderButton(
    el: HTMLElement,
    opts: { theme?: string; size?: string; text?: string; shape?: string; locale?: string },
  ): void;
};
declare global {
  interface Window {
    google?: { accounts: { id?: GsiId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

/**
 * Botón oficial «Continuar con Google». Solo aparece si el servidor tiene
 * `GOOGLE_CLIENT_ID` (consulta `googleStatusFn`): sin configuración, las
 * pantallas de acceso quedan exactamente como estaban. El flujo:
 *  1. Google abre su ventana de cuenta y nos devuelve un ID token firmado.
 *  2. El token viaja a `googleSignInFn`, que lo VERIFICA en servidor
 *     (firma/aud/exp) y decide: entra si hay cuenta con ese email, o crea un
 *     cliente nuevo al vuelo (el caso «olvidé mi contraseña» sin SMTP ni nada).
 *  3. Mismo destino que el login normal (`next` o el panel del rol).
 */
export function GoogleSignInButton({
  role,
  next,
  divider = "o bien",
  wrapClass = "mt-5",
  emptyState,
}: {
  role: Role;
  next?: string;
  /** Texto del separador superior; `null` lo oculta (pantallas solo-Google). */
  divider?: string | null;
  /** Clase del contenedor (margen superior por defecto). */
  wrapClass?: string;
  /** Qué pintar si Google no está configurado en el servidor. */
  emptyState?: ReactNode;
}) {
  const navigate = useNavigate();
  const br = useBr();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [clientId, setClientId] = useState("");
  const [off, setOff] = useState(false);
  const [err, setErr] = useState("");
  // Google inicializa el callback UNA vez al montar: no debe capturar estado
  // viejo (render → closure caduca). Delega siempre en el ref más reciente.
  const handlerRef = useRef<(credential: string) => void>(() => undefined);

  handlerRef.current = (credential) => {
    setErr("");
    void (async () => {
      try {
        const res = await googleSignInFn({
          data: { credential, intent: role === "repartidor" ? "repartidor" : "cliente" },
        });
        if (!res.ok || !res.session) {
          setErr(res.msg || "No se pudo iniciar sesión con Google.");
          return;
        }
        // Regla de puerta idéntica al formulario de contraseña: rol que no
        // coincide = sesión desechada al instante (se borra también en servidor).
        if (res.session.role !== role) {
          setErr("Esta puerta es de otro rol. Usa la zona de acceso correcta.");
          br.logout();
          return;
        }
        setSession(res.session);
        const dest = next && next.startsWith("/") ? next : HOME[role];
        if (dest === "/cuenta" || dest === "/repartidor" || dest === "/admin" || dest === "/") {
          void navigate({ to: dest });
        } else {
          window.location.assign(dest);
        }
      } catch (cause) {
        setErr((cause as Error)?.message || "No se pudo iniciar sesión con Google.");
      }
    })();
  };

  // ¿Activo? El servidor responde el client_id (público por diseño en OAuth).
  // Si no hay configuración Google, marcamos `off` para poder pintar un aviso
  // en lugar de dejar un hueco vacío (importante en la pantalla solo-Google).
  useEffect(() => {
    let cancelled = false;
    void googleStatusFn()
      .then((s) => {
        if (cancelled) return;
        if (s.enabled && s.clientId) setClientId(s.clientId);
        else setOff(true);
      })
      .catch(() => {
        if (!cancelled) setOff(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Carga el script oficial una sola vez y pinta el botón en el contenedor.
  useEffect(() => {
    if (!clientId) return;
    const mount = () => {
      const gsi = window.google?.accounts?.id;
      if (!gsi || !boxRef.current) return;
      gsi.initialize({
        client_id: clientId,
        callback: (r) => {
          if (r.credential) handlerRef.current(r.credential);
        },
      });
      gsi.renderButton(boxRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        locale: "es",
      });
    };
    if (window.google?.accounts?.id) {
      mount();
      return;
    }
    if (document.querySelector(`script[src="${GSI_SRC}"]`)) {
      // Otra instancia lo está cargando: esperar a que aparezca el objeto.
      const t = window.setInterval(() => {
        if (window.google?.accounts?.id) {
          window.clearInterval(t);
          mount();
        }
      }, 200);
      window.setTimeout(() => window.clearInterval(t), 8_000);
      return;
    }
    const el = document.createElement("script");
    el.src = GSI_SRC;
    el.async = true;
    el.onload = mount;
    document.head.appendChild(el);
  }, [clientId]);

  // Sin configuración Google: aviso amable (o nada, si quien llama no lo pide).
  if (off) return <>{emptyState ?? null}</>;
  // Aún consultando el estado: no pintamos hueco.
  if (!clientId) return null;
  return (
    <div className={wrapClass}>
      {divider ? (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span aria-hidden className="h-px flex-1 bg-line" />
          <span>{divider}</span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      ) : null}
      <div
        ref={boxRef}
        className={divider ? "mt-3 grid min-h-11 place-items-center" : "grid min-h-11 place-items-center"}
      />
      {err ? <p className="mt-2 text-sm text-ember">{err}</p> : null}
    </div>
  );
}

/* ------------------------------------------- acceso de clientes (solo Google) */

/**
 * Pantalla de CLIENTES: SOLO con Google. Un clic abre la cuenta de Google del
 * visitante; el servidor verifica el ID token firmado y, si no hay cuenta con
 * ese email, crea el cliente al vuelo (misma `googleSignIn`). El correo queda
 * verificado por Google (nadie suplanta a nadie) y no hay contraseñas que
 * recordar ni robar. Repartidores y admins NO pasan por aquí: usan la puerta
 * normal de contraseña (`LoginForm`).
 */
export function ClientGoogleLogin({
  next,
  mode = "entrar",
}: {
  next?: string;
  mode?: "entrar" | "crear";
}) {
  return (
    <div className="text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-ember/10 ring-1 ring-ember/20">
        <ShoppingBag className="size-8 text-ember" aria-hidden />
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold text-ink">
        {mode === "crear" ? "Crea tu cuenta en 2 segundos" : "Entra con tu cuenta de Google"}
      </h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
        Sin contraseñas que recordar. Google verifica que el correo es tuyo, así nadie puede
        suplantar tu cuenta.
      </p>
      <GoogleSignInButton
        role="user"
        next={next}
        divider={null}
        wrapClass="mt-6"
        emptyState={
          <p className="rounded-2xl bg-paper/60 p-4 text-sm text-muted shadow-card">
            El acceso con Google no está disponible ahora mismo. Vuelve a
            intentarlo en unos minutos.
          </p>
        }
      />
      <ul className="mt-7 space-y-2.5 text-left">
        <Feature
          icon={<Zap className="size-4 text-bottle" aria-hidden />}
          text="Acceso instantáneo: entras y pides, sin formularios."
        />
        <Feature
          icon={<ShieldCheck className="size-4 text-bottle" aria-hidden />}
          text="Correo verificado por Google: adiós a las cuentas falsas."
        />
        <Feature
          icon={<Lock className="size-4 text-bottle" aria-hidden />}
          text="Cero contraseñas que recordar ni que puedan robarte."
        />
      </ul>
    </div>
  );
}

function Feature({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3 text-sm text-ink/80">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-bottle/10">{icon}</span>
      {text}
    </li>
  );
}

export function searchNext(s: Record<string, unknown>): { next?: string } {
  return { next: typeof s.next === "string" ? s.next : undefined };
}
