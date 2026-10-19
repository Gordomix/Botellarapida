import {
  QueryClient,
  QueryClientProvider,
  type Query,
} from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { setSession } from "./br-db";

/**
 * Proveedor de TanStack Query que sustituye al `AuthProvider` de la plantilla.
 *
 * `useBr()` necesita caché; antes no lo usábamos porque todo salía de
 * `localStorage`. Se instancia UN `QueryClient` por carga de la aplicación: así
 * el servidor no comparte caché entre visitantes (cada HTML entrante empieza
 * limpio) y el cliente la conserva durante la navegación.
 */

/** El servidor rechazó el token: la sesión se da por perdida en cliente. */
function isSessionLoss(error: unknown) {
  const message = (error as Error | undefined)?.message ?? "";
  return /sesión ha caducado|No tienes permiso/i.test(message);
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  // Un solo punto para expulsar sesiones caducadas, sin tocar cada pantalla.
  const onError = (error: unknown) => {
    if (isSessionLoss(error)) setSession(null);
  };
  client
    .getQueryCache()
    .subscribe((event) => {
      const query = event?.query as Query | undefined;
      if (event?.type !== "updated" || query?.state.status !== "error") return;
      onError(query.state.error);
    });
  client
    .getMutationCache()
    .subscribe((event) => {
      if (event?.type !== "updated") return;
      const state = event?.mutation?.state as
        | { status?: string; error?: unknown }
        | undefined;
      if (state?.status === "error") onError(state.error);
    });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
