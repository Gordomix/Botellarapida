import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout, LoginForm, searchNext } from "@/components/auth/gate";
import { mergeSection, SITE_DEFAULTS, type PortalesSection } from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/login/repartidor")({
  validateSearch: searchNext,
  component: Page,
});

function Page() {
  const { next } = Route.useSearch();
  const br = useBr();
  const portales = mergeSection(SITE_DEFAULTS.portales, br.content.portales as PortalesSection);
  return (
    <AuthLayout title="Repartidores" sub="Acepta códigos BR y marca entregas.">
      <LoginForm role="repartidor" next={next} />
      <p className="mt-3 text-center text-sm">
        <Link to="/recuperar" className="font-medium text-ember">
          ¿Has olvidado tu contraseña?
        </Link>
      </p>
      {portales.registroRepartidor ? (
        <p className="mt-4 text-center text-sm text-muted">
          ¿Primera vez?{" "}
          <Link to="/registro/repartidor" className="font-medium text-ember">
            Solicitar plaza
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
