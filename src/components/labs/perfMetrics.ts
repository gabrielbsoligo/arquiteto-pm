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

export interface ClientRef { empresa: string; sdr?: string; canal?: string; valor?: number; data?: string; }
export interface Filters { from: string; to: string; sdrIds: string[] | null; } // sdrIds null = todos

export interface SdrRow {
  id: string; name: string; first: string; color: string;
  ligacoes: number; conexoes: number; agendadas: number; realizadas: number; fechadas: number; noshow: number;
  clientsAg: ClientRef[]; clientsRe: ClientRef[]; clientsNo: ClientRef[]; clientsFe: ClientRef[];
}
export interface FunnelStage { key: string; label: string; value: number; convFromPrev: number | null; idealConv: number | null; convOk: boolean | null; color: string; clients: ClientRef[]; }
export interface ChannelRow {
  canal: string; label: string; leads: number; agendadas: number; realizadas: number; noshow: number; fechadas: number; custo: number;
  clientsFe: ClientRef[]; clientsAg: ClientRef[];
}
export interface HourSlice { hora: number; label: string; total: number; bySdr: Record<string, number>; color: string; }

export interface Metrics {
  totals: { ligacoes: number; conexoes: number; agendadas: number; realizadas: number; fechadas: number; noshow: number };
  funnel: FunnelStage[];
  convRates: { label: string; name: string; from: string; to: string; pct: number | null; ideal: number; dir: "up" | "down" }[];
  sdrs: SdrRow[];
  channels: ChannelRow[];
  leadbrokerBySdr: { name: string; qtd: number; custo: number; clients: ClientRef[] }[];
  fechadas: ClientRef[];
  noShow: {
    total: number;
    list: ClientRef[]; // cada no-show com empresa/sdr/canal/data (quando era pra acontecer)
    byCanal: { canal: string; label: string; count: number }[];
    bySdr: { name: string; count: number }[];
  };
  hours: HourSlice[];
}

export function computeMetrics(
  data: { members: TeamMember[]; leads: Lead[]; deals: Deal[]; reunioes: Reuniao[]; ligacoes: Ligacao4com[] },
  f: Filters,
): Metrics {
  const { members, leads, deals, reunioes, ligacoes } = data;
  const sdrsAll = members.filter((m) => m.role === "sdr" && m.active);
  const filtering = !!(f.sdrIds && f.sdrIds.length);
  const allowed = filtering ? new Set(f.sdrIds!) : new Set(sdrsAll.map((s) => s.id));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  // canal fiel ao get_perf_funil: reunião usa r.canal → lead.canal; deal usa origem → lead.canal.
  const canalOfReu = (r: Reuniao) => normCanal(r.canal && r.canal.trim() ? r.canal : (r.lead_id ? leadById.get(r.lead_id)?.canal : undefined));
  const canalOfDeal = (d: Deal) => normCanal(d.origem && d.origem.trim() ? d.origem : (d.lead?.canal || (d.lead_id ? leadById.get(d.lead_id)?.canal : undefined)));
  const dealDay = (d: Deal) => day(d.data_fechamento || d.data_call || d.created_at);

  // classificação idêntica à tela de Reuniões / RPC get_perf_funil:
  //   realizada = realizada && show===true   ·   no-show = realizada && !show   ·   agendada (pendente) = !realizada
  const isReal = (r: Reuniao) => r.realizada === true && r.show === true;
  const isNoShow = (r: Reuniao) => r.realizada === true && !r.show;
  const okSdr = (id?: string | null) => !!id && allowed.has(id);
  // reuniões da janela com SDR (base "agendadas" = COUNT(*), igual ao RPC)
  const reusInRange = reunioes.filter((r) => okSdr(r.sdr_id) && inRange(day(r.data_reuniao), f.from, f.to));
  // deals fechados (contrato assinado) na janela — fiéis à aba Contratos/pipeline
  const closed = deals.filter((d) => d.status === "contrato_assinado" && inRange(dealDay(d), f.from, f.to) && (!filtering || okSdr(d.sdr_id)));

  // No-show "em aberto": NÃO conta se o cliente recuperou — fechou (contrato assinado,
  // em qualquer data) OU foi reagendado (existe reunião mais nova pro mesmo lead).
  // (ex.: Colégio Dom Bosco no-showou mas fechou → não é mais no-show.)
  const wonLeadIds = new Set(deals.filter((d) => d.status === "contrato_assinado" && d.lead_id).map((d) => d.lead_id as string));
  const maxReuByLead = new Map<string, string>();
  for (const r of reunioes) {
    if (!r.lead_id) continue;
    const cur = maxReuByLead.get(r.lead_id);
    if (!cur || (r.data_reuniao || "") > cur) maxReuByLead.set(r.lead_id, r.data_reuniao || "");
  }
  const recuperou = (r: Reuniao) => !!r.lead_id && (wonLeadIds.has(r.lead_id) || (maxReuByLead.get(r.lead_id) || "") > (r.data_reuniao || ""));
  const isOpenNoShow = (r: Reuniao) => isNoShow(r) && !recuperou(r);
  const reuCli = (arr: Reuniao[]) => arr.map((r) => ({ empresa: r.empresa || "—", sdr: r.sdr_id ? nameById.get(r.sdr_id) : undefined, canal: canalOfReu(r), data: r.data_reuniao }));
  const dealCli = (arr: Deal[]) => arr.map((d) => ({ empresa: d.empresa || "—", sdr: d.sdr_id ? nameById.get(d.sdr_id) : undefined, canal: canalOfDeal(d), valor: dealValor(d) }));

  // ---------- por SDR ----------
  const sdrs: SdrRow[] = sdrsAll
    .filter((s) => allowed.has(s.id))
    .map((s, i) => {
      const ligs = ligacoes.filter((l) => l.member_id === s.id && inRange(day(l.started_at), f.from, f.to));
      const reus = reusInRange.filter((r) => r.sdr_id === s.id);
      const reRe = reus.filter(isReal);
      const reNo = reus.filter(isOpenNoShow);
      const fes = closed.filter((d) => d.sdr_id === s.id);
      return {
        id: s.id, name: s.name, first: s.name.split(" ")[0], color: seriesColor(i),
        ligacoes: ligs.length,
        conexoes: ligs.filter((l) => l.atendida).length,
        agendadas: reus.length, realizadas: reRe.length, noshow: reNo.length, fechadas: fes.length,
        clientsAg: reuCli(reus), clientsRe: reuCli(reRe), clientsNo: reuCli(reNo),
        clientsFe: dealCli(fes),
      };
    });

  const totals = {
    ligacoes: sdrs.reduce((a, s) => a + s.ligacoes, 0),
    conexoes: sdrs.reduce((a, s) => a + s.conexoes, 0),
    agendadas: reusInRange.length,
    realizadas: reusInRange.filter(isReal).length,
    noshow: reusInRange.filter(isOpenNoShow).length,
    fechadas: closed.length,
  };

  const funnel: FunnelStage[] = [
    { key: "ligacoes", label: "Ligações", value: totals.ligacoes, clients: [] },
    { key: "conexoes", label: "Conexões", value: totals.conexoes, clients: [] },
    { key: "agendadas", label: "Agendadas", value: totals.agendadas, clients: reuCli(reusInRange) },
    { key: "realizadas", label: "Realizadas", value: totals.realizadas, clients: reuCli(reusInRange.filter(isReal)) },
    { key: "fechadas", label: "Fechadas", value: totals.fechadas, clients: dealCli(closed) },
  ].map((s, i, arr) => {
    // meta ideal da conversão que ENTRA nesta etapa (todas "maior é melhor")
    const IDEAL_CONV: Record<string, number> = { conexoes: 15, agendadas: 20, realizadas: 80, fechadas: 30 };
    const convFromPrev = i > 0 && arr[i - 1].value > 0 ? Math.round((100 * s.value) / arr[i - 1].value) : null;
    const idealConv = IDEAL_CONV[s.key] ?? null;
    return {
      ...s,
      color: FUNNEL_COLORS[s.key],
      convFromPrev,
      idealConv,
      convOk: convFromPrev != null && idealConv != null ? convFromPrev >= idealConv : null,
    };
  });

  const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
  // metas ideais (benchmark) por etapa. dir=up → maior é melhor; dir=down → menor é melhor.
  const convRates: Metrics["convRates"] = [
    { label: "Conexão", name: "Connect Rate", from: "Ligações", to: "Conexões", pct: pct(totals.conexoes, totals.ligacoes), ideal: 15, dir: "up" },
    { label: "Agendamento", name: "Booking Rate", from: "Conexões", to: "Agendamentos", pct: pct(totals.agendadas, totals.conexoes), ideal: 20, dir: "up" },
    { label: "Comparecimento", name: "Show Rate", from: "Agendamentos", to: "Realizadas", pct: pct(totals.realizadas, totals.agendadas), ideal: 80, dir: "up" },
    { label: "Fechamento", name: "Win Rate", from: "Realizadas", to: "Fechadas", pct: pct(totals.fechadas, totals.realizadas), ideal: 30, dir: "up" },
    { label: "No Show", name: "No Show Rate", from: "Agendamentos", to: "No Show", pct: pct(totals.noshow, totals.agendadas), ideal: 15, dir: "down" },
  ];

  // ---------- por canal ----------
  const chMap: Record<string, ChannelRow> = {};
  const ch = (c: string) => (chMap[c] ||= { canal: c, label: CANAL_LABEL[c] || c, leads: 0, agendadas: 0, realizadas: 0, noshow: 0, fechadas: 0, custo: 0, clientsFe: [], clientsAg: [] });
  const lbBySdr: Record<string, { name: string; qtd: number; custo: number; clients: ClientRef[] }> = {};
  for (const l of leads) {
    if (!inRange(day(l.data_cadastro || l.created_at), f.from, f.to)) continue;
    if (filtering && !okSdr(l.sdr_id)) continue;
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
  for (const r of reusInRange) {
    const c = canalOfReu(r);
    const row = ch(c);
    row.agendadas++;
    row.clientsAg.push({ empresa: r.empresa || "—", sdr: r.sdr_id ? nameById.get(r.sdr_id) : undefined, canal: c });
    if (isReal(r)) row.realizadas++;
    if (isOpenNoShow(r)) row.noshow++;
  }
  for (const d of closed) {
    const c = canalOfDeal(d);
    const row = ch(c);
    row.fechadas++;
    row.clientsFe.push({ empresa: d.empresa || "—", sdr: d.sdr_id ? nameById.get(d.sdr_id) : undefined, canal: c, valor: dealValor(d) });
  }
  const channels = Object.values(chMap)
    .filter((r) => r.leads || r.agendadas || r.realizadas || r.fechadas || r.noshow)
    .sort((a, b) => b.agendadas + b.fechadas - (a.agendadas + a.fechadas));

  const leadbrokerBySdr = Object.values(lbBySdr).sort((a, b) => b.qtd - a.qtd);
  const fechadas = dealCli(closed).sort((a, b) => (b.valor || 0) - (a.valor || 0));

  // ---------- NO SHOW: quantos, de quais canais, de qual SDR, quando era pra acontecer ----------
  const nsList = reuCli(reusInRange.filter(isOpenNoShow)).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const nsCanalMap: Record<string, number> = {};
  const nsSdrMap: Record<string, number> = {};
  for (const c of nsList) {
    const ck = c.canal || "sem origem";
    nsCanalMap[ck] = (nsCanalMap[ck] || 0) + 1;
    const sk = c.sdr || "Sem SDR";
    nsSdrMap[sk] = (nsSdrMap[sk] || 0) + 1;
  }
  const noShow = {
    total: nsList.length,
    list: nsList,
    byCanal: Object.entries(nsCanalMap).map(([canal, count]) => ({ canal, label: CANAL_LABEL[canal] || canal, count })).sort((a, b) => b.count - a.count),
    bySdr: Object.entries(nsSdrMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };

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

  return { totals, funnel, convRates, sdrs, channels, leadbrokerBySdr, fechadas, noShow, hours };
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
    // 3 estados fiéis ao modelo: realizada (realizada&&show), no-show (realizada&&!show), pendente (!realizada)
    const roll = Math.random();
    const realizada = roll < 0.72;             // 72% já foram confirmadas (realizada=true)
    const show = realizada ? roll < 0.55 : false; // dessas, compareceram; senão no-show. pendente fica !realizada
    reunioes.push({ id: `r${id++}`, sdr_id: sdr.id, canal, empresa: emp, tipo: "primeira_call",
      data_reuniao: `${dr}T14:00:00`, realizada, show, created_at: dr });
    if (realizada && show && Math.random() < 0.45) {
      const df = dr;
      deals.push({ id: `d${id++}`, empresa: emp, sdr_id: sdr.id, status: "contrato_assinado",
        origem: canal, valor_mrr: 3000 + rnd(12) * 500, valor_ot: rnd(8) * 2000,
        valor_escopo: 0, valor_recorrente: 0, produtos_ot: [], produtos_mrr: [],
        data_fechamento: df, data_call: df, created_at: df, updated_at: df });
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
