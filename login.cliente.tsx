import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout, GoogleSignInButton, LoginForm, searchNext } from "@/components/auth/gate";
import { mergeSection, SITE_DEFAULTS, type PortalesSection } from "@/data/site-defaults";
import { useBr } from "@/lib/use-br";

export const Route = createFileRoute("/login/cliente")({
  validateSearch: searchNext,
  component: Page,
});

function Page() {
  const { next } = Route.useSearch();
  const br = useBr();
  // El admin puede cerrar las altas de cliente desde el panel («Ajustes»): si
  // están cerradas no se enlaza el formulario de registro.
  const portales = mergeSection(SITE_DEFAULTS.portales, br.content.portales as PortalesSection);
  return (
    <AuthLayout title="Clientes" sub="Entra para comprar y seguir tus pedidos.">
      {/* Puerta principal: correo y contraseña, como siempre. El botón de
          Google sigue debajo como opción rápida para quien entraba por él. */}
      <LoginForm role="user" next={next} />
      <p className="mt-3 text-center text-sm">
        <Link to="/recuperar" className="font-medium text-ember">
          ¿Has olvidado tu contraseña?
        </Link>
      </p>
      <GoogleSignInButton role="user" next={next} divider="o bien con Google" />
      {portales.registroCliente ? (
        <p className="mt-4 text-center text-sm text-muted">
          ¿No tienes cuenta?{" "}
          <Link to="/registro/cliente" className="font-medium text-ember">
            Crear cuenta
          </Link>
        </p>
      ) : null}
      <p className="mt-2 text-center text-sm text-muted">
        ¿Eres repartidor o del equipo?{" "}
        <Link to="/acceso" className="font-medium text-ember">
          Acceso profesional
        </Link>
      </p>
    </AuthLayout>
  );
}
