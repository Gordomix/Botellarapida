/**
 * Excel de rentabilidad (Admin → Productos → «Excel rentabilidad»).
 *
 * Genera un .xlsx REAL (SheetJS) sobre los productos subidos por el admin con
 * CINCO hojas:
 *  - «Parámetros»: IVA, margen objetivo, reparto repartidor y pasarela.
 *  - «Precios %»:  catálogo AGRUPADO POR CATEGORÍA (y «Sin categoría» al final).
 *                  Cada grupo tiene su % de recargo (se edita en la cabecera) y
 *                  cada producto puede además pisarlo con su % individual.
 *                  Columnas vivas: % aplicado, precio final (base + %), extra
 *                  añadido (€), división del precio entre unidades del pack,
 *                  ganancia neta por unidad y reparto repartidor/admin, con
 *                  subtotales por grupo y total general.
 *  - «Rentabilidad»: análisis clásico (coste, margen, precio recomendado, estado).
 *  - «Nutrición»: TODA la tabla nutricional de cada producto (una columna por
 *                  campo), con marca, categoría, +18 y graduación.
 *  - «Resumen»:  recuentos y sumas del catálogo completo.
 *
 * Las columnas calculadas viajan como **fórmulas vivas de Excel**: cambiar un
 * % de grupo, un % individual o un parámetro recalcula todo solo. Cada celda
 * lleva además el valor cacheado de fábrica, así la hoja ya se ve correcta
 * aunque el visor no recalcule al abrir.
 *
 * Es 100% cliente: no toca la BD, el catálogo ni el checkout.
 */
import * as XLSX from "xlsx";
import {
  CATEGORIES,
  FREE_SHIPPING,
  SHIPPING_COST,
  type CategoryId,
  type Product,
} from "@/data/types";

/** Parámetros editables del análisis (fracciones: 0.3 = 30 %). */
export type ProfitParams = {
  /** Margen neto objetivo sobre el PVP (para el precio recomendado). */
  targetPct: number;
  /** Porcentaje del beneficio neto que se lleva el repartidor. */
  courierPct: number;
  /** Comisión de la pasarela de pago aplicada sobre el PVP. */
  gatewayPct: number;
  /** IVA incluido en el PVP (alimentación 10 % en España). */
  ivaPct: number;
};

/** % de recargo por categoría (fracciones). Clave = CategoryId o "sin". */
export type GroupPct = Record<string, number>;

const EUR = '0.00" €"';
const PCT = "0.0%";

const PARAMS = "'Parámetros'";

/** Referencias de los parámetros en la hoja «Parámetros» (columna B). */
const P = {
  iva: `${PARAMS}!$B$2`,
  target: `${PARAMS}!$B$3`,
  courier: `${PARAMS}!$B$4`,
  gateway: `${PARAMS}!$B$5`,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fila calculada en JS (valor cacheado que acompaña a la fórmula). */
type RowCalc = {
  base: number;
  bruto: number | null;
  gate: number;
  net: number | null;
  rent: number | null;
  rec: number | "Inviable" | null;
  netRec: number | null;
  courierEur: number | null;
  adminEur: number | null;
  vsObj: number | null;
  estado: string;
};

function calc(p: Product, k: ProfitParams): RowCalc {
  const base = p.price / (1 + k.ivaPct);
  const gate = p.price * k.gatewayPct;
  const hasCost = typeof p.coste === "number" && p.coste >= 0;
  const bruto = hasCost ? base - (p.coste as number) : null;
  const net = bruto != null ? bruto - gate : null;
  const rent = net != null && hasCost && (p.coste as number) > 0 ? net / (p.coste as number) : null;
  const denom = 1 / (1 + k.ivaPct) - k.gatewayPct - k.targetPct;
  let rec: number | "Inviable" | null = null;
  let netRec: number | null = null;
  if (hasCost) {
    if (denom <= 0) rec = "Inviable";
    else {
      // ROUNDUP(x,0)-0.01: deja el recomendado rematado en ,99 igual que Excel.
      rec = Math.ceil((p.coste as number) / denom) - 0.01;
      netRec = rec / (1 + k.ivaPct) - (p.coste as number) - rec * k.gatewayPct;
    }
  }
  const courierEur = net != null ? net * k.courierPct : null;
  const adminEur = net != null ? net - (courierEur as number) : null;
  const vsObj = net != null ? net / p.price - k.targetPct : null;
  const estado = !hasCost
    ? "Sin coste"
    : (net as number) < 0
      ? "PÉRDIDAS"
      : (net as number) / p.price < k.targetPct
        ? "Bajo objetivo"
        : "OK";
  return { base, bruto, gate, net, rent, rec, netRec, courierEur, adminEur, vsObj, estado };
}

/** Escribe `z` (formato de número) en las celdas indicadas de una columna. */
function fmt(ws: XLSX.WorkSheet, col: string, from: number, to: number, z: string) {
  for (let r = from; r <= to; r++) {
    const c = ws[`${col}${r}`] as XLSX.CellObject | undefined;
    if (c) c.z = z;
  }
}

/** Pone una fórmula viva en una celda conservando su valor cacheado. */
function formula(ws: XLSX.WorkSheet, addr: string, f: string, cached: number | string | null, z?: string) {
  const cell: XLSX.CellObject =
    cached === null
      ? { t: "s", v: "", f }
      : typeof cached === "number"
        ? { t: "n", v: cached, f }
        : { t: "s", v: cached, f };
  if (z) cell.z = z;
  ws[addr] = cell;
}

function paramsSheet(k: ProfitParams): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    ["Parámetro", "Valor", "Qué controla"],
    ["IVA incluido en el PVP (%)", k.ivaPct, "Alimenta el PVP sin IVA y todos los márgenes"],
    ["Margen neto objetivo (sobre PVP)", k.targetPct, "Define el precio recomendado y el estado «Bajo objetivo»"],
    ["Repartidor (% del beneficio neto)", k.courierPct, "Parte del beneficio por unidad que se lleva el repartidor"],
    ["Comisión pasarela (% sobre PVP)", k.gatewayPct, "Coste de cobrar con tarjeta (se descuenta de la ganancia neta)"],
    ["Coste de envío (informativo)", SHIPPING_COST, "Lo que paga el cliente por reparto; no entra en el margen del producto"],
    ["Envío gratis desde (€)", FREE_SHIPPING, "Ticket a partir del cual el envío no se cobra"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, { wch: 10 }, { wch: 62 }];
  fmt(ws, "B", 2, 5, PCT);
  fmt(ws, "B", 6, 7, EUR);
  return ws;
}

/* ---------------------------------------------------------------- Precios % */

/** Orden de los grupos en la hoja (el resto cae en «Sin categoría»). */
const CAT_ORDER: CategoryId[] = [
  "aperitivos",
  "snacks",
  "refrescos",
  "basicos",
  "alcohol",
  "parafarmacia",
  "ofertas",
  "packs",
];

type Group = { key: string; label: string; items: Product[] };

/** Agrupa por categoría (orden fijo) y deja las desconocidas al final. */
function groupProducts(products: Product[]): Group[] {
  const groups: Group[] = [];
  for (const c of CAT_ORDER) {
    const items = products.filter((p) => p.cat === c);
    if (items.length) groups.push({ key: c, label: CATEGORIES[c]?.label ?? c, items });
  }
  const known = new Set<string>(CAT_ORDER);
  const rest = products.filter((p) => !known.has(p.cat));
  if (rest.length) groups.push({ key: "sin", label: "Sin categoría", items: rest });
  return groups;
}

/**
 * Hoja «Precios %»: catálogo agrupado con recargo por GRUPO (celda editable en
 * la cabecera de cada categoría) o INDIVIDUAL (columna I: si un producto la
 * rellena, pisa al % de su grupo). El precio final, el extra, la división por
 * unidades del pack, la ganancia neta y el reparto son fórmulas vivas.
 */
function preciosSheet(products: Product[], k: ProfitParams, pct: GroupPct): XLSX.WorkSheet {
  const head = [
    "Producto",
    "Marca",
    "Unidad",
    "+18",
    "Graduación",
    "Coste proveedor (€)",
    "PRECIO BASE (€, IVA incl.)",
    "% grupo (auto)",
    "% INDIVIDUAL (opcional, pisa al grupo)",
    "% APLICADO",
    "PRECIO FINAL (base + %) (€)",
    "EXTRA AÑADIDO (€)",
    "Uds del pack (para dividir)",
    "PRECIO / UD (€)",
    "GANANCIA NETA / UD (€)",
    "Repartidor (€/ud)",
    "Admin (€/ud)",
  ];
  const aoa: (string | number)[][] = [head];
  // Índice para escribir las fórmulas después: fila excel + datos de la fila.
  const prodRows: { r: number; p: Product; gp: number }[] = [];
  const subRows: { r: number; from: number; to: number }[] = [];
  for (const g of groupProducts(products)) {
    const gp = pct[g.key] ?? 0;
    // Cabecera de grupo: el % editable vive en la columna C de esta fila.
    aoa.push([`▸ ${g.label.toUpperCase()}`, "% del grupo →", gp, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    const from = aoa.length + 1;
    for (const p of g.items) {
      const fin = round2(p.price * (1 + gp));
      const net = typeof p.coste === "number" ? round2(fin / (1 + k.ivaPct) - p.coste - fin * k.gatewayPct) : null;
      aoa.push([
        p.name,
        p.brand,
        p.unit,
        p.alcohol ? "Sí" : "No",
        p.grad ?? "",
        typeof p.coste === "number" ? p.coste : "",
        p.price,
        gp,
        "",
        gp,
        fin,
        round2(fin - p.price),
        1,
        fin,
        net ?? "",
        net != null ? round2(net * k.courierPct) : "",
        net != null ? round2(net * (1 - k.courierPct)) : "",
      ]);
      prodRows.push({ r: aoa.length, p, gp });
    }
    const to = aoa.length;
    const extraSum = round2(prodRows.filter((x) => x.r >= from && x.r <= to).reduce((a, x) => a + (x.p.price * x.gp), 0));
    const nets = prodRows
      .filter((x) => x.r >= from && x.r <= to)
      .map((x) => {
        const fin = x.p.price * (1 + x.gp);
        return typeof x.p.coste === "number" ? fin / (1 + k.ivaPct) - x.p.coste - fin * k.gatewayPct : 0;
      });
    const netSum = round2(nets.reduce((a, b) => a + b, 0));
    aoa.push([
      `Total ${g.label} (1 ud de cada)`,
      "", "", "", "", "", "", "", "", "", "",
      extraSum,
      "", "",
      netSum,
      round2(netSum * k.courierPct),
      round2(netSum * (1 - k.courierPct)),
    ]);
    subRows.push({ r: aoa.length, from, to });
  }
  // Total general: suma de las filas «Total» de cada grupo.
  const grandExtra = round2(subRows.reduce((a, s) => a + Number(aoa[s.r - 1][11] || 0), 0));
  const grandNet = round2(subRows.reduce((a, s) => a + Number(aoa[s.r - 1][14] || 0), 0));
  aoa.push([
    "TOTAL GENERAL (1 ud de cada)",
    "", "", "", "", "", "", "", "", "", "",
    grandExtra, "", "", grandNet,
    round2(grandNet * k.courierPct),
    round2(grandNet * (1 - k.courierPct)),
  ]);
  const grandRow = aoa.length;

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 6 }, { wch: 11 }, { wch: 17 }, { wch: 22 },
    { wch: 14 }, { wch: 34 }, { wch: 13 }, { wch: 24 }, { wch: 19 }, { wch: 21 }, { wch: 16 },
    { wch: 22 }, { wch: 16 }, { wch: 14 },
  ];
  // Cabeceras de grupo: el % editable en formato porcentaje.
  for (const s of subRows) {
    const hdr = s.from - 1; // la fila «▸ categoría» precede inmediatamente al grupo
    const cell = ws[`C${hdr}`];
    if (cell) cell.z = PCT;
  }
  // Fórmulas vivas por producto.
  for (const { r, p, gp } of prodRows) {
    const fin = round2(p.price * (1 + gp));
    const net = typeof p.coste === "number" ? round2(fin / (1 + k.ivaPct) - p.coste - fin * k.gatewayPct) : null;
    // Referencia ABSOLUTA a la celda C de la cabecera del grupo: si el usuario
    // inserta filas en Excel, el % de grupo sigue apuntando al sitio correcto.
    const hdr = `$C$${s0(subRows, r)}`;
    formula(ws, `H${r}`, `IF(ISNUMBER(${hdr}),${hdr},0)`, gp, PCT);
    formula(ws, `J${r}`, `IF(I${r}="",H${r},I${r})`, gp, PCT);
    formula(ws, `K${r}`, `IF(OR(G${r}="",N(G${r})=0),"",ROUND(G${r}*(1+J${r}),2))`, fin, EUR);
    formula(ws, `L${r}`, `IF(OR(K${r}="",G${r}=""),"",K${r}-G${r})`, round2(fin - p.price), EUR);
    formula(ws, `N${r}`, `IF(K${r}="","",K${r}/MAX(1,N(M${r})))`, fin, EUR);
    formula(
      ws,
      `O${r}`,
      `IF(OR(N${r}="",F${r}=""),"",N${r}/(1+${P.iva})-F${r}-N${r}*${P.gateway})`,
      net ?? null,
      EUR,
    );
    formula(ws, `P${r}`, `IF(O${r}="","",O${r}*${P.courier})`, net != null ? round2(net * k.courierPct) : null, EUR);
    formula(ws, `Q${r}`, `IF(OR(O${r}="",P${r}=""),"",O${r}-P${r})`, net != null ? round2(net * (1 - k.courierPct)) : null, EUR);
    fmt(ws, "I", r, r, PCT);
    fmt(ws, "M", r, r, "0");
  }
  // Subtotales por grupo y total general (SUM de las columnas de importe).
  for (const s of subRows) {
    for (const col of ["L", "O", "P", "Q"] as const) {
      const cached = Number(aoa[s.r - 1][XLSX.utils.decode_col(col)]) || 0;
      formula(ws, `${col}${s.r}`, `SUM(${col}${s.from}:${col}${s.to})`, round2(cached), EUR);
    }
    ws[`A${s.r}`] = { t: "s", v: String(aoa[s.r - 1][0]) };
  }
  for (const col of ["L", "O", "P", "Q"] as const) {
    const cached = Number(aoa[grandRow - 1][XLSX.utils.decode_col(col)]) || 0;
    formula(ws, `${col}${grandRow}`, subRows.map((s) => `${col}${s.r}`).join("+"), round2(cached), EUR);
  }
  return ws;
}

/** Fila de la cabecera de grupo a la que pertenece la fila de producto `r`. */
function s0(subRows: { r: number; from: number; to: number }[], r: number): number {
  const s = subRows.find((x) => r >= x.from && r <= x.to);
  return s ? s.from - 1 : 1;
}

/* ---------------------------------------------------------------- Nutrición */

/** Campos estándar primero (orden de lectura natural); el resto, alfabético. */
const NUTR_STD = [
  "Valor energético",
  "Grasas",
  "— saturadas",
  "Hidratos de carbono",
  "— de los cuales azúcares",
  "Fibra",
  "Proteínas",
  "Sal",
];

/**
 * Hoja «Nutrición»: TODA la tabla nutricional de cada producto (una columna
 * por campo presente en el catálogo), con marca, categoría, +18 y graduación.
 */
function nutricionSheet(products: Product[]): XLSX.WorkSheet {
  const extraKeys = new Set<string>();
  for (const p of products) {
    for (const key of Object.keys(p.nutrition ?? {})) {
      if (!NUTR_STD.includes(key)) extraKeys.add(key);
    }
  }
  const cols = [
    ...NUTR_STD.filter((key) => products.some((p) => p.nutrition?.[key] != null)),
    ...[...extraKeys].sort((a, b) => a.localeCompare(b, "es")),
  ];
  const aoa: string[][] = [
    ["Producto", "Marca", "Categoría", "+18", "Graduación", "Unidad", "Descripción", ...cols.map((c) => `${c} (por 100 g/ml)`)],
  ];
  for (const p of products) {
    aoa.push([
      p.name,
      p.brand,
      CATEGORIES[p.cat]?.label ?? "Sin categoría",
      p.alcohol ? "Sí" : "No",
      p.grad ?? "",
      p.unit,
      p.desc,
      ...cols.map((c) => p.nutrition?.[c] ?? ""),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 30 }, { wch: 14 }, { wch: 13 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 44 },
    ...cols.map(() => ({ wch: 16 })),
  ];
  return ws;
}

/* ------------------------------------------------------------- Rentabilidad */

function profitSheet(products: Product[], k: ProfitParams): XLSX.WorkSheet {
  const head = [
    "Producto",
    "Marca",
    "Unidad",
    "Coste proveedor (€)",
    "PVP actual (€, IVA incl.)",
    "PVP sin IVA (€)",
    "Margen bruto (€)",
    "Comisión pasarela (€)",
    "Ganancia neta (€/ud)",
    "Rentabilidad s/ coste",
    "PRECIO RECOMENDADO (€, a ,99)",
    "Ganancia neta al recomendado (€/ud)",
    "Reparto repartidor (€/ud)",
    "Reparto admin (€/ud)",
    "Margen vs objetivo",
    "Estado",
  ];
  const aoa: (string | number)[][] = [head];
  const calcs: RowCalc[] = [];
  for (const p of products) {
    const c = calc(p, k);
    calcs.push(c);
    aoa.push([
      p.name,
      p.brand,
      p.unit,
      typeof p.coste === "number" ? p.coste : "",
      p.price,
      round2(c.base),
      c.bruto != null ? round2(c.bruto) : "",
      round2(c.gate),
      c.net != null ? round2(c.net) : "",
      c.rent != null ? c.rent : "",
      typeof c.rec === "number" ? round2(c.rec) : c.rec === "Inviable" ? "Inviable" : "",
      c.netRec != null ? round2(c.netRec) : "",
      c.courierEur != null ? round2(c.courierEur) : "",
      c.adminEur != null ? round2(c.adminEur) : "",
      c.vsObj != null ? c.vsObj : "",
      c.estado,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 15 },
    { wch: 17 }, { wch: 17 }, { wch: 16 }, { wch: 24 }, { wch: 26 }, { wch: 18 }, { wch: 15 },
    { wch: 16 }, { wch: 14 },
  ];
  const first = 2;
  const last = aoa.length;
  // Fórmulas vivas (columnas F..P): el usuario cambia coste/parámetros y Excel
  // lo recalcula todo solo. El valor cacheado de fábrica va en `calc`.
  for (let r = first; r <= last; r++) {
    const c = calcs[r - first];
    formula(ws, `F${r}`, `IF(E${r}="","",E${r}/(1+${P.iva}))`, round2(c.base), EUR);
    formula(ws, `G${r}`, `IF(OR(D${r}="",F${r}=""),"",F${r}-D${r})`, c.bruto != null ? round2(c.bruto) : null, EUR);
    formula(ws, `H${r}`, `IF(E${r}="","",E${r}*${P.gateway})`, round2(c.gate), EUR);
    formula(ws, `I${r}`, `IF(G${r}="","",G${r}-H${r})`, c.net != null ? round2(c.net) : null, EUR);
    formula(ws, `J${r}`, `IF(OR(I${r}="",D${r}="",N(D${r})=0),"",I${r}/D${r})`, c.rent, PCT);
    formula(
      ws,
      `K${r}`,
      `IF(D${r}="","",IF(1/(1+${P.iva})-${P.gateway}-${P.target}<=0,"Inviable",ROUNDUP(D${r}/(1/(1+${P.iva})-${P.gateway}-${P.target}),0)-0.01))`,
      c.rec === "Inviable" ? "Inviable" : typeof c.rec === "number" ? round2(c.rec) : null,
      EUR,
    );
    formula(
      ws,
      `L${r}`,
      `IF(OR(NOT(ISNUMBER(K${r})),D${r}=""),"",K${r}/(1+${P.iva})-D${r}-K${r}*${P.gateway})`,
      c.netRec != null ? round2(c.netRec) : null,
      EUR,
    );
    formula(ws, `M${r}`, `IF(I${r}="","",I${r}*${P.courier})`, c.courierEur != null ? round2(c.courierEur) : null, EUR);
    formula(ws, `N${r}`, `IF(OR(I${r}="",M${r}=""),"",I${r}-M${r})`, c.adminEur != null ? round2(c.adminEur) : null, EUR);
    formula(ws, `O${r}`, `IF(OR(I${r}="",E${r}=""),"",I${r}/E${r}-${P.target})`, c.vsObj, PCT);
    formula(
      ws,
      `P${r}`,
      `IF(D${r}="","Sin coste",IF(I${r}<0,"PÉRDIDAS",IF(I${r}/E${r}<${P.target},"Bajo objetivo","OK")))`,
      c.estado,
    );
  }
  return ws;
}

/* ------------------------------------------------------------------ Resumen */

function summarySheet(products: Product[], k: ProfitParams): XLSX.WorkSheet {
  const n = products.length;
  const R = (col: string) => `Rentabilidad!${col}2:${col}${n + 1}`;
  const calcs = products.map((p) => calc(p, k));
  const sum = (pick: (c: RowCalc) => number | null) =>
    round2(calcs.reduce((acc, c) => acc + (pick(c) ?? 0), 0));
  const rents = calcs.map((c) => c.rent).filter((x): x is number => x != null);
  const cached = {
    withCost: calcs.filter((c) => c.estado !== "Sin coste").length,
    ok: calcs.filter((c) => c.estado === "OK").length,
    bajo: calcs.filter((c) => c.estado === "Bajo objetivo").length,
    perdidas: calcs.filter((c) => c.estado === "PÉRDIDAS").length,
    rentAvg: rents.length ? rents.reduce((a, b) => a + b, 0) / rents.length : 0,
    net: sum((c) => c.net),
    netRec: sum((c) => c.netRec),
    courier: sum((c) => c.courierEur),
    admin: sum((c) => c.adminEur),
  };
  const aoa: (string | number)[][] = [
    ["Resumen del catálogo subido", "", "Cómo leerlo"],
    ["Productos en el Excel", n, "Solo las altas del admin (pestaña Productos)"],
    ["Con coste del proveedor", cached.withCost, "Sin coste => la fila se marca «Sin coste»"],
    ["Rentables (OK)", cached.ok, "Margen neto ≥ objetivo"],
    ["Por debajo del objetivo", cached.bajo, "Al precio recomendado pasarían a OK"],
    ["En PÉRDIDAS", cached.perdidas, "El PVP actual no cubre coste + pasarela"],
    ["Rentabilidad media (s/ coste)", cached.rentAvg, ""],
    ["Ganancia neta 1 ud de cada (precio actual)", cached.net, ""],
    ["Ganancia neta 1 ud de cada (recomendado)", cached.netRec, ""],
    ["Reparto repartidor (1 ud de cada, actual)", cached.courier, ""],
    ["Reparto admin (1 ud de cada, actual)", cached.admin, ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 44 }];
  // Fórmulas vivas con el valor de fábrica cacheado (arriba): si alguien toca
  // la hoja «Rentabilidad», el resumen se actualiza al recalcular en Excel.
  const F: [string, string, number, string?][] = [
    ["B3", `COUNT(${R("D")})`, cached.withCost],
    ["B4", `COUNTIF(${R("P")},"OK")`, cached.ok],
    ["B5", `COUNTIF(${R("P")},"Bajo objetivo")`, cached.bajo],
    ["B6", `COUNTIF(${R("P")},"PÉRDIDAS")`, cached.perdidas],
    ["B7", `IFERROR(AVERAGE(${R("J")}),0)`, cached.rentAvg, PCT],
    ["B8", `SUM(${R("I")})`, cached.net, EUR],
    ["B9", `SUM(${R("L")})`, cached.netRec, EUR],
    ["B10", `SUM(${R("M")})`, cached.courier, EUR],
    ["B11", `SUM(${R("N")})`, cached.admin, EUR],
  ];
  for (const [addr, f, v, z] of F) formula(ws, addr, f, v, z);
  return ws;
}

/** Nombre de archivo con fecha: rentabilidad-botella-rapida-YYYYMMDD.xlsx */
export function profitFileName(d = new Date()): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `rentabilidad-botella-rapida-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`;
}

/** Construye el libro completo (exportado para pruebas sin DOM). */
export function buildProfitWorkbook(products: Product[], k: ProfitParams, pct: GroupPct = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, paramsSheet(k), "Parámetros");
  XLSX.utils.book_append_sheet(wb, preciosSheet(products, k, pct), "Precios %");
  XLSX.utils.book_append_sheet(wb, profitSheet(products, k), "Rentabilidad");
  XLSX.utils.book_append_sheet(wb, nutricionSheet(products), "Nutrición");
  XLSX.utils.book_append_sheet(wb, summarySheet(products, k), "Resumen");
  return wb;
}

/** Genera el .xlsx y lanza la descarga del navegador. */
export function downloadProfitXlsx(products: Product[], k: ProfitParams, pct: GroupPct = {}): void {
  const out = XLSX.write(buildProfitWorkbook(products, k, pct), { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = profitFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
