import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  addCourierFaultFn,
  addCustomProductFn,
  ackFaultsFn,
  addressSuggestionsFn,
  assignCourierFn,
  cancelOrderFn,
  courierAcceptFn,
  courierCancelFn,
  createCouponFn,
  createCheckoutFn,
  createDonationFn,
  createOrderFn,
  createReviewFn,
  declareAdultFn,
  deleteCourierFaultFn,
  deleteCouponFn,
  deleteDonationFn,
  deleteOrderFn,
  deleteReviewFn,
  deleteUserFn,
  banIpFn,
  unbanIpFn,
  listIpBansFn,
  listSuspiciousIpsFn,
  getCourierShiftFn,
  getSiteContentFn,
  getStatsFn,
  importProductFromUrlFn,
  fetchImageAsDataUrlFn,
  listArchivedOrdersFn,
  listClaimsFn,
  listAllReviewsFn,
  listCouponsFn,
  listCouriersFn,
  listCustomProductsFn,
  listDonationsFn,
  listFaultsAdminFn,
  listMessagesFn,
  listMyReviewedOrderIdsFn,
  listOrdersFn,
  adminSetPasswordFn,
  listProductsFn,
  listPublishedReviewsFn,
  listResetRequestsFn,
  listSessionsFn,
  listUsersFn,
  liveLocationsFn,
  loginAdminFn,
  loginFn,
  logoutFn,
  markDeliveredFn,
  myFaultsFn,
  orderTrackingFn,
  paymentStatusFn,
  paymentsStatusFn,
  pingCourierLocationFn,
  pingCustomerLocationFn,
  purgeOrderFn,
  reactivateAssignCourierFn,
  registerFn,
  removeCustomProductFn,
  reorderCustomProductsFn,
  replyMessageFn,
  requestResetFn,
  resetLaunchDataFn,
  resetPasswordFn,
  resetProductOverrideFn,
  resetSiteSectionFn,
  restoreOrderFn,
  restoreSessionFn,
  resolveClaimFn,
  saveProductOverrideFn,
  saveSiteSectionFn,
  searchSpanishProductsFn,
  sendMessageFn,
  setCouponActiveFn,
  setCourierShiftFn,
  setReviewPublishedFn,
  setUserStatusFn,
  validateCouponFn,
  raffleStateFn,
  raffleSpinFn,
  raffleRevealFn,
  raffleClaimFn,
  raffleClaimPayFn,
  raffleClaimStatusFn,
  raffleConsolationFn,
  adminRaffleStateFn,
  saveRaffleConfigFn,
  upsertRafflePrizeFn,
  deleteRafflePrizeFn,
  setRaffleEntryFlagsFn,
  chapaStateFn,
  chapaRedeemFn,
  adminChapaStateFn,
  saveChapaConfigFn,
  setChapaProductFn,
  upsertChapaRewardFn,
  deleteChapaRewardFn,
  setChapaRedemptionStatusFn,
  adjustChapaBalanceFn,
  adminPaymentsStateFn,
  savePaymentSettingsFn,
  demoPaymentInfoFn,
  approveDemoPaymentFn,
  cancelDemoPaymentFn,
  notificationsListFn,
  notificationsReadFn,
  createAffiliateLinkFn,
  listAffiliateLinksFn,
  affiliateInfoFn,
  attachReferralFn,
  adminVerifyEmailFn,
  adminResendVerificationFn,
  testSmtpEmailFn,
} from "@/lib/br-api";
import type { SiteContent, SiteSectionKey } from "@/data/site-defaults";
import {
  currentSession,
  currentSid,
  getCart,
  getFavs,
  isAgeVerified,
  onSync,
  setAgeVerified,
  setCart,
  setFavs,
  setSession,
} from "@/lib/br-db";
import { bumpCart, playAddSfx } from "@/lib/cart-fx";

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

/**
 * Código de invitación `AF-...` capturado de un enlace compartido (migración
 * 0030): lo guarda la cabecera al abrir la web con `?ref=` y lo adjuntan
 * automáticamente el registro y el primer pedido del invitado.
 */
function loadStoredRef(): string | null {
  try {
    return localStorage.getItem("br_ref") || null;
  } catch {
    return null;
  }
}

/**
 * Si `sessionStorage` llegó vacío (los navegadores móviles lo borran al
 * descartar la pestaña) se pide la sesión al servidor, que la resuelve desde la
 * cookie httpOnly. Un solo intento por carga de página, sin importar cuántas
 * pantallas monten `useBr()`.
 */
let restoreAttempt: Promise<void> | null = null;
function restoreFromCookie(): Promise<void> {
  if (!restoreAttempt) {
    restoreAttempt = restoreSessionFn()
      .then((s) => {
        if (s) setSession(s);
      })
      .catch(() => {
        /* sin cookie válida (o sin sesión): seguimos anónimos */
      });
  }
  return restoreAttempt;
}

const qk = {
  products: ["products"] as const,
  custom: ["custom-products"] as const,
  content: ["site-content"] as const,
  orders: ["orders"] as const,
  payments: ["payments"] as const,
  users: ["users"] as const,
  couriers: ["couriers"] as const,
  myShift: ["my-shift"] as const,
  archived: ["archived-orders"] as const,
  faults: ["courier-faults"] as const,
  myFaults: ["my-faults"] as const,
  claims: ["claims"] as const,
  messages: ["messages"] as const,
  live: ["live-locations"] as const,
  stats: ["stats"] as const,
  sessions: ["sessions"] as const,
  resetRequests: ["reset-requests"] as const,
  coupons: ["coupons"] as const,
  reviews: ["reviews"] as const,
  adminReviews: ["admin-reviews"] as const,
  myReviewed: ["my-reviewed-orders"] as const,
  donations: ["donations"] as const,
  raffle: ["raffle"] as const,
  adminRaffle: ["admin-raffle"] as const,
  chapa: ["chapa"] as const,
  adminChapa: ["admin-chapa"] as const,
  adminPayments: ["admin-payments"] as const,
  notifications: ["notifications"] as const,
  affiliateLinks: ["affiliate-links"] as const,
  ipBans: ["ip-bans"] as const,
  suspiciousIps: ["suspicious-ips"] as const,
};

export function useBr() {
  const qc = useQueryClient();
  const [session, setSessionState] = useState<Session | null>(null);
  const [cart, setCartState] = useState<CartItem[]>([]);
  const [favs, setFavsState] = useState<string[]>([]);
  const [ageOk, setAgeOk] = useState(false);
  // La sesión/cesta/+18 viven en el navegador: en el primer render (y en SSR)
  // aún no se han leído. `sessionReady` evita que los guards redirijan a login
  // antes de haber consultado `sessionStorage` (carrera de arranque).
  const [sessionReady, setSessionReady] = useState(false);
  // Montado real en el navegador. `isLoading` lo usa para que el PRIMER render
  // del cliente coincida con el HTML del SSR ("cargando…"): si el catálogo
  // llega por red antes de que React hidrate, el cliente ya vería la lista
  // (o el vacío) mientras el servidor renderizó el skeleton → React descarta
  // y vuelve a montar todo el árbol (error de hidratación en consola y
  // parpadeo; en iOS además reinicia la carga de las imágenes).
  const [mounted, setMounted] = useState(false);

  // Estado local (cesta, +18, sesión) solo existe en el navegador.
  useEffect(() => {
    setMounted(true);
    const sync = () => {
      setSessionState(currentSession());
      setCartState(getCart());
      setFavsState(getFavs());
      setAgeOk(isAgeVerified());
      setSessionReady(true);
    };
    sync();
    // Sesión perdida al cerrar la pestaña móvil: la cookie httpOnly la rescata.
    if (!currentSession()) void restoreFromCookie();
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

  // Franja del repartidor conectado: solo él la ve y la edita en su portal.
  const myShiftQ = useQuery({
    queryKey: [...qk.myShift, sid ?? "anon"],
    queryFn: () => getCourierShiftFn({ data: { sid } }),
    enabled: session?.role === "repartidor",
  });

  // Pedidos archivados (eliminados por el admin): solo admin.
  const archivedQ = useQuery({
    queryKey: [...qk.archived, sid ?? "anon"],
    queryFn: () => listArchivedOrdersFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  // Todas las faltas (panel de admin): las agrupa por repartidor en la UI.
  const faultsAdminQ = useQuery({
    queryKey: [...qk.faults, sid ?? "anon"],
    queryFn: () => listFaultsAdminFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  // Faltas del repartidor conectado: alimentan el pop-up de aviso de su portal.
  const myFaultsQ = useQuery({
    queryKey: [...qk.myFaults, sid ?? "anon"],
    queryFn: () => myFaultsFn({ data: { sid } }),
    enabled: session?.role === "repartidor",
    refetchInterval: session?.role === "repartidor" ? POLL_MS : false,
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

  // Ubicación viva de los repartidores (mapa del admin): se refresca con el
  // mismo sondeo de 15 s que los pedidos.
  const liveQ = useQuery({
    queryKey: [...qk.live, sid ?? "anon"],
    queryFn: () => liveLocationsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? POLL_MS : false,
  });

  // Estadísticas del panel: solo admin, sondeo suave (30 s) para no machacar las
  // agregaciones. La pestaña «Estadísticas» muestra skeleton hasta que llega.
  const statsQ = useQuery({
    queryKey: [...qk.stats, sid ?? "anon"],
    queryFn: () => getStatsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 30_000 : false,
  });

  // Auditoría de accesos (solo admin): lista de sesiones de `br_sessions`.
  // Sondeo largo (60 s): no es una vista de tiempo real, basta con ver las
  // últimas entradas al refrescar la pestaña.
  const sessionsQ = useQuery({
    queryKey: [...qk.sessions, sid ?? "anon"],
    queryFn: () => listSessionsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // IPs ya bloqueadas (panel Seguridad). Sondeo largo: lista de atención.
  const ipBansQ = useQuery({
    queryKey: [...qk.ipBans, sid ?? "anon"],
    queryFn: () => listIpBansFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // IPs usadas en intentos de login de las últimas 24 h (detector de ataque).
  const suspiciousIpsQ = useQuery({
    queryKey: [...qk.suspiciousIps, sid ?? "anon"],
    queryFn: () => listSuspiciousIpsFn({ data: { sid, withinHours: 24 } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // Solicitudes de recuperación de contraseña pendientes (solo admin). Sondeo
  // medio (30 s): es una bandeja de atención, no una vista de tiempo real.
  const resetRequestsQ = useQuery({
    queryKey: [...qk.resetRequests, sid ?? "anon"],
    queryFn: () => listResetRequestsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 30_000 : false,
  });

  // Cupones y códigos de afiliado (panel de admin). Sondeo largo (60 s): se
  // gestiona poco y el uso real ya lo contabiliza el servidor al crear pedidos.
  const couponsQ = useQuery({
    queryKey: [...qk.coupons, sid ?? "anon"],
    queryFn: () => listCouponsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // Reseñas publicadas: públicas y casi estáticas (las mueve el admin):
  // 5 min de cache basta para la vitrina de la portada.
  const publishedReviewsQ = useQuery({
    queryKey: qk.reviews,
    queryFn: () => listPublishedReviewsFn(),
    staleTime: 300_000,
  });

  // Bandeja de reseñas del admin (incluye las privadas). Sondeo largo: llegan
  // despacio y su gestión es manual.
  const adminReviewsQ = useQuery({
    queryKey: [...qk.adminReviews, sid ?? "anon"],
    queryFn: () => listAllReviewsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // Pedidos que ESTE cliente ya valoró: el formulario de reseña solo aparece
  // en los entregados que no estén en esta lista (el servidor además bloquea
  // el duplicado, esto es la capa amable).
  //
  // SOLO rol cliente: el endpoint exige ["user","admin"] y este hook se monta
  // también en el portal del repartidor. Si corriera con sesión de repartidor,
  // el servidor respondería «No tienes permiso» y el capturador global de
  // pérdida de sesión (`query-provider`) expulsaría la sesión al instante —
  // el repartidor no podría permanecer conectado. Por eso el gate por rol,
  // no un simple `hasSession`.
  const myReviewedQ = useQuery({
    queryKey: [...qk.myReviewed, sid ?? "anon"],
    queryFn: () => listMyReviewedOrderIdsFn({ data: { sid } }),
    enabled: session?.role === "user",
    staleTime: 60_000,
  });

  // Apoyos «Apóyanos» registrados (solo admin).
  const donationsQ = useQuery({
    queryKey: [...qk.donations, sid ?? "anon"],
    queryFn: () => listDonationsFn({ data: { sid } }),
    enabled: session?.role === "admin",
    refetchInterval: session?.role === "admin" ? 60_000 : false,
  });

  // Contenido editable (CMS): público, el merge con defaults lo hace cada page.
  const contentQ = useQuery({
    queryKey: qk.content,
    queryFn: () => getSiteContentFn(),
    staleTime: 60_000,
  });

  // ¿Pasarela de tarjeta activa (clave de Stripe en el servidor)? Público.
  const paymentsQ = useQuery({
    queryKey: qk.payments,
    queryFn: () => paymentsStatusFn(),
    staleTime: 300_000,
  });

  // Ruleta pública: la ven también los anónimos (no la giran). Con sesión de
  // cliente el servidor añade giros restantes y el premio pendiente de reclamar.
  const raffleQ = useQuery({
    queryKey: [...qk.raffle, sid ?? "anon"],
    queryFn: () => raffleStateFn({ data: { sid } }),
    staleTime: 15_000,
  });

  // Chapas público: ofertas siempre visibles; saldo/libro solo con sesión.
  const chapaQ = useQuery({
    queryKey: [...qk.chapa, sid ?? "anon"],
    queryFn: () => chapaStateFn({ data: { sid } }),
    staleTime: 15_000,
  });

  // Sorteo completo (config + premios con pesos + histórico) — solo admin.
  const adminRaffleQ = useQuery({
    queryKey: [...qk.adminRaffle, sid ?? "anon"],
    queryFn: () => adminRaffleStateFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  // Chapas de admin (config + ofertas + overrides + canjes + saldos) — solo admin.
  const adminChapaQ = useQuery({
    queryKey: [...qk.adminChapa, sid ?? "anon"],
    queryFn: () => adminChapaStateFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  // Pasarela de pagos (proveedor, modo pruebas, claves, histórico) — solo admin.
  const adminPaymentsQ = useQuery({
    queryKey: [...qk.adminPayments, sid ?? "anon"],
    queryFn: () => adminPaymentsStateFn({ data: { sid } }),
    enabled: session?.role === "admin",
  });

  // Campanita (0030): premios, chapas, mensajes, pedidos e invitaciones. Sondeo
  // de 30 s: suficiente para ver avisos sin abrir la página y barato en carga.
  const notificationsQ = useQuery({
    queryKey: [...qk.notifications, sid ?? "anon"],
    queryFn: () => notificationsListFn({ data: { sid } }),
    enabled: hasSession,
    refetchInterval: hasSession ? 30_000 : false,
  });

  // Enlaces de invitación propios (generar/compartir) — cualquier cuenta.
  const affiliateLinksQ = useQuery({
    queryKey: [...qk.affiliateLinks, sid ?? "anon"],
    queryFn: () => listAffiliateLinksFn({ data: { sid } }),
    enabled: hasSession,
    staleTime: 30_000,
  });

  /* ---------------------------------------------------------------- mutaciones */

  const invalidate = useCallback(
    (keys: ReadonlyArray<readonly string[]>) => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    },
    [qc],
  );

  /* ---------------------------------------------- sorteo (ruleta) — mutaciones */

  const raffleSpinMut = useMutation({
    mutationFn: () => raffleSpinFn({ data: { sid } }),
    onSuccess: () => invalidate([qk.raffle, qk.chapa, qk.notifications]),
  });
  const raffleRevealMut = useMutation({
    mutationFn: (args: { id: string }) => raffleRevealFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.raffle]),
  });
  const raffleClaimMut = useMutation({
    mutationFn: (args: { id: string }) => raffleClaimFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.raffle]),
  });
  const rafflePayMut = useMutation({
    mutationFn: (args: { id: string }) => raffleClaimPayFn({ data: { sid, id: args.id } }),
  });
  const rafflePayStatusMut = useMutation({
    mutationFn: (args: { id: string }) => raffleClaimStatusFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.raffle]),
  });
  // Consuelo al perder (Fase 10): revela el secreto ofrecido con -10 % y crea
  // la entry de compra; refresca el sorteo y la campanita (deja aviso).
  const raffleConsolationMut = useMutation({
    mutationFn: (args: { id: string }) => raffleConsolationFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.raffle, qk.notifications]),
  });
  const saveRaffleConfigMut = useMutation({
    mutationFn: (patch: Parameters<typeof saveRaffleConfigFn>[0]["data"]["patch"]) =>
      saveRaffleConfigFn({ data: { sid, patch } }),
    onSuccess: () => invalidate([qk.adminRaffle, qk.raffle]),
  });
  const upsertRafflePrizeMut = useMutation({
    mutationFn: (prize: Parameters<typeof upsertRafflePrizeFn>[0]["data"]["prize"]) =>
      upsertRafflePrizeFn({ data: { sid, prize } }),
    onSuccess: () => invalidate([qk.adminRaffle, qk.raffle]),
  });
  const deleteRafflePrizeMut = useMutation({
    mutationFn: (args: { id: string }) => deleteRafflePrizeFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.adminRaffle, qk.raffle]),
  });
  const setRaffleFlagsMut = useMutation({
    mutationFn: (args: {
      id: string;
      flags: { paid?: boolean; revealed?: boolean; claimed?: boolean };
    }) => setRaffleEntryFlagsFn({ data: { sid, id: args.id, flags: args.flags } }),
    onSuccess: () => invalidate([qk.adminRaffle, qk.raffle]),
  });

  /* ---------------------------------------------------- chapas — mutaciones */

  const chapaRedeemMut = useMutation({
    mutationFn: (args: { id: string }) => chapaRedeemFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.chapa, qk.adminChapa]),
  });
  const saveChapaConfigMut = useMutation({
    mutationFn: (patch: Parameters<typeof saveChapaConfigFn>[0]["data"]["patch"]) =>
      saveChapaConfigFn({ data: { sid, patch } }),
    onSuccess: () => invalidate([qk.adminChapa, qk.chapa]),
  });
  const setChapaProductMut = useMutation({
    mutationFn: (args: { productId: string; chapas: number | null }) =>
      setChapaProductFn({ data: { sid, productId: args.productId, chapas: args.chapas } }),
    onSuccess: () => invalidate([qk.adminChapa]),
  });
  const upsertChapaRewardMut = useMutation({
    mutationFn: (reward: Parameters<typeof upsertChapaRewardFn>[0]["data"]["reward"]) =>
      upsertChapaRewardFn({ data: { sid, reward } }),
    onSuccess: () => invalidate([qk.adminChapa, qk.chapa]),
  });
  const deleteChapaRewardMut = useMutation({
    mutationFn: (args: { id: string }) => deleteChapaRewardFn({ data: { sid, id: args.id } }),
    onSuccess: () => invalidate([qk.adminChapa, qk.chapa]),
  });
  const setChapaRedemptionMut = useMutation({
    mutationFn: (args: { id: string; status: "entregado" | "cancelado" }) =>
      setChapaRedemptionStatusFn({ data: { sid, id: args.id, status: args.status } }),
    onSuccess: () => invalidate([qk.adminChapa, qk.chapa]),
  });
  const adjustChapaBalanceMut = useMutation({
    mutationFn: (args: { email: string; delta: number; reason: string }) =>
      adjustChapaBalanceFn({
        data: { sid, email: args.email, delta: args.delta, reason: args.reason },
      }),
    onSuccess: () => invalidate([qk.adminChapa, qk.chapa]),
  });

  /* ------------------------------------------- campanita e invitaciones (0030) */

  const notifReadMut = useMutation({
    mutationFn: (args?: { id?: string }) => notificationsReadFn({ data: { sid, id: args?.id } }),
    onSuccess: () => invalidate([qk.notifications]),
  });
  const createAffLinkMut = useMutation({
    mutationFn: () => createAffiliateLinkFn({ data: { sid } }),
    onSuccess: () => invalidate([qk.affiliateLinks]),
  });
  const attachReferralMut = useMutation({
    mutationFn: (code: string) => attachReferralFn({ data: { sid, code } }),
  });
  const adminVerifyEmailMut = useMutation({
    mutationFn: (target: string) => adminVerifyEmailFn({ data: { sid, email: target } }),
    onSuccess: () => invalidate([qk.users]),
  });
  const adminResendVerificationMut = useMutation({
    mutationFn: (target: string) => adminResendVerificationFn({ data: { sid, email: target } }),
    onSuccess: () => invalidate([qk.users]),
  });

  // Diagnóstico SMTP (Fase 13): el admin dispara un correo de prueba y ve el
  // error real si falla. `to` opcional (por defecto, su propio email admin).
  const testSmtpMut = useMutation({
    mutationFn: (to?: string) => testSmtpEmailFn({ data: { sid, to } }),
  });

  /* --------------------------------------------- pasarela de pagos — mutaciones */

  const savePaymentSettingsMut = useMutation({
    mutationFn: (patch: Parameters<typeof savePaymentSettingsFn>[0]["data"]["patch"]) =>
      savePaymentSettingsFn({ data: { sid, patch } }),
    // Cambiar proveedor/modo pruebas afecta también al estado público del checkout.
    onSuccess: () => invalidate([qk.adminPayments, qk.payments]),
  });
  const demoApproveMut = useMutation({
    mutationFn: (args: { token: string }) =>
      approveDemoPaymentFn({ data: { sid, token: args.token } }),
    onSuccess: () =>
      invalidate([qk.orders, qk.raffle, qk.adminPayments, qk.chapa, qk.notifications]),
  });
  const demoCancelMut = useMutation({
    mutationFn: (args: { token: string }) =>
      cancelDemoPaymentFn({ data: { sid, token: args.token } }),
    onSuccess: () => invalidate([qk.adminPayments]),
  });

  const loginMut = useMutation({
    // Fase 2: con `code` usa el segundo paso del admin (loginAdmin); sin él,
    // el login de siempre. `login` responde `totpRequired` cuando la cuenta
    // de admin tiene 2FA activo y el formulario pide el código.
    mutationFn: (args: { email: string; pass: string; code?: string }) =>
      args.code
        ? loginAdminFn({ data: { email: args.email, pass: args.pass, code: args.code } })
        : loginFn({ data: { email: args.email, pass: args.pass } }),
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
    // El código de invitación capturado del enlace viaja solo si la pantalla
    // no lo pasó ya a mano (migración 0030).
    mutationFn: (input: RegisterInput) =>
      registerFn({ data: { ...input, ref: input.ref ?? loadStoredRef() } }),
  });

  const requestResetMut = useMutation({
    mutationFn: (email: string) => requestResetFn({ data: { email } }),
  });

  const resetPasswordMut = useMutation({
    mutationFn: (data: { token: string; pass: string }) => resetPasswordFn({ data }),
  });

  const createOrderMut = useMutation({
    mutationFn: (data: OrderInput) =>
      createOrderFn({ data: { ...data, ref: data.ref ?? loadStoredRef(), sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.claims, qk.coupons, qk.stats]),
  });

  // Registra en servidor la declaración de mayoría de edad (migración 0023).
  // Fire-and-forget al aceptar el gate: si falla, el pedido con alcohol vuelve a
  // pedir la confirmación, así que no hay riesgo de quedar sin registrar.
  const declareAdultMut = useMutation({
    mutationFn: () => declareAdultFn({ data: { sid: currentSid() } }),
  });

  const assignCourierMut = useMutation({
    mutationFn: (data: AssignInput) => assignCourierFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  // Fase 10: reactivar un CANCELADO delegándolo a otro repartidor (mismo
  // candado de estados en servidor: solo pedidos cancelados).
  const reactivateAssignMut = useMutation({
    mutationFn: (data: AssignInput) =>
      reactivateAssignCourierFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const courierAcceptMut = useMutation({
    mutationFn: (data: IdInput) => courierAcceptFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const markDeliveredMut = useMutation({
    mutationFn: (data: IdInput) => markDeliveredFn({ data: { ...data, sid: currentSid() } }),
    // Al entregar, el servidor suma las chapas del cliente: refresca también su
    // saldo para que el nuevo total se vea sin recargar la página. Con entrega
    // se cierra además la invitación de afiliado si procedía (0030).
    onSuccess: () => invalidate([qk.orders, qk.chapa, qk.notifications, qk.affiliateLinks]),
  });

  const cancelOrderMut = useMutation({
    mutationFn: (data: IdInput) => cancelOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders]),
  });

  const payByCardMut = useMutation({
    mutationFn: (data: IdInput) => createCheckoutFn({ data: { ...data, sid: currentSid() } }),
  });

  const paymentStatusMut = useMutation({
    mutationFn: (data: IdInput) => paymentStatusFn({ data: { ...data, sid: currentSid() } }),
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

  const deleteUserMut = useMutation({
    mutationFn: (data: { email: string; code: string }) =>
      deleteUserFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.users, qk.couriers, qk.orders]),
  });

  // Bloqueo/desbloqueo de IP: el servidor exige el código 2FA (lanza si no).
  // Ambos refrescan la lista de baneadas y la de sospechosas.
  const banIpMut = useMutation({
    mutationFn: (data: { ip: string; code: string; note?: string }) =>
      banIpFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.ipBans, qk.suspiciousIps]),
  });
  const unbanIpMut = useMutation({
    mutationFn: (data: { ip: string; code: string }) =>
      unbanIpFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.ipBans, qk.suspiciousIps]),
  });

  // El admin fija una contraseña nueva a una cuenta (recuperación sin SMTP).
  const adminSetPasswordMut = useMutation({
    mutationFn: (data: { email: string; pass: string }) =>
      adminSetPasswordFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.resetRequests, qk.sessions]),
  });

  const setCourierShiftMut = useMutation({
    mutationFn: (data: { startHour: number }) =>
      setCourierShiftFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.myShift]),
  });

  const deleteOrderMut = useMutation({
    mutationFn: (data: IdInput) => deleteOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.archived]),
  });

  const restoreOrderMut = useMutation({
    mutationFn: (data: IdInput) => restoreOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.archived]),
  });

  // Borrado definitivo de un archivado: refresca archivados, pedidos y estadísticas.
  const purgeOrderMut = useMutation({
    mutationFn: (data: IdInput) => purgeOrderFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.archived, qk.stats]),
  });

  // Reinicio de lanzamiento (admin): borra toda la data transaccional de prueba.
  // Refresca todo lo que depende de pedidos: listas, estadísticas, reseñas, chats.
  const resetLaunchMut = useMutation({
    mutationFn: (confirmText: string) =>
      resetLaunchDataFn({ data: { confirmText, sid: currentSid() } }),
    onSuccess: () =>
      invalidate([
        qk.orders,
        qk.archived,
        qk.stats,
        qk.claims,
        qk.coupons,
        qk.reviews,
        qk.adminReviews,
        qk.myReviewed,
        qk.payments,
        qk.live,
      ]),
  });

  // El repartidor cancela su reparto (con motivo): refresca sus pedidos y las stats.
  const courierCancelMut = useMutation({
    mutationFn: (data: { id: string; reason: string }) =>
      courierCancelFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.orders, qk.stats]),
  });

  const addFaultMut = useMutation({
    mutationFn: (data: { email: string; reason: string }) =>
      addCourierFaultFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.faults, qk.myFaults]),
  });

  const deleteFaultMut = useMutation({
    mutationFn: (data: IdInput) => deleteCourierFaultFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.faults]),
  });

  const ackFaultsMut = useMutation({
    mutationFn: () => ackFaultsFn({ data: { sid: currentSid() } }),
    onSuccess: () => invalidate([qk.myFaults]),
  });

  const addClaimMut = useMutation({
    mutationFn: (data: ClaimInput) => addClaimFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.claims]),
  });

  const sendMessageMut = useMutation({
    mutationFn: (input: { email: string; text: string }) => sendMessageFn({ data: input }),
    onSuccess: () => invalidate([qk.messages]),
  });

  const addProductMut = useMutation({
    mutationFn: (data: { product: Product }) =>
      addCustomProductFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.products, qk.custom]),
  });

  const removeProductMut = useMutation({
    mutationFn: (data: IdInput) => removeCustomProductFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.products, qk.custom]),
  });

  // Orden manual del catálogo (flechas ↑↓ del panel).
  const reorderProductsMut = useMutation({
    mutationFn: (data: { ids: string[] }) =>
      reorderCustomProductsFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.products, qk.custom]),
  });

  // Búsqueda en la base española (Open Food Facts). Función estable (useCallback):
  // el panel la llama desde un useEffect con debounce y no debe re-dispararlo.
  const searchEan = useCallback(
    (q: string) => searchSpanishProductsFn({ data: { q, sid: currentSid() } }),
    [],
  );

  // Autocompletado de calles por CP (checkout, Fase 10). Estable como
  // `searchEan`: lo dispara un useEffect con debounce sobre el campo dirección.
  const addressSuggestions = useCallback(
    (postalCode: string, q: string) =>
      addressSuggestionsFn({ data: { postalCode, query: q, sid: currentSid() } }),
    [],
  );

  // Importación por URL de la tienda del proveedor (el servidor lee la ficha).
  // Estable como `searchEan`: la dispara un botón del panel, no un efecto.
  const importUrl = useCallback(
    (url: string) => importProductFromUrlFn({ data: { url, sid: currentSid() } }),
    [],
  );

  // Baja una foto remota como data URL para el editor de recorte (evita el
  // bloqueo CORS del canvas). Estable como las de arriba: la dispara un efecto
  // al abrir la edición, no debe re-dispararse en cada render.
  const fetchImage = useCallback(
    (url: string) => fetchImageAsDataUrlFn({ data: { url, sid: currentSid() } }),
    [],
  );

  // Ping del GPS del móvil del repartidor: fire-and-forget, lo llama un watch
  // con throttle. Estable (useCallback) para no reiniciar el watch en cada render.
  const pingCourierLocation = useCallback(
    (p: { lat: number; lng: number; accuracyM?: number; orderId?: string }) =>
      pingCourierLocationFn({ data: { ...p, sid: currentSid() } }),
    [],
  );

  // Ping del GPS del CLIENTE cuando activa «Compartir mi ubicación» en su
  // seguimiento. Estable: lo llama un watchPosition, y si dependiera del objeto
  // `br` se reiniciaría la escucha en cada render (15 s). El orderRef viaja como
  // argumento; el servidor comprueba que el pedido es suyo.
  const pingCustomerLocation = useCallback(
    (p: { orderRef: string; lat: number; lng: number; accuracyM?: number }) =>
      pingCustomerLocationFn({ data: { ...p, sid: currentSid() } }),
    [],
  );

  const saveSectionMut = useMutation({
    mutationFn: (data: { section: SiteSectionKey; payload: unknown }) =>
      saveSiteSectionFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.content }),
  });

  const resetSectionMut = useMutation({
    mutationFn: (section: SiteSectionKey) =>
      resetSiteSectionFn({ data: { section, sid: currentSid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.content }),
  });

  const saveProductPatchMut = useMutation({
    mutationFn: (data: { id: string; patch: Partial<Product> }) =>
      saveProductOverrideFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.products }),
  });

  const resetProductPatchMut = useMutation({
    mutationFn: (id: string) => resetProductOverrideFn({ data: { id, sid: currentSid() } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.products }),
  });

  /* ---------------------------------------------------------------- cupones */

  const createCouponMut = useMutation({
    mutationFn: (draft: CouponDraftInput) => createCouponFn({ data: { draft, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.coupons]),
  });

  const setCouponActiveMut = useMutation({
    mutationFn: (data: { id: string; active: boolean }) =>
      setCouponActiveFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.coupons]),
  });

  const deleteCouponMut = useMutation({
    mutationFn: (data: { id: string }) => deleteCouponFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.coupons]),
  });

  /* ------------------------------------------------------- reseñas y apoyos */

  const createReviewMut = useMutation({
    mutationFn: (data: { orderId: string; stars: number; text: string; image?: string }) =>
      createReviewFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.reviews, qk.adminReviews, qk.myReviewed]),
  });

  const setReviewPublishedMut = useMutation({
    mutationFn: (data: { id: string; published: boolean }) =>
      setReviewPublishedFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.reviews, qk.adminReviews]),
  });

  const deleteReviewMut = useMutation({
    mutationFn: (data: { id: string }) => deleteReviewFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.reviews, qk.adminReviews]),
  });

  const donateMut = useMutation({
    mutationFn: (data: { amount: number; message?: string }) =>
      createDonationFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.donations]),
  });

  const deleteDonationMut = useMutation({
    mutationFn: (data: { id: string }) =>
      deleteDonationFn({ data: { ...data, sid: currentSid() } }),
    onSuccess: () => invalidate([qk.donations]),
  });

  // Pre-visualización del cupón en el checkout. Estable (como `searchEan`): el
  // checkout la dispara desde un botón y no debe re-crear renderizaciones.
  // El descuento DEFINITIVO lo recalcula el servidor al crear el pedido.
  const checkCoupon = useCallback(
    (code: string, sub: number) =>
      validateCouponFn({ data: { code, subtotal: sub, sid: currentSid() } }),
    [],
  );

  /* ---------------------------------------------------------------- derivados */

  // Tripleta pública que se pinta SIN sesión (catálogo, textos del CMS, vitrina
  // de reseñas): si la query llega por red antes de que React hidrate, el
  // primer render del cliente mostraría datos donde el SSR pintó el vacío →
  // hydration mismatch. Con `mounted` ambos renders iniciales coinciden y el
  // efecto re-pinta un instante después. Las demás listas exigen sesión, que
  // no existe hasta el montaje, así que su query está apagada en SSR: sin riesgo.
  const products = mounted ? (productsQ.data ?? []) : [];
  const orders = ordersQ.data ?? [];
  const claims = claimsQ.data ?? [];
  const messages = messagesQ.data ?? [];
  const users = usersQ.data ?? [];
  const couriers = couriersQ.data ?? [];
  const custom = customQ.data ?? [];
  const content = (mounted ? (contentQ.data ?? {}) : {}) as SiteContent;

  const addToCart = useCallback((product: Product, qty = 1) => {
    if (product.alcohol && !isAgeVerified()) {
      setAgeVerified(false);
      window.dispatchEvent(new Event("br-need-age"));
      return { ok: false as const, reason: "age" as const };
    }
    const next = getCart();
    const found = next.find((c) => c.id === product.id);
    // Tope de stock EN CLIENTE (además del que ya valida el servidor en el
    // checkout): con control de stock activo la cesta nunca supera las unidades
    // disponibles, así el cliente no puede añadir de más y quedarse atascado.
    const cap = typeof product.stock === "number" ? Math.max(0, Math.floor(product.stock)) : null;
    const cur = found ? found.qty : 0;
    if (cap !== null && cur >= cap) {
      setCart(next);
      toast.message(
        cap <= 0 ? `${product.name}: agotado` : `No hay más unidades de ${product.name}`,
      );
      return { ok: false as const, reason: "stock" as const, cap };
    }
    const target = cap === null ? cur + qty : Math.min(cap, cur + qty);
    if (found) found.qty = target;
    else next.push({ id: product.id, qty: target });
    setCart(next);
    // Feedback sonoro/visual (pitido 8-bit + rebote del bolsón). Aditivo y a
    // prueba de fallos: ver lib/cart-fx.ts. El vuelo de la imagen lo dispara la
    // propia tarjeta, que es quien conoce su posición en pantalla.
    playAddSfx();
    bumpCart();
    return { ok: true as const, capped: cap !== null && target < cur + qty };
  }, []);

  /* -------------------------------------------------------------- favoritos */

  /**
   * Wishlist local: ids en `localStorage` (como la cesta, por dispositivo).
   * `toggleFav` devuelve el estado NUEVO para que el corazón de la ficha pinte
   * sin esperar al ciclo de `onSync`.
   */
  const isFav = useCallback((id: string) => favs.includes(id), [favs]);

  const toggleFav = useCallback((id: string) => {
    const cur = getFavs();
    const now = !cur.includes(id);
    setFavs(now ? [id, ...cur] : cur.filter((x) => x !== id));
    return now;
  }, []);

  /**
   * «Repetir pedido» en un toque: devuelve los productos de un pedido pasado a
   * la cesta de golpe. Los productos ya dados de baja se ignoran (se avisa con
   * `skipped`), y los +18 piden la confirmación de edad igual que al añadir uno
   * a uno. No toca el resto de la cesta: suma cantidades sobre lo existente.
   */
  const reorderItems = useCallback(
    (items: { id: string; qty: number }[]) => {
      const next = getCart();
      let added = 0;
      let skipped = 0;
      let blockedAge = false;
      for (const it of items) {
        const product = products.find((p) => p.id === it.id);
        if (!product) {
          skipped += 1;
          continue;
        }
        if (product.alcohol && !isAgeVerified()) {
          blockedAge = true;
          skipped += 1;
          continue;
        }
        const found = next.find((c) => c.id === product.id);
        if (found) found.qty = Math.min(999, found.qty + it.qty);
        else next.push({ id: product.id, qty: Math.min(999, it.qty) });
        added += 1;
      }
      if (added > 0) {
        setCart(next);
        playAddSfx();
        bumpCart();
      }
      if (blockedAge) window.dispatchEvent(new Event("br-need-age"));
      return { added, skipped, blockedAge };
    },
    [products],
  );

  const setQty = useCallback(
    (id: string, qty: number) => {
      const product = products.find((p) => p.id === id);
      const cap =
        product && typeof product.stock === "number"
          ? Math.max(0, Math.floor(product.stock))
          : null;
      const bounded = cap === null ? qty : Math.min(qty, cap);
      setCart(
        getCart()
          .map((c) => (c.id === id ? { ...c, qty: bounded } : c))
          .filter((c) => c.qty > 0),
      );
    },
    [products],
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
  const dbErrorMsg = firstError ? String((firstError as Error).message ?? firstError) : null;
  // Un 429 del tope anti-avalanchas (las server functions viajan como POST) NO
  // es un fallo de base de datos: es tráfico momentáneo. Lo clasificamos para
  // avisar «espera un momento» y no asustar con «revisa las variables MySQL».
  const dbRateLimited = /demasiadas peticiones|too many|espera un momento|\b429\b/i.test(
    dbErrorMsg || "",
  );

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
    /** Hora de inicio de la jornada del repartidor conectado (null sin elegir). */
    myShiftStart: myShiftQ.data?.shiftStart ?? null,
    /** Pedidos archivados (eliminados) — solo admin. */
    archivedOrders: archivedQ.data ?? [],
    /** Todas las faltas registradas — solo admin. */
    faultsAdmin: faultsAdminQ.data ?? [],
    /** Faltas del repartidor conectado (aviso) y recuento. */
    myFaults: myFaultsQ.data?.faults ?? [],
    myFaultsTotal: myFaultsQ.data?.total ?? 0,
    myFaultsUnread: myFaultsQ.data?.unread ?? 0,
    /** Última posición de cada repartidor — solo admin (mapa en vivo). */
    liveCouriers: liveQ.data ?? [],
    /** Estadísticas del panel — solo admin (null hasta que llegan). */
    stats: statsQ.data ?? null,
    statsLoading: statsQ.isLoading,
    /** Auditoría de accesos — solo admin: última lista de sesiones registradas. */
    sessions: sessionsQ.data ?? [],
    sessionsLoading: sessionsQ.isLoading,
    /** IPs bloqueadas — solo admin (panel Seguridad). */
    ipBans: ipBansQ.data ?? [],
    ipBansLoading: ipBansQ.isLoading,
    /** IPs de intentos de login (24 h) — solo admin: detector de ataques. */
    suspiciousIps: suspiciousIpsQ.data ?? [],
    suspiciousIpsLoading: suspiciousIpsQ.isLoading,
    /** Solicitudes de recuperación pendientes — solo admin (bandeja "Cuentas"). */
    resetRequests: resetRequestsQ.data ?? [],
    resetRequestsLoading: resetRequestsQ.isLoading,
    /** Cupones y códigos de afiliado — solo admin. */
    coupons: couponsQ.data ?? [],
    couponsLoading: couponsQ.isLoading,
    /** Reseñas PUBLICADAS (vitrina de la portada); las privadas solo viajan al admin. */
    reviews: mounted ? (publishedReviewsQ.data ?? []) : [],
    /** Todas las reseñas (bandeja del admin), incluidas las privadas. */
    adminReviews: adminReviewsQ.data ?? [],
    adminReviewsLoading: adminReviewsQ.isLoading,
    /** Ids de pedido que este cliente ya valoró (ocultan el formulario repetido). */
    myReviewedOrderIds: myReviewedQ.data ?? [],
    /** Apoyos «Apóyanos» registrados — solo admin. */
    donations: donationsQ.data ?? [],
    donationsLoading: donationsQ.isLoading,
    /** Overrides de contenido guardados (sin merge); las páginas los mezclan con defaults. */
    content,
    /** `true` si la pasarela puede cobrar (real configurada o modo pruebas activo). */
    paymentsEnabled: Boolean(paymentsQ.data?.enabled),
    /** Estado completo de la pasarela (proveedor, modo pruebas, claves) para la UI. */
    paymentStatus: paymentsQ.data ?? null,
    /** Primer pintado del catálogo: las pantallas muestran skeleton hasta aquí. */
    isLoading: !mounted || productsQ.isLoading,
    /** MySQL no responde: la UI avisa de que faltan datos (despliegue mal configurado). */
    dbError: dbErrorMsg,
    /** `true` si el error es el tope de peticiones (429), no una caída de BD. */
    dbRateLimited,
    /** Hay una recarga de pedidos/reclamaciones en vuelo (el sondeo de 15 s). */
    isRefreshing: ordersQ.isFetching || claimsQ.isFetching,
    setAgeVerified,
    /** Guarda en servidor que este cliente confirmó ser mayor de 18 (pedidos con alcohol). */
    declareAdult: declareAdultMut.mutateAsync,
    addToCart,
    setQty,
    clearCart,
    /** Wishlist local: favoritos del navegador (ids de producto). */
    favs,
    isFav,
    toggleFav,
    /** «Repetir pedido»: rellena la cesta desde un pedido histórico en un toque. */
    reorderItems,
    login: loginMut.mutateAsync,
    loginPending: loginMut.isPending,
    logout: () => logoutMut.mutate(),
    registerUser: registerMut.mutateAsync,
    registerPending: registerMut.isPending,
    requestPasswordReset: requestResetMut.mutateAsync,
    resetPassword: resetPasswordMut.mutateAsync,
    createOrder: createOrderMut.mutateAsync,
    /** Calles que existen dentro de ese CP (desplegable del checkout, Fase 10). */
    addressSuggestions,
    assignCourier: assignCourierMut.mutateAsync,
    /** Reactivar un cancelado asignándolo a otro repartidor (solo admin). */
    reactivateAssignCourier: reactivateAssignMut.mutateAsync,
    courierAccept: courierAcceptMut.mutateAsync,
    markDelivered: markDeliveredMut.mutateAsync,
    cancelOrder: cancelOrderMut.mutateAsync,
    /** Abre el Checkout de Stripe del pedido; devuelve `{ url }` para navegar. */
    payByCard: payByCardMut.mutateAsync,
    /** Pregunta a servidor (y este a Stripe) si el pedido está cobrado. */
    checkPayment: paymentStatusMut.mutateAsync,
    addClaim: addClaimMut.mutateAsync,
    resolveClaim: resolveClaimMut.mutateAsync,
    sendMessage: sendMessageMut.mutateAsync,
    replyMessage: replyMessageMut.mutateAsync,
    setUserStatus: setUserStatusMut.mutateAsync,
    deleteUser: deleteUserMut.mutateAsync,
    /** Bloquea/desbloquea una IP (exige 2FA en servidor). Solo admin. */
    banIp: banIpMut.mutateAsync,
    unbanIp: unbanIpMut.mutateAsync,
    /** El admin fija una contraseña nueva a una cuenta (recuperación mediada). */
    adminSetPassword: adminSetPasswordMut.mutateAsync,
    setCourierShift: setCourierShiftMut.mutateAsync,
    deleteOrder: deleteOrderMut.mutateAsync,
    restoreOrder: restoreOrderMut.mutateAsync,
    /** Borrado definitivo de un pedido archivado (solo admin). */
    purgeOrder: purgeOrderMut.mutateAsync,
    resetLaunchData: resetLaunchMut.mutateAsync,
    /** El repartidor cancela su reparto en curso con motivo obligatorio. */
    courierCancel: courierCancelMut.mutateAsync,
    addCourierFault: addFaultMut.mutateAsync,
    deleteCourierFault: deleteFaultMut.mutateAsync,
    ackFaults: ackFaultsMut.mutateAsync,
    addCustomProduct: addProductMut.mutateAsync,
    removeCustomProduct: removeProductMut.mutateAsync,
    reorderCustom: reorderProductsMut.mutateAsync,
    searchEan,
    importUrl,
    fetchImage,
    pingCourierLocation,
    pingCustomerLocation,
    saveSection: saveSectionMut.mutateAsync,
    resetSection: resetSectionMut.mutateAsync,
    saveProductPatch: saveProductPatchMut.mutateAsync,
    resetProductPatch: resetProductPatchMut.mutateAsync,
    /** Comprueba un cupón contra el servidor (pre-visualización del checkout). */
    checkCoupon,
    createCoupon: createCouponMut.mutateAsync,
    setCouponActive: setCouponActiveMut.mutateAsync,
    deleteCoupon: deleteCouponMut.mutateAsync,
    /** Reseña privada de un pedido entregado propio (nace sin publicar). */
    submitReview: createReviewMut.mutateAsync,
    setReviewPublished: setReviewPublishedMut.mutateAsync,
    deleteReview: deleteReviewMut.mutateAsync,
    /** Registra un apoyo «Apóyanos» (1–999 €); no cobra nada aún. */
    donate: donateMut.mutateAsync,
    deleteDonation: deleteDonationMut.mutateAsync,
    /* ------------------------------------------------------- sorteo (ruleta) */
    /** Estado de la ruleta para la página pública (null hasta que llega). */
    raffle: raffleQ.data ?? null,
    raffleLoading: !mounted || raffleQ.isLoading,
    /** Panel de Sorteos (config + premios con pesos + histórico) — solo admin. */
    adminRaffle: adminRaffleQ.data ?? null,
    adminRaffleLoading: adminRaffleQ.isLoading,
    /** Girar la ruleta (el resultado lo decide el servidor). */
    spinRaffle: raffleSpinMut.mutateAsync,
    spinRafflePending: raffleSpinMut.isPending,
    revealRaffle: raffleRevealMut.mutateAsync,
    claimRaffle: raffleClaimMut.mutateAsync,
    /** Abre el Checkout de Stripe de la reclamación; devuelve `{ url }`. */
    payRaffleClaim: rafflePayMut.mutateAsync,
    /** Confirma en servidor (y Stripe) el pago del premio: lo descubre. */
    checkRaffleClaim: rafflePayStatusMut.mutateAsync,
    /** Consuelo al perder: secreto ofrecido con -10 % (entry de compra ya creado). */
    raffleConsolation: raffleConsolationMut.mutateAsync,
    saveRaffleConfig: saveRaffleConfigMut.mutateAsync,
    upsertRafflePrize: upsertRafflePrizeMut.mutateAsync,
    deleteRafflePrize: deleteRafflePrizeMut.mutateAsync,
    setRaffleFlags: setRaffleFlagsMut.mutateAsync,
    /* ---------------------------------------------------------------- chapas */
    /** Estado público de Chapas (ofertas + saldo/libro si hay sesión). */
    chapa: chapaQ.data ?? null,
    chapaLoading: !mounted || chapaQ.isLoading,
    /** Panel de Chapas (config + ofertas + overrides + canjes + saldos). */
    adminChapa: adminChapaQ.data ?? null,
    adminChapaLoading: adminChapaQ.isLoading,
    redeemChapa: chapaRedeemMut.mutateAsync,
    saveChapaConfig: saveChapaConfigMut.mutateAsync,
    setChapaProduct: setChapaProductMut.mutateAsync,
    upsertChapaReward: upsertChapaRewardMut.mutateAsync,
    deleteChapaReward: deleteChapaRewardMut.mutateAsync,
    setChapaRedemption: setChapaRedemptionMut.mutateAsync,
    adjustChapaBalance: adjustChapaBalanceMut.mutateAsync,
    /* --------------------------------------------------------- pagos (0029) */
    /** Panel de Pagos: settings + claves + histórico — solo admin. */
    adminPayments: adminPaymentsQ.data ?? null,
    adminPaymentsLoading: adminPaymentsQ.isLoading,
    savePaymentSettings: savePaymentSettingsMut.mutateAsync,
    /** Datos del pago simulado para pintar /pago-demo (dueño o admin). */
    demoPaymentInfo: (token: string) => demoPaymentInfoFn({ data: { sid, token } }),
    /** Aprobar el pago simulado: marca pagado sin cobrar nada. */
    approveDemoPayment: demoApproveMut.mutateAsync,
    cancelDemoPayment: demoCancelMut.mutateAsync,
    /* ---------------------------------------- campanita e invitaciones (0030) */
    /** Últimas notificaciones de la sesión (premios, chapas, mensajes, pedidos). */
    notifications: notificationsQ.data?.items ?? [],
    notificationsUnread: notificationsQ.data?.unread ?? 0,
    /** Marcar leídas la campanita: todas (sin id) o una sola. */
    markNotificationsRead: (args?: { id?: string }) => notifReadMut.mutateAsync(args),
    /** Mis enlaces de invitación: el activo primero, luego los gastados. */
    affiliateLinks: affiliateLinksQ.data ?? [],
    affiliateLinksLoading: affiliateLinksQ.isLoading,
    /** Genera (o reutiliza) mi enlace de invitación de chapas. */
    createAffiliateLink: createAffLinkMut.mutateAsync,
    createAffiliateLinkPending: createAffLinkMut.isPending,
    /** Ficha pública de un enlace (quién invita y cuánto regala). */
    affiliateInfo: (code: string) => affiliateInfoFn({ data: { code } }),
    /** Cuenta registrada que abre el enlace: se vincula como referida. */
    attachReferral: (code: string) => attachReferralMut.mutateAsync(code),
    /** El admin confirma el correo de una cuenta a mano (Panel → Cuentas). */
    adminVerifyEmail: adminVerifyEmailMut.mutateAsync,
    /** El admin reenvía el enlace de activación por correo. */
    adminResendVerification: adminResendVerificationMut.mutateAsync,
    testSmtp: testSmtpMut.mutateAsync,
  };
}

/* ------------------------------------------------------- tipos de entrada de acción */

type OrderInput = Parameters<typeof createOrderFn>[0]["data"];
type AssignInput = Omit<Parameters<typeof assignCourierFn>[0]["data"], "sid">;
type IdInput = Omit<Parameters<typeof courierAcceptFn>[0]["data"], "sid">;
type AnswerInput = Omit<Parameters<typeof resolveClaimFn>[0]["data"], "sid">;
type ClaimInput = Omit<Parameters<typeof addClaimFn>[0]["data"], "sid">;

/** Alta de cupón: mismo contrato que valida `createCouponFn` (br-api). */
type CouponDraftInput = Parameters<typeof createCouponFn>[0]["data"]["draft"];

/** Entrada de alta de cuenta: mismo contrato que valida `registerFn` (br-api). */
type RegisterInput = {
  name: string;
  email: string;
  pass: string;
  role?: "user" | "repartidor";
  dni?: string;
  vehicle?: "patinete" | "bici" | "moto" | "coche";
  phone?: string;
  /** Código `AF-...` del enlace de invitación (0030); si falta se lee de `br_ref`. */
  ref?: string | null;
};

/**
 * Consulta de la página de seguimiento (`/seguimiento/BR-XXXX`): se refresca
 * cada 10 s mientras el pedido esté en juego y deja de sondear al entregarse o
 * cancelarse. El servidor autoriza contra la sesión (dueño / repartidor /
 * admin); el navegador solo manda el código.
 */
export function useOrderTracking(orderRef: string) {
  const s = currentSession();
  return useQuery({
    queryKey: ["tracking", orderRef, s?.sid ?? "anon"],
    queryFn: () => orderTrackingFn({ data: { sid: s?.sid, orderRef } }),
    enabled: Boolean(orderRef && s?.sid),
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st === "entregado" || st === "cancelado" ? false : 10_000;
    },
  });
}

export type Br = ReturnType<typeof useBr>;
