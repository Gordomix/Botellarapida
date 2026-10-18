import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/gate";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/registro/cliente")({ component: Page });

function Page() {
  const br = useBr();
  const navigate = useNavigate();
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const pass = String(fd.get("pass"));
    let res;
    try {
      res = await br.registerUser({
        name: String(fd.get("name")),
        email,
        pass,
        role: "user",
      });
    } catch (cause) {
      setErr((cause as Error)?.message || "No se pudo conectar con el servidor.");
      return;
    }
    if (!res.ok) {
      setErr(res.msg);
      return;
    }
    // Alta en MySQL; entramos con la misma cuenta para tener sesión (token) ya.
    const logged = await br.login({ email, pass }).catch(() => null);
    if (!logged?.ok) {
      setErr("Cuenta creada, pero no se pudo entrar. Inténtalo desde Entrar.");
      return;
    }
    void navigate({ to: "/cuenta" });
  }

  return (
    <AuthLayout title="Crear cuenta" sub="Un nombre, un email, y a picar.">
      <form onSubmit={onSubmit} className="space-y-3">
        <In name="name" label="Nombre" autoComplete="name" />
        <In name="email" label="Email" type="email" autoComplete="email" />
        <In name="pass" label="Contraseña" type="password" autoComplete="new-password" />
        {err ? <p className="text-sm text-ember">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={br.registerPending}>
          {br.registerPending ? "Creando…" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link to="/login/cliente" search={{ next: undefined }} className="font-medium text-ember">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

function In({
  name,
  label,
  type = "text",
  autoComplete,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
      />
    </label>
  );
}
