import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout, LoginForm, searchNext } from "@/components/auth/gate";

export const Route = createFileRoute("/login/repartidor")({
  validateSearch: searchNext,
  component: Page,
});

function Page() {
  const { next } = Route.useSearch();
  return (
    <AuthLayout title="Repartidores" sub="Acepta códigos BR y marca entregas.">
      <LoginForm role="repartidor" next={next} />
      <p className="mt-4 text-center text-sm text-muted">
        ¿Primera vez?{" "}
        <Link to="/registro/repartidor" className="font-medium text-ember">
          Solicitar plaza
        </Link>
      </p>
    </AuthLayout>
  );
}
