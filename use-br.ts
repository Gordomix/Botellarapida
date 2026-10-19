import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CartItem,
  Claim,
  Order,
  Product,
  Session,
  SupportMessage,
  User,
  UserStatus,
} from "@/data/types";
import {
  addClaimFn,
  addCustomProductFn,
  assignCourierFn,
  cancelOrderFn,
  courierAcceptFn,
  createOrderFn,
  listClaimsFn,
  listCouriersFn,
  listCustomProductsFn,
  listMessagesFn,
  listOrdersFn,
  listProductsFn,
  listUsersFn,
  loginFn,
  logoutFn,
  markDeliveredFn,
  registerFn,
  removeCustomProductFn,
  replyMessageFn,
  resolveClaimFn,
  sendMessageFn,
  setUserStatusFn,
} from "@/lib/br-api";
import {
  currentSession,
  currentSid,
  getCart,
  isAgeVerified,
  onSync,
  setAgeVerified,
  setCart,
  setSession,
} from "@/lib/br-db";

/**
 * Hook único de datos de la app. Antes leía `localStorage`; ahora cada lista es
 * una consulta a MySQL y cada acción una mutación, con la sesión en
 * `sessionStorage` (ver `@/lib/br-db`).
 *
 * Mantiene la forma del objeto que ya consumían las pantallas (`br.orders`,
 * `br.createOrder`, …) para que la migración no reescribiera toda la UI: lo que
 * cambia es que las acciones devuelven `Promise` y hay que esperarlas.
 */

/** Los pedidos cambian por otras sesiones (otro dispositivo): sondeo ligero. */
const POLL_MS = 15_000;

const qk = {
  products: ["products"] as const,
  custom: ["custom-products"] as const,
  orders: ["orders"] as const,
  users: ["users"] as const,
  couriers: ["couriers"] as const,
  claims: ["claims"] as const,
  messages: ["messages"] as const,
};

export function useBr() {
  const qc = useQueryClient();
  const [session, setSessionState] = useState<Session | null>(null);
  const [cart, setCartState] = useState<CartItem[]>([]);
  const [ageOk, setAgeOk] = useState(false);
  // La sesión/cesta/+18 viven en el navegador: en el primer render (y en SSR)
  // aún no se han leído. `sessionReady` evita que los guards redirijan a login
  // antes de haber consultado `sessionStorage` (carrera de arranque).
  const [sessionReady, setSessionReady] = useState(false);

  // Estado local (cesta, +18, sesión) solo existe en el navegador.
  useEffect(() => {
    const sync = () => {
      setSessionState(currentSession());
      setCartState(getCart());
      setAgeOk(isAgeVerified());
      setSessionReady(true);
    };
    sync();
    return onSync(sync);
  }, []);

  const sid = session?.sid;
  const hasSession = Boolean(sid);

  /* ---------------------------------------------------------------- consultas */

  // Catálogo completo (base + altas): público, no necesita sesión.
  const productsQ = useQuery({
    queryKey: qk.products,
    queryFn: () => listProductsFn(),
    staleTime: 60_000,
  });

  // Solo las altas del admin: es la lista que pinta el panel "Subidos por el admin".
  const customQ = useQuery({
    queryKey: qk.custom,
    queryFn: () => listCustomProductsFn(),
    staleTime: 30_000,
  });

  const ordersQ = useQuery({
    queryKey: [...qk.orders, sid ?? "anon"],
    queryFn: () => listOrdersFn({ data: { sid } }),
    enabled: hasSession,
    refetchInterval: hasSession ? POLL_MS : false,
  });

  const usersQ = useQuery({
    queryKey: [...qk.users, sid ?? "anon"],
    queryFn: () => listUsersFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  const couriersQ = useQuery({
    queryKey: [...qk.couriers, sid ?? "anon"],
    queryFn: () => listCouriersFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  const claimsQ = useQuery({
    queryKey: [...qk.claims, sid ?? "anon"],
    queryFn: () => listClaimsFn({ data: { sid } }),
    enabled: hasSession,
    refetchInterval: hasSession ? POLL_MS : false,
  });

  const messagesQ = useQuery({
    queryKey: [...qk.messages, sid ?? "anon"],
    queryFn: () => listMessagesFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  /* ---------------------------------------------------------------- mutaciones */

  const invalidate = useCallback(
    (keys: ReadonlyArray<readonly string[]>) => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    },
    [qc],
  );

  const loginMut = useMutation({
    mutationFn: (args: { email: string; pass: string }) => loginFn({ data: args }),
    onSuccess: (res) => {
      if (res.ok && res.session) setSession(res.session);
    },
  });

  const logoutMut = useMutation({
    mutationFn: () => logoutFn({ data: { sid: currentSid() } }),
    onSettled: () => {
      setSession(null);
      void qc.invalidateQueries();
    },
  });

  const registerMut = useMutation({
    mutationFn: (input: RegisterInput) => registerFn({ data: input }),
  });

  const createOrderMut = useMutation({
    mutationFn: (data: OrderInput) => createOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.claims]),
  });

  const assignCourierMut = useMutation({
    mutationFn: (data: AssignInput) =>
      assignCourierFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const courierAcceptMut = useMutation({
    mutationFn: (data: IdInput) => courierAcceptFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const markDeliveredMut = useMutation({
    mutationFn: (data: IdInput) => markDeliveredFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const cancelOrderMut = useMutation({
    mutationFn: (data: IdInput) => cancelOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const resolveClaimMut = useMutation({
    mutationFn: (data: AnswerInput) => resolveClaimFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.claims]),
  });

  const replyMessageMut = useMutation({
    mutationFn: (data: AnswerInput) => replyMessageFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.messages]),
  });

  const setUserStatusMut = useMutation({
    mutationFn: (data: { email: string; status: UserStatus }) =>
      setUserStatusFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.users, qk.orders, qk.couriers]),
  });

  const addClaimMut = useMutation({
    mutationFn: (data: ClaimInput) => addClaimFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.claims]),
  });

  const sendMessageMut = useMutation({
    mutationFn: (input: { email: string; text: string }) =>
      sendMessageFn({ data: input }),
    onSuccess: () => invalidate([qk.messages]),
  });

  const addProductMut = useMutation({
    mutationFn: (data: { product: Product }) =>
      addCustomProductFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.products, qk.custom]),
  });

  const removeProductMut = useMutation({
    mutationFn: (data: IdInput) =>
      removeCustomProductFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.products, qk.custom]),
  });

  /* ---------------------------------------------------------------- derivados */

  const products = productsQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const claims = claimsQ.data ?? [];
  const messages = messagesQ.data ?? [];
  const users = usersQ.data ?? [];
  const couriers = couriersQ.data ?? [];
  const custom = customQ.data ?? [];

  const addToCart = useCallback((product: Product, qty = 1) => {
    if (product.alcohol && !isAgeVerified()) {
      setAgeVerified(false);
      window.dispatchEvent(new Event("br-need-age"));
      return { ok: false as const, reason: "age" as const };
    }
    const next = getCart();
    const found = next.find((c) => c.id === product.id);
    if (found) found.qty += qty;
    else next.push({ id: product.id, qty });
    setCart(next);
    return { ok: true as const };
  }, []);

  const setQty = useCallback(
    (id: string, qty: number) =>
      setCart(getCart().map((c) => (c.id === id ? { ...c, qty } : c)).filter((c) => c.qty > 0)),
    [],
  );

  const clearCart = useCallback(() => setCart([]), []);

  const cartItems = useMemo(
    () =>
      cart
        .map((c) => {
          const product = products.find((p) => p.id === c.id);
          if (!product) return null;
          return { ...c, product, line: product.price * c.qty };
        })
        .filter(Boolean) as Array<CartItem & { product: Product; line: number }>,
    [cart, products],
  );

  const subtotal = cartItems.reduce((s, i) => s + i.line, 0);

  const firstError = productsQ.error ?? ordersQ.error ?? null;

  return {
    session,
    /** `false` hasta leer `sessionStorage` en cliente: los guards no deben redirigir antes. */
    sessionReady,
    cart: cartItems,
    cartItems,
    subtotal,
    ageOk,
    products,
    orders,
    users,
    claims,
    messages,
    custom,
    couriers,
    /** Primer pintado del catálogo: las pantallas muestran skeleton hasta aquí. */
    isLoading: productsQ.isLoading,
    /** MySQL no responde: la UI avisa de que faltan datos (despliegue mal configurado). */
    dbError: firstError ? (firstError as Error).message : null,
    /** Hay una recarga de pedidos/reclamaciones en vuelo (el sondeo de 15 s). */
    isRefreshing: ordersQ.isFetching || claimsQ.isFetching,
    setAgeVerified,
    addToCart,
    setQty,
    clearCart,
    login: loginMut.mutateAsync,
    loginPending: loginMut.isPending,
    logout: () => logoutMut.mutate(),
    registerUser: registerMut.mutateAsync,
    registerPending: registerMut.isPending,
    createOrder: createOrderMut.mutateAsync,
    assignCourier: assignCourierMut.mutateAsync,
    courierAccept: courierAcceptMut.mutateAsync,
    markDelivered: markDeliveredMut.mutateAsync,
    cancelOrder: cancelOrderMut.mutateAsync,
    addClaim: addClaimMut.mutateAsync,
    resolveClaim: resolveClaimMut.mutateAsync,
    sendMessage: sendMessageMut.mutateAsync,
    replyMessage: replyMessageMut.mutateAsync,
    setUserStatus: setUserStatusMut.mutateAsync,
    addCustomProduct: addProductMut.mutateAsync,
    removeCustomProduct: removeProductMut.mutateAsync,
  };
}

/* ------------------------------------------------------- tipos de entrada de acción */

type OrderInput = Parameters<typeof createOrderFn>[0]["data"];
type AssignInput = Omit<Parameters<typeof assignCourierFn>[0]["data"], "sid">;
type IdInput = Omit<Parameters<typeof courierAcceptFn>[0]["data"], "sid">;
type AnswerInput = Omit<Parameters<typeof resolveClaimFn>[0]["data"], "sid">;
type ClaimInput = Omit<Parameters<typeof addClaimFn>[0]["data"], "sid">;

/** Entrada de alta de cuenta: mismo contrato que valida `registerFn` (br-api). */
type RegisterInput = {
  name: string;
  email: string;
  pass: string;
  role?: "user" | "repartidor";
  dni?: string;
  vehicle?: "patinete" | "bici" | "moto" | "coche";
};

export type Br = ReturnType<typeof useBr>;
