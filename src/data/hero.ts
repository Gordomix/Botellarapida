import { SERVICE_AREA_TOWNS } from "./service-area";

export const HERO_SLIDES = [
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
    caption: "Calle estrecha, nevera llena, menos de 90 minutos.",
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
] as const;

// Cobertura real: los municipios donde repartimos hoy. Fuente única en
// `service-area.ts`; al ampliar zona se actualizan solos el marquesina, el pie
// y la parrilla de "Cobertura".
export const CITIES = SERVICE_AREA_TOWNS;
