/**
 * prospLib — núcleo do Hub de Prospecção Outbound (V4) evoluído p/ CRM de Sales Engagement.
 *
 * Tudo client-side (o clone Labs é read-only): parsing de CSV/XLS (lib xlsx),
 * mapeamento das colunas do Lemit, entidade Decisor, log de Atividades
 * (touchpoints), pipeline de 9 etapas, motivos de perda, maturidade digital,
 * persistência em localStorage, gerador de abordagem por regras, métricas de
 * conversão do funil e exportação CSV (Kommo / 3C Plus).
 *
 * PRODUÇÃO: trocar o store de localStorage por tabelas Supabase (schema em
 * SCHEMA.md) e o gerador de abordagem por uma chamada OpenAI/Claude — as
 * interfaces (ProspLead / Touchpoint / generateApproach) já estão prontas.
 */
import * as XLSX from "xlsx";

// ---------------- Pipeline (9 etapas) ----------------
export type Status =
  | "inteligencia" | "enriquecimento" | "prospeccao_ativa" | "conectado"
  | "qualificado" | "reuniao_agendada" | "reuniao_realizada" | "fechado" | "perdido";

// ordem completa (com Perdido no fim, fora do fluxo linear)
export const STATUS_ORDER: Status[] = [
  "inteligencia", "enriquecimento", "prospeccao_ativa", "conectado", "qualificado",
  "reuniao_agendada", "reuniao_realizada", "fechado", "perdido",
];
// funil "para frente" (sem Perdido) — usado no cálculo de conversão cumulativa
export const PIPELINE: Status[] = STATUS_ORDER.filter((s) => s !== "perdido");

export const STATUS_LABELS: Record<Status, string> = {
  inteligencia: "Inteligência", enriquecimento: "Enriquecimento", prospeccao_ativa: "Prospecção Ativa",
  conectado: "Conectado", qualificado: "Qualificado", reuniao_agendada: "Reunião Agendada",
  reuniao_realizada: "Reunião Realizada", fechado: "Fechado / Ganho", perdido: "Perdido / Descarte",
};
// dica curta de cada etapa (aparece no card/coluna)
export const STATUS_HINT: Record<Status, string> = {
  inteligencia: "Lista bruta / higienização", enriquecimento: "Buscando contatos do decisor",
  prospeccao_ativa: "Cadência iniciada", conectado: "Falou com o decisor",
  qualificado: "Validou dor / fit", reuniao_agendada: "Convite enviado",
  reuniao_realizada: "Comparecimento confirmado", fechado: "Contrato assinado", perdido: "Motivo obrigatório",
};
// cor (tokens) por etapa — para pills e barra do card
export const STATUS_COLOR: Record<Status, string> = {
  inteligencia: "#6b7280", enriquecimento: "#8b8b8b", prospeccao_ativa: "#f59e0b", conectado: "#38bdf8",
  qualificado: "#a78bfa", reuniao_agendada: "#c084fc", reuniao_realizada: "#34d399", fechado: "#e63946", perdido: "#ef4444",
};

// Mapeamento (produção): etapa da Prospecção → etapa do lead na tela Leads do SalesHub.
export const LEAD_ETAPA_MAP: Record<string, string> = {
  prospeccao_ativa: "em_follow", conectado: "em_follow", qualificado: "em_follow",
  reuniao_agendada: "reuniao_marcada", reuniao_realizada: "reuniao_realizada", fechado: "cliente",
};

// ---------------- Maturidade digital (Baixa/Média/Alta) ----------------
export type Nivel = "Baixa" | "Média" | "Alta";
export const NIVEIS: Nivel[] = ["Baixa", "Média", "Alta"];
export const maturidadeBanda = (n: number): Nivel => (n <= 2 ? "Baixa" : n === 3 ? "Média" : "Alta");
export const nivelToNum = (nv: Nivel): number => (nv === "Baixa" ? 2 : nv === "Média" ? 3 : 5);

// ---------------- Nichos (foco: SaaS, Saúde e Beleza, Construtoras) ----------------
export const NICHOS = [
  "SaaS / Tecnologia", "Saúde e Beleza", "Construtoras / Incorporadoras",
  "Varejo / E-commerce", "Serviços B2B", "Educação", "Indústria", "Outro",
];

// ---------------- Atividades (Touchpoints) ----------------
export type AtividadeTipo = "cold_call" | "cold_mail" | "social_selling" | "whatsapp";
export type AtividadeResultado = "conectou" | "nao_atendeu" | "bounce" | "callback" | "gatekeeper" | "sem_interesse" | "outro";
export interface Touchpoint {
  id: string;
  tipo: AtividadeTipo;
  dataHora: string;         // ISO
  resultado: AtividadeResultado;
  nota?: string;
  bdr?: string | null;
}
export const ATIVIDADE_TIPOS: { key: AtividadeTipo; label: string }[] = [
  { key: "cold_call", label: "Cold Call" }, { key: "cold_mail", label: "Cold Mail" },
  { key: "social_selling", label: "Social Selling" }, { key: "whatsapp", label: "WhatsApp" },
];
export const ATIVIDADE_RESULTADOS: { key: AtividadeResultado; label: string }[] = [
  { key: "conectou", label: "Conectou (falou com decisor)" }, { key: "nao_atendeu", label: "Não atendeu" },
  { key: "callback", label: "Pediu retorno / callback" }, { key: "gatekeeper", label: "Barrado (gatekeeper)" },
  { key: "sem_interesse", label: "Sem interesse" }, { key: "bounce", label: "Bounce (e-mail/nº inválido)" },
  { key: "outro", label: "Outro" },
];
export const tipoLabel = (t: AtividadeTipo) => ATIVIDADE_TIPOS.find((x) => x.key === t)?.label || t;
export const resultadoLabel = (r: AtividadeResultado) => ATIVIDADE_RESULTADOS.find((x) => x.key === r)?.label || r;

// ---------------- Motivos de perda ----------------
export const MOTIVOS_PERDA = [
  "Fora de Perfil (ICP)", "Lista Ruim (dados incorretos)", "Sem Orçamento",
  "Usando Concorrente", "Sem Interesse", "Não respondeu / sumiu", "Timing ruim", "Outro",
];

export interface ProspLead {
  id: string;
  // Empresa
  empresa: string;
  cnpj: string;
  socio1: string;
  socio2: string;
  whatsapp1: string;
  whatsapp2: string;
  email: string;
  site: string;
  cidade: string;
  estado: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
  nicho: string;
  origem: string;       // origem da lista (Lemit, Apollo, indicação, evento…)
  // Decisor (Contato)
  decisorNome: string;
  decisorCargo: string;
  decisorTel: string;
  decisorEmail: string;
  decisorLinkedin: string;
  // operacional
  bdr: string | null;
  maturidade: number;              // 1..5 — sinal automático (presença digital)
  maturidadeNivel: Nivel;          // Baixa/Média/Alta (editável)
  abordagem: string;
  status: Status;
  motivoPerda?: string;            // obrigatório quando status = perdido
  // agendamento (status = reuniao_agendada+)
  dataReuniao?: string; closerId?: string; closerNome?: string; canal?: string;
  // atividades
  atividades: Touchpoint[];
  notas: string;
  batch: string;
  createdAt: string;
  updatedAt: string;
}

export const LEMIT_COLUNAS = [
  "NOME EMPRESA", "NOME SOCIO 1", "NOME SOCIO 2", "CELULAR/WHATSAPP 1", "CELULAR/WHATSAPP 2",
  "EMAIL", "SITE EMPRESA", "CIDADE", "ESTADO", "LINK INSTAGRAM", "LINK FACEBOOK", "LINK LINKEDIN", "LINK YOUTUBE",
];

// normaliza header: minúsculo, sem acento, sem pontuação → facilita casar variações
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS, "").replace(/[^a-z0-9]+/g, " ").trim();

const FIELD_ALIASES: Record<keyof Pick<ProspLead,
  "empresa" | "cnpj" | "socio1" | "socio2" | "whatsapp1" | "whatsapp2" | "email" | "site" | "cidade" | "estado" | "instagram" | "facebook" | "linkedin" | "youtube">, string[]> = {
  empresa: ["nome empresa", "empresa", "razao social", "nome fantasia"],
  cnpj: ["cnpj", "cnpj empresa", "documento"],
  socio1: ["nome socio 1", "socio 1", "socio1", "nome socio"],
  socio2: ["nome socio 2", "socio 2", "socio2"],
  whatsapp1: ["celular whatsapp 1", "celular 1", "whatsapp 1", "telefone 1", "celular whatsapp", "telefone", "celular"],
  whatsapp2: ["celular whatsapp 2", "celular 2", "whatsapp 2", "telefone 2"],
  email: ["email", "e mail"],
  site: ["site empresa", "site", "website", "url"],
  cidade: ["cidade", "municipio"],
  estado: ["estado", "uf"],
  instagram: ["link instagram", "instagram", "insta"],
  facebook: ["link facebook", "facebook", "face"],
  linkedin: ["link linkedin", "linkedin"],
  youtube: ["link youtube", "youtube", "yt"],
};

function buildHeaderMap(headers: string[]): Partial<Record<keyof typeof FIELD_ALIASES, number>> {
  const map: any = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const field of Object.keys(FIELD_ALIASES) as (keyof typeof FIELD_ALIASES)[]) {
      if (map[field] != null) continue;
      if (FIELD_ALIASES[field].some((a) => a === n || n.includes(a))) map[field] = i;
    }
  });
  return map;
}

export interface ParseResult { leads: ProspLead[]; matched: string[]; missing: string[]; rows: number; }

/** Lê um File (CSV ou XLS/XLSX) e devolve os leads mapeados. */
export async function parseFile(file: File, batch: string, nicho = "", owner: string | null = null, origem = ""): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  if (!matrix.length) return { leads: [], matched: [], missing: LEMIT_COLUNAS, rows: 0 };
  const headers = (matrix[0] || []).map((h) => String(h));
  const hmap = buildHeaderMap(headers);
  const get = (row: string[], f: keyof typeof FIELD_ALIASES) => {
    const idx = hmap[f];
    return idx != null ? String(row[idx] ?? "").trim() : "";
  };
  const now = new Date().toISOString();
  const leads: ProspLead[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const empresa = get(row, "empresa");
    if (!empresa && !get(row, "email") && !get(row, "whatsapp1")) continue; // linha vazia
    const socio1 = get(row, "socio1");
    const lead: ProspLead = {
      id: `${batch}-${r}-${Math.abs(hashStr(empresa + get(row, "email") + r))}`,
      empresa, cnpj: get(row, "cnpj"), socio1, socio2: get(row, "socio2"),
      whatsapp1: get(row, "whatsapp1"), whatsapp2: get(row, "whatsapp2"),
      email: get(row, "email"), site: get(row, "site"),
      cidade: get(row, "cidade"), estado: get(row, "estado"),
      instagram: get(row, "instagram"), facebook: get(row, "facebook"),
      linkedin: get(row, "linkedin"), youtube: get(row, "youtube"),
      nicho, origem: origem || batch,
      // decisor pré-preenchido a partir da lista (BDR valida/ajusta depois)
      decisorNome: socio1, decisorCargo: socio1 ? "Sócio(a)" : "", decisorTel: get(row, "whatsapp1"),
      decisorEmail: get(row, "email"), decisorLinkedin: "",
      bdr: owner, maturidade: 0, maturidadeNivel: "Baixa", abordagem: "", status: "inteligencia",
      atividades: [], notas: "", batch, createdAt: now, updatedAt: now,
    };
    lead.maturidade = autoMaturidade(lead);
    lead.maturidadeNivel = maturidadeBanda(lead.maturidade);
    leads.push(lead);
  }
  const matchedFields = Object.keys(hmap);
  const matched = LEMIT_COLUNAS.filter((c) => matchedFields.includes(canonicalOf(c)));
  const missing = LEMIT_COLUNAS.filter((c) => !matchedFields.includes(canonicalOf(c)));
  return { leads, matched, missing, rows: matrix.length - 1 };
}

function canonicalOf(lemitCol: string): string {
  const n = norm(lemitCol);
  for (const f of Object.keys(FIELD_ALIASES) as (keyof typeof FIELD_ALIASES)[])
    if (FIELD_ALIASES[f].some((a) => a === n || n.includes(a))) return f;
  return lemitCol;
}

function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ---------------- maturidade digital automática (1..5) ----------------
export function autoMaturidade(lead: { site?: string; instagram?: string; linkedin?: string; youtube?: string; facebook?: string }): number {
  const raw =
    (lead.site ? 1.5 : 0) + (lead.instagram ? 1 : 0) + (lead.linkedin ? 1 : 0) +
    (lead.youtube ? 1 : 0) + (lead.facebook ? 0.5 : 0);
  return Math.max(1, Math.min(5, Math.round(raw)));
}

export function maturidadeMotivo(lead: ProspLead): string {
  const pares: [string, string][] = [["Site", lead.site], ["Instagram", lead.instagram], ["LinkedIn", lead.linkedin], ["YouTube", lead.youtube], ["Facebook", lead.facebook]];
  const on = pares.filter(([, v]) => v).map(([n]) => n);
  const off = pares.filter(([, v]) => !v).map(([n]) => n);
  return `Presentes: ${on.join(", ") || "nenhum"}${off.length ? ` · Faltam: ${off.join(", ")}` : ""}`;
}

// ---------------- links / click-to-call ----------------
const q = (s: string) => encodeURIComponent(s.trim());
const httpize = (u: string) => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u);

export function channelLink(lead: ProspLead, kind: "site" | "instagram" | "facebook" | "linkedin" | "youtube" | "gmb" | "google"): { href: string; derived: boolean } {
  const nome = `${lead.empresa} ${lead.cidade}`.trim();
  switch (kind) {
    case "site": return lead.site ? { href: httpize(lead.site), derived: false } : { href: `https://www.google.com/search?q=${q(lead.empresa + " site oficial")}`, derived: true };
    case "instagram": return lead.instagram ? { href: httpize(lead.instagram), derived: false } : { href: `https://www.google.com/search?q=${q(nome + " instagram")}`, derived: true };
    case "facebook": return lead.facebook ? { href: httpize(lead.facebook), derived: false } : { href: `https://www.google.com/search?q=${q(nome + " facebook")}`, derived: true };
    case "linkedin": return lead.linkedin ? { href: httpize(lead.linkedin), derived: false } : { href: `https://www.google.com/search?q=${q(nome + " linkedin empresa")}`, derived: true };
    case "youtube": return lead.youtube ? { href: httpize(lead.youtube), derived: false } : { href: `https://www.youtube.com/results?search_query=${q(lead.empresa)}`, derived: true };
    case "gmb": return { href: `https://www.google.com/maps/search/${q(nome)}`, derived: true };
    case "google": return { href: `https://www.google.com/search?q=${q(nome)}`, derived: true };
  }
}

export const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");
export function callLink(phone: string): string {
  const d = onlyDigits(phone);
  const full = d.length >= 11 && !d.startsWith("55") ? `55${d}` : d;
  return `api4com://${full}`;
}
export function telLink(phone: string): string {
  const d = onlyDigits(phone);
  const full = d.length >= 11 && !d.startsWith("55") ? `55${d}` : d;
  return `tel:+${full}`;
}
export function whatsappLink(phone: string): string {
  const d = onlyDigits(phone);
  const full = d.length >= 11 && !d.startsWith("55") ? `55${d}` : d;
  return `https://wa.me/${full}`;
}

// ---------------- persistência (localStorage) ----------------
const KEY = "v4_hub_outbound_leads_v1";              // estado de trabalho do Hub (etapas, decisor, atividades…)
const PROSP_KEY = "v4_prospeccao_leads_v1";          // ÚNICO ponto de upload (aba Prospecção)
const DISMISS_KEY = "v4_hub_outbound_dismissed_v1";  // ids removidos no Hub (p/ não voltarem no sync)
const VALID_STATUS = new Set(STATUS_ORDER as string[]);
// migração de status antigos (Prospecção 6 etapas / versões antigas) → pipeline de 9 etapas
const STATUS_MIGRA: Record<string, Status> = {
  novo: "inteligencia", abordando: "prospeccao_ativa", conexao: "conectado", agendado: "reuniao_agendada",
  realizado: "reuniao_realizada", investigando: "prospeccao_ativa", abordado: "prospeccao_ativa",
  reuniao: "reuniao_agendada", descartado: "perdido",
};

// normaliza um lead (da Prospecção OU do próprio Hub) pro modelo rico de 9 etapas.
function normalizeLead(l: any): ProspLead {
  const maturidade = l.maturidade && l.maturidade > 0 ? l.maturidade : autoMaturidade(l);
  return {
    cnpj: "", origem: l.origem || l.batch || "Importada", decisorNome: l.decisorNome || l.socio1 || "",
    decisorCargo: l.decisorCargo || (l.socio1 ? "Sócio(a)" : ""), decisorTel: l.decisorTel || l.whatsapp1 || "",
    decisorEmail: l.decisorEmail || l.email || "", decisorLinkedin: l.decisorLinkedin || "",
    atividades: Array.isArray(l.atividades) ? l.atividades : [],
    createdAt: l.createdAt || new Date().toISOString(), updatedAt: l.updatedAt || l.createdAt || new Date().toISOString(),
    ...l,
    nicho: l.nicho || "Construtoras / Incorporadoras",
    abordagem: l.abordagem || "", notas: l.notas || "",
    status: VALID_STATUS.has(l.status) ? l.status : (STATUS_MIGRA[l.status as string] || "inteligencia"),
    maturidade,
    maturidadeNivel: l.maturidadeNivel || maturidadeBanda(maturidade),
  } as ProspLead;
}

function readRaw(key: string): any[] {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; } catch { return []; }
}
function loadDismissed(): Set<string> { try { return new Set(readRaw(DISMISS_KEY) as string[]); } catch { return new Set(); } }
function saveDismissed(s: Set<string>) { try { localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(s))); } catch { /* quota */ } }

/** Marca ids como removidos no Hub — o sync com a Prospecção não os traz de volta. */
export function markDismissed(ids: string[]): void {
  const s = loadDismissed(); ids.forEach((id) => s.add(id)); saveDismissed(s);
}

/**
 * Carrega os leads do Hub INTEGRANDO com a Prospecção: o upload acontece só na
 * aba Prospecção; aqui a gente ingere os leads de lá que ainda não estão no Hub
 * (respeitando os removidos). Os leads que já existem no Hub mantêm o estado de
 * trabalho (etapa de 9, decisor, atividades, agendamento…).
 */
export function loadLeads(): ProspLead[] {
  try {
    const dismissed = loadDismissed();
    const hubById = new Map<string, any>(readRaw(KEY).map((l) => [l.id, l]));
    let changed = false;
    for (const p of readRaw(PROSP_KEY)) {
      if (!p || !p.id || dismissed.has(p.id)) continue;
      if (!hubById.has(p.id)) { hubById.set(p.id, p); changed = true; } // novo lead vindo da Prospecção
    }
    const merged = Array.from(hubById.values()).map(normalizeLead);
    if (changed) saveLeads(merged); // persiste os recém-ingeridos
    return merged;
  } catch { return []; }
}
export function saveLeads(leads: ProspLead[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(leads)); } catch { /* quota */ }
}

// ---------------- distribuição entre BDRs ----------------
export function distribute(leads: ProspLead[], bdrs: string[]): ProspLead[] {
  if (!bdrs.length) return leads;
  return leads.map((l, i) => (l.bdr ? l : { ...l, bdr: bdrs[i % bdrs.length] }));
}

// ---------------- REGRAS DE NEGÓCIO (bloqueio de etapa) ----------------
/** Valida se um lead pode entrar numa etapa. Devolve { ok, motivo }. */
export function canMoveTo(lead: ProspLead, to: Status): { ok: boolean; motivo?: string } {
  if (to === "reuniao_agendada") {
    const temDecisor = !!(lead.decisorNome && lead.decisorNome.trim());
    const temData = !!(lead.dataReuniao && lead.dataReuniao.trim());
    if (!temDecisor || !temData) return { ok: false, motivo: "Preencha Decisor e Data da Reunião antes de agendar." };
  }
  if (to === "perdido") {
    if (!lead.motivoPerda) return { ok: false, motivo: "Selecione o motivo da perda." };
  }
  return { ok: true };
}

// ---------------- MÉTRICAS DE CONVERSÃO ----------------
export const stageIndex = (s: Status) => PIPELINE.indexOf(s);
export interface StageMetric { status: Status; label: string; count: number; reached: number; convPrev: number | null; convTop: number; }
export interface FunnelMetrics { stages: StageMetric[]; total: number; perdidos: number; ganhos: number; taxaAgendamento: number; taxaGanho: number; }

/**
 * Funil cumulativo: `reached(etapa)` = nº de leads cujo status atual está NAQUELA
 * etapa ou ADIANTE (progresso assumido monotônico). Conversão etapa→etapa =
 * reached(i)/reached(i-1). Perdidos ficam à parte (sem histórico de etapa não dá
 * pra saber onde caíram — em produção o stage-history dá o ponto exato de drop).
 */
export function funnelMetrics(leads: ProspLead[]): FunnelMetrics {
  const ativos = leads.filter((l) => l.status !== "perdido");
  const total = leads.length;
  const perdidos = leads.filter((l) => l.status === "perdido").length;
  const ganhos = leads.filter((l) => l.status === "fechado").length;
  const stages: StageMetric[] = PIPELINE.map((s, i) => {
    const count = leads.filter((l) => l.status === s).length;
    const reached = ativos.filter((l) => stageIndex(l.status) >= i).length;
    return { status: s, label: STATUS_LABELS[s], count, reached, convPrev: null, convTop: 0 };
  });
  const top = stages[0]?.reached || 0;
  stages.forEach((st, i) => {
    const prev = i > 0 ? stages[i - 1].reached : 0;
    st.convPrev = i > 0 ? (prev > 0 ? +( (100 * st.reached) / prev ).toFixed(1) : 0) : null;
    st.convTop = top > 0 ? +((100 * st.reached) / top).toFixed(1) : 0;
  });
  const reachedAgendada = ativos.filter((l) => stageIndex(l.status) >= stageIndex("reuniao_agendada")).length;
  return {
    stages, total, perdidos, ganhos,
    taxaAgendamento: total > 0 ? +((100 * reachedAgendada) / total).toFixed(1) : 0,
    taxaGanho: total > 0 ? +((100 * ganhos) / total).toFixed(1) : 0,
  };
}

// ---------------- DASHBOARDS (agregações p/ o painel do gestor) ----------------
const reachedAgendada = (l: ProspLead) => l.status !== "perdido" && stageIndex(l.status) >= stageIndex("reuniao_agendada");

/** Qualidade da lista: por origem → volume, taxa de reunião agendada, perdas por dados ruins. */
export function listQuality(leads: ProspLead[]) {
  const byOrigem = new Map<string, ProspLead[]>();
  leads.forEach((l) => { const k = l.origem || "—"; (byOrigem.get(k) || byOrigem.set(k, []).get(k)!).push(l); });
  return Array.from(byOrigem.entries()).map(([origem, ls]) => {
    const total = ls.length;
    const agendadas = ls.filter(reachedAgendada).length;
    const perdasDados = ls.filter((l) => l.status === "perdido" && /lista ruim|dados/i.test(l.motivoPerda || "")).length;
    const perdasTotal = ls.filter((l) => l.status === "perdido").length;
    return {
      origem, total, agendadas, perdasDados, perdasTotal,
      taxaAgendamento: total ? +((100 * agendadas) / total).toFixed(1) : 0,
      taxaDadosRuins: total ? +((100 * perdasDados) / total).toFixed(1) : 0,
    };
  }).sort((a, b) => b.total - a.total);
}

/** Maturidade × conversão por nicho: matriz nicho × banda (Baixa/Média/Alta). */
export function maturityConversion(leads: ProspLead[]) {
  const nichos = Array.from(new Set(leads.map((l) => l.nicho || "—")));
  return nichos.map((nicho) => {
    const row: any = { nicho };
    NIVEIS.forEach((nv) => {
      const ls = leads.filter((l) => (l.nicho || "—") === nicho && (l.maturidadeNivel || maturidadeBanda(l.maturidade)) === nv);
      const total = ls.length;
      const agendadas = ls.filter(reachedAgendada).length;
      const ganhos = ls.filter((l) => l.status === "fechado").length;
      row[nv] = { total, agendadas, ganhos, taxa: total ? Math.round((100 * agendadas) / total) : null };
    });
    row._total = leads.filter((l) => (l.nicho || "—") === nicho).length;
    return row;
  }).filter((r) => r._total > 0).sort((a, b) => b._total - a._total);
}

/** Produtividade dos BDRs: volume de atividades, ligações, conexões, reuniões. */
export function bdrProductivity(leads: ProspLead[], team: string[]) {
  const names = team.length ? team : Array.from(new Set(leads.map((l) => l.bdr).filter(Boolean) as string[]));
  return names.map((bdr) => {
    const ls = leads.filter((l) => l.bdr === bdr);
    const ativ = ls.flatMap((l) => l.atividades || []);
    const ligacoes = ativ.filter((a) => a.tipo === "cold_call").length;
    const conexoes = ativ.filter((a) => a.resultado === "conectou").length;
    const agendadas = ls.filter(reachedAgendada).length;
    const ganhos = ls.filter((l) => l.status === "fechado").length;
    return {
      bdr, leads: ls.length, atividades: ativ.length, ligacoes, conexoes, agendadas, ganhos,
      taxaConexao: ligacoes ? +((100 * conexoes) / ligacoes).toFixed(1) : 0,
    };
  }).sort((a, b) => b.atividades - a.atividades);
}

// ---------------- gerador de abordagem (regras por nicho + gaps; trocável por LLM) ----------------
interface NichoInfo { label: string; dores: [string, string, string]; prova: string }
const NICHO_MAP: Record<string, NichoInfo> = {
  saas: {
    label: "empresas de SaaS e tecnologia",
    dores: ["estruturar a máquina de aquisição (outbound + inbound) pra gerar MRR previsível", "reduzir o CAC e o churn com um funil e uma ativação bem desenhados", "escalar o go-to-market com previsibilidade de pipeline e eficiência de mídia"],
    prova: "ajudamos empresas de tecnologia a montar um pipeline previsível e escalar o MRR",
  },
  beleza: {
    label: "negócios de saúde e beleza",
    dores: ["encher a agenda com clientes qualificados da região", "aumentar recorrência e ticket médio (retenção e recompra)", "construir autoridade e prova social que gerem confiança e indicações"],
    prova: "temos clínicas e negócios de beleza que lotaram a agenda com clientes da região",
  },
  imobiliario: {
    label: "construtoras e incorporadoras",
    dores: ["estruturar a geração de leads qualificados pros lançamentos e reduzir o custo por lead", "acelerar a velocidade de vendas e girar o estoque de unidades com um funil previsível", "escalar a captação com eficiência de mídia (ROI) e autoridade de marca pro comprador de alto ticket"],
    prova: "temos cases de incorporadoras que encheram o funil de compradores qualificados e aceleraram a venda de estoque",
  },
  varejo: {
    label: "varejo e e-commerce",
    dores: ["estruturar tráfego e recuperação de carrinho pra vender todo dia", "aumentar a recorrência e o ticket médio com CRM e retenção", "escalar as vendas online com ROI positivo e previsível"],
    prova: "ajudamos varejos a escalar vendas online com ROI positivo",
  },
  servicos: {
    label: "serviços B2B",
    dores: ["gerar reuniões qualificadas de forma previsível (outbound + inbound)", "encurtar o ciclo de vendas com nutrição e prova de autoridade", "escalar a aquisição com CAC sob controle"],
    prova: "geramos pipeline previsível de reuniões qualificadas pra empresas B2B",
  },
  generico: {
    label: "empresas como a de vocês",
    dores: ["estruturar a aquisição de clientes de forma previsível (tráfego, funil e conversão)", "profissionalizar o que já roda e destravar o próximo nível de crescimento", "escalar com previsibilidade e reduzir o custo de aquisição"],
    prova: "ajudamos empresas a crescer com marketing e vendas por performance",
  },
};
function resolveNicho(nicho: string): NichoInfo {
  const n = (nicho || "").toLowerCase();
  if (/saas|tecnolog|software|tech|app/.test(n)) return NICHO_MAP.saas;
  if (/saud|saúde|beleza|clinic|clínic|odont|estetic|estétic/.test(n)) return NICHO_MAP.beleza;
  if (/imob|incorpor|constru/.test(n)) return NICHO_MAP.imobiliario;
  if (/varej|commerce|loja|ecom/.test(n)) return NICHO_MAP.varejo;
  if (/b2b|servi/.test(n)) return NICHO_MAP.servicos;
  return NICHO_MAP.generico;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function generateApproach(lead: ProspLead): string {
  const nome = (lead.decisorNome || lead.socio1)?.trim().split(" ")[0] || "tudo bem";
  const empresa = lead.empresa || "sua empresa";
  const m = lead.maturidade;
  const ni = resolveNicho(lead.nicho);

  const presentes: string[] = [];
  const faltando: string[] = [];
  ([["site", lead.site], ["Instagram", lead.instagram], ["LinkedIn", lead.linkedin], ["YouTube", lead.youtube]] as [string, string][])
    .forEach(([lbl, v]) => (v ? presentes : faltando).push(lbl));

  const obs = presentes.length
    ? `dei uma olhada ${presentes.length > 1 ? "nos canais" : "no"} ${presentes.join(", ")} de vocês`
    : `pesquisei sobre a ${empresa}`;
  const gap = faltando.length
    ? ` e vi que dá pra explorar bem mais ${faltando.length > 2 ? "a presença digital de vocês" : faltando.join(" e ")} pra atrair mais cliente`
    : ", e dá pra tirar muito mais resultado do que já existe";

  const dor = ni.dores[m <= 2 ? 0 : m === 3 ? 1 : 2];

  return [
    `Oi ${nome}, tudo certo? Aqui é da V4 Company — assessoria de marketing e vendas por performance.`,
    ``,
    `Atuo bastante com ${ni.label}, ${obs}${lead.cidade ? ` aí de ${lead.cidade}` : ""}${gap}.`,
    ``,
    `O que mais aparece em ${ni.label} nesse momento é a necessidade de ${dor}. ${cap(ni.prova)} — sempre com meta e ROI acordados antes de começar.`,
    ``,
    `Faz sentido a gente marcar uma *Consultoria Gratuita com um Especialista* (uns 30 min)? Te trago, com base no que já mapeei da ${empresa}, os 2–3 pontos com maior potencial de retorno pra vocês — sem compromisso. Consigo ${diaSugestao()}, ou prefere outro horário?`,
  ].join("\n");
}
function diaSugestao(): string { return "amanhã de manhã"; }

// ---------------- export CSV (Kommo / 3C Plus) ----------------
export function toCSV(leads: ProspLead[]): string {
  const cols = [
    ["empresa", "NOME EMPRESA"], ["cnpj", "CNPJ"], ["socio1", "NOME SOCIO 1"], ["socio2", "NOME SOCIO 2"],
    ["whatsapp1", "CELULAR/WHATSAPP 1"], ["whatsapp2", "CELULAR/WHATSAPP 2"], ["email", "EMAIL"],
    ["site", "SITE EMPRESA"], ["cidade", "CIDADE"], ["estado", "ESTADO"],
    ["instagram", "LINK INSTAGRAM"], ["facebook", "LINK FACEBOOK"], ["linkedin", "LINK LINKEDIN"], ["youtube", "LINK YOUTUBE"],
    ["decisorNome", "DECISOR"], ["decisorCargo", "CARGO"], ["decisorTel", "TEL DECISOR"], ["decisorEmail", "EMAIL DECISOR"],
    ["bdr", "BDR/DONO"], ["nicho", "NICHO"], ["origem", "ORIGEM LISTA"], ["maturidadeNivel", "MATURIDADE"],
    ["status", "STATUS"], ["motivoPerda", "MOTIVO PERDA"], ["dataReuniao", "DATA REUNIAO"], ["closerNome", "CLOSER"], ["canal", "CANAL"],
  ] as [keyof ProspLead, string][];
  const esc = (v: any) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = cols.map((c) => c[1]).join(";");
  const rows = leads.map((l) => cols.map((c) => c[0] === "status" ? esc(STATUS_LABELS[l.status]) : esc(l[c[0]])).join(";"));
  return [head, ...rows].join("\n");
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
