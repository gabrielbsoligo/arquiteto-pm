/**
 * perfMetrics — lógica pura do dashboard de performance do SDR (Labs).
 *
 * Calcula o funil (Ligações → Conexões → Agendadas → Realizadas → Fechadas,
 * + No Show), as taxas de conversão etapa→etapa, a visão por SDR, por canal
 * (com custo do Leadbroker), e os fechados com SDR+canal de origem — tudo a
 * partir dos dados que o app já carrega (leads/deals/reunioes/ligações/members),
 * SEM escrever nada. Cada agregado carrega também a lista de CLIENTES (empresas)
 * daquela fatia, pra aparecer no hover dos gráficos.
 *
 * READ-ONLY: aqui só se LÊ e agrega. Nenhuma mutação.
 */
import type { TeamMember, Lead, Deal, Reuniao, Ligacao4com } from "../../types";

// ---- paleta: só branco, vermelho e preto/cinza (nada de arco-íris) ----
export const PAL = {
  red: "#e63946",
  redHover: "#ff4d5a",
  redSoft: "#ff8a93",
  redDeep: "#a31621",
  white: "#f5f5f5",
  gray: "#9aa0a6",
  grayLight: "#cfd3d7",
  grayDark: "#5f6368",
  grid: "#2a2a2a",
  muted: "#a0a0a0",
};

/** Série monocromática (vermelho → cinza) para distinguir SDRs/fatias sem poluir. */
export const SERIES = [PAL.red, PAL.redSoft, PAL.redDeep, PAL.grayLight, PAL.gray, PAL.grayDark, PAL.white];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];

/** Cores do funil: vermelho forte no topo → cinza no fundo; No Show sempre cinza. */
export const FUNNEL_COLORS: Record<string, string> = {
  ligacoes: PAL.redSoft,
  conexoes: PAL.red,
  agendadas: PAL.redHover,
  realizadas: PAL.redDeep,
  fechadas: PAL.white,
  noshow: PAL.grayDark,
};

export const CANAIS = ["leadbroker", "blackbox", "outbound", "recovery", "recomendacao", "indicacao", "sem origem"];
export const CANAL_LABEL: Record<string, string> = {
  leadbroker: "LeadBroker", blackbox: "BlackBox", outbound: "Outbound",
  recovery: "Recovery", recomendacao: "Recomendação", indicacao: "Indicação", "sem origem": "Sem origem",
};

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to;
const normCanal = (c?: string | null) => {
  const k = (c || "").toLowerCase().trim();
  return CANAIS.includes(k) ? k : "sem origem";
};
const dealValor = (d: Deal) => {
  const a = (Number(d.valor_mrr) || 0) + (Number(d.valor_ot) || 0);
  return a > 0 ? a : (Number(d.valor_escopo) || 0) + (Number(d.valor_recorrente) || 0);
};

export interface ClientRef { empresa: string; sdr?: string; canal?: string; valor?: number; }
export interface Filters { from: string; to: string; sdrIds: string[] | null; } // sdrIds null = todos

export interface SdrRow {
  id: string; name: string; first: string; color: string;
  ligacoes: number; conexoes: number; agendadas: number; realizadas: number; fechadas: number; noshow: number;
  clientsAg: ClientRef[]; clientsRe: ClientRef[]; clientsNo: ClientRef[]; clientsFe: ClientRef[];
}
export interface FunnelStage { key: string; label: string; value: number; convFromPrev: number | null; color: string; clients: ClientRef[]; }
export interface ChannelRow {
  canal: string; label: string; leads: number; agendadas: number; realizadas: number; noshow: number; fechadas: number; custo: number;
  clientsFe: ClientRef[]; clientsAg: ClientRef[];
}
export interface HourSlice { hora: number; label: string; total: number; bySdr: Record<string, number>; color: string; }

export interface Metrics {
  totals: { ligacoes: number; conexoes: number; agendadas: number; realizadas: number; fechadas: number; noshow: number };
  funnel: FunnelStage[];
  convRates: { label: string; from: string; to: string; pct: number | null }[];
  sdrs: SdrRow[];
  channels: ChannelRow[];
  leadbrokerBySdr: { name: string; qtd: number; custo: number; clients: ClientRef[] }[];
  fechadas: ClientRef[];
  hours: HourSlice[];
}

export function computeMetrics(
  data: { members: TeamMember[]; leads: Lead[]; deals: Deal[]; reunioes: Reuniao[]; ligacoes: Ligacao4com[] },
  f: Filters,
): Metrics {
  const { members, leads, deals, reunioes, ligacoes } = data;
  const sdrsAll = members.filter((m) => m.role === "sdr" && m.active);
  const allowed = f.sdrIds && f.sdrIds.length ? new Set(f.sdrIds) : new Set(sdrsAll.map((s) => s.id));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const canalOfDeal = (d: Deal) => normCanal(d.lead?.canal || (d.lead_id ? leadById.get(d.lead_id)?.canal : undefined) || d.origem);

  // ---------- por SDR ----------
  const sdrs: SdrRow[] = sdrsAll
    .filter((s) => allowed.has(s.id))
    .map((s, i) => {
      const ligs = ligacoes.filter((l) => l.member_id === s.id && inRange(day(l.started_at), f.from, f.to));
      const reus = reunioes.filter((r) => r.sdr_id === s.id && inRange(day(r.data_reuniao), f.from, f.to));
      const reAg = reus;
      const reRe = reus.filter((r) => r.realizada === true);
      const reNo = reus.filter((r) => r.show === false);
      const fes = deals.filter((d) => d.sdr_id === s.id && d.status === "contrato_assinado" && inRange(day(d.data_fechamento), f.from, f.to));
      const cli = (arr: any[], withCanal = false) =>
        arr.map((x) => ({ empresa: x.empresa || "—", sdr: s.name, canal: withCanal ? normCanal(x.canal) : undefined }));
      return {
        id: s.id, name: s.name, first: s.name.split(" ")[0], color: seriesColor(i),
        ligacoes: ligs.length,
        conexoes: ligs.filter((l) => l.atendida).length,
        agendadas: reAg.length, realizadas: reRe.length, noshow: reNo.length, fechadas: fes.length,
        clientsAg: cli(reAg, true), clientsRe: cli(reRe, true), clientsNo: cli(reNo, true),
        clientsFe: fes.map((d) => ({ empresa: d.empresa || "—", sdr: s.name, canal: canalOfDeal(d), valor: dealValor(d) })),
      };
    });

  const sum = (k: keyof SdrRow) => sdrs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totals = {
    ligacoes: sum("ligacoes"), conexoes: sum("conexoes"), agendadas: sum("agendadas"),
    realizadas: sum("realizadas"), fechadas: sum("fechadas"), noshow: sum("noshow"),
  };

  const gather = (key: "clientsAg" | "clientsRe" | "clientsNo" | "clientsFe") => sdrs.flatMap((s) => s[key]);
  const funnel: FunnelStage[] = [
    { key: "ligacoes", label: "Ligações", value: totals.ligacoes, clients: [] },
    { key: "conexoes", label: "Conexões", value: totals.conexoes, clients: [] },
    { key: "agendadas", label: "Agendadas", value: totals.agendadas, clients: gather("clientsAg") },
    { key: "realizadas", label: "Realizadas", value: totals.realizadas, clients: gather("clientsRe") },
    { key: "fechadas", label: "Fechadas", value: totals.fechadas, clients: gather("clientsFe") },
  ].map((s, i, arr) => ({
    ...s,
    color: FUNNEL_COLORS[s.key],
    convFromPrev: i > 0 && arr[i - 1].value > 0 ? Math.round((100 * s.value) / arr[i - 1].value) : null,
  }));

  const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
  const convRates = [
    { label: "Conexão", from: "Ligações", to: "Conexões", pct: pct(totals.conexoes, totals.ligacoes) },
    { label: "Agendamento", from: "Conexões", to: "Agendadas", pct: pct(totals.agendadas, totals.conexoes) },
    { label: "Comparecimento", from: "Agendadas", to: "Realizadas", pct: pct(totals.realizadas, totals.agendadas) },
    { label: "Fechamento", from: "Realizadas", to: "Fechadas", pct: pct(totals.fechadas, totals.realizadas) },
    { label: "No Show", from: "Agendadas", to: "No Show", pct: pct(totals.noshow, totals.agendadas) },
  ];

  // ---------- por canal ----------
  const chMap: Record<string, ChannelRow> = {};
  const ch = (c: string) => (chMap[c] ||= { canal: c, label: CANAL_LABEL[c] || c, leads: 0, agendadas: 0, realizadas: 0, noshow: 0, fechadas: 0, custo: 0, clientsFe: [], clientsAg: [] });
  const lbBySdr: Record<string, { name: string; qtd: number; custo: number; clients: ClientRef[] }> = {};
  for (const l of leads) {
    if (!inRange(day(l.data_cadastro || l.created_at), f.from, f.to)) continue;
    if (l.sdr_id && !allowed.has(l.sdr_id)) continue;
    const c = normCanal(l.canal);
    ch(c).leads++;
    if (c === "leadbroker") {
      const key = l.sdr_id || "sem_sdr";
      const nm = l.sdr_id ? nameById.get(l.sdr_id) || "—" : "Sem SDR";
      const e = (lbBySdr[key] ||= { name: nm, qtd: 0, custo: 0, clients: [] });
      e.qtd++; e.custo += Number(l.valor_lead) || 0;
      e.clients.push({ empresa: l.empresa || "—", sdr: nm, canal: c, valor: Number(l.valor_lead) || 0 });
      ch(c).custo += Number(l.valor_lead) || 0;
    }
  }
  for (const r of reunioes) {
    if (!inRange(day(r.data_reuniao), f.from, f.to)) continue;
    if (r.sdr_id && !allowed.has(r.sdr_id)) continue;
    const c = normCanal(r.canal);
    const row = ch(c);
    row.agendadas++;
    row.clientsAg.push({ empresa: r.empresa || "—", sdr: r.sdr_id ? nameById.get(r.sdr_id) : undefined, canal: c });
    if (r.realizada === true) row.realizadas++;
    if (r.show === false) row.noshow++;
  }
  for (const d of deals) {
    if (d.status !== "contrato_assinado" || !inRange(day(d.data_fechamento), f.from, f.to)) continue;
    if (d.sdr_id && !allowed.has(d.sdr_id)) continue;
    const c = canalOfDeal(d);
    const row = ch(c);
    row.fechadas++;
    row.clientsFe.push({ empresa: d.empresa || "—", sdr: d.sdr_id ? nameById.get(d.sdr_id) : undefined, canal: c, valor: dealValor(d) });
  }
  const channels = Object.values(chMap)
    .filter((r) => r.leads || r.agendadas || r.realizadas || r.fechadas || r.noshow)
    .sort((a, b) => b.agendadas + b.fechadas - (a.agendadas + a.fechadas));

  const leadbrokerBySdr = Object.values(lbBySdr).sort((a, b) => b.qtd - a.qtd);
  const fechadas = sdrs.flatMap((s) => s.clientsFe).sort((a, b) => (b.valor || 0) - (a.valor || 0));

  // ---------- ligações por hora (pizza) ----------
  const hourMap = new Map<number, { total: number; bySdr: Record<string, number> }>();
  for (const l of ligacoes) {
    if (!l.member_id || !allowed.has(l.member_id) || !inRange(day(l.started_at), f.from, f.to)) continue;
    const h = new Date(l.started_at).getHours();
    const e = hourMap.get(h) || { total: 0, bySdr: {} };
    e.total++;
    const nm = (nameById.get(l.member_id) || "—").split(" ")[0];
    e.bySdr[nm] = (e.bySdr[nm] || 0) + 1;
    hourMap.set(h, e);
  }
  const maxH = Math.max(1, ...Array.from(hourMap.values()).map((v) => v.total));
  const hours: HourSlice[] = Array.from(hourMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hora, v]) => ({
      hora, label: `${String(hora).padStart(2, "0")}h`, total: v.total, bySdr: v.bySdr,
      // vermelho mais intenso = hora mais quente; menos volume → cinza
      color: v.total / maxH > 0.66 ? PAL.red : v.total / maxH > 0.33 ? PAL.redSoft : PAL.gray,
    }));

  return { totals, funnel, convRates, sdrs, channels, leadbrokerBySdr, fechadas, hours };
}

// =============================================================
// DADOS DEMO — só pra pré-visualizar o layout sem login (?labs=perf&demo=1).
// Não vêm do banco; servem de molde visual. Em produção usa-se o store real.
// =============================================================
export function makeDemoData() {
  const names = ["Lary", "Bianca", "Edric", "Erick"];
  const members: TeamMember[] = names.map((n, i) => ({
    id: `sdr${i}`, name: n, email: `${n.toLowerCase()}@ruston.com`, role: "sdr", active: true, created_at: "2025-01-01",
  }));
  const canais = ["leadbroker", "blackbox", "outbound", "recomendacao", "indicacao"];
  const empresas = ["Alfa Ltda", "Beta SA", "Gamma Corp", "Delta ME", "Epsilon Tech", "Zeta Foods", "Eta Log", "Theta Farma", "Iota Auto", "Kappa Bank", "Lambda Wear", "Mu Solar", "Nu Games", "Xi Health", "Omicron Edu", "Pi Retail", "Rho Build", "Sigma Med", "Tau Cloud", "Upsilon Agro"];
  const today = new Date();
  const dstr = (daysAgo: number) => {
    const d = new Date(today); d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const pick = <T,>(a: T[]) => a[rnd(a.length)];

  const leads: Lead[] = [];
  const reunioes: Reuniao[] = [];
  const deals: Deal[] = [];
  const ligacoes: Ligacao4com[] = [];
  let id = 0;

  for (let i = 0; i < 90; i++) {
    const sdr = pick(members); const canal = pick(canais); const emp = pick(empresas);
    const dc = dstr(rnd(30));
    leads.push({ id: `l${id++}`, empresa: emp, canal: canal as any, sdr_id: sdr.id, status: "em_follow",
      data_cadastro: dc, valor_lead: canal === "leadbroker" ? 40 + rnd(60) : 0, created_at: dc, updated_at: dc });
  }
  for (let i = 0; i < 70; i++) {
    const sdr = pick(members); const canal = pick(canais); const emp = pick(empresas);
    const dr = dstr(rnd(30));
    const realizada = Math.random() < 0.62;
    const noShow = !realizada && Math.random() < 0.5;
    reunioes.push({ id: `r${id++}`, sdr_id: sdr.id, canal, empresa: emp, tipo: "primeira_call",
      data_reuniao: `${dr}T14:00:00`, realizada, show: noShow ? false : realizada, created_at: dr });
    if (realizada && Math.random() < 0.4) {
      const df = dr;
      deals.push({ id: `d${id++}`, empresa: emp, sdr_id: sdr.id, status: "contrato_assinado",
        origem: canal, valor_mrr: 3000 + rnd(12) * 500, valor_ot: rnd(8) * 2000,
        valor_escopo: 0, valor_recorrente: 0, produtos_ot: [], produtos_mrr: [],
        data_fechamento: df, created_at: df, updated_at: df });
    }
  }
  for (let i = 0; i < 800; i++) {
    const sdr = pick(members);
    const daysAgo = rnd(30);
    const hour = 8 + rnd(11); // 8h..18h
    const d = new Date(today); d.setDate(d.getDate() - daysAgo); d.setHours(hour, rnd(60), 0, 0);
    ligacoes.push({ id: `c${id++}`, call_id: `${id}`, direction: "out", caller: "", called: "", started_at: d.toISOString(),
      ended_at: d.toISOString(), duration: rnd(300), hangup_cause: "", member_id: sdr.id, atendida: Math.random() < 0.35, created_at: d.toISOString() });
  }
  return { members, leads, deals, reunioes, ligacoes };
}
