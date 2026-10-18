import { SERVICE_AREA_LABEL, SERVICE_AREA_TOWNS } from "./service-area";
import { CATEGORIES, type CategoryId } from "./types";

/**
 * Defaults del CMS del panel admin. Cada valor es EXACTAMENTE el que hoy está
 * escrito a mano en las páginas, de modo que con la tabla `br_content` vacía el
 * sitio se ve idéntico. El editor guarda solo overrides parciales encima.
 *
 * NO duplicar aquí lo que ya es fuente única: la zona de reparto sale de
 * `service-area.ts` (los textos que la citan la interpolan).
 */

/* ------------------------------------------------------------------ tipos */

export type Slide = { src: string; kicker: string; title: string; caption: string };
export type IconKey = "clock" | "snow" | "pin";
export type NavLink = { to: string; label: string };
export type Step = { iconKey: IconKey; t: string; d: string; img: string };
export type Testimonial = { q: string; who: string };
export type CategoryCopy = { label: string; kicker: string; image: string };

export type HeroSection = { slides: Slide[] };
/**
 * Orden de las secciones de la portada. El default es EXACTAMENTE el orden que
 * siempre tuvieron; el admin lo cambia arrastrando en «Inicio · orden» y la
 * página lo lee con `HOME_SECTION_IDS` como filtro de seguridad (ids válidas).
 */
export const HOME_SECTION_IDS = [
  "pasillos",
  "nevera",
  "casa",
  "como",
  "testimonios",
  "cobertura",
  "buzon",
] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];
export type HomeOrderSection = { sections: HomeSectionId[] };
export type PasillosSection = { kicker: string; title: string; linkLabel: string };
export type NeveraSection = { kicker: string; title: string; lead: string };
export type CasaSection = {
  kicker: string;
  title: string;
  body: string;
  ctaLabel: string;
  imgBg: string;
  img1: string;
  img2: string;
};
export type ComoSection = { kicker: string; title: string; steps: Step[] };
export type TestimoniosSection = {
  heroImg: string;
  heroQuote: string;
  heroWho: string;
  items: Testimonial[];
};
export type CoberturaSection = { kicker: string; title: string; body: string; cities: string[] };
export type BuzonSection = {
  kicker: string;
  title: string;
  body: string;
  placeholder: string;
  ctaLabel: string;
};
export type CategoriesSection = Record<CategoryId, CategoryCopy>;
export type BrandSection = {
  name: string;
  topBadge: string;
  topDelivery: string;
  topShippingLabel: string;
  catalogKicker: string;
  catalogFallbackTitle: string;
  catalogLead: string;
};
export type NavSection = { items: NavLink[]; pasillosLabel: string };
export type FooterSection = {
  tagline: string;
  coverageLabel: string;
  storeTitle: string;
  legalTitle: string;
  storeLinks: NavLink[];
  legalLinks: NavLink[];
  legalNote: string;
  copyright: string;
};
export type AgeGateSection = {
  title: string;
  body: string;
  ok: string;
  no: string;
  notePrefix: string;
  termsLink: string;
  privacyLink: string;
};
export type CheckoutSection = { cartTitle: string; empty: string; submit: string };
export type MetaSection = { title: string; description: string };
export type LegalSection = { title: string; paragraphs: string[] };
export type ContactSection = {
  supportEmail: string;
  privacyEmail: string;
  phone: string;
  hours: string;
};

/**
 * Interruptores que el admin usa para abrir/cerrar las entradas públicas sin
 * tocar código: altas de cliente, altas de repartidor y el buzón de soporte.
 * Por defecto TODO abierto (la web se comporta como hasta ahora).
 */
export type PortalesSection = {
  registroCliente: boolean;
  registroRepartidor: boolean;
  soporte: boolean;
  /**
   * Migración 0030: exige confirmar el correo (con SMTP activo) para entrar.
   * OFF por defecto — así las altas funcionan en cuanto se despliega, sin
   * depender de que el correo de confirmación llegue o no.
   */
  confirmarCorreo: boolean;
};

/**
 * Aviso deslizante de la barra superior (marquee de derecha a izquierda).
 * Vacío o apagado = la cabecera se ve exactamente como hoy.
 */
export type AvisoSection = { activo: boolean; texto: string };
/**
 * Cierre temporal de la tienda: los clientes ven una pantalla de mantenimiento
 * y el servidor rechaza pedidos nuevos (el admin y el repartidor siguen dentro).
 */
export type MantenimientoSection = {
  activo: boolean;
  titulo: string;
  mensaje: string;
  vuelta: string;
};

/**
 * Fase 11: días de reparto (índices JS: 0 = domingo ... 6 = sábado). Los
 * pedidos de los días NO marcados quedan como RESERVA para el siguiente día
 * de reparto. Lista vacía = reparto todos los días (función apagada).
 */
export type RepartoSection = { dias: number[] };

export type SiteSectionKey =
  | "hero"
  | "home.order"
  | "home.pasillos"
  | "home.nevera"
  | "home.casa"
  | "home.como"
  | "home.testimonios"
  | "home.cobertura"
  | "home.buzon"
  | "categories"
  | "brand"
  | "nav"
  | "footer"
  | "agegate"
  | "checkout"
  | "meta"
  | "legal.privacidad"
  | "legal.terminos"
  | "contacto"
  | "portales"
  | "aviso"
  | "mantenimiento"
  | "reparto";

/* ---------------------------------------------------------------- defaults */

export const SITE_DEFAULTS = {
  hero: {
    slides: [
      {
        src: "/brand/slides/terraza.jpg",
        kicker: "Aperitivo",
        title: "La terraza, resuelta.",
        caption: "Frío, salado y a tiempo. Como el súper, sin la cola.",
      },
      {
        src: "/brand/slides/patinete.jpg",
        kicker: "Reparto",
        title: "Un patinete. Tu barrio, ya.",
        caption: "Calle estrecha, nevera llena, en aprox. 30 minutos.",
      },
      {
        src: "/brand/slides/mesa.jpg",
        kicker: "Mesa",
        title: "Lo que pide la sobremesa.",
        caption: "Aceitunas, vermú, jamón y el crujido que cierra el día.",
      },
      {
        src: "/brand/slides/nevera.jpg",
        kicker: "Nevera",
        title: "Bien fría, en la puerta.",
        caption: "Refrescos, cerveza y citrus con el vaho todavía puesto.",
      },
      {
        src: "/brand/slides/azotea.jpg",
        kicker: "Noche",
        title: "La ciudad, abajo. El brindis, aquí.",
        caption: "Bodega verificada. DNI en la entrega. Sin prisas feas.",
      },
      {
        src: "/brand/slides/sofa.jpg",
        kicker: "Sofá",
        title: "El picoteo que no espera.",
        caption: "Snacks de súper, lámpara baja, pedido en camino.",
      },
    ],
  } satisfies HeroSection,

  // Orden histórico de la portada: si nadie lo toca, `index.tsx` renderiza
  // exactamente en el orden de siempre.
  "home.order": {
    sections: [...HOME_SECTION_IDS],
  } satisfies HomeOrderSection,

  "home.pasillos": {
    kicker: "Pasillos",
    title: "Como el súper, sin la cola.",
    linkLabel: "Catálogo completo",
  } satisfies PasillosSection,

  "home.nevera": {
    kicker: "Nevera",
    title: "Lo que pide la nevera",
    lead: "Ofertas y la caja degustación de la casa. Añade y lo mandamos frío.",
  } satisfies NeveraSection,

  "home.casa": {
    kicker: "La casa",
    title: "Despensa de barrio, velocidad de ciudad.",
    body: "Aceite, arroz, café y lo de siempre, a precio de lineal. No es un dark store de plástico: es el ultramarino que llega en patinete por el barrio.",
    ctaLabel: "Ver despensa",
    imgBg: "/brand/slides/despensa.jpg",
    img1: "/brand/slides/mesa.jpg",
    img2: "/brand/slides/nevera.jpg",
  } satisfies CasaSection,

  "home.como": {
    kicker: "Cómo va",
    title: "Pides. Enfriamos. Llega.",
    steps: [
      {
        iconKey: "clock",
        t: "Pides",
        d: "Catálogo de ultramarinos con precios de DIA, Lidl y Consum. Cesta en un toque.",
        img: "/brand/slides/mesa.jpg",
      },
      {
        iconKey: "snow",
        t: "Enfriamos",
        d: "Bebidas de nevera, snacks y despensa. Alcohol solo con mayoría de edad.",
        img: "/brand/slides/nevera.jpg",
      },
      {
        iconKey: "pin",
        t: "Llega",
        d: "Patinete por el barrio. Código BR-XXXX, timeline en tu cuenta, DNI si hay bodega.",
        img: "/brand/slides/patinete.jpg",
      },
    ],
  } satisfies ComoSection,

  "home.testimonios": {
    heroImg: "/brand/slides/azotea.jpg",
    heroQuote:
      "“Pedí el vermú y las aceitunas desde la azotea. El patinete llegó antes que el atardecer.”",
    heroWho: "Clara · Badalona",
    items: [
      { q: "Nunca más bajar a por hielo y snacks a las once.", who: "Martín · Ripollet" },
      { q: "Precios de lineal, no de terraza turística.", who: "Núria · Sant Adrià de Besòs" },
      { q: "La caja rayo resolvió el cumple de la oficina.", who: "Iago · Badalona" },
    ],
  } satisfies TestimoniosSection,

  "home.cobertura": {
    kicker: "Cobertura",
    title: "De momento, tu barrio.",
    body: `Salimos desde un almacén urbano y repartimos en ${SERVICE_AREA_LABEL}. Si tu calle está en la lista, el patinete entra. Si no, dínoslo: vamos abriendo barrio a barrio.`,
    cities: [...SERVICE_AREA_TOWNS],
  } satisfies CoberturaSection,

  "home.buzon": {
    kicker: "Buzón",
    title: "Rayos de ofertas, sin spam.",
    body: "Un correo cuando hay reposición relámpago o envío gratis extra. Express España, en la bandeja.",
    placeholder: "tu@email.com",
    ctaLabel: "Apuntarme",
  } satisfies BuzonSection,

  categories: Object.fromEntries(
    (Object.keys(CATEGORIES) as CategoryId[]).map((id) => [
      id,
      { label: CATEGORIES[id].label, kicker: CATEGORIES[id].kicker, image: CATEGORIES[id].image },
    ]),
  ) as CategoriesSection,

  brand: {
    name: "Botella Rápida",
    topBadge: "Express España",
    topDelivery: "Reparto 24 h · aprox. 30 min",
    topShippingLabel: "Envío gratis desde",
    catalogKicker: "Express España",
    catalogFallbackTitle: "Todos los pasillos",
    catalogLead: "Ultramarinos a precio de supermercado. Filtra, añade, y lo mandamos en patinete.",
  } satisfies BrandSection,

  nav: {
    items: [
      { to: "/catalogo", label: "Catálogo" },
      { to: "/soporte", label: "Soporte" },
      { to: "/sorteo", label: "Sorteo!" },
      { to: "/chapas", label: "Chapas" },
    ],
    pasillosLabel: "Pasillos",
  } satisfies NavSection,

  footer: {
    tagline:
      "Express España. Ultramarinos urbanos a velocidad de patinete. Precios de supermercado, nevera fría, puerta en aprox. 30 minutos. Tienda y reparto abiertos 24 horas.",
    coverageLabel: "Reparto en",
    storeTitle: "Tienda",
    legalTitle: "Legal",
    storeLinks: [
      { to: "/catalogo", label: "Catálogo" },
      { to: "/soporte", label: "Soporte" },
      { to: "/acceso", label: "Acceso" },
    ],
    legalLinks: [
      { to: "/privacidad", label: "Privacidad" },
      { to: "/terminos", label: "Términos" },
    ],
    legalNote: "Solo mayores de 18 años",
    copyright:
      "© 2026 Botella Rápida S.L. · Express España · Consumo responsable. Si bebes, no conduzcas.",
  } satisfies FooterSection,

  agegate: {
    title: "¿Tienes 18 años o más?",
    body: "Vendemos bodega. La ley española exige confirmar mayoría de edad. Sin verificación, el alcohol no se muestra.",
    ok: "Tengo 18 o más",
    no: "Soy menor de 18",
    notePrefix: "Al continuar aceptas los",
    termsLink: "términos",
    privacyLink: "privacidad",
  } satisfies AgeGateSection,

  checkout: {
    cartTitle: "Tu cesta",
    empty: "La cesta está vacía.",
    submit: "Finalizar pedido",
  } satisfies CheckoutSection,

  meta: {
    title: "Botella Rápida",
    description: `Botella Rápida: ultramarinos online, aperitivos, snacks, refrescos y bodega a precios de supermercado. Entrega en aprox. 30 minutos con reparto 24 horas, en ${SERVICE_AREA_LABEL}.`,
  } satisfies MetaSection,

  "legal.privacidad": {
    title: "Privacidad",
    paragraphs: [
      `Botella Rápida S.L. trata los datos de pedidos, cuentas y soporte para entregar ultramarinos en nuestra zona de reparto (${SERVICE_AREA_LABEL} y alrededores). Base jurídica: ejecución del contrato y consentimiento del age gate.`,
      "Usuarios, pedidos, reclamaciones y soporte se guardan en la base de datos del servidor (MySQL). La cesta y la declaración de mayoría de edad se conservan solo en tu navegador. No hay cesión a terceros ni cookies publicitarias. Para ejercer derechos RGPD: botellarapidadmin@gmail.com.",
      "El age gate recuerda tu declaración de mayoría de edad en el dispositivo; el alcohol no se muestra sin ella. Tus contraseñas se guardan cifradas (hash) en el servidor y la sesión se protege con una cookie httpOnly. Cuando el pago online esté activo, se procesa por una pasarela certificada: no almacenamos números de tarjeta.",
      "Seguimiento por GPS (finalidad de entrega): durante un reparto en curso, el portal del repartidor envía su última posición (nunca rutas históricas: cada envío sobrescribe al anterior y deja de ser visible a las 6 h). El repartidor puede pausar el GPS cuando quiera con el interruptor de su portal, y fuera de turno jamás se le rastrea. De forma BIDIRECCIONAL y opcional, el cliente puede activar «Compartir mi ubicación» en su pantalla de seguimiento (permiso explícito del navegador): solo entonces su última posición se envía al repartidor asignado y a la central de Botella Rápida durante un máximo de 10 min, para facilitar la entrega; se sobrescribe con cada nuevo fijado, caduca a los 10 min sin guardarse histórico y deja de enviarse al terminar el reparto o al desactivarlo con un toque. Los datos personales del repartidor (email, teléfono, DNI) nunca se muestran al cliente: solo su nombre de pila.",
      "Confirmación de correo en altas nuevas: al registrarte con contraseña te enviamos un enlace de verificación de un solo uso desde botellarapidadmin@gmail.com; la cuenta no se puede usar hasta confirmar que el correo es tuyo. Así evitamos que alguien suplante el email de otra persona. Las cuentas creadas con Google ya vienen verificadas por Google. Ese correo de confirmación se usa solo para activar la cuenta y avisos esenciales, nunca para publicidad.",
      "Inicio de sesión con Google: usamos Google Identity Services; Google confirma ante nosotros que el email es suyo (token firmado y email verificado), por lo que nadie puede abrir ni crear una cuenta con el correo de otra persona. Solo leemos nombre y email. Los avisos de pedido (email y notificaciones del navegador) son opcionales y se desactivan desde tu propio gestor de correo o del navegador.",
    ],
  } satisfies LegalSection,

  "legal.terminos": {
    title: "Términos",
    paragraphs: [
      `Pedidos sujetos a stock y zona de entrega (${SERVICE_AREA_LABEL} y alrededores). Envío 2,90 €; gratis a partir de 25 €. Franja inmediata estimada en aprox. 30 minutos, no es un compromiso de carrier.`,
      "La venta de alcohol está prohibida a menores de 18 años. El repartidor puede exigir DNI en la entrega y cancelar la parte de bodega si no hay verificación. Bebe con responsabilidad.",
      "Desistimiento: 14 días para productos no perecederos y no abiertos, según la normativa de consumidores. Reclamaciones desde Tu cuenta o escribiéndonos desde Soporte.",
    ],
  } satisfies LegalSection,

  contacto: {
    supportEmail: "botellarapidadmin@gmail.com",
    privacyEmail: "botellarapidadmin@gmail.com",
    phone: "",
    hours: "Abierto y reparto 24 horas, todos los días",
  } satisfies ContactSection,

  // ASERCION (no `satisfies`): con `satisfies` los `true` literales no se
  // ensanchan a `boolean`, y un booleano no es assignable a Partial<{...: true}>
  // al hacer mergeSection. Así SITE_DEFAULTS.portales tiene campos boolean.
  portales: {
    registroCliente: true,
    registroRepartidor: true,
    soporte: true,
    confirmarCorreo: false,
  } as PortalesSection,

  // ASERCION también aquí: los `false` literales no deben estrecharse al hacer
  // mergeSection con overrides parciales. Default = nada de aviso (web de hoy).
  aviso: {
    activo: false,
    texto: "",
  } as AvisoSection,

  // Mantenimiento OFF por defecto: sin fila en `br_content`, tienda abierta.
  mantenimiento: {
    activo: false,
    titulo: "Cerrados por mantenimiento",
    mensaje:
      "Estamos haciendo unos ajustes en la tienda. Volvemos en unos minutos: tu cesta sigue guardada en tu dispositivo.",
    vuelta: "",
  } as MantenimientoSection,

  // Fase 11: de momento se reparte viernes, sábado y domingo (se cambia desde
  // Panel → Ajustes). El resto de días la tienda sigue abierta: los pedidos
  // llegan como reserva al siguiente día de reparto.
  reparto: {
    dias: [5, 6, 0],
  } as RepartoSection,
};

/* -------------------------------------------------------------- utilidades */

/** Overrides parciales por sección, tal como viajan desde `br_content`. */
export type SiteContent = Partial<Record<SiteSectionKey, unknown>>;

/**
 * Merge superficial: el override reemplaza campos presentes (y las listas enteras).
 * Sin override devuelve el default literal => la página queda idéntica a hoy.
 */
export function mergeSection<T extends object>(def: T, over?: Partial<T> | null): T {
  return over ? { ...def, ...over } : def;
}

export function getDefaults<K extends SiteSectionKey>(key: K) {
  return SITE_DEFAULTS[key];
}
