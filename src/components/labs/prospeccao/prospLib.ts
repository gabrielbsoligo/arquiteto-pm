/**
 * prospLib — núcleo do Hub de Prospecção Outbound (V4).
 *
 * Tudo client-side (o clone Labs é read-only): parsing de CSV/XLS (lib xlsx),
 * mapeamento das colunas do Lemit, derivação de links, persistência em
 * localStorage (nada se perde no navegador), gerador de abordagem por regras
 * e exportação CSV (Kommo / 3C Plus).
 *
 * PRODUÇÃO: trocar o store de localStorage por uma tabela Supabase
 * `prospeccao_leads` (schema no README/entrega) e o gerador de abordagem por
 * uma chamada OpenAI/Claude — a interface (ProspLead / generateApproach) já
 * está pronta pra isso.
 */
import * as XLSX from "xlsx";

export interface ProspLead {
  id: string;
  empresa: string;
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
  // operacional
  bdr: string | null;   // dono/responsável da lista
  nicho: string;        // nicho da lista (ex.: "Mercado Imobiliário / Incorporadoras")
  maturidade: number;   // 1..5 — presença digital (proxy automático)
  abordagem: string;
  status: "novo" | "abordando" | "conexao" | "agendado" | "realizado" | "fechado";
  // agendamento (preenchido quando status = agendado)
  dataReuniao?: string; closerId?: string; closerNome?: string; canal?: string;
  notas: string;
  batch: string;        // rótulo do lote de upload
  createdAt: string;
}

export const LEMIT_COLUNAS = [
  "NOME EMPRESA", "NOME SOCIO 1", "NOME SOCIO 2", "CELULAR/WHATSAPP 1", "CELULAR/WHATSAPP 2",
  "EMAIL", "SITE EMPRESA", "CIDADE", "ESTADO", "LINK INSTAGRAM", "LINK FACEBOOK", "LINK LINKEDIN", "LINK YOUTUBE",
];

export const STATUS_LABELS: Record<ProspLead["status"], string> = {
  novo: "A abordar", abordando: "Abordando", conexao: "Conexão", agendado: "Agendado", realizado: "Realizado", fechado: "Fechado",
};
export const STATUS_ORDER: ProspLead["status"][] = ["novo", "abordando", "conexao", "agendado", "realizado", "fechado"];

// Mapeamento (produção): status da Prospecção → etapa do lead na tela Leads do SalesHub.
export const LEAD_ETAPA_MAP: Record<string, string> = {
  abordando: "em_follow", conexao: "em_follow", agendado: "reuniao_marcada", realizado: "reuniao_marcada", fechado: "reuniao_realizada",
};

// Nichos-preset (o usuário pode adicionar; começa com o imobiliário).
export const NICHOS = [
  "Mercado Imobiliário / Incorporadoras", "Varejo / E-commerce", "Serviços B2B", "Saúde / Clínicas",
  "Educação", "Indústria", "Alimentação / Food Service", "Automotivo", "Outro",
];

// normaliza header: minúsculo, sem acento, sem pontuação → facilita casar variações
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS, "").replace(/[^a-z0-9]+/g, " ").trim();

// mapa de campo canônico -> lista de headers aceitos (normalizados)
const FIELD_ALIASES: Record<keyof Pick<ProspLead,
  "empresa" | "socio1" | "socio2" | "whatsapp1" | "whatsapp2" | "email" | "site" | "cidade" | "estado" | "instagram" | "facebook" | "linkedin" | "youtube">, string[]> = {
  empresa: ["nome empresa", "empresa", "razao social", "nome fantasia"],
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
export async function parseFile(file: File, batch: string, nicho = "", owner: string | null = null): Promise<ParseResult> {
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
  const leads: ProspLead[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const empresa = get(row, "empresa");
    if (!empresa && !get(row, "email") && !get(row, "whatsapp1")) continue; // linha vazia
    const lead: ProspLead = {
      id: `${batch}-${r}-${Math.abs(hashStr(empresa + get(row, "email") + r))}`,
      empresa, socio1: get(row, "socio1"), socio2: get(row, "socio2"),
      whatsapp1: get(row, "whatsapp1"), whatsapp2: get(row, "whatsapp2"),
      email: get(row, "email"), site: get(row, "site"),
      cidade: get(row, "cidade"), estado: get(row, "estado"),
      instagram: get(row, "instagram"), facebook: get(row, "facebook"),
      linkedin: get(row, "linkedin"), youtube: get(row, "youtube"),
      bdr: owner, nicho, maturidade: 0, abordagem: "", status: "novo", notas: "", batch, createdAt: new Date().toISOString(),
    };
    lead.maturidade = autoMaturidade(lead); // nota automática inicial (norte de prioridade)
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
// Sinal = presença digital nos canais. Pesos: site e canais "profissionais"
// (LinkedIn/YouTube) pesam mais; Facebook menos. Serve de NORTE de prioridade
// (quanto mais madura digitalmente, mais investe/valoriza marketing). Editável pelo BDR.
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

/** Devolve o link do canal; se vazio, um link de BUSCA (Google) pra o BDR achar rápido. */
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
/** Link click-to-call API4COM (protocolo) a partir do número. */
export function callLink(phone: string): string {
  const d = onlyDigits(phone);
  const full = d.length >= 11 && !d.startsWith("55") ? `55${d}` : d;
  return `api4com://${full}`;
}
/** Link `tel:` (abre o discador/softphone padrão — funciona sem depender do protocolo do app). */
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
const KEY = "v4_prospeccao_leads_v1";
const VALID_STATUS = new Set(["novo", "abordando", "conexao", "agendado", "realizado", "fechado"]);
const STATUS_MIGRA: Record<string, ProspLead["status"]> = { investigando: "abordando", abordado: "abordando", reuniao: "agendado", descartado: "novo" };
export function loadLeads(): ProspLead[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as ProspLead[]) : [];
    // backfill de leads antigos: nicho ausente, status legado e nota zerada
    return arr.map((l) => ({
      ...l,
      nicho: l.nicho || "Mercado Imobiliário / Incorporadoras",
      abordagem: l.abordagem || "",
      notas: l.notas || "",
      status: VALID_STATUS.has(l.status) ? l.status : (STATUS_MIGRA[l.status as string] || "novo"),
      maturidade: l.maturidade && l.maturidade > 0 ? l.maturidade : autoMaturidade(l),
    }));
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

// ---------------- gerador de abordagem (regras por nicho + gaps; trocável por LLM) ----------------
interface NichoInfo { label: string; dores: [string, string, string]; prova: string }
const NICHO_MAP: Record<string, NichoInfo> = {
  imobiliario: {
    label: "incorporadoras e mercado imobiliário",
    dores: [
      "estruturar a geração de leads qualificados pros lançamentos e reduzir o custo por lead",
      "acelerar a velocidade de vendas e girar o estoque de unidades com um funil previsível",
      "escalar a captação com eficiência de mídia (ROI) e autoridade de marca pro comprador de alto ticket",
    ],
    prova: "temos cases de incorporadoras que encheram o funil de compradores qualificados e aceleraram a venda de estoque",
  },
  varejo: {
    label: "varejo e e-commerce",
    dores: ["estruturar tráfego e recuperação de carrinho pra vender todo dia", "aumentar a recorrência e o ticket médio com CRM e retenção", "escalar as vendas online com ROI positivo e previsível"],
    prova: "ajudamos varejos a escalar vendas online com ROI positivo",
  },
  saude: {
    label: "clínicas e saúde",
    dores: ["encher a agenda com pacientes qualificados da região", "reduzir no-show e aumentar recompra/retorno", "construir autoridade e prova social que gerem confiança"],
    prova: "temos clínicas que lotaram a agenda com pacientes da região",
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
  if (/imob|incorpor|constru/.test(n)) return NICHO_MAP.imobiliario;
  if (/varej|commerce|loja|ecom/.test(n)) return NICHO_MAP.varejo;
  if (/saud|saúde|clinic|clínic|odont|estetic/.test(n)) return NICHO_MAP.saude;
  if (/b2b|servi/.test(n)) return NICHO_MAP.servicos;
  return NICHO_MAP.generico;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function generateApproach(lead: ProspLead): string {
  const nome = lead.socio1?.trim().split(" ")[0] || "tudo bem";
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

  // dor puxa pela maturidade: baixa=fundação, média=otimização, alta=escala
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
    ["empresa", "NOME EMPRESA"], ["socio1", "NOME SOCIO 1"], ["socio2", "NOME SOCIO 2"],
    ["whatsapp1", "CELULAR/WHATSAPP 1"], ["whatsapp2", "CELULAR/WHATSAPP 2"], ["email", "EMAIL"],
    ["site", "SITE EMPRESA"], ["cidade", "CIDADE"], ["estado", "ESTADO"],
    ["instagram", "LINK INSTAGRAM"], ["facebook", "LINK FACEBOOK"], ["linkedin", "LINK LINKEDIN"], ["youtube", "LINK YOUTUBE"],
    ["bdr", "BDR/DONO"], ["nicho", "NICHO"], ["maturidade", "MATURIDADE"], ["status", "STATUS"],
    ["dataReuniao", "DATA REUNIAO"], ["closerNome", "CLOSER"], ["canal", "CANAL"],
  ] as [keyof ProspLead, string][];
  const esc = (v: any) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = cols.map((c) => c[1]).join(";");
  const rows = leads.map((l) => cols.map((c) => esc(l[c[0]])).join(";"));
  return [head, ...rows].join("\n");
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
