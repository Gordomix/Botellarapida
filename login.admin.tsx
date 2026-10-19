import { createFileRoute } from "@tanstack/react-router";
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
    </AuthLayout>
  );
}
