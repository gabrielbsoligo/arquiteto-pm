import React, { useMemo, useRef, useState } from "react";
import {
  Upload, Download, Phone, MessageCircle, Star, Globe, Instagram, Facebook, Linkedin, Youtube,
  MapPin, Search, Sparkles, X, Building2, Copy, Check, ClipboardList, Users, Trash2,
} from "lucide-react";
import {
  parseFile, distribute, loadLeads, saveLeads, channelLink, callLink, whatsappLink,
  generateApproach, toCSV, downloadCSV, STATUS_LABELS, maturidadeMotivo, type ProspLead,
} from "./prospeccao/prospLib";

/**
 * ProspeccaoHub — Hub de Prospecção Outbound (V4). Protótipo no clone Labs.
 * Sobe listas do Lemit (CSV/XLS), distribui entre BDRs, investiga (links + IA),
 * pontua maturidade e exporta pra Kommo/3C. Persiste em localStorage (read-only-safe).
 * Tema dark do SalesHub, com acento vermelho.
 */
const RED = "var(--color-v4-red)";
const BDRS = ["Ana", "Bruno", "Carla"]; // 3 BDRs (produção: vem da tabela de usuários)

const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const CHECKLIST = [
  { icon: Globe, title: "SITE / LP", tips: "Proposta de valor · Stack tecnológico · Maturidade de conversão (CTAs) · Prova social" },
  { icon: Linkedin, title: "LINKEDIN", tips: "Decisores (C-Level) · Momento (vagas abertas) · Tamanho da operação · Notícias/marcos" },
  { icon: Instagram, title: "INSTAGRAM / FACEBOOK", tips: "Termômetro de clientes (comentários/reclamações) · Posicionamento de marca · Engajamento" },
  { icon: Youtube, title: "YOUTUBE", tips: "Maturidade do produto · Foco em educação (webinars) · Dúvidas nos comentários" },
];

export const ProspeccaoHub: React.FC = () => {
  const [leads, setLeads] = useState<ProspLead[]>(() => loadLeads());
  const [bdrFilter, setBdrFilter] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: ProspLead[]) => { setLeads(next); saveLeads(next); };
  const updateLead = (id: string, patch: Partial<ProspLead>) => persist(leads.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      let added = 0; let matched: string[] = []; let missing: string[] = [];
      let acc = [...leads];
      for (const f of Array.from(files)) {
        const batch = f.name.replace(/\.(csv|xlsx?|xls)$/i, "");
        const res = await parseFile(f, batch);
        matched = res.matched; missing = res.missing;
        const existingIds = new Set(acc.map((l) => l.id));
        const fresh = res.leads.filter((l) => !existingIds.has(l.id));
        acc = distribute([...acc, ...fresh], BDRS);
        added += fresh.length;
      }
      persist(acc);
      setBanner({ ok: true, msg: `${added} lead(s) importado(s) e distribuído(s). Colunas OK: ${matched.length}/13.${missing.length ? " Faltando: " + missing.join(", ") : ""}` });
    } catch (e: any) {
      setBanner({ ok: false, msg: "Falha ao ler o arquivo: " + (e?.message || e) });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return leads.filter((l) =>
      (bdrFilter === "todos" || l.bdr === bdrFilter) &&
      (!s || l.empresa.toLowerCase().includes(s) || l.cidade.toLowerCase().includes(s) || l.socio1.toLowerCase().includes(s)))
      .sort((a, b) => b.maturidade - a.maturidade); // prioridade: mais maduro digitalmente primeiro
  }, [leads, bdrFilter, search]);

  const countByBdr = (b: string) => leads.filter((l) => l.bdr === b).length;
  const open = openId ? leads.find((l) => l.id === openId) || null : null;

  const exportCSV = () => {
    const rows = bdrFilter === "todos" ? leads : leads.filter((l) => l.bdr === bdrFilter);
    if (!rows.length) { setBanner({ ok: false, msg: "Nada pra exportar." }); return; }
    downloadCSV(`prospeccao_${bdrFilter}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  };

  const clearAll = () => { if (confirm("Apagar TODAS as listas deste navegador?")) persist([]); };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-6 py-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center font-black text-white" style={{ background: RED }}>V4</div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">Hub de Prospecção <span style={{ color: RED }}>Outbound</span></h1>
            <p className="text-[11px] text-[var(--color-v4-text-muted)]">Suba as listas do Lemit · investigue · pontue · exporte pro Kommo/3C</p>
          </div>
        </div>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold cursor-pointer" style={{ background: RED }}>
          <Upload size={15} /> Subir lista (CSV/XLS)
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </label>
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-v4-border)] text-sm font-semibold text-white hover:bg-[var(--color-v4-card-hover)]">
          <Download size={15} /> Exportar
        </button>
        {leads.length > 0 && (
          <button onClick={clearAll} title="Limpar tudo" className="p-2 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)]"><Trash2 size={15} /></button>
        )}
      </div>

      <div className="p-6">
        {banner && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border ${banner.ok ? "bg-[var(--color-v4-surface)] text-white border-[var(--color-v4-border)]" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
            {banner.msg} <button onClick={() => setBanner(null)} className="float-right text-[var(--color-v4-text-muted)] hover:text-white"><X size={14} /></button>
          </div>
        )}

        {leads.length === 0 ? (
          <EmptyState onPick={() => fileRef.current?.click()} onFiles={handleFiles} />
        ) : (
          <>
            {/* filtros por BDR */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Users size={15} className="text-[var(--color-v4-text-muted)]" />
              <TabBtn active={bdrFilter === "todos"} onClick={() => setBdrFilter("todos")} label={`Todos (${leads.length})`} />
              {BDRS.map((b) => <TabBtn key={b} active={bdrFilter === b} onClick={() => setBdrFilter(b)} label={`${b} (${countByBdr(b)})`} />)}
              <div className="flex-1" />
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-v4-text-muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa, cidade, sócio…"
                  className="pl-8 pr-3 py-2 rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </div>
            </div>

            {/* tabela */}
            <div className={`overflow-x-auto ${card}`}>
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Cidade/UF</th><th className="px-3 py-2.5">Sócio</th>
                    <th className="px-3 py-2.5">Contato</th><th className="px-3 py-2.5">BDR</th><th className="px-3 py-2.5">Maturidade</th>
                    <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)] cursor-pointer text-white" onClick={() => setOpenId(l.id)}>
                      <td className="px-3 py-2.5 font-semibold flex items-center gap-2"><Building2 size={14} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{[l.cidade, l.estado].filter(Boolean).join("/") || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.socio1 || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.whatsapp1 || l.email || "—"}</td>
                      <td className="px-3 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">{l.bdr || "—"}</span></td>
                      <td className="px-3 py-2.5"><Stars value={l.maturidade} readOnly /></td>
                      <td className="px-3 py-2.5"><StatusPill status={l.status} /></td>
                      <td className="px-3 py-2.5 text-right"><span className="text-[11px] font-semibold" style={{ color: RED }}>Abrir →</span></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-v4-text-muted)]">Nenhum lead nesse filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--color-v4-text-muted)] mt-2">{filtered.length} lead(s) · ordenados por maturidade (prioridade ↓) · nota automática pela presença digital · salvos neste navegador</p>
          </>
        )}
      </div>

      {open && <LeadPanel lead={open} onClose={() => setOpenId(null)} onUpdate={(patch) => updateLead(open.id, patch)} />}
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${active ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)]"}`}
    style={active ? { background: RED } : undefined}>{label}</button>
);

const StatusPill: React.FC<{ status: ProspLead["status"] }> = ({ status }) => {
  const c: Record<ProspLead["status"], string> = {
    novo: "bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)]", investigando: "bg-amber-500/15 text-amber-400",
    abordado: "bg-blue-500/15 text-blue-400", reuniao: "bg-red-500/15 text-red-400", descartado: "bg-[var(--color-v4-surface)] text-[var(--color-v4-text-disabled)] line-through",
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${c[status]}`}>{STATUS_LABELS[status]}</span>;
};

const Stars: React.FC<{ value: number; onChange?: (v: number) => void; readOnly?: boolean }> = ({ value, onChange, readOnly }) => (
  <div className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} disabled={readOnly} onClick={(e) => { e.stopPropagation(); onChange?.(n); }} className={readOnly ? "" : "hover:scale-110 transition-transform"}>
        <Star size={readOnly ? 13 : 22} fill={n <= value ? "#e63946" : "none"} color={n <= value ? "#e63946" : "#4a4a4a"} />
      </button>
    ))}
  </div>
);

const EmptyState: React.FC<{ onPick: () => void; onFiles: (f: FileList | null) => void }> = ({ onPick, onFiles }) => (
  <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
    className="border-2 border-dashed border-[var(--color-v4-border)] rounded-2xl py-16 flex flex-col items-center justify-center text-center">
    <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: RED }}><Upload size={26} className="text-white" /></div>
    <h2 className="text-lg font-bold text-white">Suba a lista enriquecida do Lemit</h2>
    <p className="text-sm text-[var(--color-v4-text-muted)] max-w-md mt-1">Arraste o CSV/XLS aqui ou clique pra selecionar. As colunas devem seguir o padrão Lemit
      (NOME EMPRESA, NOME SÓCIO 1/2, CELULAR/WHATSAPP 1/2, EMAIL, SITE, CIDADE, ESTADO, LINKS…).</p>
    <button onClick={onPick} className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}>Selecionar arquivo</button>
  </div>
);

// ---------------- Painel do Lead ----------------
const LeadPanel: React.FC<{ lead: ProspLead; onClose: () => void; onUpdate: (patch: Partial<ProspLead>) => void }> = ({ lead, onClose, onUpdate }) => {
  const [copied, setCopied] = useState(false);
  const links = [
    { kind: "site", label: "Site", Icon: Globe },
    { kind: "instagram", label: "Instagram", Icon: Instagram },
    { kind: "facebook", label: "Facebook", Icon: Facebook },
    { kind: "linkedin", label: "LinkedIn", Icon: Linkedin },
    { kind: "youtube", label: "YouTube", Icon: Youtube },
    { kind: "gmb", label: "Google Meu Negócio", Icon: MapPin },
    { kind: "google", label: "Buscar no Google", Icon: Search },
  ] as const;

  const genApproach = () => onUpdate({ abordagem: generateApproach(lead), status: lead.status === "novo" ? "investigando" : lead.status });
  const copy = () => { navigator.clipboard?.writeText(lead.abordagem); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-[var(--color-v4-card)] h-full overflow-y-auto shadow-2xl text-[var(--color-v4-text)] border-l border-[var(--color-v4-border)]">
        <div className="sticky top-0 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-5 py-4 flex items-start gap-3">
          <div>
            <h2 className="text-base font-extrabold flex items-center gap-2 text-white"><Building2 size={18} style={{ color: RED }} />{lead.empresa || "—"}</h2>
            <p className="text-xs text-[var(--color-v4-text-muted)]">{[lead.cidade, lead.estado].filter(Boolean).join("/")} · BDR {lead.bdr || "—"}</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Sócio 1" value={lead.socio1} />
            <Field label="Sócio 2" value={lead.socio2} />
            <Field label="E-mail" value={lead.email} />
            <Field label="Cidade/UF" value={[lead.cidade, lead.estado].filter(Boolean).join("/")} />
          </div>

          {/* click-to-call */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Contato — click-to-call (API4COM)</p>
            <div className="flex flex-wrap gap-2">
              {[lead.whatsapp1, lead.whatsapp2].filter(Boolean).map((ph, i) => (
                <div key={i} className="inline-flex items-center rounded-lg border border-[var(--color-v4-border)] overflow-hidden">
                  <a href={callLink(ph)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white" style={{ background: RED }}><Phone size={13} /> {ph}</a>
                  <a href={whatsappLink(ph)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm text-green-400 hover:bg-[var(--color-v4-surface)]"><MessageCircle size={14} /></a>
                </div>
              ))}
              {!lead.whatsapp1 && !lead.whatsapp2 && <span className="text-sm text-[var(--color-v4-text-muted)]">Sem telefone na lista.</span>}
            </div>
          </div>

          {/* links de investigação */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Investigação — links clicáveis</p>
            <div className="flex flex-wrap gap-2">
              {links.map(({ kind, label, Icon }) => {
                const { href, derived } = channelLink(lead, kind);
                return (
                  <a key={kind} href={href} target="_blank" rel="noopener"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${derived ? "border-dashed border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)]" : "border-[var(--color-v4-border)] text-white hover:border-[var(--color-v4-red)]"}`}
                    title={derived ? "Não veio na lista — abre uma busca pra você achar" : href}>
                    <Icon size={14} style={{ color: derived ? undefined : "#e63946" }} /> {label}{derived ? " 🔎" : ""}
                  </a>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">🔎 = link não veio na lista; abre uma busca pra você localizar.</p>
          </div>

          {/* maturidade + IA */}
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between">
              <div className="pr-2">
                <p className="text-sm font-bold text-white">Maturidade digital <span className="text-[10px] font-medium text-[var(--color-v4-text-muted)] align-middle">· nota automática</span></p>
                <p className="text-[11px] text-[var(--color-v4-text-muted)]">{maturidadeMotivo(lead)}</p>
                <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-0.5 opacity-70">Calculada pela presença digital — ajuste após investigar.</p>
              </div>
              <Stars value={lead.maturidade} onChange={(v) => onUpdate({ maturidade: v })} />
            </div>
            <button onClick={genApproach} className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-bold" style={{ background: RED }}>
              <Sparkles size={15} /> Gerar Abordagem Inteligente
            </button>
            {lead.abordagem && (
              <div className="mt-3 relative">
                <textarea value={lead.abordagem} onChange={(e) => onUpdate({ abordagem: e.target.value })} rows={9}
                  className="w-full text-sm border border-[var(--color-v4-border)] rounded-lg p-3 bg-[var(--color-v4-surface)] text-white focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                <button onClick={copy} className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[var(--color-v4-card)] border border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)]">
                  {copied ? <><Check size={12} className="text-green-400" /> Copiado</> : <><Copy size={12} /> Copiar</>}
                </button>
                <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">Gerado por regras (nota + dados). Em produção troca por OpenAI/Claude. Objetivo: agendar a Reunião de Consultoria Gratuita.</p>
              </div>
            )}
          </div>

          {/* checklist */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5 flex items-center gap-1"><ClipboardList size={13} /> Checklist de investigação</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CHECKLIST.map(({ icon: Icon, title, tips }) => (
                <div key={title} className={`${card} p-3`}>
                  <div className="flex items-center gap-1.5 text-sm font-bold mb-1 text-white"><Icon size={14} style={{ color: RED }} /> {title}</div>
                  <p className="text-[11px] text-[var(--color-v4-text-muted)] leading-relaxed">{tips}</p>
                </div>
              ))}
            </div>
          </div>

          {/* status + notas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase">Status</label>
              <select value={lead.status} onChange={(e) => onUpdate({ status: e.target.value as ProspLead["status"] })}
                className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase">Notas</label>
              <input value={lead.notas} onChange={(e) => onUpdate({ notas: e.target.value })} placeholder="Anotações da investigação…"
                className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase">{label}</p>
    <p className="text-white">{value || "—"}</p>
  </div>
);

export const LabProspeccaoRoute: React.FC = () => <ProspeccaoHub />;
export default ProspeccaoHub;
