import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend,
} from "recharts";
import {
  Radar, ShoppingCart, LifeBuoy, TrendingUp, Users, DollarSign, Target, CalendarCheck, CheckCircle2,
  Trophy, AlertTriangle, Clock,
} from "lucide-react";
import { useAppStore } from "../../store";
import { computeMetrics, makeDemoData, CANAL_LABEL, PAL, type Metrics, type ClientRef } from "./perfMetrics";
import type { Lead, Deal } from "../../types";

/**
 * CanaisAnalytics — Análise de Canais (V4, clone Labs). Três abas:
 *  · Panorama — invisto × retorno por canal, qual canal dá mais retorno.
 *  · LeadBroker — volume, custo, eficiência/SLA, reuniões e valor por SDR.
 *  · Recovery — volume e jornada (conectadas → agendadas → realizadas → fechadas).
 * Dados REAIS via o store (leads/deals/reunioes). No preview Code Web o banco é
 * bloqueado; então só popula rodando localmente (login) ou em ?demo=1. READ-ONLY.
 */
const RED = "var(--color-v4-red)";
const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const MUTED = "var(--color-v4-text-muted)";
const SURFACE = "var(--color-v4-surface)";

const brl = (n: number) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);

type Periodo = "all" | "7d" | "30d" | "90d" | "mes" | "ano";
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "all", label: "Todo período" }, { id: "7d", label: "Últimos 7 dias" }, { id: "30d", label: "Últimos 30 dias" },
  { id: "90d", label: "Últimos 90 dias" }, { id: "mes", label: "Este mês" }, { id: "ano", label: "Este ano" },
];
function rangeOf(p: Periodo): { from: string; to: string } {
  const to = new Date(); const toStr = to.toISOString().slice(0, 10);
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  switch (p) {
    case "7d": return { from: d(7), to: toStr };
    case "30d": return { from: d(30), to: toStr };
    case "90d": return { from: d(90), to: toStr };
    case "mes": return { from: new Date(to.getFullYear(), to.getMonth(), 1).toISOString().slice(0, 10), to: toStr };
    case "ano": return { from: `${to.getFullYear()}-01-01`, to: toStr };
    default: return { from: "2000-01-01", to: "2999-12-31" };
  }
}
const inRange = (v: string | undefined | null, from: string, to: string) => { const d = (v || "").slice(0, 10); return !!d && d >= from && d <= to; };
const receitaCanal = (clientsFe: ClientRef[]) => clientsFe.reduce((a, c) => a + (c.valor || 0), 0);

type Tab = "panorama" | "leadbroker" | "recovery";

interface Data { members: any[]; leads: Lead[]; deals: Deal[]; reunioes: any[]; ligacoes: any[]; }

const CanaisAnalytics: React.FC<{ data: Data; demo?: boolean }> = ({ data, demo }) => {
  const [tab, setTab] = useState<Tab>("panorama");
  const [periodo, setPeriodo] = useState<Periodo>("all");
  const { from, to } = useMemo(() => rangeOf(periodo), [periodo]);

  const m: Metrics = useMemo(() => computeMetrics(data, { from, to, sdrIds: null }), [data, from, to]);
  const hasData = data.leads.length > 0 || data.reunioes.length > 0 || data.deals.length > 0;

  // volume/valor por SDR para um canal (a partir dos leads crus, no período)
  const bySdrForCanal = (canal: string) => {
    const nameById = new Map<string, string>(data.members.map((x: any) => [x.id, x.name]));
    const map = new Map<string, { name: string; qtd: number; valor: number }>();
    data.leads.forEach((l) => {
      if ((l.canal || "").toLowerCase() !== canal) return;
      if (!inRange(l.data_cadastro || (l as any).created_at, from, to)) return;
      const nm = l.sdr_id ? (nameById.get(l.sdr_id) || "—") : "Sem SDR";
      const e = map.get(nm) || { name: nm, qtd: 0, valor: 0 };
      e.qtd++; e.valor += Number(l.valor_lead) || 0;
      map.set(nm, e);
    });
    return Array.from(map.values()).sort((a, b) => b.qtd - a.qtd);
  };

  // SLA médio de fechamento (dias entre data_cadastro do lead e data_fechamento do deal) por canal
  const slaCanal = (canal: string) => {
    const leadById = new Map<string, Lead>(data.leads.map((l) => [l.id, l]));
    const dias: number[] = [];
    data.deals.forEach((d) => {
      if (d.status !== "contrato_assinado") return;
      const org = (d.origem || d.lead?.canal || (d.lead_id ? leadById.get(d.lead_id)?.canal : "") || "").toLowerCase();
      if (org !== canal) return;
      const lead = d.lead_id ? leadById.get(d.lead_id) : null;
      const ini = lead?.data_cadastro || (lead as any)?.created_at;
      const fim = d.data_fechamento || d.data_call;
      if (!ini || !fim) return;
      const dd = Math.round((new Date(fim).getTime() - new Date(ini).getTime()) / 864e5);
      if (dd >= 0 && dd < 400) dias.push(dd);
    });
    if (!dias.length) return null;
    return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      <div className="px-6 pt-6 pb-3 flex flex-wrap items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: RED }}><Radar size={18} className="text-white" /></div>
        <div className="mr-auto">
          <h1 className="text-lg font-bold text-white leading-tight">Análise de <span style={{ color: RED }}>Canais</span></h1>
          <p className="text-[11px]" style={{ color: MUTED }}>Panorama de retorno por canal, LeadBroker e Recovery — dados do Sales Hub.{demo ? " (modo demonstração)" : ""}</p>
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}
          className="text-xs rounded-lg px-3 py-2 border border-[var(--color-v4-border)] bg-[var(--color-v4-card)] text-white">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      <div className="px-6 pb-3 flex items-center gap-1.5">
        <TabBtn active={tab === "panorama"} onClick={() => setTab("panorama")} icon={TrendingUp} label="Panorama" />
        <TabBtn active={tab === "leadbroker"} onClick={() => setTab("leadbroker")} icon={ShoppingCart} label="LeadBroker" />
        <TabBtn active={tab === "recovery"} onClick={() => setTab("recovery")} icon={LifeBuoy} label="Recovery" />
      </div>

      {!hasData && (
        <div className="mx-6 mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Sem dados carregados. Esta análise usa dados reais do Sales Hub (banco) — que só aparecem <b>rodando localmente e logado</b>. Aqui no preview você pode ver com dados de exemplo abrindo <code className="px-1 rounded bg-black/30">?labs=canais&demo=1</code>.</span>
        </div>
      )}

      <div className="px-6 pb-10">
        {tab === "panorama" && <Panorama m={m} />}
        {tab === "leadbroker" && <CanalPanel canal="leadbroker" m={m} bySdr={bySdrForCanal("leadbroker")} sla={slaCanal("leadbroker")} comCusto />}
        {tab === "recovery" && <CanalPanel canal="recovery" m={m} bySdr={bySdrForCanal("recovery")} sla={slaCanal("recovery")} />}
      </div>
    </div>
  );
};

// ---------------- Panorama ----------------
const Panorama: React.FC<{ m: Metrics }> = ({ m }) => {
  const rows = m.channels.map((c) => {
    const receita = receitaCanal(c.clientsFe);
    return { canal: c.canal, label: c.label, leads: c.leads, invest: c.custo, fechadas: c.fechadas, receita, roas: c.custo > 0 ? +(receita / c.custo).toFixed(2) : null, cpl: c.leads > 0 && c.custo > 0 ? Math.round(c.custo / c.leads) : null };
  }).sort((a, b) => b.receita - a.receita);
  const totalInvest = rows.reduce((a, r) => a + r.invest, 0);
  const totalReceita = rows.reduce((a, r) => a + r.receita, 0);
  const totalFechadas = rows.reduce((a, r) => a + r.fechadas, 0);
  const melhor = rows.filter((r) => r.receita > 0)[0];
  const chart = rows.map((r) => ({ canal: r.label, Investido: r.invest, Retorno: r.receita }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={DollarSign} label="Investido (total)" value={brl(totalInvest)} sub="custo de leads (LeadBroker)" />
        <Kpi icon={Trophy} label="Retorno (vendas fechadas)" value={brl(totalReceita)} color={PAL.white} sub="MRR + OT dos contratos" />
        <Kpi icon={CheckCircle2} label="Contratos fechados" value={totalFechadas} />
        <Kpi icon={TrendingUp} label="ROAS geral" value={totalInvest > 0 ? `${(totalReceita / totalInvest).toFixed(2)}x` : "—"} color={RED} sub="retorno / investido" />
      </div>

      {melhor && (
        <div className={`${card} p-3 flex items-center gap-3`}>
          <Trophy size={18} style={{ color: RED }} />
          <span className="text-sm text-white">Canal que mais retorna hoje: <b>{melhor.label}</b> — {brl(melhor.receita)} em vendas{melhor.roas != null ? ` · ROAS ${melhor.roas}x` : ""}.</span>
        </div>
      )}

      <div className={`${card} p-4`}>
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><TrendingUp size={15} style={{ color: RED }} /> Investido × Retorno por canal</h3>
        <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>Quanto cada canal custou (leads comprados) versus quanto retornou em vendas fechadas.</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chart} margin={{ top: 6, right: 8, left: 6, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" />
            <XAxis dataKey="canal" tick={{ fill: MUTED, fontSize: 10 }} />
            <YAxis tick={{ fill: MUTED, fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} formatter={(v: any) => brl(Number(v))} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Investido" fill={PAL.gray} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Retorno" fill={RED} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={`${card} p-4`}>
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Target size={15} style={{ color: RED }} /> Detalhe por canal</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-left" style={{ color: MUTED }}>
              <th className="py-1 pr-2">Canal</th><th className="py-1 px-2">Leads</th><th className="py-1 px-2">Investido</th><th className="py-1 px-2">CPL</th>
              <th className="py-1 px-2">Fechados</th><th className="py-1 px-2">Retorno</th><th className="py-1 px-2">ROAS</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.canal} className="border-t border-[var(--color-v4-border)] text-white">
                  <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
                  <td className="py-1.5 px-2">{r.leads}</td>
                  <td className="py-1.5 px-2">{r.invest > 0 ? brl(r.invest) : "—"}</td>
                  <td className="py-1.5 px-2">{r.cpl != null ? brl(r.cpl) : "—"}</td>
                  <td className="py-1.5 px-2">{r.fechadas}</td>
                  <td className="py-1.5 px-2" style={{ color: r.receita > 0 ? PAL.white : MUTED }}>{r.receita > 0 ? brl(r.receita) : "—"}</td>
                  <td className="py-1.5 px-2"><span style={{ color: r.roas != null && r.roas >= 1 ? RED : MUTED }}>{r.roas != null ? `${r.roas}x` : "—"}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="py-4 text-center" style={{ color: MUTED }}>Sem dados no período.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] mt-2" style={{ color: MUTED }}>Investido/CPL aparecem onde há custo por lead cadastrado (hoje: LeadBroker). Retorno = soma dos contratos assinados atribuídos ao canal.</p>
      </div>
    </div>
  );
};

// ---------------- Painel de um canal (LeadBroker / Recovery) ----------------
const CanalPanel: React.FC<{ canal: string; m: Metrics; bySdr: { name: string; qtd: number; valor: number }[]; sla: number | null; comCusto?: boolean }> = ({ canal, m, bySdr, sla, comCusto }) => {
  const row = m.channels.find((c) => c.canal === canal);
  const leads = row?.leads || 0;
  const agendadas = row?.agendadas || 0;
  const realizadas = row?.realizadas || 0;
  const noshow = row?.noshow || 0;
  const fechadas = row?.fechadas || 0;
  const invest = row?.custo || 0;
  const receita = row ? receitaCanal(row.clientsFe) : 0;
  const label = CANAL_LABEL[canal] || canal;

  const funil = [
    { label: "Leads", v: leads, color: PAL.gray },
    { label: "Reuniões marcadas", v: agendadas, color: PAL.redSoft },
    { label: "Realizadas", v: realizadas, color: PAL.red },
    { label: "Fechadas / Ganho", v: fechadas, color: PAL.white },
  ];
  const chart = bySdr.map((s) => ({ sdr: s.name, Leads: s.qtd, ...(comCusto ? { Valor: s.valor } : {}) }));
  const totalNaMao = bySdr.reduce((a, s) => a + s.qtd, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi icon={Target} label={`Leads ${label}`} value={leads} />
        <Kpi icon={CalendarCheck} label="Reuniões marcadas" value={agendadas} color={PAL.redSoft} />
        <Kpi icon={CheckCircle2} label="Realizadas" value={realizadas} color={PAL.red} />
        <Kpi icon={Trophy} label="Fechadas / Ganho" value={fechadas} color={PAL.white} />
        {comCusto && <Kpi icon={DollarSign} label="Investido" value={brl(invest)} sub="custo dos leads" />}
        <Kpi icon={TrendingUp} label="Taxa de fechamento" value={`${pct(fechadas, leads)}%`} color={RED} sub="fechados / leads" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Taxa marcação" value={`${pct(agendadas, leads)}%`} sub="reuniões / leads" big />
        <Kpi label="Comparecimento" value={`${pct(realizadas, agendadas)}%`} sub="realizadas / marcadas" big />
        <Kpi label="No-show (aberto)" value={noshow} sub="marcadas sem comparecer" big />
        <Kpi icon={Clock} label="SLA médio de fechamento" value={sla != null ? `${sla} dias` : "—"} sub="cadastro → contrato" big />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* funil */}
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><TrendingUp size={15} style={{ color: RED }} /> Jornada {label}</h3>
          <div className="space-y-1.5">
            {funil.map((f, i) => {
              const base = funil[0].v || 1;
              const prev = i > 0 ? funil[i - 1].v : 0;
              return (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-[10.5px] w-32 shrink-0 truncate" style={{ color: MUTED }}>{f.label}</span>
                  <div className="flex-1 h-6 rounded overflow-hidden" style={{ background: SURFACE }}>
                    <div className="h-full rounded flex items-center px-2" style={{ width: `${Math.max(pct(f.v, base), f.v ? 6 : 0)}%`, background: f.color, minWidth: f.v ? 26 : 0 }}>
                      <span className="text-[10px] font-bold" style={{ color: f.color === PAL.white ? "#111" : "#fff" }}>{f.v}</span>
                    </div>
                  </div>
                  <span className="text-[10px] w-20 text-right shrink-0" style={{ color: MUTED }}>{i > 0 ? `${pct(f.v, prev)}%` : "100%"}</span>
                </div>
              );
            })}
          </div>
          {comCusto && (
            <div className="mt-3 pt-3 border-t border-[var(--color-v4-border)] flex items-center justify-between text-[12px]">
              <span style={{ color: MUTED }}>Investido / Retorno / ROAS</span>
              <span className="text-white font-semibold">{brl(invest)} → {brl(receita)} · <span style={{ color: RED }}>{invest > 0 ? `${(receita / invest).toFixed(2)}x` : "—"}</span></span>
            </div>
          )}
        </div>

        {/* por SDR */}
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Users size={15} style={{ color: RED }} /> {label} na mão dos SDRs</h3>
          <p className="text-[10.5px] mb-3" style={{ color: MUTED }}>{totalNaMao} lead(s) distribuído(s){comCusto ? ` · ${brl(bySdr.reduce((a, s) => a + s.valor, 0))} em valor` : ""}.</p>
          {chart.length ? (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={chart} margin={{ top: 6, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" />
                <XAxis dataKey="sdr" tick={{ fill: MUTED, fontSize: 10 }} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} formatter={(v: any, n: any) => n === "Valor" ? brl(Number(v)) : v} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="Leads" fill={RED} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="py-6 text-center text-xs" style={{ color: MUTED }}>Sem leads deste canal no período.</div>}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="text-left" style={{ color: MUTED }}>
                <th className="py-1 pr-2">SDR/BDR</th><th className="py-1 px-2">Leads</th>{comCusto && <th className="py-1 px-2">Valor</th>}
              </tr></thead>
              <tbody>
                {bySdr.map((s) => (
                  <tr key={s.name} className="border-t border-[var(--color-v4-border)] text-white">
                    <td className="py-1 pr-2 font-semibold">{s.name}</td><td className="py-1 px-2">{s.qtd}</td>{comCusto && <td className="py-1 px-2">{brl(s.valor)}</td>}
                  </tr>
                ))}
                {!bySdr.length && <tr><td colSpan={comCusto ? 3 : 2} className="py-3 text-center" style={{ color: MUTED }}>Sem dados no período.</td></tr>}
              </tbody>
            </table>
          </div>
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

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button onClick={onClick} className={`text-xs px-3 py-2 rounded-lg border inline-flex items-center gap-1.5 transition-colors ${active ? "bg-[var(--color-v4-red)] text-white border-[var(--color-v4-red)]" : "border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-white hover:border-[var(--color-v4-red)]"}`}>
    <Icon size={14} /> {label}
  </button>
);

export const LabCanaisRoute: React.FC<{ demo?: boolean }> = ({ demo }) => {
  const store = useAppStore();
  if (demo) return <CanaisAnalytics data={makeDemoData()} demo />;
  return <CanaisAnalytics data={{ members: store.members, leads: store.leads, deals: store.deals, reunioes: store.reunioes, ligacoes: store.ligacoes }} />;
};

export default CanaisAnalytics;
