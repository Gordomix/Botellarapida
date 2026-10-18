/**
 * Instalación de la web como app (PWA). El navegador lanza `beforeinstallprompt`
 * cuando considera que la página ya se puede instalar; lo guardamos "diferido"
 * hasta que el visitante pulse el botón. En iOS Safari ese evento NO existe:
 * allí el botón lleva al tutorial de instalación del propio dominio
 * (`/?install=1`), que el servidor ya sirve para iPhone/iPad.
 */
import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** ¿Ya se está viendo a pantalla completa (instalada)? iOS y Android. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* navegadores muy antiguos sin matchMedia: se asume no instalada */
  }
  return Boolean((navigator as unknown as { standalone?: boolean }).standalone);
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Se cancela el mini-diálogo automático para poder mostrarlo nosotros.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /** Devuelve "fallback" si este navegador no trae diálogo nativo (iOS). */
  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "fallback"> => {
    if (!deferred) return "fallback";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return { canInstall: Boolean(deferred), installed, promptInstall };
}
