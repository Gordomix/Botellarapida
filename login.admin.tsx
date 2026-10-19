import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout, LoginForm, searchNext } from "@/components/auth/gate";

export const Route = createFileRoute("/login/admin")({
  validateSearch: searchNext,
  component: Page,
});

function Page() {
  const { next } = Route.useSearch();
  return (
    <AuthLayout title="Administración" sub="Panel privado de logística y catálogo.">
      <LoginForm role="admin" next={next} />
      <p className="mt-3 text-center text-sm">
        <Link to="/recuperar" className="font-medium text-ember">
          ¿Has olvidado tu contraseña?
        </Link>
      </p>
    </AuthLayout>
  );
}
