import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Upload, Download, Phone, MessageCircle, Star, Globe, Instagram, Facebook, Linkedin, Youtube,
  MapPin, Search, Sparkles, X, Building2, Copy, Check, ClipboardList, Users, Trash2, Calendar, Clock,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  parseFile, distribute, loadLeads, saveLeads, channelLink, telLink, callLink, whatsappLink,
  generateApproach, toCSV, downloadCSV, STATUS_LABELS, STATUS_ORDER, NICHOS, maturidadeMotivo, type ProspLead,
} from "./prospeccao/prospLib";

/**
 * ProspeccaoHub — Hub de Prospecção Outbound (V4). Protótipo no clone Labs.
 * Sobe listas do Lemit (CSV/XLS), define dono + nicho, investiga (links + IA por
 * nicho/gaps), pontua presença digital, agenda (data/closer/canal) e exporta.
 * Persiste em localStorage (o clone é read-only). Tema dark, acento vermelho.
 */
const RED = "var(--color-v4-red)";
const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const CANAIS = ["outbound", "inbound", "indicacao", "recomendacao"];
const CHECKLIST = [
  { icon: Globe, title: "SITE / LP", tips: "Proposta de valor · Stack tecnológico · Maturidade de conversão (CTAs) · Prova social" },
  { icon: Linkedin, title: "LINKEDIN", tips: "Decisores (C-Level) · Momento (vagas abertas) · Tamanho da operação · Notícias/marcos" },
  { icon: Instagram, title: "INSTAGRAM / FACEBOOK", tips: "Termômetro de clientes (comentários/reclamações) · Posicionamento de marca · Engajamento" },
  { icon: Youtube, title: "YOUTUBE", tips: "Maturidade do produto · Foco em educação (webinars) · Dúvidas nos comentários" },
];

type Member = { id: string; name: string };
interface HubProps {
  teamMembers?: Member[];
  closers?: Member[];
}

const FALLBACK_TEAM = ["Lary", "Edric", "Bianca", "Erick"].map((n) => ({ id: n, name: n }));
const FUNIL: ProspLead["status"][] = ["abordando", "conexao", "agendado", "realizado", "fechado"];

export const ProspeccaoHub: React.FC<HubProps> = ({ teamMembers, closers = [] }) => {
  const team = (teamMembers && teamMembers.length ? teamMembers : FALLBACK_TEAM);
  const teamNames = team.map((t) => t.name);

  const [leads, setLeads] = useState<ProspLead[]>(() => loadLeads());
  const [bdrFilter, setBdrFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<ProspLead["status"] | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ownerSel, setOwnerSel] = useState<string>("__auto__");
  const [nichoSel, setNichoSel] = useState<string>(NICHOS[0]);
  const [agendarFor, setAgendarFor] = useState<ProspLead | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: ProspLead[]) => { setLeads(next); saveLeads(next); };
  const updateLead = (id: string, patch: Partial<ProspLead>) => { const next = leads.map((l) => (l.id === id ? { ...l, ...patch } : l)); persist(next); return next.find((l) => l.id === id)!; };

  // auto-conserto: leads salvos com dono fora do time real (ex.: placeholders antigos
  // Ana/Bruno/Carla) são redistribuídos entre o time atual.
  useEffect(() => {
    if (!leads.length || !teamNames.length) return;
    const set = new Set(teamNames);
    const orphans = leads.filter((l) => !l.bdr || !set.has(l.bdr));
    if (!orphans.length) return;
    let i = 0;
    const next = leads.map((l) => (l.bdr && set.has(l.bdr) ? l : { ...l, bdr: teamNames[i++ % teamNames.length] }));
    persist(next);
    setBanner({ ok: true, msg: `Corrigi ${orphans.length} lead(s) com dono antigo/placeholder → redistribuídos entre ${teamNames.join(", ")}.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNames.join(",")]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      let added = 0; let matched: string[] = []; let missing: string[] = [];
      const owner = ownerSel === "__auto__" ? null : ownerSel;
      let acc = [...leads];
      for (const f of Array.from(files)) {
        const batch = f.name.replace(/\.(csv|xlsx?|xls)$/i, "");
        const res = await parseFile(f, batch, nichoSel, owner);
        matched = res.matched; missing = res.missing;
        const existingIds = new Set(acc.map((l) => l.id));
        const fresh = res.leads.filter((l) => !existingIds.has(l.id));
        acc = owner ? [...acc, ...fresh] : distribute([...acc, ...fresh], teamNames);
        added += fresh.length;
      }
      persist(acc);
      setBanner({ ok: true, msg: `${added} lead(s) importado(s) · dono: ${owner || "distribuído entre todos"} · nicho: ${nichoSel} · colunas ${matched.length}/13${missing.length ? " · faltando: " + missing.join(", ") : ""}` });
    } catch (e: any) {
      setBanner({ ok: false, msg: "Falha ao ler o arquivo: " + (e?.message || e) });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const bdrLeads = useMemo(() => leads.filter((l) => bdrFilter === "todos" || l.bdr === bdrFilter), [leads, bdrFilter]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bdrLeads.filter((l) =>
      (!statusFilter || l.status === statusFilter) &&
      (!s || l.empresa.toLowerCase().includes(s) || l.cidade.toLowerCase().includes(s) || l.socio1.toLowerCase().includes(s)))
      .sort((a, b) => b.maturidade - a.maturidade);
  }, [bdrLeads, statusFilter, search]);

  // FUNIL local (simulação): conta por status; conversão etapa→etapa
  const funil = useMemo(() => FUNIL.map((s, i, arr) => {
    const n = bdrLeads.filter((l) => l.status === s).length;
    const prev = i > 0 ? bdrLeads.filter((l) => l.status === arr[i - 1]).length : 0;
    return { s, n, conv: i > 0 && prev > 0 ? Math.round((100 * n) / prev) : null };
  }), [bdrLeads]);
  const naoAbordados = useMemo(() => bdrLeads.filter((l) => l.status === "novo").length, [bdrLeads]);
  // AGENDA local (simulação): reuniões marcadas
  const agenda = useMemo(() => bdrLeads.filter((l) => l.status === "agendado" && l.dataReuniao).sort((a, b) => (a.dataReuniao || "").localeCompare(b.dataReuniao || "")), [bdrLeads]);

  const countByBdr = (b: string) => leads.filter((l) => l.bdr === b).length;
  const open = openId ? leads.find((l) => l.id === openId) || null : null;

  const exportCSV = () => {
    const rows = bdrFilter === "todos" ? leads : leads.filter((l) => l.bdr === bdrFilter);
    if (!rows.length) { setBanner({ ok: false, msg: "Nada pra exportar." }); return; }
    downloadCSV(`prospeccao_${bdrFilter}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  };
  const clearAll = () => { if (confirm("Apagar TODAS as listas deste navegador?")) persist([]); };

  // simulação local: só atualiza o Hub (localStorage). O funil e a agenda abaixo refletem na hora.
  const changeStatus = (lead: ProspLead, status: ProspLead["status"]) => {
    if (status === "agendado") { setAgendarFor(lead); return; }
    updateLead(lead.id, { status });
  };

  const confirmAgendar = (opts: { dataISO: string; closerId?: string; canal: string; closerNome?: string }) => {
    if (!agendarFor) return;
    const closerNome = closers.find((c) => c.id === opts.closerId)?.name || opts.closerNome || "";
    updateLead(agendarFor.id, { status: "agendado", dataReuniao: opts.dataISO, closerId: opts.closerId, closerNome, canal: opts.canal });
    setAgendarFor(null);
    setBanner({ ok: true, msg: `Agendado com ${closerNome || "closer"} para ${new Date(opts.dataISO).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} — veja na Agenda (simulação local).` });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center font-black text-white" style={{ background: RED }}>V4</div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">Hub de Prospecção <span style={{ color: RED }}>Outbound</span></h1>
            <p className="text-[11px] text-[var(--color-v4-text-muted)]">Suba as listas do Lemit · defina dono e nicho · investigue · agende · exporte</p>
          </div>
        </div>
        <div className="flex-1" />
        {/* dono + nicho + upload */}
        <select value={ownerSel} onChange={(e) => setOwnerSel(e.target.value)} title="Dono da lista"
          className="px-2.5 py-2 rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white text-xs">
          <option value="__auto__">Distribuir entre todos</option>
          {teamNames.map((n) => <option key={n} value={n}>Dono: {n}</option>)}
        </select>
        <select value={nichoSel} onChange={(e) => setNichoSel(e.target.value)} title="Nicho da lista"
          className="px-2.5 py-2 rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white text-xs max-w-[220px]">
          {NICHOS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold cursor-pointer" style={{ background: RED }}>
          <Upload size={15} /> Subir lista
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
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Users size={15} className="text-[var(--color-v4-text-muted)]" />
              <TabBtn active={bdrFilter === "todos"} onClick={() => setBdrFilter("todos")} label={`Todos (${leads.length})`} />
              {teamNames.map((b) => <TabBtn key={b} active={bdrFilter === b} onClick={() => setBdrFilter(b)} label={`${b} (${countByBdr(b)})`} />)}
              <div className="flex-1" />
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-v4-text-muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa, cidade, sócio…"
                  className="pl-8 pr-3 py-2 rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </div>
            </div>

            {/* FUNIL LOCAL (simulação) — reflete os status na hora */}
            <div className={`${card} p-3 mb-4`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Funil (simulação local)</span>
                <span className="text-[10px] text-[var(--color-v4-text-muted)]">clique numa etapa pra filtrar · A abordar: {naoAbordados}{statusFilter ? " · " : ""}{statusFilter && <button onClick={() => setStatusFilter(null)} className="underline">limpar filtro</button>}</span>
              </div>
              <div className="flex flex-wrap items-stretch gap-2">
                {funil.map(({ s, n, conv }) => (
                  <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                    className={`flex-1 min-w-[110px] rounded-lg border px-3 py-2 text-left transition-colors ${statusFilter === s ? "border-[var(--color-v4-red)]" : "border-[var(--color-v4-border)]"} bg-[var(--color-v4-surface)] hover:border-[var(--color-v4-red)]`}>
                    <div className="text-[10px] text-[var(--color-v4-text-muted)] flex items-center justify-between">{STATUS_LABELS[s]}{conv != null && <span style={{ color: RED }}>▲{conv}%</span>}</div>
                    <div className="text-2xl font-bold text-white">{n}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className={`overflow-x-auto ${card}`}>
              <table className="w-full text-sm min-w-[880px]">
                <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Nicho</th><th className="px-3 py-2.5">Cidade/UF</th>
                    <th className="px-3 py-2.5">Contato</th><th className="px-3 py-2.5">Dono</th><th className="px-3 py-2.5">Presença</th>
                    <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)] cursor-pointer text-white" onClick={() => setOpenId(l.id)}>
                      <td className="px-3 py-2.5 font-semibold flex items-center gap-2"><Building2 size={14} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)] text-[11px]">{l.nicho || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{[l.cidade, l.estado].filter(Boolean).join("/") || "—"}</td>
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
            <p className="text-[11px] text-[var(--color-v4-text-muted)] mt-2">{filtered.length} lead(s) · ordenados por presença digital (prioridade ↓) · salvos neste navegador</p>

            {/* AGENDA LOCAL (simulação) */}
            {agenda.length > 0 && (
              <div className={`${card} mt-4`}>
                <div className="px-4 py-3 border-b border-[var(--color-v4-border)] flex items-center gap-2">
                  <Calendar size={15} style={{ color: RED }} />
                  <span className="text-sm font-bold text-white">Agenda (simulação local)</span>
                  <span className="text-[11px] text-[var(--color-v4-text-muted)]">{agenda.length} reunião(ões) agendada(s)</span>
                </div>
                <div className="divide-y divide-[var(--color-v4-border)]">
                  {agenda.map((l) => (
                    <div key={l.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm hover:bg-[var(--color-v4-card-hover)] cursor-pointer" onClick={() => setOpenId(l.id)}>
                      <span className="font-semibold w-32" style={{ color: RED }}>{new Date(l.dataReuniao!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="text-white flex-1 min-w-[120px] font-medium">{l.empresa}</span>
                      <span className="text-[var(--color-v4-text-muted)] text-xs">closer {l.closerNome || "—"}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--color-v4-surface)]">{l.canal}</span>
                      <span className="text-[var(--color-v4-text-muted)] text-xs">dono {l.bdr}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 text-[10px] text-[var(--color-v4-text-muted)] opacity-70">Simulação local — em produção estas reuniões cairiam na agenda (Google Calendar) do closer.</div>
              </div>
            )}
          </>
        )}
      </div>

      {open && <LeadPanel lead={open} closers={closers} onClose={() => setOpenId(null)}
        onUpdate={(patch) => updateLead(open.id, patch)} onStatus={(s) => changeStatus(open, s)} />}
      {agendarFor && <AgendarModal lead={agendarFor} closers={closers} onClose={() => setAgendarFor(null)} onConfirm={confirmAgendar} />}
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${active ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)]"}`}
    style={active ? { background: RED } : undefined}>{label}</button>
);

const StatusPill: React.FC<{ status: ProspLead["status"] }> = ({ status }) => {
  const c: Record<ProspLead["status"], string> = {
    novo: "bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)]", abordando: "bg-amber-500/15 text-amber-400",
    conexao: "bg-sky-500/15 text-sky-400", agendado: "bg-violet-500/15 text-violet-400",
    realizado: "bg-emerald-500/15 text-emerald-400", fechado: "bg-red-500/15 text-red-400",
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
    <p className="text-sm text-[var(--color-v4-text-muted)] max-w-md mt-1">Escolha o <b>dono</b> e o <b>nicho</b> no topo, depois arraste o CSV/XLS aqui ou clique. Colunas no padrão Lemit
      (NOME EMPRESA, SÓCIO 1/2, WHATSAPP 1/2, EMAIL, SITE, CIDADE, ESTADO, LINKS…).</p>
    <button onClick={onPick} className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}>Selecionar arquivo</button>
  </div>
);

// ---------------- Modal Agendar ----------------
const AgendarModal: React.FC<{ lead: ProspLead; closers: Member[]; onClose: () => void; onConfirm: (o: { dataISO: string; closerId?: string; canal: string; closerNome?: string }) => void }> = ({ lead, closers, onClose, onConfirm }) => {
  const now = new Date(Date.now() + 864e5); const p = (n: number) => String(n).padStart(2, "0");
  const [data, setData] = useState(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T10:00`);
  const [closerId, setCloserId] = useState(closers[0]?.id || "");
  const [closerNome, setCloserNome] = useState("");
  const [canal, setCanal] = useState("outbound");
  const ok = !!data && (!!closerId || !!closerNome.trim());
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-sm ${card} p-5`}>
        <div className="flex items-center gap-2 mb-3"><Calendar size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Agendar reunião — {lead.empresa}</h3></div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)]">Data e hora</label>
            <input type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)]">Closer</label>
            {closers.length ? (
              <select value={closerId} onChange={(e) => setCloserId(e.target.value)} className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm">
                {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <input value={closerNome} onChange={(e) => setCloserNome(e.target.value)} placeholder="Nome do closer" className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
            )}
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)]">Canal</label>
            <select value={canal} onChange={(e) => setCanal(e.target.value)} className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm">
              {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="text-[10px] text-[var(--color-v4-text-muted)]">Em produção, cai automaticamente na agenda do closer (Google Calendar) e cria a reunião no SalesHub.</p>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button disabled={!ok} onClick={() => onConfirm({ dataISO: new Date(data).toISOString(), closerId: closerId || undefined, canal, closerNome: closerNome || undefined })}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-30" style={{ background: RED }}>
            <Clock size={14} /> Agendar
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------- Painel do Lead ----------------
const LeadPanel: React.FC<{ lead: ProspLead; closers: Member[]; onClose: () => void; onUpdate: (patch: Partial<ProspLead>) => void; onStatus: (s: ProspLead["status"]) => void }> = ({ lead, onClose, onUpdate, onStatus }) => {
  const [copied, setCopied] = useState(false);
  const links = [
    { kind: "site", label: "Site", Icon: Globe }, { kind: "instagram", label: "Instagram", Icon: Instagram },
    { kind: "facebook", label: "Facebook", Icon: Facebook }, { kind: "linkedin", label: "LinkedIn", Icon: Linkedin },
    { kind: "youtube", label: "YouTube", Icon: Youtube }, { kind: "gmb", label: "Google Meu Negócio", Icon: MapPin },
    { kind: "google", label: "Buscar no Google", Icon: Search },
  ] as const;
  const genApproach = () => onUpdate({ abordagem: generateApproach(lead) });
  const copy = () => { navigator.clipboard?.writeText(lead.abordagem); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-[var(--color-v4-card)] h-full overflow-y-auto shadow-2xl text-[var(--color-v4-text)] border-l border-[var(--color-v4-border)]">
        <div className="sticky top-0 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-5 py-4 flex items-start gap-3">
          <div>
            <h2 className="text-base font-extrabold flex items-center gap-2 text-white"><Building2 size={18} style={{ color: RED }} />{lead.empresa || "—"}</h2>
            <p className="text-xs text-[var(--color-v4-text-muted)]">{[lead.cidade, lead.estado].filter(Boolean).join("/")} · {lead.nicho} · dono {lead.bdr || "—"}</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Sócio 1" value={lead.socio1} /><Field label="Sócio 2" value={lead.socio2} />
            <Field label="E-mail" value={lead.email} /><Field label="Cidade/UF" value={[lead.cidade, lead.estado].filter(Boolean).join("/")} />
          </div>

          {/* status */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Status (etapa do funil)</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button key={s} onClick={() => onStatus(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${lead.status === s ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`}
                  style={lead.status === s ? { background: RED } : undefined}>{STATUS_LABELS[s]}</button>
              ))}
            </div>
            {lead.status === "agendado" && lead.dataReuniao && (
              <p className="text-[11px] text-violet-400 mt-1.5">📅 {new Date(lead.dataReuniao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · closer {lead.closerNome || "—"} · {lead.canal}</p>
            )}
          </div>

          {/* click-to-call */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Contato — click-to-call</p>
            <div className="flex flex-wrap gap-2">
              {[lead.whatsapp1, lead.whatsapp2].filter(Boolean).map((ph, i) => (
                <div key={i} className="inline-flex items-center rounded-lg border border-[var(--color-v4-border)] overflow-hidden">
                  <a href={telLink(ph)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white" style={{ background: RED }}><Phone size={13} /> {ph}</a>
                  <a href={callLink(ph)} title="Discar via API4COM (requer app 4COM)" className="px-2 py-1.5 text-[10px] text-[var(--color-v4-text-muted)] hover:text-white border-l border-[var(--color-v4-border)]">4COM</a>
                  <a href={whatsappLink(ph)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm text-green-400 hover:bg-[var(--color-v4-surface)] border-l border-[var(--color-v4-border)]"><MessageCircle size={14} /></a>
                </div>
              ))}
              {!lead.whatsapp1 && !lead.whatsapp2 && <span className="text-sm text-[var(--color-v4-text-muted)]">Sem telefone na lista.</span>}
            </div>
            <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">Botão vermelho abre o discador/softphone (tel:). Auto-discagem nativa do API4COM exige o HTTP API + token deles (produção).</p>
          </div>

          {/* links */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Investigação — links clicáveis</p>
            <div className="flex flex-wrap gap-2">
              {links.map(({ kind, label, Icon }) => {
                const { href, derived } = channelLink(lead, kind);
                return (
                  <a key={kind} href={href} target="_blank" rel="noopener"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${derived ? "border-dashed border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)]" : "border-[var(--color-v4-border)] text-white hover:border-[var(--color-v4-red)]"}`}
                    title={derived ? "Não veio na lista — abre uma busca pra você achar/validar" : href}>
                    <Icon size={14} style={{ color: derived ? undefined : "#e63946" }} /> {label}{derived ? " 🔎" : ""}
                  </a>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">🔎 = link não veio na lista; abre uma busca. ⚠️ confira sempre se o perfil é realmente da empresa antes de pontuar.</p>
          </div>

          {/* maturidade + IA */}
          <div className={`${card} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">Presença digital <span className="text-[10px] font-medium text-[var(--color-v4-text-muted)]">· auto (proxy)</span></p>
                <p className="text-[11px] text-[var(--color-v4-text-muted)]">{maturidadeMotivo(lead)}</p>
                <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-0.5 opacity-70">Nota pela presença de canais. Maturidade REAL (analisar site/redes + validar link) precisa de análise ao vivo (produção). Ajuste após investigar.</p>
              </div>
              <Stars value={lead.maturidade} onChange={(v) => onUpdate({ maturidade: v })} />
            </div>
            <button onClick={genApproach} className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-bold" style={{ background: RED }}>
              <Sparkles size={15} /> Gerar Abordagem Inteligente ({(lead.nicho || "Nicho").split(" ")[0]})
            </button>
            {lead.abordagem && (
              <div className="mt-3 relative">
                <textarea value={lead.abordagem} onChange={(e) => onUpdate({ abordagem: e.target.value })} rows={10}
                  className="w-full text-sm border border-[var(--color-v4-border)] rounded-lg p-3 bg-[var(--color-v4-surface)] text-white focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                <button onClick={copy} className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[var(--color-v4-card)] border border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)]">
                  {copied ? <><Check size={12} className="text-green-400" /> Copiado</> : <><Copy size={12} /> Copiar</>}
                </button>
                <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">Personalizada pelo nicho ({lead.nicho}) + gaps + maturidade. Em produção, troca por OpenAI/Claude pra ficar 100% dinâmica.</p>
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

          {/* notas */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase">Notas</label>
            <input value={lead.notas} onChange={(e) => onUpdate({ notas: e.target.value })} placeholder="Anotações da investigação…"
              className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div><p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase">{label}</p><p className="text-white">{value || "—"}</p></div>
);

// ---------------- Route: usa o store só pra puxar os NOMES reais (SDRs/closers). ----------------
// Simulação local — NÃO grava no banco/agenda de produção (o clone é read-only).
export const LabProspeccaoRoute: React.FC = () => {
  const store = useAppStore();
  const teamMembers = useMemo(() => {
    const t = store.members.filter((m) => m.active && (m.role === "sdr" || m.role === "gestor")).map((m) => ({ id: m.id, name: m.name }));
    return t.length ? t : FALLBACK_TEAM;
  }, [store.members]);
  const closers = useMemo(() => store.members.filter((m) => m.active && (m.role === "closer" || m.role === "gestor")).map((m) => ({ id: m.id, name: m.name })), [store.members]);
  return <ProspeccaoHub teamMembers={teamMembers} closers={closers} />;
};

export default ProspeccaoHub;
