import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/gate";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/registro/repartidor")({ component: Page });

function Page() {
  const br = useBr();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    let res;
    try {
      res = await br.registerUser({
        name: String(fd.get("name")),
        email: String(fd.get("email")),
        pass: String(fd.get("pass")),
        role: "repartidor",
        dni: String(fd.get("dni")),
        vehicle: String(fd.get("vehicle")) as
          | "patinete"
          | "bici"
          | "moto"
          | "coche",
      });
    } catch (cause) {
      setOk(false);
      setMsg((cause as Error)?.message || "No se pudo conectar con el servidor.");
      return;
    }
    setOk(res.ok);
    setMsg(res.msg);
  }

  return (
    <AuthLayout title="Solicitar plaza" sub="DNI y medio de reparto. El admin revisa la solicitud.">
      {ok ? (
        <p className="text-sm text-bottle">{msg}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <In name="name" label="Nombre" />
          <In name="email" label="Email" type="email" />
          <In name="pass" label="Contraseña" type="password" />
          <In name="dni" label="DNI" />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Medio</span>
            <select
              name="vehicle"
              className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
            >
              <option value="patinete">Patinete</option>
              <option value="bici">Bicicleta</option>
              <option value="moto">Moto</option>
              <option value="coche">Coche</option>
            </select>
          </label>
          {msg && !ok ? <p className="text-sm text-ember">{msg}</p> : null}
          <Button type="submit" className="w-full" disabled={br.registerPending}>
            {br.registerPending ? "Enviando…" : "Enviar solicitud"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya te aprobaron?{" "}
        <Link to="/login/repartidor" search={{ next: undefined }} className="font-medium text-ember">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

function In({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required
        className="h-11 w-full rounded-2xl bg-paper px-3 text-sm outline-none shadow-card"
      />
    </label>
  );
}
