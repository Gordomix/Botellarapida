import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import type { Role } from "@/data/types";
import { useBr } from "@/lib/use-br";
import { cn } from "@/lib/utils";

const LOGIN: Record<Role, "/login/cliente" | "/login/repartidor" | "/login/admin"> = {
  user: "/login/cliente",
  repartidor: "/login/repartidor",
  admin: "/login/admin",
};

export function PanelShell({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const br = useBr();
  const navigate = useNavigate();

  useEffect(() => {
    // No decidir hasta haber leído `sessionStorage` en cliente: si no, el primer
    // render (sesión aún `null`) reexpulsaría a /login con la sesión ya guardada.
    if (!br.sessionReady) return;
    if (!br.session) {
      void navigate({ to: LOGIN[role], search: { next: window.location.pathname } });
      return;
    }
    if (br.session.role !== role) {
      void navigate({ to: "/acceso" });
    }
  }, [br.sessionReady, br.session, navigate, role]);

  if (!br.session || br.session.role !== role) {
    return (
      <div className="grid min-h-dvh place-items-center bg-night text-mist">
        Comprobando sesión…
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-night text-paper">
      <header className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Logo inverted />
          <div className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wider",
                role === "admin" && "bg-paper text-ink",
                role === "repartidor" && "bg-bottle text-surface",
                role === "user" && "bg-ember text-surface",
              )}
            >
              {role === "user" ? "cliente" : role}
            </span>
            <span className="hidden sm:inline text-surface/80">{br.session.name}</span>
            <Link to="/" className="text-surface/80 hover:text-surface">
              Tienda
            </Link>
            <Button
              size="sm"
              variant="ghost"
              className="bg-paper/10 text-paper hover:bg-paper/16"
              onClick={() => {
                br.logout();
                void navigate({ to: "/acceso" });
              }}
            >
              Salir
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "wait" | "go" | "warn" | "stop" | "info";
}) {
  const map = {
    neutral: "bg-ink/10 text-ink",
    wait: "bg-ember/15 text-ember-dark",
    go: "bg-bottle/15 text-bottle",
    warn: "bg-ember/20 text-ember-dark",
    stop: "bg-adult/15 text-adult",
    info: "bg-bottle/10 text-bottle",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold", map[tone])}>
      {children}
    </span>
  );
}

export function statusTone(st: string) {
  if (st === "entregado" || st === "resuelta" || st === "respondido" || st === "activo") return "go" as const;
  if (st === "pendiente" || st === "abierta" || st === "abierto" || st === "solicitud") return "wait" as const;
  if (st === "en_reparto") return "warn" as const;
  if (st === "asignado") return "info" as const;
  if (st === "cancelado" || st === "rechazado" || st === "suspendido") return "stop" as const;
  return "neutral" as const;
}
