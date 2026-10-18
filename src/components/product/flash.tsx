import { useEffect, useState } from "react";
import { countdown } from "@/lib/stock";

/**
 * Cuenta atrás en vivo de una oferta flash. Se refresca cada segundo cuando
 * queda menos de un minuto (urgencia) y cada 30 s en caso contrario, para no
 * martillar el reloj en ofertas largas. Devuelve `null` si ya caducó, de modo
 * que el llamador puede dejar de pintarla.
 *
 * Hidratación segura: el primer pintado (SSR y primera pasada del cliente) NO
 * depende de `Date.now()`, porque servidor y navegador discrepan al segundo y
 * React lo denunciaría como mismatch. El texto real aparece solo tras montar.
 */
export function FlashCountdown({ until }: { until: number }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const tick = () => {
      const left = until - Date.now();
      if (left <= 0) {
        setLabel(null);
        clearInterval(timer);
        return;
      }
      setLabel(countdown(left));
      // Re-ajusta la cadencia según el tiempo restante (1 s en el último minuto).
      clearInterval(timer);
      timer = setInterval(tick, left <= 60_000 ? 1_000 : 30_000);
    };
    tick();
    return () => clearInterval(timer);
  }, [until]);
  return label ? <>{label}</> : null;
}
