import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthLayout, GoogleSignInButton } from "@/components/auth/gate";
import { mergeSection, SITE_DEFAULTS, type PortalesSection } from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/registro/cliente")({ component: Page });

function Page() {
  const br = useBr();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  // El admin puede cerrar las altas de cliente desde el panel («Ajustes»).
  const portales = mergeSection(SITE_DEFAULTS.portales, br.content.portales as PortalesSection);

  if (!portales.registroCliente) {
    return (
      <AuthLayout title="Altas cerradas" sub="El registro de clientes está temporalmente cerrado.">
        <p className="text-sm text-muted">Si ya tienes cuenta, puedes entrar igual.</p>
        <p className="mt-4 text-center text-sm text-muted">
          <Link to="/login/cliente" search={{ next: undefined }} className="font-medium text-ember">
            Entrar
          </Link>
        </p>
      </AuthLayout>
    );
  }

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
    // Alta en MySQL; si el correo no exige confirmación (sin SMTP, p. ej. local)
    // entramos con la misma cuenta para tener sesión ya. Si el login falla
    // (falta confirmar el correo, etc.) se muestra el aviso de `registerUser`.
    const logged = await br.login({ email, pass }).catch(() => null);
    if (!logged?.ok) {
      setErr(res.msg || "Cuenta creada. Entra desde «Entrar» cuando puedas.");
      void navigate({ to: "/login/cliente", search: { next: undefined } });
      return;
    }
    void navigate({ to: "/cuenta" });
  }

  return (
    <AuthLayout title="Crear cuenta" sub="Un nombre, un email, y a picar.">
      {/* Alta clásica por contraseña, como siempre; Google queda debajo como
          opción rápida para quien prefiera entrar con su cuenta de Google. */}
      <form onSubmit={onSubmit} className="space-y-3">
        <In name="name" label="Nombre" autoComplete="name" />
        <In name="email" label="Email" type="email" autoComplete="email" />
        <In name="pass" label="Contraseña" type="password" autoComplete="new-password" />
        {err ? <p className="text-sm text-ember">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={br.registerPending}>
          {br.registerPending ? "Creando…" : "Crear cuenta"}
        </Button>
      </form>
      <GoogleSignInButton role="user" next="/cuenta" divider="o bien creala con Google" />
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
