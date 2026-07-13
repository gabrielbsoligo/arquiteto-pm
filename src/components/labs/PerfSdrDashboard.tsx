import React, { useMemo, useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
  PieChart, Pie, LabelList,
} from "recharts";
import { Phone, Link2, CalendarClock, CheckCircle2, Trophy, UserX, Users, Filter, Radio, ShoppingCart } from "lucide-react";
import { useAppStore } from "../../store";
import { supabase } from "../../lib/supabase";
import { LoginView } from "../LoginView";
import {
  computeMetrics, makeDemoData, PAL, seriesColor, CANAL_LABEL,
  type Filters, type ClientRef, type Metrics, type FunnelStage,
} from "./perfMetrics";
import type { TeamMember, Lead, Deal, Reuniao, Ligacao4com } from "../../types";

/**
 * PerfSdrDashboard — versão "visual-first" do dashboard de performance do SDR,
 * criada no Labs (read-only). Funil ToFu com taxas etapa→etapa, visão por SDR,
 * funil por canal (com custo do Leadbroker por SDR) e fechados com SDR+canal.
 * Hover nos gráficos mostra números e QUAIS CLIENTES. Tema dark, só branco,
 * vermelho e preto/cinza.
 *
 * Abrir: /?labs=perf  (dados reais, após login)  ·  /?labs=perf&demo=1 (mock).
 */

type DashData = { members: TeamMember[]; leads: Lead[]; deals: Deal[]; reunioes: Reuniao[]; ligacoes: Ligacao4com[] };

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (d?: string) => (d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)] p-4";
const tipBox: React.CSSProperties = { background: "#0a0a0a", border: `1px solid ${PAL.grid}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, maxWidth: 280 };

// lista compacta de clientes pro hover
const ClientList: React.FC<{ clients?: ClientRef[]; max?: number }> = ({ clients = [], max = 8 }) => {
  if (!clients.length) return null;
  const shown = clients.slice(0, max);
  return (
    <div className="mt-1.5 space-y-0.5">
      {shown.map((c, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
          <span className="text-white truncate">{c.empresa}</span>
          <span className="text-[var(--color-v4-text-muted)] whitespace-nowrap">
            {c.sdr ? c.sdr.split(" ")[0] : ""}{c.canal ? ` · ${CANAL_LABEL[c.canal] || c.canal}` : ""}{c.data ? ` · ${fmtDay(c.data)}` : ""}{c.valor ? ` · ${fmtBRL(c.valor)}` : ""}
          </span>
        </div>
      ))}
      {clients.length > max && <div className="text-[10px] text-[var(--color-v4-text-muted)]">+{clients.length - max} outros…</div>}
    </div>
  );
};

// tooltip genérico p/ barras: mostra cada série (valor) + clientes daquela série
const BarTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={tipBox}>
      <div className="text-white font-semibold mb-1">{label}</div>
      {payload.map((p: any, i: number) => {
        const clients: ClientRef[] = row[`_cli_${p.dataKey}`] || [];
        return (
          <div key={i} className="mb-1">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5" style={{ color: p.color }}>
                <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}
              </span>
              <span className="text-white font-semibold">{p.value}</span>
            </div>
            <ClientList clients={clients} max={6} />
          </div>
        );
      })}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number | string; icon: React.ReactNode; color: string; sub?: string }> = ({ label, value, icon, color, sub }) => (
  <div className={card}>
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-v4-text-muted)]">{icon}{label}</div>
    <div className="text-3xl font-bold mt-1" style={{ color }}>{value}</div>
    {sub && <div className="text-[10px] text-[var(--color-v4-text-muted)] mt-0.5">{sub}</div>}
  </div>
);

const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; hint?: string }> = ({ title, icon, children, hint }) => (
  <div className="mb-6">
    <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">{icon}{title}</h3>
    {children}
    {hint && <div className="text-[10px] text-[var(--color-v4-text-muted)] mt-1.5 opacity-70">{hint}</div>}
  </div>
);

type Preset = "hoje" | "7d" | "30d" | "90d" | "custom";

export const PerfSdrDashboard: React.FC<{ data: DashData; demo?: boolean }> = ({ data, demo }) => {
  const [preset, setPreset] = useState<Preset>("30d");
  const [selSdrs, setSelSdrs] = useState<string[]>([]); // [] = todos
  const [cFrom, setCFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [cTo, setCTo] = useState(iso(new Date()));

  const sdrsAll = useMemo(() => data.members.filter((m) => m.role === "sdr" && m.active), [data.members]);

  const [from, to] = useMemo(() => {
    const t = new Date();
    if (preset === "hoje") return [iso(t), iso(t)];
    if (preset === "custom") return [cFrom <= cTo ? cFrom : cTo, cTo >= cFrom ? cTo : cFrom];
    const back = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
    return [iso(new Date(Date.now() - back * 864e5)), iso(t)];
  }, [preset, cFrom, cTo]);

  const filters: Filters = { from, to, sdrIds: selSdrs.length ? selSdrs : null };

  // Ligações/conexões autoritativas via RPC get_perf_ligacoes (mesma fonte da tela Perf. SDR),
  // porque o store só carrega as 2000 ligações mais recentes e subconta períodos longos.
  // Fallback: se falhar/estiver em demo, usa a contagem do store.
  const [ligBySdr, setLigBySdr] = useState<Record<string, { feitas: number; atendidas: number }> | undefined>(undefined);
  useEffect(() => {
    if (demo) { setLigBySdr(undefined); return; }
    const pSdrs = (selSdrs.length ? selSdrs : sdrsAll.map((s) => s.id));
    if (!pSdrs.length) { setLigBySdr(undefined); return; }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_perf_ligacoes", { p_from: from, p_to: to, p_sdrs: pSdrs });
        if (!alive || error || !Array.isArray(data)) return;
        const map: Record<string, { feitas: number; atendidas: number }> = {};
        for (const r of data as any[]) map[r.member_id] = { feitas: Number(r.feitas) || 0, atendidas: Number(r.atendidas) || 0 };
        setLigBySdr(map);
      } catch { /* mantém fallback do store */ }
    })();
    return () => { alive = false; };
  }, [demo, from, to, selSdrs, sdrsAll]);

  const m: Metrics = useMemo(() => computeMetrics(data, filters, ligBySdr), [data, from, to, selSdrs, ligBySdr]);

  // dados p/ o gráfico comparativo por SDR (barras agrupadas por etapa)
  const cmpData = useMemo(() => {
    const stages: { key: keyof typeof m.sdrs[number]; cliKey: string; label: string }[] = [
      { key: "ligacoes", cliKey: "", label: "Ligações" },
      { key: "conexoes", cliKey: "", label: "Conexões" },
      { key: "agendadas", cliKey: "clientsAg", label: "Agendadas" },
      { key: "realizadas", cliKey: "clientsRe", label: "Realizadas" },
      { key: "fechadas", cliKey: "clientsFe", label: "Fechadas" },
      { key: "noshow", cliKey: "clientsNo", label: "No Show" },
    ];
    return stages.map((st) => {
      const row: any = { etapa: st.label };
      m.sdrs.forEach((s) => {
        row[s.first] = Number((s as any)[st.key]) || 0;
        row[`_cli_${s.first}`] = st.cliKey ? (s as any)[st.cliKey] : [];
      });
      return row;
    });
  }, [m]);

  const totalLbCusto = m.leadbrokerBySdr.reduce((a, x) => a + x.custo, 0);

  // realizadas por closer (barra horizontal + hover com clientes/SDR)
  const closerData = useMemo(
    () => m.realizadasByCloser.map((c) => ({ closer: c.closer, Realizadas: c.count, _cli_Realizadas: c.clients })),
    [m],
  );
  // lista achatada: uma linha por reunião realizada, com o closer que a conduziu
  const realizadasFlat = useMemo(
    () => m.realizadasByCloser
      .flatMap((c) => c.clients.map((cl) => ({ empresa: cl.empresa, closer: c.closer, sdr: cl.sdr, canal: cl.canal, data: cl.data })))
      .sort((a, b) => (b.data || "").localeCompare(a.data || "")),
    [m],
  );

  // No-show empilhado por SDR × canal (p/ o gráfico)
  const nsCanaisLabels = useMemo(
    () => Array.from(new Set(m.noShow.list.map((c) => CANAL_LABEL[c.canal || "sem origem"] || c.canal || "sem origem"))),
    [m],
  );
  const nsStacked = useMemo(() => {
    const bySdr: Record<string, any> = {};
    for (const c of m.noShow.list) {
      const sdr = c.sdr ? c.sdr.split(" ")[0] : "Sem SDR";
      const cl = CANAL_LABEL[c.canal || "sem origem"] || c.canal || "sem origem";
      const row = (bySdr[sdr] ||= { sdr });
      row[cl] = (row[cl] || 0) + 1;
      (row[`_cli_${cl}`] ||= []).push(c);
    }
    return Object.values(bySdr);
  }, [m]);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] p-6">
      {/* header */}
      <div className="flex items-center gap-2 mb-1">
        <Users size={20} className="text-[var(--color-v4-red)]" />
        <h2 className="text-2xl font-bold text-white">Performance SDR — visão visual</h2>
        {demo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-v4-red)]/20 text-[var(--color-v4-red)] font-medium">DEMO (mock)</span>}
      </div>
      <p className="text-xs text-[var(--color-v4-text-muted)] mb-4">Funil ToFu, conversões etapa→etapa, por SDR e por canal · passe o mouse nos gráficos pra ver números e clientes · read-only</p>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1.5 text-[var(--color-v4-text-muted)] text-xs"><Filter size={13} /></div>
        <div className="flex bg-[var(--color-v4-surface)] rounded-lg p-0.5">
          {(["hoje", "7d", "30d", "90d", "custom"] as Preset[]).map((p) => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${preset === p ? "bg-[var(--color-v4-red)] text-white" : "text-[var(--color-v4-text-muted)]"}`}>
              {p === "hoje" ? "Hoje" : p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : p === "90d" ? "90 dias" : "Custom"}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-v4-text-muted)]">
            <input type="date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)}
              className="bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)] rounded px-2 py-1 text-white" />
            até
            <input type="date" value={cTo} min={cFrom} max={iso(new Date())} onChange={(e) => setCTo(e.target.value)}
              className="bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)] rounded px-2 py-1 text-white" />
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {sdrsAll.map((s, i) => {
            const on = selSdrs.includes(s.id);
            return (
              <button key={s.id}
                onClick={() => setSelSdrs((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                style={{
                  borderColor: seriesColor(i),
                  background: on ? seriesColor(i) : "transparent",
                  color: on ? (seriesColor(i) === PAL.white ? "#000" : "#fff") : "var(--color-v4-text-muted)",
                }}>
                {s.name.split(" ")[0]}
              </button>
            );
          })}
          {selSdrs.length > 0 && <button onClick={() => setSelSdrs([])} className="px-2 py-1 text-xs text-[var(--color-v4-text-muted)] underline">todos</button>}
        </div>
      </div>

      {/* cards grandes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Ligações" value={m.totals.ligacoes} icon={<Phone size={12} />} color={PAL.gray} />
        <StatCard label="Conexões" value={m.totals.conexoes} icon={<Link2 size={12} />} color={PAL.redSoft} sub={m.convRates[0].pct != null ? `${m.convRates[0].pct}% das ligações` : undefined} />
        <StatCard label="Agendadas" value={m.totals.agendadas} icon={<CalendarClock size={12} />} color={PAL.redHover} />
        <StatCard label="Realizadas" value={m.totals.realizadas} icon={<CheckCircle2 size={12} />} color={PAL.red} />
        <StatCard label="Fechadas" value={m.totals.fechadas} icon={<Trophy size={12} />} color={PAL.white} />
        <StatCard label="No Show" value={m.totals.noshow} icon={<UserX size={12} />} color={PAL.grayDark} sub={m.convRates[4].pct != null ? `${m.convRates[4].pct}% das agendadas` : undefined} />
      </div>

      {/* FUNIL ToFu + conversões */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className={`${card} lg:col-span-2`}>
          <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Funil ToFu (topo → fundo) — % = conversão da etapa anterior; passe o mouse pra ver clientes</div>
          <FunnelChart stages={m.funnel} noshow={{ value: m.totals.noshow, pct: m.convRates[4].pct, clients: m.sdrs.flatMap((s) => s.clientsNo) }} />
        </div>
        <div className={card}>
          <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Conversão etapa → etapa <span className="opacity-70">· realizado vs meta ideal</span></div>
          <div className="space-y-3.5">
            {m.convRates.map((r) => {
              const has = r.pct != null;
              const ok = has && (r.dir === "up" ? (r.pct as number) >= r.ideal : (r.pct as number) <= r.ideal);
              const col = !has ? PAL.gray : ok ? "#22c55e" : PAL.red;
              const gap = has ? (r.dir === "up" ? (r.pct as number) - r.ideal : r.ideal - (r.pct as number)) : null; // >0 = melhor que a meta
              return (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[12px] text-white font-medium">{r.name}<span className="text-[10px] text-[var(--color-v4-text-muted)] font-normal ml-1.5">{r.from} → {r.to}</span></span>
                    <span className="text-right whitespace-nowrap">
                      <span className="text-[13px] font-bold" style={{ color: col }}>{has ? `${r.pct}%` : "—"}</span>
                      <span className="text-[10px] text-[var(--color-v4-text-muted)] ml-1">meta {r.dir === "down" ? "≤" : "≥"}{r.ideal}%</span>
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded bg-[var(--color-v4-surface)] overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${Math.min(100, r.pct ?? 0)}%`, background: col }} />
                    <div className="absolute top-[-1px] bottom-[-1px] w-[2px] bg-white" style={{ left: `${Math.min(100, r.ideal)}%` }} title={`meta ${r.ideal}%`} />
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: gap == null ? PAL.gray : gap >= 0 ? "#22c55e" : PAL.red }}>
                    {gap == null ? "sem dados" : gap === 0 ? "na meta ✓" : gap > 0 ? `${Math.abs(gap)}pp melhor que a meta ✓` : `${Math.abs(gap)}pp ${r.dir === "up" ? "abaixo" : "acima"} da meta`}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[9px] text-[var(--color-v4-text-muted)] mt-3 opacity-70">Barra branca = meta ideal. Verde = dentro/melhor que a meta; vermelho = fora.</div>
        </div>
      </div>

      {/* POR SDR — comparativo + cards individuais */}
      <Section title="Performance por SDR" icon={<Users size={14} className="text-[var(--color-v4-red)]" />}
        hint="Cada barra é um SDR; passe o mouse numa etapa pra ver o valor e os clientes de cada um.">
        <div className={`${card} mb-3`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cmpData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PAL.grid} />
              <XAxis dataKey="etapa" tick={{ fontSize: 11, fill: PAL.muted }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: PAL.muted }} />
              <Tooltip cursor={{ fill: "#ffffff10" }} content={<BarTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {m.sdrs.map((s, i) => (
                <Bar key={s.id} dataKey={s.first} fill={seriesColor(i)} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {m.sdrs.map((s) => {
            const conv = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
            const rows: [string, number, string][] = [
              ["Ligações", s.ligacoes, PAL.gray], ["Conexões", s.conexoes, PAL.redSoft],
              ["Agendadas", s.agendadas, PAL.redHover], ["Realizadas", s.realizadas, PAL.red],
              ["Fechadas", s.fechadas, PAL.white], ["No Show", s.noshow, PAL.grayDark],
            ];
            const maxv = Math.max(1, s.ligacoes);
            return (
              <div key={s.id} className={card}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-white font-semibold text-sm">{s.first}</span>
                </div>
                <div className="space-y-1">
                  {rows.map(([label, v, c]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-16 text-[10px] text-[var(--color-v4-text-muted)] text-right">{label}</span>
                      <div className="flex-1 h-3.5 rounded bg-[var(--color-v4-surface)] overflow-hidden">
                        <div className="h-full rounded flex items-center justify-end px-1 text-[9px] text-black font-bold"
                          style={{ width: `${Math.max(8, (100 * v) / maxv)}%`, background: c }}>{v || ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-[var(--color-v4-text-muted)] mt-2 border-t border-[var(--color-v4-border)] pt-1.5">
                  Comparec. <span className="text-white">{conv(s.realizadas, s.agendadas)}%</span> · Fech. <span className="text-white">{conv(s.fechadas, s.realizadas)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* REUNIÕES REALIZADAS POR CLOSER */}
      <Section title="Reuniões realizadas por Closer" icon={<CheckCircle2 size={14} className="text-[var(--color-v4-red)]" />}
        hint="Pra onde o esforço dos SDRs vai: reuniões realizadas (compareceram) na mão de cada closer. Hover mostra cliente, SDR de origem e data.">
        <div className={card}>
          {m.realizadasByCloser.length === 0 ? (
            <div className="text-xs text-[var(--color-v4-text-muted)] py-6 text-center">Sem reuniões realizadas no período.</div>
          ) : (
            <>
              <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-1">{m.totals.realizadas} realizada(s) no período · distribuídas por closer</div>
              <ResponsiveContainer width="100%" height={Math.max(180, closerData.length * 54 + 40)}>
                <BarChart layout="vertical" data={closerData} margin={{ top: 8, right: 30, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={PAL.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: PAL.muted }} />
                  <YAxis type="category" dataKey="closer" width={92} tick={{ fontSize: 12, fill: "#fff" }} />
                  <Tooltip cursor={{ fill: "#ffffff10" }} content={<BarTip />} />
                  <Bar dataKey="Realizadas" fill={PAL.red} radius={[0, 3, 3, 0]}><LabelList dataKey="Realizadas" position="right" fill={PAL.muted} fontSize={11} /></Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto mt-3 border-t border-[var(--color-v4-border)] pt-3">
                <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-2">Detalhe — o closer que realizou cada reunião</div>
                <table className="w-full text-sm min-w-[620px]">
                  <thead><tr className="text-[11px] text-[var(--color-v4-text-muted)] text-left">
                    <th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Closer</th><th className="px-2 py-1">SDR (origem)</th><th className="px-2 py-1">Canal</th><th className="px-2 py-1">Data</th>
                  </tr></thead>
                  <tbody>
                    {realizadasFlat.map((r, i) => (
                      <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                        <td className="px-2 py-1.5">{r.empresa}</td>
                        <td className="px-2 py-1.5 font-medium">{r.closer.split(" ")[0]}</td>
                        <td className="px-2 py-1.5 text-[var(--color-v4-text-muted)]">{r.sdr?.split(" ")[0] || "—"}</td>
                        <td className="px-2 py-1.5"><span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-v4-surface)]">{CANAL_LABEL[r.canal || ""] || r.canal || "—"}</span></td>
                        <td className="px-2 py-1.5 text-[var(--color-v4-text-muted)]">{fmtDay(r.data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* LIGAÇÕES POR HORA — PIZZA */}
      <Section title="Ligações por hora" icon={<Phone size={14} className="text-[var(--color-v4-red)]" />}
        hint="Fatia = hora do dia; vermelho mais forte = hora mais quente. Hover mostra volume e SDRs. (distribuição por hora usa as ligações recentes carregadas — os totais do funil vêm do get_perf_ligacoes)">
        <div className={card}>
          {m.hours.length === 0 ? (
            <div className="text-xs text-[var(--color-v4-text-muted)] py-8 text-center">Sem ligações no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={m.hours} dataKey="total" nameKey="label" cx="50%" cy="50%" outerRadius={110} innerRadius={45}
                  label={(e: any) => `${e.label}: ${e.total}`} labelLine={false} stroke="#0a0a0a" strokeWidth={2}>
                  {m.hours.map((h, i) => <Cell key={i} fill={h.color} />)}
                </Pie>
                <Tooltip content={<HourTip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>

      {/* FUNIL POR CANAL */}
      <Section title="Funil por canal" icon={<Radio size={14} className="text-[var(--color-v4-red)]" />}
        hint="Quais canais mais trazem cliente pelo funil. Hover mostra quantidade, clientes e SDR.">
        <div className={`${card} mb-3`}>
          {m.channels.length === 0 ? (
            <div className="text-xs text-[var(--color-v4-text-muted)] py-8 text-center">Sem dados por canal no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, m.channels.length * 74 + 48)}>
              <BarChart layout="vertical" barCategoryGap="22%" data={m.channels.map((c) => ({
                canal: c.label, Agendadas: c.agendadas, Realizadas: c.realizadas, "No Show": c.noshow, Fechadas: c.fechadas,
                _cli_Agendadas: c.clientsAg, _cli_Fechadas: c.clientsFe, _cli_Realizadas: [], "_cli_No Show": [],
              }))} margin={{ top: 8, right: 30, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PAL.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: PAL.muted }} />
                <YAxis type="category" dataKey="canal" width={96} tick={{ fontSize: 12, fill: "#fff" }} />
                <Tooltip cursor={{ fill: "#ffffff10" }} content={<BarTip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Agendadas" fill={PAL.redHover} radius={[0, 3, 3, 0]}><LabelList dataKey="Agendadas" position="right" fill={PAL.muted} fontSize={10} /></Bar>
                <Bar dataKey="Realizadas" fill={PAL.red} radius={[0, 3, 3, 0]}><LabelList dataKey="Realizadas" position="right" fill={PAL.muted} fontSize={10} /></Bar>
                <Bar dataKey="Fechadas" fill={PAL.white} radius={[0, 3, 3, 0]}><LabelList dataKey="Fechadas" position="right" fill={PAL.muted} fontSize={10} /></Bar>
                <Bar dataKey="No Show" fill={PAL.grayDark} radius={[0, 3, 3, 0]}><LabelList dataKey="No Show" position="right" fill={PAL.muted} fontSize={10} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leadbroker por SDR (custo) */}
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] text-white font-semibold flex items-center gap-1.5"><ShoppingCart size={13} className="text-[var(--color-v4-red)]" /> LeadBroker — leads na mão de cada SDR (canal pago)</div>
            <div className="text-[11px] text-[var(--color-v4-text-muted)]">custo total <span className="text-white font-semibold">{fmtBRL(totalLbCusto)}</span></div>
          </div>
          {m.leadbrokerBySdr.length === 0 ? (
            <div className="text-xs text-[var(--color-v4-text-muted)] py-3">Nenhum lead LeadBroker no período.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {m.leadbrokerBySdr.map((lb, i) => {
                const max = Math.max(1, ...m.leadbrokerBySdr.map((x) => x.qtd));
                return (
                  <div key={i} className="rounded-lg border border-[var(--color-v4-border)] p-2.5 group relative">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm font-medium">{lb.name.split(" ")[0]}</span>
                      <span className="text-xl font-bold" style={{ color: PAL.red }}>{lb.qtd}</span>
                    </div>
                    <div className="h-2 rounded bg-[var(--color-v4-surface)] overflow-hidden my-1.5">
                      <div className="h-full rounded" style={{ width: `${(100 * lb.qtd) / max}%`, background: PAL.red }} />
                    </div>
                    <div className="text-[10px] text-[var(--color-v4-text-muted)]">custo {fmtBRL(lb.custo)}</div>
                    {/* hover: clientes */}
                    <div className="absolute z-10 left-0 top-full mt-1 w-full opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" style={tipBox}>
                      <div className="text-white font-semibold text-[11px]">{lb.name.split(" ")[0]} · {lb.qtd} leads</div>
                      <ClientList clients={lb.clients} max={8} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {/* FECHADOS — SDR + canal */}
      <Section title="Fechados — de qual SDR e canal veio" icon={<Trophy size={14} className="text-[var(--color-v4-red)]" />}>
        <div className={card}>
          {m.fechadas.length === 0 ? (
            <div className="text-xs text-[var(--color-v4-text-muted)] py-3">Nenhum fechado no período.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-[11px] text-[var(--color-v4-text-muted)] text-left">
                    <th className="px-2 py-1">Cliente</th><th className="px-2 py-1">SDR</th><th className="px-2 py-1">Canal</th><th className="px-2 py-1 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {m.fechadas.map((c, i) => (
                    <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                      <td className="px-2 py-1.5">{c.empresa}</td>
                      <td className="px-2 py-1.5 text-[var(--color-v4-text-muted)]">{c.sdr?.split(" ")[0] || "—"}</td>
                      <td className="px-2 py-1.5"><span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-v4-surface)]">{CANAL_LABEL[c.canal || ""] || c.canal || "—"}</span></td>
                      <td className="px-2 py-1.5 text-right font-semibold" style={{ color: PAL.red }}>{c.valor ? fmtBRL(c.valor) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--color-v4-border)] text-white font-semibold bg-[var(--color-v4-surface)]/40">
                    <td className="px-2 py-1.5" colSpan={3}>Total ({m.fechadas.length})</td>
                    <td className="px-2 py-1.5 text-right" style={{ color: PAL.red }}>{fmtBRL(m.fechadas.reduce((a, c) => a + (c.valor || 0), 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* NO SHOW — quantos, de quais canais, de qual SDR, quando era pra acontecer */}
      <Section title="No Show — quem não compareceu" icon={<UserX size={14} className="text-[var(--color-v4-red)]" />}
        hint="Destino de todo cliente que deu no-show: reagendou (voltou pra agenda), fechou mesmo assim, ou continua em aberto. “Era pra acontecer” = data da reunião.">
        {m.noShow.breakdown.totalClientes === 0 ? (
          <div className={card}><div className="text-xs text-[var(--color-v4-text-muted)] py-6 text-center">Nenhum no-show no período. 🎉</div></div>
        ) : (
          <>
            {(() => {
              const bd = m.noShow.breakdown; const T = bd.totalClientes || 1;
              const segs = [
                { label: "Reagendados", v: bd.reagendados, color: "#f59e0b" },
                { label: "Fecharam mesmo assim", v: bd.fechados, color: "#22c55e" },
                { label: "Em aberto", v: bd.emAberto, color: PAL.red },
              ].map((s) => ({ ...s, pct: Math.round((100 * s.v) / T) }));
              const pctR = Math.round((100 * bd.reagendados) / T);
              return (
                <div className={`${card} mb-3`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <div className="text-[12px] text-white font-semibold">Destino dos no-shows — {bd.totalClientes} cliente(s) deram no-show no período</div>
                    <div className="text-[12px]"><span className="font-bold text-lg" style={{ color: "#f59e0b" }}>{pctR}%</span> <span className="text-[10px] text-[var(--color-v4-text-muted)]">reagendaram</span></div>
                  </div>
                  <div className="flex h-6 rounded overflow-hidden bg-[var(--color-v4-surface)]">
                    {segs.filter((s) => s.v > 0).map((s) => (
                      <div key={s.label} className="h-full flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${s.pct}%`, background: s.color }} title={`${s.label}: ${s.v} (${s.pct}%)`}>{s.pct >= 10 ? `${s.pct}%` : ""}</div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {segs.map((s) => (
                      <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-v4-text-muted)]">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.label}: <span className="text-white font-semibold">{s.v}</span> ({s.pct}%)
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
            {m.noShow.total === 0 && (
              <div className={card}><div className="text-xs text-emerald-400 py-4 text-center">Todos os no-shows do período já recuperaram (reagendaram ou fecharam). ✓</div></div>
            )}
            {m.noShow.total > 0 && (<>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-3">
              <div className={card}>
                <div className="text-[11px] text-[var(--color-v4-text-muted)] flex items-center gap-1"><UserX size={12} /> Total no-show</div>
                <div className="text-4xl font-bold mt-1" style={{ color: PAL.red }}>{m.noShow.total}</div>
                <div className="text-[10px] text-[var(--color-v4-text-muted)] mt-0.5">clientes que não compareceram</div>
                <div className="text-[10px] text-[var(--color-v4-text-muted)] mt-3 mb-1">Por canal</div>
                {m.noShow.byCanal.map((c) => {
                  const max = Math.max(1, ...m.noShow.byCanal.map((x) => x.count));
                  return (
                    <div key={c.canal} className="flex items-center gap-2 py-0.5">
                      <span className="w-20 text-[10px] text-[var(--color-v4-text-muted)] truncate text-right">{c.label}</span>
                      <div className="flex-1 h-3 rounded bg-[var(--color-v4-surface)] overflow-hidden"><div className="h-full rounded" style={{ width: `${(100 * c.count) / max}%`, background: PAL.red }} /></div>
                      <span className="w-6 text-[10px] text-white text-right">{c.count}</span>
                    </div>
                  );
                })}
              </div>
              <div className={`${card} lg:col-span-2`}>
                <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-1">No-show por SDR (empilhado por canal) — hover mostra clientes e data</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={nsStacked} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PAL.grid} />
                    <XAxis dataKey="sdr" tick={{ fontSize: 11, fill: PAL.muted }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: PAL.muted }} />
                    <Tooltip cursor={{ fill: "#ffffff10" }} content={<BarTip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {nsCanaisLabels.map((cl, i) => <Bar key={cl} dataKey={cl} stackId="ns" fill={seriesColor(i)} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className={card}>
              <div className="text-[11px] text-[var(--color-v4-text-muted)] mb-2">Detalhe — {m.noShow.total} no-show(s), mais recentes primeiro</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead><tr className="text-[11px] text-[var(--color-v4-text-muted)] text-left">
                    <th className="px-2 py-1">Cliente</th><th className="px-2 py-1">SDR</th><th className="px-2 py-1">Canal</th><th className="px-2 py-1">Era pra acontecer</th>
                  </tr></thead>
                  <tbody>
                    {m.noShow.list.map((c, i) => (
                      <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                        <td className="px-2 py-1.5">{c.empresa}</td>
                        <td className="px-2 py-1.5 text-[var(--color-v4-text-muted)]">{c.sdr?.split(" ")[0] || "—"}</td>
                        <td className="px-2 py-1.5"><span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-v4-surface)]">{CANAL_LABEL[c.canal || ""] || c.canal || "—"}</span></td>
                        <td className="px-2 py-1.5 text-[var(--color-v4-text-muted)]">{fmtDay(c.data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>)}
          </>
        )}
      </Section>

      <div className="text-[10px] text-[var(--color-v4-text-muted)] opacity-60 pb-6">
        Protótipo Labs · dados {demo ? "MOCK (demo)" : "reais, leitura via app"} · nenhuma escrita no banco · janela {from} → {to}
      </div>
    </div>
  );
};

// gráfico de FUNIL com gradiente: rótulo à esquerda, valor no funil, conversão à direita.
const FunnelChart: React.FC<{ stages: FunnelStage[]; noshow: { value: number; pct: number | null; clients: ClientRef[] } }> = ({ stages, noshow }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, BAND = 76, GAP = 9, H = stages.length * BAND;
  const maxV = Math.max(1, stages[0].value);
  const cx = 300, HALF = 130;                 // funil ocupa 170..430; rótulo à esquerda, % à direita
  const half = (v: number) => Math.max(4, (v / maxV) * HALF);
  const midY = (i: number) => i * BAND + (BAND - GAP) / 2;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="fnlGrad" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={PAL.redSoft} />
            <stop offset="55%" stopColor={PAL.red} />
            <stop offset="100%" stopColor={PAL.redDeep} />
          </linearGradient>
        </defs>
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const t = half(s.value), b = half(next ? next.value : s.value * 0.7);
          const y = i * BAND, y2 = y + BAND - GAP, my = midY(i);
          const dim = hover !== null && hover !== i;
          return (
            <g key={s.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={dim ? 0.45 : 1} style={{ transition: "opacity .15s" }}>
              <polygon points={`${cx - t},${y} ${cx + t},${y} ${cx + b},${y2} ${cx - b},${y2}`} fill="url(#fnlGrad)" />
              <text x={140} y={my} textAnchor="end" dominantBaseline="middle" fontSize="13.5" fontWeight="600" fill={PAL.white}>{s.label}</text>
              <text x={cx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize="19" fontWeight="800" fill="#fff"
                stroke="#0a0a0a" strokeWidth="0.7" style={{ paintOrder: "stroke" }}>{s.value}</text>
              {s.convFromPrev != null && (
                <text textAnchor="end" fontWeight="700">
                  <tspan x={W} y={my - 6} fontSize="13" fill={s.convOk == null ? PAL.muted : s.convOk ? "#22c55e" : PAL.red}>▲ {s.convFromPrev}%</tspan>
                  {s.idealConv != null && <tspan x={W} y={my + 9} fontSize="9.5" fontWeight="500" fill={PAL.muted}>meta ≥{s.idealConv}%</tspan>}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && stages[hover].clients.length > 0 && (
        <div className="absolute z-20 pointer-events-none" style={{ ...tipBox, left: "60%", top: `${(hover / stages.length) * 100}%` }}>
          <div className="text-white font-semibold text-[11px]">{stages[hover].label} · {stages[hover].value} clientes</div>
          <ClientList clients={stages[hover].clients} max={10} />
        </div>
      )}
      {/* No Show — vazamento das agendadas */}
      <div className="mt-4 flex items-center gap-2 text-[12px] border-t border-[var(--color-v4-border)] pt-2.5">
        <UserX size={13} className="text-[var(--color-v4-text-muted)]" />
        <span className="text-[var(--color-v4-text-muted)]">No Show</span>
        <span className="px-2 py-0.5 rounded font-bold text-white" style={{ background: PAL.grayDark }}>{noshow.value}</span>
        {noshow.pct != null && <span className="text-[var(--color-v4-text-muted)]">— {noshow.pct}% das agendadas não compareceram</span>}
      </div>
    </div>
  );
};

const HourTip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const h = payload[0].payload;
  const sdrs = Object.entries(h.bySdr || {}).sort((a: any, b: any) => b[1] - a[1]);
  return (
    <div style={tipBox}>
      <div className="text-white font-semibold">{h.label} · {h.total} ligações</div>
      <div className="mt-1 space-y-0.5">
        {sdrs.map(([nm, v]: any, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-[var(--color-v4-text-muted)]">{nm}</span><span className="text-white">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---- Route wrapper: dados reais (após login) ou demo (?demo=1) ----
export const LabPerfSdrRoute: React.FC<{ demo?: boolean }> = ({ demo }) => {
  const store = useAppStore();
  if (demo) return <PerfSdrDashboard data={makeDemoData()} demo />;
  if (store.isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-v4-bg)]">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-[var(--color-v4-red)] rounded-full animate-spin" />
      </div>
    );
  }
  if (!store.currentUser) return <LoginView />;
  return (
    <PerfSdrDashboard data={{ members: store.members, leads: store.leads, deals: store.deals, reunioes: store.reunioes, ligacoes: store.ligacoes }} />
  );
};

export default PerfSdrDashboard;
