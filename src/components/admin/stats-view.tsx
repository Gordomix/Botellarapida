"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/format";
import { fmtEur } from "@/lib/utils";
import type { OrderStatus, Stats } from "@/data/types";

/** Colores literales: recharts no resuelve variables CSS del tema. */
const EMBER = "#e25a32";
const EMBER_DARK = "#c24724";
const BOTTLE = "#2f6d56";
const INK = "#1c1712";
const MUTED = "#6e6458";
const GRID = "#d9cdb6";

const STATUS_COLORS: Record<OrderStatus, string> = {
  pendiente: "#cbb9a0",
  asignado: "#e0a458",
  en_reparto: EMBER,
  entregado: BOTTLE,
  cancelado: "#9a8a76",
};

/** Chip de variación %: verde si sube, rojo si baja, neutro en 0. */
function Delta({ value, suffix = "vs ayer" }: { value: number; suffix?: string }) {
  const up = value > 0;
  const flat = value === 0;
  const tone = flat ? MUTED : up ? BOTTLE : EMBER_DARK;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: tone }}>
      <Icon className="size-3" />
      {up ? "+" : ""}
      {value}% <span className="font-normal text-muted">{suffix}</span>
    </span>
  );
}

/** Tarjeta KPI compacta: valor grande, etiqueta y (opcional) delta %. */
function Kpi({
  label,
  value,
  hint,
  delta,
  deltaSuffix,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number;
  deltaSuffix?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {typeof delta === "number" ? (
        <div className="mt-1">
          <Delta value={delta} suffix={deltaSuffix} />
        </div>
      ) : null}
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-[1.25rem] bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

/** Tooltip común: fondo crema, texto tinta, cifras tabulares. */
function ChartTooltip(props: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  euroKeys?: string[];
}) {
  const { active, payload, label, euroKeys = [] } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-paper/95 px-3 py-2 text-xs shadow-lift">
      {label ? <p className="mb-1 font-semibold text-ink">{label}</p> : null}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 tabular-nums" style={{ color: p.color }}>
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-semibold text-ink">
            {euroKeys.includes(p.name ?? "") ? fmtEur(Number(p.value ?? 0)) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * Panel de estadísticas del admin: KPIs del día y del mes con su variación %,
 * evolución diaria (30 d), ingresos mensuales (12 m) y reparto por estado. Todo
 * llega ya agregado desde `getStats` (servidor); aquí solo se pinta.
 */
export function StatsView({ stats }: { stats: Stats }) {
  const t = stats.totals;
  const d = stats.deltas;
  const totalStatus = stats.statusBreakdown.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Actualizado {new Date(stats.updatedAt).toLocaleString("es-ES")} · los porcentajes
        comparan con el periodo anterior (ayer / mes pasado).
      </p>

      {/* HOY */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ember">Hoy</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Pedidos" value={String(t.ordersToday)} delta={d.ordersDayPct} />
          <Kpi label="Ingresos" value={fmtEur(t.revenueToday)} delta={d.revenueDayPct} />
          <Kpi label="Nuevos registros" value={String(t.signupsToday)} delta={d.signupsDayPct} />
          <Kpi
            label="Usuarios activos"
            value={String(t.activeUsersToday)}
            delta={d.activeUsersDayPct}
            hint="con sesión iniciada hoy"
          />
        </div>
      </section>

      {/* AHORA MISMO + MES */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ember">
          En vivo y este mes
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Usuarios en vivo"
            value={String(t.liveUsers)}
            hint="sesiones vigentes ahora"
          />
          <Kpi label="Pedidos mes" value={String(t.ordersMonth)} delta={d.ordersMonthPct} deltaSuffix="vs mes" />
          <Kpi
            label="Ingresos mes"
            value={fmtEur(t.revenueMonth)}
            delta={d.revenueMonthPct}
            deltaSuffix="vs mes"
          />
          <Kpi
            label="Registros mes"
            value={String(t.signupsMonth)}
            delta={d.signupsMonthPct}
            deltaSuffix="vs mes"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Repartidores activos" value={String(t.couriersActive)} />
          <Kpi label="Pedidos por delegar" value={String(t.pendingOrders)} />
          <Kpi label="En la calle" value={String(t.inFlightOrders)} />
          <Kpi
            label="Canceladas por repartidor"
            value={String(t.courierCancelsMonth)}
            hint="este mes (con motivo)"
          />
        </div>
      </section>

      {/* RECURRENCIA: fidelidad del ultramarinos — cliente que repite vale más. */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ember">
          Recurrencia y ticket medio
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Ticket medio"
            value={fmtEur(t.avgTicket)}
            hint="mes · sin cancelados"
          />
          <Kpi
            label="Clientes que repiten"
            value={`${t.repeatRatePct}%`}
            hint="con 2+ pedidos este mes"
          />
          <Kpi
            label="Pedidos por cliente"
            value={t.ordersPerCustomer.toFixed(2)}
            hint="media del mes"
          />
          <Kpi
            label="Clientes únicos"
            value={String(t.uniqueCustomers)}
            hint="con pedido este mes"
          />
        </div>
      </section>

      {/* Evolución diaria */}
      <ChartCard title="Evolución diaria" hint="últimos 30 días · pedidos, registros e ingresos">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={stats.daily} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} interval={4} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} width={36} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${Math.round(Number(v))}€`} />
            <Tooltip content={<ChartTooltip euroKeys={["Ingresos"]} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area yAxisId="left" type="monotone" dataKey="orders" name="Pedidos" stroke={EMBER} fill={EMBER} fillOpacity={0.18} strokeWidth={2} />
            <Area yAxisId="left" type="monotone" dataKey="signups" name="Registros" stroke={BOTTLE} fill={BOTTLE} fillOpacity={0.12} strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="revenue" name="Ingresos" stroke={INK} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ingresos mensuales */}
        <ChartCard title="Ingresos mensuales" hint="últimos 12 meses">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.monthly} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={{ stroke: GRID }} />
              <YAxis tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${Math.round(Number(v))}€`} />
              <Tooltip cursor={{ fill: "rgba(226,90,50,0.08)" }} content={<ChartTooltip euroKeys={["Ingresos"]} />} />
              <Bar dataKey="revenue" name="Ingresos" fill={EMBER} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Pedidos mensuales */}
        <ChartCard title="Pedidos mensuales" hint="últimos 12 meses">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.monthly} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="mVol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EMBER} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={EMBER} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={{ stroke: GRID }} />
              <YAxis tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="orders" name="Pedidos" stroke={EMBER_DARK} fill="url(#mVol)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Distribución por estado */}
      <ChartCard title="Distribución por estado" hint={`sobre los últimos ~12 meses · ${totalStatus} pedidos`}>
        {totalStatus === 0 ? (
          // Sin pedidos el Pie quedaría un lienzo en blanco: mejor decirlo.
          <p className="grid h-full place-items-center text-sm text-muted">
            Aún no hay pedidos que repartir por estado.
          </p>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={stats.statusBreakdown.filter((s) => s.count > 0)}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              label={(p: { status?: OrderStatus; count?: number }) =>
                `${STATUS_LABEL[p.status ?? "pendiente"] ?? p.status}: ${p.count ?? 0}`
              }
              labelLine={false}
            >
              {stats.statusBreakdown
                .filter((s) => s.count > 0)
                .map((s) => (
                  <Cell key={s.status} fill={STATUS_COLORS[s.status]} stroke="none" />
                ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
