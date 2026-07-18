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
  updatedAt?: string;
  // ---- enriquecimento (Lemit) feito já no upload da Prospecção ----
  cnpj?: string;
  decisorNome?: string; decisorCargo?: string; decisorTel?: string; decisorEmail?: string; decisorLinkedin?: string;
  telefonesExtra?: TelefoneExtra[];   // telefones/WhatsApp adicionais (unificados + Lemit)
  emailsExtra?: string[];
  sociosExtra?: SocioExtra[];         // sócios da MESMA empresa unificados + quadro societário
  empresaInfo?: EmpresaInfo;
  enriquecidoEm?: string;
  linhasUnificadas?: number;          // quantas linhas da lista viraram este card
  enviadoHub?: boolean;               // já revisado e enviado pro Hub Outbound?
  nomeFonte?: "lista" | "site" | "email" | "cnpj" | "pessoa"; // de onde veio o nome da empresa
  nomeSuspeito?: boolean;             // nome ainda parece de pessoa (verificar antes de enviar)
}

export interface TelefoneExtra { numero: string; tipo: string; }
export interface SocioExtra { nome: string; cargo?: string; telefone?: string; participacao?: string; }
export interface EmpresaInfo {
  porte?: string; naturezaJuridica?: string; atividade?: string; cnae?: string;
  capitalSocial?: string; dataAbertura?: string; situacao?: string;
  funcionariosEstimado?: string; faturamentoEstimado?: string;
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
  "Mercado Imobiliário / Incorporadoras", "SaaS / Tecnologia", "Energia", "Academias / Esportes",
  "Varejo / E-commerce", "Serviços B2B", "Saúde / Clínicas", "Educação", "Indústria",
  "Alimentação / Food Service", "Automotivo", "Outro",
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

// ==================================================================
// UNIFICAÇÃO DE SÓCIOS (mesma empresa) + ENRIQUECIMENTO (Lemit) + DIVISÃO
// ==================================================================

// chave de empresa: CNPJ (se houver) senão nome normalizado + cidade/uf
const companyKey = (l: ProspLead) => {
  const cnpj = onlyDigits(l.cnpj || "");
  if (cnpj.length >= 11) return "cnpj:" + cnpj;
  return "nome:" + norm(l.empresa) + "|" + norm(l.cidade) + norm(l.estado);
};

/**
 * Unifica linhas da MESMA empresa num único card: mantém a linha mais completa e
 * agrega os demais sócios (com telefone), telefones e e-mails como "extras".
 * Não cria vários cards da mesma empresa.
 */
export function dedupeByCompany(leads: ProspLead[]): ProspLead[] {
  const groups = new Map<string, ProspLead[]>();
  for (const l of leads) { const k = companyKey(l); const g = groups.get(k); if (g) g.push(l); else groups.set(k, [l]); }
  const out: ProspLead[] = [];
  for (const g of groups.values()) {
    // base = a linha com mais preenchimento (telefone/email/site)
    const score = (l: ProspLead) => (l.whatsapp1 ? 2 : 0) + (l.whatsapp2 ? 1 : 0) + (l.email ? 1 : 0) + (l.site ? 1 : 0) + (l.socio1 ? 1 : 0);
    const base = [...g].sort((a, b) => score(b) - score(a))[0];
    const sociosExtra: SocioExtra[] = [];
    const telefonesExtra: TelefoneExtra[] = [];
    const emailsExtra: string[] = [];
    const telsBase = new Set([base.whatsapp1, base.whatsapp2].map(onlyDigits).filter(Boolean));
    const nomesBase = new Set([base.socio1, base.socio2].filter(Boolean));
    const mailsBase = new Set([base.email].filter(Boolean));
    for (const l of g) {
      if (l === base) continue;
      // sócios das outras linhas → viram sócios do card (com o telefone daquela linha)
      [[l.socio1, l.whatsapp1], [l.socio2, l.whatsapp2]].forEach(([nome, tel]) => {
        if (nome && !nomesBase.has(nome) && !sociosExtra.some((s) => s.nome === nome)) {
          nomesBase.add(nome); sociosExtra.push({ nome, cargo: "Sócio(a)", telefone: tel || undefined });
        }
      });
      // telefones extras
      [l.whatsapp1, l.whatsapp2].filter(Boolean).forEach((t) => { const k = onlyDigits(t); if (k && !telsBase.has(k)) { telsBase.add(k); telefonesExtra.push({ numero: t, tipo: "Celular/WhatsApp" }); } });
      // e-mails extras
      if (l.email && !mailsBase.has(l.email)) { mailsBase.add(l.email); emailsExtra.push(l.email); }
    }
    out.push({ ...base, sociosExtra, telefonesExtra, emailsExtra, linhasUnificadas: g.length });
  }
  return out;
}

// ---- INTELIGÊNCIA de NOME DE EMPRESA ----
// Muitas listas trazem o nome de uma PESSOA na coluna da empresa (ou vêm vazias).
// Aqui a gente resolve pra um nome de EMPRESA de verdade antes de ir pro Hub.
const EMAIL_GENERICO = /@(gmail|hotmail|outlook|yahoo|icloud|bol|uol|terra|live|msn|me)\./i;
const EMPRESA_KW = /ltda|eireli|\bs\.?a\.?\b|\bme\b|epp|mei|incorpor|constru|tech|softwar|sistemas|comerci|com[eé]rcio|ind[uú]stri|servi[çc]|clinic|cl[íi]nica|academia|consultor|assessoria|associa|escola|col[eé]gio|restaurante|padaria|auto\s|autope|mercad|loja|studio|est[uú]dio|group|holding|solu[çc]|imobili|transport|log[íi]stic|contabil|advocac|engenh|distribuidora|farm[aá]ci|pet\b|odonto|estetic|est[eé]tica|energ|solar|fitness/i;
// dicionário de nomes próprios comuns (BR) + conectores → detecta nome de PESSOA
const PRIMEIROS_NOMES = new Set(["joao", "joão", "jose", "josé", "maria", "ana", "antonio", "antônio", "francisco", "carlos", "paulo", "pedro", "lucas", "luiz", "luis", "marcos", "marcelo", "rafael", "marcio", "márcio", "bruno", "eduardo", "felipe", "rodrigo", "gustavo", "gabriel", "guilherme", "ricardo", "fernando", "fabio", "fábio", "alexandre", "leonardo", "andre", "andré", "sergio", "sérgio", "roberto", "jorge", "mateus", "matheus", "thiago", "tiago", "vinicius", "vinícius", "diego", "leandro", "william", "wesley", "wagner", "renato", "rogerio", "rogério", "claudio", "cláudio", "julio", "júlio", "cesar", "césar", "henrique", "igor", "ivan", "junior", "júnior", "otavio", "otávio", "vitor", "victor", "caio", "davi", "david", "samuel", "arthur", "artur", "bernardo", "murilo", "miguel", "heitor", "hugo", "erick", "edric", "juliana", "patricia", "patrícia", "fernanda", "aline", "amanda", "bruna", "camila", "carla", "carolina", "cristiane", "daniela", "debora", "débora", "elaine", "fabiana", "gabriela", "isabela", "jessica", "jéssica", "larissa", "lary", "leticia", "letícia", "luana", "lucia", "lúcia", "luiza", "mariana", "michele", "monica", "mônica", "natalia", "natália", "paula", "priscila", "rafaela", "renata", "roberta", "sabrina", "sandra", "simone", "tatiane", "vanessa", "vitoria", "vitória", "beatriz", "bianca", "elisa", "rita", "sonia", "sônia", "angela", "ângela", "adriana", "andrea", "andréa", "viviane", "rocha", "souza", "silva"]);
const CONECTORES = new Set(["da", "de", "do", "dos", "das", "e"]);
/** o texto parece nome de PESSOA (e não de empresa)? */
function pareceNomePessoa(nome: string, lead: ProspLead): boolean {
  const n = (nome || "").trim();
  if (!n) return true;
  if (EMPRESA_KW.test(n)) return false;                       // tem marca de empresa → é empresa
  if (/[0-9&@/]/.test(n)) return false;                        // dígitos/& → empresa
  const socios = [lead.socio1, lead.socio2, lead.decisorNome].filter(Boolean).map((s) => s.toLowerCase().trim());
  if (socios.includes(n.toLowerCase())) return true;          // igual a um sócio → é pessoa
  const tokens = n.toLowerCase().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;   // 1 palavra ou muito longo → trata como empresa
  if (PRIMEIROS_NOMES.has(tokens[0])) return true;            // começa com nome próprio comum
  if (tokens.some((t) => CONECTORES.has(t))) return true;     // "Fulano da Silva"
  // 2 palavras, ambas "nome-like" e nenhuma é palavra de empresa → provável pessoa
  return false;
}
/** deixa "paoquente.com.br"/"contato@techvale.com" → "Paoquente" / "Techvale" */
function nomeDeDominio(url: string): string {
  const d = String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#@]/).pop() || "";
  const host = d.includes("@") ? d.split("@")[1] : d;
  const root = (host.split(".")[0] || "").trim();
  if (!root) return "";
  return root.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/**
 * Resolve o nome da empresa — NUNCA deixa nome de pessoa na empresa.
 * Ordem: nome válido da lista → domínio do site → domínio do e-mail (não genérico)
 * → consulta CNPJ (protótipo: razão social simulada por ramo+cidade; produção: API
 * por CNPJ) → placeholder "(verificar)". Devolve `pessoa` = o nome de pessoa que
 * estava indevidamente na empresa, pra virar sócio.
 */
export function resolveCompanyName(lead: ProspLead): { nome: string; fonte: NonNullable<ProspLead["nomeFonte"]>; suspeito: boolean; pessoa?: string } {
  const atual = (lead.empresa || "").trim();
  const eraPessoa = pareceNomePessoa(atual, lead);
  if (atual && !eraPessoa) return { nome: atual, fonte: "lista", suspeito: false };
  const pessoa = atual && eraPessoa ? atual : undefined; // nome de pessoa que estava na empresa
  // 1) domínio do site
  const bySite = lead.site ? nomeDeDominio(lead.site) : "";
  if (bySite) return { nome: bySite, fonte: "site", suspeito: false, pessoa };
  // 2) domínio do e-mail (não genérico)
  if (lead.email && !EMAIL_GENERICO.test(lead.email)) {
    const byMail = nomeDeDominio(lead.email);
    if (byMail) return { nome: byMail, fonte: "email", suspeito: false, pessoa };
  }
  // 3) CNPJ → razão social (PROTÓTIPO por ramo+cidade; produção: API ReceitaWS/CNPJ.ws por CNPJ)
  if (onlyDigits(lead.cnpj || "").length >= 11) {
    return { nome: razaoSocialSimulada(lead), fonte: "cnpj", suspeito: false, pessoa };
  }
  // 4) não deu — placeholder de empresa (NUNCA nome de pessoa) + sinaliza
  const ramo = (RAMO_POR_NICHO.find(([re]) => re.test((lead.nicho || "").toLowerCase())) || [null, "Empresa"])[1];
  const loc = (lead.cidade || "").trim();
  return { nome: `${ramo}${loc ? ` ${loc}` : ""} (verificar)`, fonte: "pessoa", suspeito: true, pessoa };
}
const RAMO_POR_NICHO: [RegExp, string][] = [
  [/saas|tecnolog|software|tech|app/, "Tecnologia"], [/energ|solar|fotovolt|renov/, "Energia Solar"],
  [/academ|esporte|fitness/, "Fitness"], [/imob|incorpor|constru/, "Incorporadora"],
  [/saud|saúde|beleza|clinic|clínic|estetic|estétic|odont/, "Saúde"], [/varej|commerce|loja|ecom/, "Comércio"],
];
function razaoSocialSimulada(lead: ProspLead): string {
  const cidade = (lead.cidade || "").trim();
  const ramo = (RAMO_POR_NICHO.find(([re]) => re.test((lead.nicho || "").toLowerCase())) || [null, "Serviços"])[1];
  return cidade ? `${ramo} ${cidade}` : `${ramo} Vale do Paraíba`;
}
/** Aplica a resolução de nome no lead: empresa vira nome de EMPRESA e a pessoa
 * que estava na empresa é movida pros sócios. Idempotente (roda no upload e no envio). */
export function fixCompanyName(lead: ProspLead): ProspLead {
  const r = resolveCompanyName(lead);
  if (r.fonte === "lista") return lead;
  let sociosExtra = lead.sociosExtra || [];
  if (r.pessoa) {
    const jaTem = [lead.socio1, lead.socio2, lead.decisorNome, ...sociosExtra.map((s) => s.nome)].filter(Boolean).map((x) => x.toLowerCase());
    if (!jaTem.includes(r.pessoa.toLowerCase())) sociosExtra = [{ nome: r.pessoa, cargo: "Sócio(a)" }, ...sociosExtra];
  }
  return { ...lead, empresa: r.nome, sociosExtra, nomeFonte: r.fonte, nomeSuspeito: r.suspeito, decisorNome: lead.decisorNome || lead.socio1 || r.pessoa || "" };
}

// ---- enriquecimento (Lemit) — determinístico (protótipo). Produção: API por CNPJ. ----
const P_PORTES = ["MEI", "ME (Microempresa)", "EPP (Pequeno Porte)", "Média Empresa", "Grande Empresa"];
const P_SIT = ["Ativa", "Ativa", "Ativa", "Ativa", "Suspensa"];
const P_NAT = ["Sociedade Empresária Limitada (LTDA)", "Empresário Individual (EI)", "Sociedade Anônima (S.A.)", "Sociedade Limitada Unipessoal (SLU)"];
const P_CNAE: { re: RegExp; atividade: string; cnae: string }[] = [
  { re: /saas|tecnolog|software|tech|app/, atividade: "Desenvolvimento de software sob encomenda", cnae: "6201-5/01" },
  { re: /energ|solar|fotovolt|renov/, atividade: "Geração/comércio de energia (solar fotovoltaica)", cnae: "3511-5/01" },
  { re: /academ|esporte|fitness|cross|pilates|estudio|estúdio/, atividade: "Atividades de condicionamento físico", cnae: "9313-1/00" },
  { re: /imob|incorpor|constru/, atividade: "Incorporação de empreendimentos imobiliários", cnae: "4110-7/00" },
  { re: /saud|saúde|beleza|clinic|clínic|estetic|estétic|odont/, atividade: "Atividades de atenção à saúde / estética", cnae: "8630-5/03" },
  { re: /varej|commerce|loja|ecom/, atividade: "Comércio varejista", cnae: "4712-1/00" },
  { re: /b2b|servi/, atividade: "Consultoria em gestão empresarial", cnae: "7020-4/00" },
];
const P_NOMES = ["Ricardo", "Fernanda", "Marcelo", "Patrícia", "André", "Juliana", "Roberto", "Camila", "Eduardo", "Beatriz"];
const P_SOBR = ["Menezes", "Tavares", "Barbosa", "Cardoso", "Moreira", "Nogueira", "Pires", "Ramos"];
const pRng = (seed: number) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pDDD = (l: ProspLead) => { const d = onlyDigits(l.whatsapp1 || l.whatsapp2 || ""); const s = d.startsWith("55") ? d.slice(2) : d; return s.length >= 10 ? s.slice(0, 2) : "12"; };
const pCel = (ddd: string, r: () => number) => { let n = "9"; for (let i = 0; i < 8; i++) n += Math.floor(r() * 10); return `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`; };
const pFixo = (ddd: string, r: () => number) => { let n = String(2 + Math.floor(r() * 3)); for (let i = 0; i < 7; i++) n += Math.floor(r() * 10); return `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`; };
const pCNPJ = (r: () => number) => { let s = ""; for (let i = 0; i < 14; i++) s += Math.floor(r() * 10); return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`; };

/** Enriquece 1 lead (dados cadastrais + telefones + quadro societário + decisor 100%). Mescla com os extras já unificados. */
export function enrichProsp(lead: ProspLead): ProspLead {
  const seed = Math.abs(hashStr(lead.empresa + (lead.cnpj || "") + lead.id + lead.cidade));
  const r = pRng(seed);
  const ddd = pDDD(lead);
  const jaTel = new Set([lead.whatsapp1, lead.whatsapp2, ...(lead.telefonesExtra || []).map((t) => t.numero)].map(onlyDigits).filter(Boolean));
  const tels: TelefoneExtra[] = [...(lead.telefonesExtra || [])];
  const addTel = (numero: string, tipo: string) => { const k = onlyDigits(numero); if (k && !jaTel.has(k)) { jaTel.add(k); tels.push({ numero, tipo }); } };
  addTel(pCel(ddd, r), "Celular/WhatsApp"); addTel(pFixo(ddd, r), "Fixo comercial"); if (r() > 0.5) addTel(pCel(ddd, r), "Recado (recepção)");
  if (tels.length === 0) addTel(pCel(ddd, r), "Celular/WhatsApp");

  const genNome = () => `${P_NOMES[Math.floor(r() * P_NOMES.length)]} ${P_SOBR[Math.floor(r() * P_SOBR.length)]}`;
  const socios: SocioExtra[] = [...(lead.sociosExtra || [])];
  const nomes = new Set([lead.socio1, lead.socio2, ...socios.map((s) => s.nome)].filter(Boolean));
  // dá participação/cargo a quem veio da unificação sem isso
  socios.forEach((s) => { if (!s.participacao) s.participacao = `${10 + Math.floor(r() * 60)}%`; if (!s.telefone) s.telefone = pCel(ddd, r); });
  const nExtra = 1 + Math.floor(r() * 2);
  for (let i = 0; i < nExtra; i++) { const nome = genNome(); if (nomes.has(nome)) continue; nomes.add(nome); socios.push({ nome, cargo: "Sócio-administrador", telefone: pCel(ddd, r), participacao: `${10 + Math.floor(r() * 60)}%` }); }
  if (socios.length === 0) socios.push({ nome: genNome(), cargo: "Sócio-administrador", telefone: pCel(ddd, r), participacao: `${30 + Math.floor(r() * 50)}%` });

  const cn = P_CNAE.find((c) => c.re.test((lead.nicho || "").toLowerCase()));
  const ano = 1998 + Math.floor(r() * 25);
  const empresaInfo: EmpresaInfo = {
    porte: P_PORTES[Math.floor(r() * P_PORTES.length)], naturezaJuridica: P_NAT[Math.floor(r() * P_NAT.length)],
    atividade: cn?.atividade || "Atividades empresariais", cnae: cn?.cnae || "8299-7/99",
    capitalSocial: `R$ ${(10 + Math.floor(r() * 490)).toLocaleString("pt-BR")}.000,00`,
    dataAbertura: `${String(1 + Math.floor(r() * 28)).padStart(2, "0")}/${String(1 + Math.floor(r() * 12)).padStart(2, "0")}/${ano}`,
    situacao: P_SIT[Math.floor(r() * P_SIT.length)],
    funcionariosEstimado: ["1–5", "6–10", "11–25", "26–50", "51–100", "100+"][Math.floor(r() * 6)],
    faturamentoEstimado: ["até R$ 360 mil/ano", "R$ 360 mil – R$ 1 mi", "R$ 1 mi – R$ 5 mi", "R$ 5 mi – R$ 20 mi", "R$ 20 mi+"][Math.floor(r() * 5)],
  };

  const dominio = `${(lead.empresa || "empresa").toLowerCase().normalize("NFD").replace(DIACRITICS, "").replace(/[^a-z0-9]/g, "").slice(0, 16) || "empresa"}.com.br`;
  const top = [...socios].sort((a, b) => parseInt(b.participacao || "0") - parseInt(a.participacao || "0"))[0];
  const decisorNome = lead.decisorNome || lead.socio1 || top?.nome || genNome();
  const firstName = (decisorNome.split(" ")[0] || "contato").toLowerCase().normalize("NFD").replace(DIACRITICS, "").replace(/[^a-z]/g, "") || "contato";
  const decisorCargo = lead.decisorCargo || (lead.socio1 ? "Sócio(a)" : top?.cargo) || "Sócio-administrador";
  const decisorTel = lead.decisorTel || lead.whatsapp1 || top?.telefone || tels[0]?.numero || pCel(ddd, r);
  const decisorEmail = lead.decisorEmail || lead.email || `${firstName}@${dominio}`;

  return {
    ...lead, cnpj: lead.cnpj || pCNPJ(r), telefonesExtra: tels, sociosExtra: socios,
    emailsExtra: lead.emailsExtra && lead.emailsExtra.length ? lead.emailsExtra : [`comercial@${dominio}`],
    empresaInfo, decisorNome, decisorCargo, decisorTel, decisorEmail, decisorLinkedin: lead.decisorLinkedin || "",
    enriquecidoEm: new Date().toISOString(),
  };
}

/** Todos os telefones do lead, sem repetir (decisor + principais + extras + sócios). */
export function allPhonesProsp(lead: ProspLead): { numero: string; tipo: string }[] {
  const out: { numero: string; tipo: string }[] = []; const seen = new Set<string>();
  const push = (numero: string | undefined, tipo: string) => { if (!numero) return; const k = onlyDigits(numero); if (!seen.has(k)) { seen.add(k); out.push({ numero, tipo }); } };
  push(lead.decisorTel, "Decisor"); push(lead.whatsapp1, "WhatsApp 1"); push(lead.whatsapp2, "WhatsApp 2");
  (lead.telefonesExtra || []).forEach((t) => push(t.numero, t.tipo));
  (lead.sociosExtra || []).forEach((s) => push(s.telefone, `Sócio: ${s.nome.split(" ")[0]}`));
  return out;
}

/** Divisão QUALIFICADA: ordena por maturidade e distribui round-robin, pra cada dono receber um mix equilibrado de bons/ruins. */
export function distributeQualified(leads: ProspLead[], owners: string[]): ProspLead[] {
  if (!owners.length) return leads;
  const ordenados = [...leads].sort((a, b) => (b.maturidade || 0) - (a.maturidade || 0));
  const byId = new Map<string, string>();
  ordenados.forEach((l, i) => byId.set(l.id, owners[i % owners.length]));
  return leads.map((l) => ({ ...l, bdr: byId.get(l.id) || l.bdr }));
}

export type ReqCampo = "empresa" | "telefone" | "email" | "socio";
/**
 * Incompleto = campo em branco NA LISTA ORIGINAL (não conta o que o Lemit
 * fabricou no enriquecimento). Assim a limpeza remove empresas cujos DADOS DE
 * ORIGEM vieram vazios, que é o que o usuário quer avaliar.
 */
export function isIncompleto(lead: ProspLead, reqs: ReqCampo[]): boolean {
  return reqs.some((rq) => {
    if (rq === "empresa") return !lead.empresa?.trim();
    if (rq === "telefone") return !lead.whatsapp1?.trim() && !lead.whatsapp2?.trim();
    if (rq === "email") return !lead.email?.trim();
    if (rq === "socio") return !lead.socio1?.trim() && !lead.socio2?.trim();
    return false;
  });
}
