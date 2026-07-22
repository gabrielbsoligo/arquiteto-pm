import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LineChart, Line,
} from "recharts";
import {
  LayoutDashboard, RefreshCw, TrendingUp, Users, Target, CheckCircle2, XCircle, CalendarCheck,
  PhoneCall, Trophy, Flame,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  loadLeads, funnelMetrics, listQuality, bdrProductivity, STATUS_LABELS, STATUS_COLOR, PIPELINE,
  type ProspLead, type Status,
} from "./hubOutbound/hubLib";

/**
 * HubDashboard — painel de indicadores 100% do Hub Outbound (V4, clone Labs).
 * Lê a MESMA fonte do Hub (loadLeads / localStorage), então qualquer mudança feita
 * no Kanban/Tabela do Hub reflete aqui automaticamente (recarrega ao abrir, no
 * evento de storage e no botão atualizar). Fica ACIMA do Hub no menu.
 */
const RED = "var(--color-v4-red)";
const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const MUTED = "var(--color-v4-text-muted)";
const SURFACE = "var(--color-v4-surface)";

const FALLBACK_TEAM = ["Lary", "Edric", "Bianca", "Erick"];

type Periodo = "all" | "hoje" | "7d" | "30d" | "90d" | "mes";
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "all", label: "Todo período" }, { id: "hoje", label: "Hoje" }, { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" }, { id: "90d", label: "Últimos 90 dias" }, { id: "mes", label: "Este mês" },
];

function dentroDoPeriodo(iso: string | undefined, p: Periodo): boolean {
  if (p === "all") return true;
  if (!iso) return false;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return false;
  const now = Date.now();
  const dia = 864e5;
  switch (p) {
    case "hoje": { const t = new Date(); t.setHours(0, 0, 0, 0); return d >= t.getTime(); }
    case "7d": return d >= now - 7 * dia;
    case "30d": return d >= now - 30 * dia;
    case "90d": return d >= now - 90 * dia;
    case "mes": { const t = new Date(); const ini = new Date(t.getFullYear(), t.getMonth(), 1).getTime(); return d >= ini; }
    default: return true;
  }
}

const HubDashboard: React.FC<{ teamNames?: string[] }> = ({ teamNames }) => {
  const team = teamNames && teamNames.length ? teamNames : FALLBACK_TEAM;
  const [allLeads, setAllLeads] = useState<ProspLead[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>("all");
  const [bdr, setBdr] = useState<string>("todos");
  const [tick, setTick] = useState(0);

  const refresh = () => setAllLeads(loadLeads());
  useEffect(() => { refresh(); }, [tick]);
  // reativo: recarrega quando o Hub grava no localStorage, ao voltar o foco/aba
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.includes("hub_outbound") || e.key.includes("prospeccao")) refresh(); };
    const onFocus = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, []);

  const leads = useMemo(() => allLeads.filter((l) =>
    (bdr === "todos" || l.bdr === bdr) && dentroDoPeriodo(l.createdAt, periodo)
  ), [allLeads, bdr, periodo]);

  const fm = useMemo(() => funnelMetrics(leads), [leads]);
  const quality = useMemo(() => listQuality(leads), [leads]);
  const prod = useMemo(() => bdrProductivity(leads, team), [leads, team]);

  // reached por etapa (do funil cumulativo)
  const reachedOf = (s: Status) => fm.stages.find((x) => x.status === s)?.reached ?? 0;
  const conectados = reachedOf("conectado");
  const qualificados = reachedOf("qualificado");
  const agendadas = reachedOf("reuniao_agendada");
  const realizadas = reachedOf("reuniao_realizada");
  const ganhos = fm.ganhos;
  const perdidos = fm.perdidos;
  const ativos = leads.filter((l) => l.status !== "perdido").length;

  // distribuição por etapa (contagem atual)
  const porEtapa = useMemo(() => [...PIPELINE, "perdido" as Status].map((s) => ({
    s, label: STATUS_LABELS[s], count: leads.filter((l) => l.status === s).length, color: STATUS_COLOR[s],
  })), [leads]);

  // funil de reuniões (mini)
  const reunioesFunil = [
    { label: "Conectados", v: conectados, color: STATUS_COLOR.conectado, icon: PhoneCall },
    { label: "Agendadas", v: agendadas, color: STATUS_COLOR.reuniao_agendada, icon: CalendarCheck },
    { label: "Realizadas", v: realizadas, color: STATUS_COLOR.reuniao_realizada, icon: CheckCircle2 },
    { label: "Fechadas / Ganho", v: ganhos, color: STATUS_COLOR.fechado, icon: Trophy },
  ];

  // evolução: leads criados por dia (últimos 14 pontos com dado)
  const evolucao = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => { const d = (l.createdAt || "").slice(0, 10); if (d) map.set(d, (map.get(d) || 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14).map(([d, n]) => ({ dia: d.slice(5).replace("-", "/"), leads: n }));
  }, [leads]);

  // por origem/canal (volume + agendadas)
  const porOrigem = useMemo(() => quality.map((q) => ({ origem: q.origem, total: q.total, agendadas: q.agendadas, taxa: q.taxaAgendamento })), [quality]);

  const bdrChart = prod.map((p) => ({ bdr: p.bdr, leads: p.leads, agendadas: p.agendadas, ganhos: p.ganhos }));

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      <div className="px-6 pt-6 pb-3 flex flex-wrap items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: RED }}>
          <LayoutDashboard size={18} className="text-white" />
        </div>
        <div className="mr-auto">
          <h1 className="text-lg font-bold text-white leading-tight">Dashboard <span style={{ color: RED }}>Hub Outbound</span></h1>
          <p className="text-[11px]" style={{ color: MUTED }}>Indicadores em tempo real do pipeline — reflete tudo que muda no Hub Outbound.</p>
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}
          className="text-xs rounded-lg px-3 py-2 border border-[var(--color-v4-border)] bg-[var(--color-v4-card)] text-white">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button onClick={() => setTick((t) => t + 1)} title="Atualizar"
          className="text-xs inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border border-[var(--color-v4-border)] bg-[var(--color-v4-card)] text-white hover:border-[var(--color-v4-red)]">
          <RefreshCw size={13} /> Atualizar
        </button>
      </div>

      {/* filtro por BDR */}
      <div className="px-6 pb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] mr-1 inline-flex items-center gap-1" style={{ color: MUTED }}><Users size={12} /> BDR/SDR:</span>
        <TabBtn active={bdr === "todos"} onClick={() => setBdr("todos")} label={`Todos (${allLeads.filter((l) => dentroDoPeriodo(l.createdAt, periodo)).length})`} />
        {team.map((b) => <TabBtn key={b} active={bdr === b} onClick={() => setBdr(b)} label={`${b} (${allLeads.filter((l) => l.bdr === b && dentroDoPeriodo(l.createdAt, periodo)).length})`} />)}
      </div>

      <div className="px-6 pb-10 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Kpi icon={Target} label="Total de leads" value={leads.length} />
          <Kpi icon={Flame} label="No funil (ativos)" value={ativos} />
          <Kpi icon={PhoneCall} label="Conectados" value={conectados} color={STATUS_COLOR.conectado} />
          <Kpi icon={CalendarCheck} label="Reuniões agendadas" value={agendadas} color={STATUS_COLOR.reuniao_agendada} />
          <Kpi icon={CheckCircle2} label="Realizadas" value={realizadas} color={STATUS_COLOR.reuniao_realizada} />
          <Kpi icon={Trophy} label="Fechadas / Ganho" value={ganhos} color={STATUS_COLOR.fechado} />
          <Kpi icon={XCircle} label="Perdidos" value={perdidos} color={STATUS_COLOR.perdido} />
        </div>

        {/* taxas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Taxa de agendamento" value={`${fm.taxaAgendamento}%`} sub="reuniões agendadas / total" big />
          <Kpi label="Taxa de ganho" value={`${fm.taxaGanho}%`} sub="fechados / total" big />
          <Kpi label="Qualificados" value={qualificados} sub="chegaram a qualificado+" big />
          <Kpi label="Conv. conectado→agendada" value={`${conectados ? Math.round((100 * agendadas) / conectados) : 0}%`} sub="eficiência de agendamento" big />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* funil do pipeline */}
          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><TrendingUp size={15} style={{ color: RED }} /> Funil do pipeline</h3>
            <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Leads que alcançaram cada etapa (cumulativo) e a conversão etapa a etapa.</p>
            <div className="space-y-1.5">
              {fm.stages.map((st) => {
                const pct = fm.stages[0]?.reached ? Math.round((100 * st.reached) / fm.stages[0].reached) : 0;
                return (
                  <div key={st.status} className="flex items-center gap-2">
                    <span className="text-[10.5px] w-32 shrink-0 truncate" style={{ color: MUTED }}>{st.label}</span>
                    <div className="flex-1 h-6 rounded bg-[var(--color-v4-surface)] overflow-hidden relative">
                      <div className="h-full rounded flex items-center px-2" style={{ width: `${Math.max(pct, st.reached ? 6 : 0)}%`, background: STATUS_COLOR[st.status], minWidth: st.reached ? 26 : 0 }}>
                        <span className="text-[10px] font-bold text-white">{st.reached}</span>
                      </div>
                    </div>
                    <span className="text-[10px] w-24 text-right shrink-0" style={{ color: MUTED }}>
                      {st.convPrev != null ? `${st.convPrev}% da anterior` : `${pct}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* distribuição por etapa (contagem atual) */}
          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><LayoutDashboard size={15} style={{ color: RED }} /> Leads por etapa (agora)</h3>
            <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Quantos leads estão atualmente em cada coluna do Kanban.</p>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={porEtapa} margin={{ top: 6, right: 8, left: -18, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" />
                <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 9 }} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {porEtapa.map((e) => <Cell key={e.s} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* funil de reuniões */}
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><CalendarCheck size={15} style={{ color: RED }} /> Jornada de reuniões</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {reunioesFunil.map((r, i) => {
              const Icon = r.icon;
              const prev = i > 0 ? reunioesFunil[i - 1].v : 0;
              const conv = i > 0 && prev > 0 ? Math.round((100 * r.v) / prev) : null;
              return (
                <div key={r.label} className="rounded-lg p-3 border border-[var(--color-v4-border)]" style={{ background: SURFACE }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} style={{ color: r.color }} />
                    <span className="text-[10.5px]" style={{ color: MUTED }}>{r.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{r.v}</div>
                  {conv != null && <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>{conv}% da etapa anterior</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* por BDR */}
          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Users size={15} style={{ color: RED }} /> Por BDR/SDR</h3>
            <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Leads na mão, reuniões agendadas e ganhos por vendedor.</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bdrChart} margin={{ top: 6, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" />
                <XAxis dataKey="bdr" tick={{ fill: MUTED, fontSize: 10 }} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="leads" name="Leads" fill={MUTED} radius={[3, 3, 0, 0]} />
                <Bar dataKey="agendadas" name="Agendadas" fill={STATUS_COLOR.reuniao_agendada} radius={[3, 3, 0, 0]} />
                <Bar dataKey="ganhos" name="Ganhos" fill={STATUS_COLOR.fechado} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-left" style={{ color: MUTED }}>
                  <th className="py-1 pr-2">BDR</th><th className="py-1 px-2">Leads</th><th className="py-1 px-2">Ativ.</th><th className="py-1 px-2">Conex.</th><th className="py-1 px-2">Agend.</th><th className="py-1 px-2">Ganhos</th>
                </tr></thead>
                <tbody>
                  {prod.map((p) => (
                    <tr key={p.bdr} className="border-t border-[var(--color-v4-border)] text-white">
                      <td className="py-1 pr-2 font-semibold">{p.bdr}</td><td className="py-1 px-2">{p.leads}</td><td className="py-1 px-2">{p.atividades}</td>
                      <td className="py-1 px-2">{p.conexoes}</td><td className="py-1 px-2">{p.agendadas}</td><td className="py-1 px-2" style={{ color: STATUS_COLOR.fechado }}>{p.ganhos}</td>
                    </tr>
                  ))}
                  {!prod.length && <tr><td colSpan={6} className="py-3 text-center" style={{ color: MUTED }}>Sem dados no período.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* por origem/canal */}
          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Target size={15} style={{ color: RED }} /> Por origem / canal</h3>
            <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Volume e taxa de agendamento por canal de entrada.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-left" style={{ color: MUTED }}>
                  <th className="py-1 pr-2">Origem</th><th className="py-1 px-2">Leads</th><th className="py-1 px-2">Agendadas</th><th className="py-1 px-2">Taxa</th>
                </tr></thead>
                <tbody>
                  {porOrigem.map((o) => (
                    <tr key={o.origem} className="border-t border-[var(--color-v4-border)] text-white">
                      <td className="py-1 pr-2 font-semibold">{o.origem}</td><td className="py-1 px-2">{o.total}</td><td className="py-1 px-2">{o.agendadas}</td>
                      <td className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: SURFACE, color: o.taxa >= 20 ? STATUS_COLOR.fechado : MUTED }}>{o.taxa}%</span></td>
                    </tr>
                  ))}
                  {!porOrigem.length && <tr><td colSpan={4} className="py-3 text-center" style={{ color: MUTED }}>Sem dados no período.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* evolução no tempo */}
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><TrendingUp size={15} style={{ color: RED }} /> Entrada de leads no tempo</h3>
          <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Leads criados por dia (últimos pontos com dado).</p>
          {evolucao.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={evolucao} margin={{ top: 6, right: 12, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" />
                <XAxis dataKey="dia" tick={{ fill: MUTED, fontSize: 10 }} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} />
                <Line type="monotone" dataKey="leads" stroke={RED} strokeWidth={2} dot={{ r: 3, fill: RED }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="py-6 text-center text-xs" style={{ color: MUTED }}>Sem dados no período selecionado.</div>}
        </div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ icon?: any; label: string; value: React.ReactNode; sub?: string; color?: string; big?: boolean }> = ({ icon: Icon, label, value, sub, color, big }) => (
  <div className={`${card} p-3`}>
    <div className="flex items-center gap-1.5 mb-1">
      {Icon && <Icon size={13} style={{ color: color || MUTED }} />}
      <span className="text-[10px] uppercase tracking-wide truncate" style={{ color: MUTED }}>{label}</span>
    </div>
    <div className={`font-bold ${big ? "text-2xl" : "text-xl"}`} style={{ color: color || "#fff" }}>{value}</div>
    {sub && <div className="text-[9.5px] mt-0.5" style={{ color: MUTED }}>{sub}</div>}
  </div>
);

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${active ? "bg-[var(--color-v4-red)] text-white border-[var(--color-v4-red)]" : "border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-white hover:border-[var(--color-v4-red)]"}`}>{label}</button>
);

export const LabHubDashboardRoute: React.FC = () => {
  const store = useAppStore();
  const teamNames = useMemo(() => {
    const t = store.members.filter((m) => m.active && (m.role === "sdr" || m.role === "gestor")).map((m) => m.name);
    return t.length ? t : FALLBACK_TEAM;
  }, [store.members]);
  return <HubDashboard teamNames={teamNames} />;
};

export default HubDashboard;
