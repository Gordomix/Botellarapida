import { createFileRoute, Link } from "@tanstack/react-router";
import { Headset, Shield, Store, Truck } from "lucide-react";
import { StoreShell } from "@/components/layout/store-shell";

export const Route = createFileRoute("/acceso")({ component: Acceso });

const ZONES = [
  {
    to: "/login/cliente" as const,
    icon: Store,
    title: "Clientes",
    text: "Entra o crea cuenta para comprar y seguir tus pedidos.",
    cta: "Entrar como cliente",
    img: "/brand/slides/terraza.jpg",
  },
  {
    to: "/login/repartidor" as const,
    icon: Truck,
    title: "Repartidores",
    text: "Portal de repartos. Solicita plaza con DNI; el admin aprueba.",
    cta: "Entrar como repartidor",
    img: "/brand/slides/patinete.jpg",
  },
  {
    to: "/login/admin" as const,
    icon: Shield,
    title: "Administración",
    text: "Panel privado. Solo personal autorizado.",
    cta: "Entrar como admin",
    img: "/brand/slides/despensa.jpg",
  },
  {
    to: "/soporte" as const,
    icon: Headset,
    title: "Atención al cliente",
    text: "Un problema con un pedido. No hace falta cuenta.",
    cta: "Abrir soporte",
    img: "/brand/slides/sofa.jpg",
  },
];

function Acceso() {
  return (
    <StoreShell>
      <section className="relative min-h-72 overflow-hidden sm:min-h-80">
        <img src="/brand/slides/azotea.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/75 to-night/50" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Express España</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
            Cuatro puertas, un almacén.
          </h1>
          <p className="mt-3 max-w-xl text-mist">
            Cada rol tiene su propia entrada. Abre tres pestañas y verás el pedido fluir de la cesta al patinete.
          </p>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {ZONES.map((z) => (
            <Link
              key={z.title}
              to={z.to}
              className="group overflow-hidden rounded-[1.5rem] bg-ink shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-lift"
            >
              <div className="aspect-[16/7] overflow-hidden">
                <img src={z.img} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
              </div>
              <div className="p-6">
                <z.icon className="size-5 text-ember" />
                <h2 className="mt-4 font-display text-2xl font-semibold text-paper">{z.title}</h2>
                <p className="mt-2 text-sm text-mist">{z.text}</p>
                <p className="mt-4 text-sm font-medium text-ember">{z.cta}</p>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-10 rounded-2xl bg-ink px-4 py-3 text-xs text-mist">
          Cuentas creadas con el seed: cliente@demo.es / demo1234 · demo@repartidor.br / demo1234.
          El admin es el ADMIN_EMAIL y ADMIN_PASSWORD que definiste en tu .env (en local,
          admin@local.dev / admin12345).
        </p>
      </div>
    </StoreShell>
  );
}
