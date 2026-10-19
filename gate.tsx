import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { StoreShell } from "@/components/layout/store-shell";
import type { Role } from "@/data/types";
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    const fd = new FormData(e.currentTarget);
    // `br.login` es ahora asíncrono: habla con MySQL por `createServerFn`.
    // El servidor emite el token de sesión y lo guarda en `sessionStorage`
    // (`@/lib/br-db`); el rol se lee de esa sesión, nunca de un campo del cliente.
    let res;
    try {
      res = await br.login({
        email: String(fd.get("email")),
        pass: String(fd.get("pass")),
      });
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo conectar con el servidor.");
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
      {err ? <p className="text-sm text-ember">{err}</p> : null}
      <Button type="submit" className="w-full" disabled={br.loginPending}>
        {br.loginPending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}

export function searchNext(s: Record<string, unknown>): { next?: string } {
  return { next: typeof s.next === "string" ? s.next : undefined };
}
