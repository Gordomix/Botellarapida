import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Reordenación EN VIVO arrastrando con el cursor (o el dedo): al agarrar el
 * asa, las filas van saltando mientras el puntero pasa por encima. Sustituye
 * al drag nativo HTML5, que no funciona con táctil y cuyo fantasma depende
 * del navegador. Sin dependencias: solo Pointer Events (universales hoy).
 *
 * Uso: `const { dragI, start, setRowRef } = usePointerSort(items, onChange)`;
 * el contenedor de cada fila recibe `ref={setRowRef(i)}` y el asa
 * `onPointerDown={(e) => start(i, e)}` (con `touch-action: none`).
 */
export function usePointerSort<T>(
  items: T[],
  onReorder: (next: T[]) => void,
  opts?: {
    /** Se llama al soltar, con el orden final (para persistir una sola vez). */
    onEnd?: (next: T[]) => void;
  },
) {
  const [dragI, setDragI] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  // Refs siempre frescas: los listeners viven fuera del render y no pueden
  // cerrar sobre `items`/callbacks obsoletos.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  rows.current.length = items.length;
  const cbRef = useRef(onReorder);
  cbRef.current = onReorder;
  const endRef = useRef(opts?.onEnd);
  endRef.current = opts?.onEnd;
  const fromRef = useRef(0);

  const start = useCallback((index: number, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fromRef.current = index;
    setDragI(index);
    const move = (ev: PointerEvent) => {
      // La fila "bajo el cursor" es aquella cuyo rectángulo contiene el punto:
      // funciona igual en listas verticales y en carruseles horizontales.
      let to = fromRef.current;
      const rowsNow = rows.current;
      for (let j = 0; j < rowsNow.length; j++) {
        const el = rowsNow[j];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (
          ev.clientX >= r.left &&
          ev.clientX <= r.right &&
          ev.clientY >= r.top &&
          ev.clientY <= r.bottom
        ) {
          to = j;
          break;
        }
      }
      if (to !== fromRef.current) {
        const a = [...itemsRef.current];
        const [moved] = a.splice(fromRef.current, 1);
        a.splice(to, 0, moved);
        cbRef.current(a);
        fromRef.current = to;
        setDragI(to);
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDragI(null);
      endRef.current?.(itemsRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, []);

  const setRowRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      rows.current[i] = el;
    },
    [],
  );

  return { dragI, start, setRowRef };
}
