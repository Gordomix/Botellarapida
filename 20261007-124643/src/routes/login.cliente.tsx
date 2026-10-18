import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout, LoginForm, searchNext } from "@/components/auth/gate";

export const Route = createFileRoute("/login/cliente")({
  validateSearch: searchNext,
  component: Page,
});

function Page() {
  const { next } = Route.useSearch();
  return (
    <AuthLayout title="Clientes" sub="Entra para comprar y seguir tus pedidos.">
      <LoginForm role="user" next={next} />
      <p className="mt-4 text-center text-sm text-muted">
        ¿No tienes cuenta?{" "}
        <Link to="/registro/cliente" className="font-medium text-ember">
          Crear cuenta
        </Link>
      </p>
    </AuthLayout>
  );
}
