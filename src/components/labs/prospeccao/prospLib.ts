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
  bdr: string | null;
  maturidade: number; // 0 = não avaliado; 1..5
  abordagem: string;
  status: "novo" | "investigando" | "abordado" | "reuniao" | "descartado";
  notas: string;
  batch: string; // rótulo do lote de upload
  createdAt: string;
}

export const LEMIT_COLUNAS = [
  "NOME EMPRESA", "NOME SOCIO 1", "NOME SOCIO 2", "CELULAR/WHATSAPP 1", "CELULAR/WHATSAPP 2",
  "EMAIL", "SITE EMPRESA", "CIDADE", "ESTADO", "LINK INSTAGRAM", "LINK FACEBOOK", "LINK LINKEDIN", "LINK YOUTUBE",
];

export const STATUS_LABELS: Record<ProspLead["status"], string> = {
  novo: "Novo", investigando: "Investigando", abordado: "Abordado", reuniao: "Reunião", descartado: "Descartado",
};

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
export async function parseFile(file: File, batch: string): Promise<ParseResult> {
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
    leads.push({
      id: `${batch}-${r}-${Math.abs(hashStr(empresa + get(row, "email") + r))}`,
      empresa, socio1: get(row, "socio1"), socio2: get(row, "socio2"),
      whatsapp1: get(row, "whatsapp1"), whatsapp2: get(row, "whatsapp2"),
      email: get(row, "email"), site: get(row, "site"),
      cidade: get(row, "cidade"), estado: get(row, "estado"),
      instagram: get(row, "instagram"), facebook: get(row, "facebook"),
      linkedin: get(row, "linkedin"), youtube: get(row, "youtube"),
      bdr: null, maturidade: 0, abordagem: "", status: "novo", notas: "", batch, createdAt: new Date().toISOString(),
    });
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
export function whatsappLink(phone: string): string {
  const d = onlyDigits(phone);
  const full = d.length >= 11 && !d.startsWith("55") ? `55${d}` : d;
  return `https://wa.me/${full}`;
}

// ---------------- persistência (localStorage) ----------------
const KEY = "v4_prospeccao_leads_v1";
export function loadLeads(): ProspLead[] {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as ProspLead[]) : []; } catch { return []; }
}
export function saveLeads(leads: ProspLead[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(leads)); } catch { /* quota */ }
}

// ---------------- distribuição entre BDRs ----------------
export function distribute(leads: ProspLead[], bdrs: string[]): ProspLead[] {
  if (!bdrs.length) return leads;
  return leads.map((l, i) => (l.bdr ? l : { ...l, bdr: bdrs[i % bdrs.length] }));
}

// ---------------- gerador de abordagem (regras; trocável por LLM) ----------------
export function generateApproach(lead: ProspLead): string {
  const nome = lead.socio1?.split(" ")[0] || "tudo bem";
  const empresa = lead.empresa || "sua empresa";
  const m = lead.maturidade;
  const canais: string[] = [];
  if (lead.instagram) canais.push("Instagram");
  if (lead.site) canais.push("site");
  if (lead.linkedin) canais.push("LinkedIn");
  const temPresenca = canais.length ? `Vi a presença de vocês no ${canais.join(" e ")}` : "Dei uma pesquisada sobre a empresa";

  let diagnostico: string, gancho: string;
  if (m <= 2 && m > 0) {
    diagnostico = "percebi que ainda há bastante espaço pra estruturar a aquisição de clientes de forma previsível (tráfego, funil e conversão)";
    gancho = "montar uma base sólida de geração de demanda que traga leads qualificados todo mês";
  } else if (m === 3) {
    diagnostico = "notei que já existe uma operação rodando, mas com pontos claros de otimização em conversão e mensuração de resultado";
    gancho = "destravar o próximo nível de crescimento profissionalizando o que já existe";
  } else if (m >= 4) {
    diagnostico = "vi uma operação madura — o foco aqui seria escala, eficiência de investimento (ROI) e canais novos";
    gancho = "escalar com previsibilidade e reduzir o custo de aquisição";
  } else {
    diagnostico = "queria entender melhor o momento de vocês em marketing e vendas";
    gancho = "identificar as maiores oportunidades de crescimento pro momento atual";
  }

  return [
    `Olá ${nome}, tudo bem? Aqui é da V4 Company (assessoria de marketing e vendas por performance).`,
    ``,
    `${temPresenca} da ${empresa}${lead.cidade ? ` aí em ${lead.cidade}` : ""} e ${diagnostico}.`,
    ``,
    `Trabalhamos com ${empresa.length ? "empresas como a de vocês" : "empresas"} justamente pra ${gancho} — sempre com metas e ROI acordados.`,
    ``,
    `Faz sentido marcarmos uma *Reunião de Consultoria Gratuita com um Especialista*? São ~30 min onde te mostro, com base no que já mapeei, onde estão as maiores oportunidades — sem compromisso. Tenho ${diaSugestao()} ou prefere outro horário?`,
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
    ["bdr", "BDR"], ["maturidade", "MATURIDADE"], ["status", "STATUS"],
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
