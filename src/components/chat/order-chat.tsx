import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/data/types";
import { listChatMessagesFn, sendChatMessageFn } from "@/lib/br-api";
import { currentSession, currentSid } from "@/lib/br-db";
import { cn } from "@/lib/utils";

/**
 * Chat POR PEDIDO (cliente ↔ repartidor ↔ admin/soporte). Sustituye al WhatsApp:
 * nadie ve el teléfono real del otro; todo queda registrado y autorizado en
 * servidor (`br-server.chatAccess`). Mientras no haya WebSockets, el hilo se
 * refresca por sondeo (como ya hacen los pedidos). Se monta SOLO al abrirlo, así
 * que una pantalla con muchos pedidos no dispara N consultas de golpe.
 */

const CHAT_POLL_MS = 5_000;

const ROLE_TAG: Record<string, string> = {
  admin: "Soporte",
  repartidor: "Repartidor",
  user: "Cliente",
};

const QUICK_REPLIES = ["Estoy en el portal", "Subo ahora", "¿Cuánto tardas?"];

function hhmm(ts: number) {
  return new Date(ts).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderChat({
  orderId,
  label = "Chat del pedido",
  emptyHint,
  startOpen = false,
  highlight = false,
}: {
  /** id o código del pedido… o de un CANJE (migración 0028: mismo hilo) o de un PREMIO (Fase 12). */
  orderId: string;
  /** Texto del botón y de la cabecera («Chat del pedido», «Chat»…). */
  label?: string;
  /** Pista cuando el hilo aún no tiene mensajes. */
  emptyHint?: string;
  /** Arranca desplegado (deep-link desde la campanita del admin). */
  startOpen?: boolean;
  /** Anillo de destaque cuando la notificación señala este hilo. */
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return open ? (
    <ChatThread
      orderId={orderId}
      label={label}
      emptyHint={emptyHint}
      highlight={highlight}
      onClose={() => setOpen(false)}
    />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-ink shadow-card transition-colors hover:bg-ink hover:text-paper",
        highlight && "ring-2 ring-ember/60",
      )}
    >
      <MessageSquare className="size-3.5" />
      {label}
    </button>
  );
}

function ChatThread({
  orderId,
  label,
  emptyHint,
  highlight = false,
  onClose,
}: {
  orderId: string;
  label: string;
  emptyHint?: string;
  /** Anillo de destaque cuando la notificación señala este hilo (Fase 12). */
  highlight?: boolean;
  onClose: () => void;
}) {
  // Sesión leída una sola vez: es estable durante toda la sesión de navegador.
  const [me] = useState(() => currentSession());
  const [sid] = useState(() => currentSid());
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const key = ["chat", orderId, sid ?? "anon"] as const;
  const msgsQ = useQuery<ChatMessage[]>({
    queryKey: key,
    queryFn: () => listChatMessagesFn({ data: { sid, orderId } }),
    enabled: Boolean(sid),
    refetchInterval: CHAT_POLL_MS,
  });

  const sendMut = useMutation({
    mutationFn: (body: string) => sendChatMessageFn({ data: { sid, orderId, body } }),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error((err as Error)?.message || "No se pudo enviar."),
  });

  const msgs = msgsQ.data ?? [];

  // Autoscroll al final cuando llegan mensajes nuevos.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  function submit() {
    const body = draft.trim();
    if (!body || sendMut.isPending) return;
    sendMut.mutate(body);
  }

  return (
    <div
      className={cn(
        "mt-3 rounded-2xl bg-paper/60 p-3 shadow-card",
        highlight && "ring-2 ring-ember/60",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-full hover:bg-paper"
          aria-label="Cerrar chat"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={listRef} className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {msgsQ.isLoading ? (
          <p className="py-4 text-center text-xs text-muted">Cargando conversación…</p>
        ) : msgs.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">
            {emptyHint ??
              `Sin mensajes aún. Escríbele al ${me?.role === "user" ? "repartidor" : "cliente"}.`}
          </p>
        ) : (
          msgs.map((m) => {
            const mine = m.senderEmail === me?.email;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    mine ? "bg-ink text-paper" : "bg-surface text-ink",
                  )}
                >
                  {!mine ? (
                    <p className="mb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide opacity-70">
                      {ROLE_TAG[m.senderRole] ?? m.senderRole}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-right text-[0.6rem] tabular-nums",
                      mine ? "text-paper/60" : "text-muted",
                    )}
                  >
                    {hhmm(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setDraft(q)}
            className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink shadow-card hover:bg-ink hover:text-paper"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={2000}
          rows={1}
          placeholder="Escribe un mensaje…"
          className="max-h-32 min-h-11 flex-1 resize-y rounded-2xl bg-surface px-3 py-2.5 text-sm text-ink outline-none shadow-card placeholder:text-muted"
        />
        <Button size="sm" onClick={submit} disabled={!draft.trim() || sendMut.isPending}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
