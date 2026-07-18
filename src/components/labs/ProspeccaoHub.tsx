import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Upload, Download, Phone, MessageCircle, Star, Globe, Instagram, Facebook, Linkedin, Youtube,
  MapPin, Search, Sparkles, X, Building2, Copy, Check, ClipboardList, Users, Trash2, Calendar, Clock,
  Database, Users2, UserCheck, Send, Briefcase, Filter, AlertTriangle,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  parseFile, loadLeads, saveLeads, channelLink, telLink, callLink, whatsappLink,
  generateApproach, toCSV, downloadCSV, dedupeByCompany, enrichProsp, distributeQualified, isIncompleto, allPhonesProsp,
  STATUS_LABELS, STATUS_ORDER, NICHOS, maturidadeMotivo, type ProspLead, type ReqCampo,
} from "./prospeccao/prospLib";
import { undismiss as hubUndismiss } from "./hubOutbound/hubLib";

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
  const [ownersSel, setOwnersSel] = useState<string[]>([]);
  const [nichoSel, setNichoSel] = useState<string>(NICHOS[0]);
  const [agendarFor, setAgendarFor] = useState<ProspLead | null>(null);
  const [pending, setPending] = useState<File[] | null>(null); // arquivo(s) escolhido(s), aguardando definir BDR
  const [preview, setPreview] = useState<{ count: number; matched: number; missing: string[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limpezaOpen, setLimpezaOpen] = useState(false);
  const [reqs, setReqs] = useState<ReqCampo[]>(["empresa", "telefone"]);
  const [sendOpen, setSendOpen] = useState(false);
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

  // Upload: unifica sócios da mesma empresa → enriquece no Lemit → divisão
  // qualificada entre os donos → fica "em revisão" (não vai pro Hub até aprovar).
  const handleFiles = async (files: File[] | null, owners: string[], nicho: string) => {
    if (!files?.length) return;
    setOwnersSel(owners); setNichoSel(nicho);
    const alvo = owners.length ? owners : teamNames;
    try {
      let matched: string[] = []; let missing: string[] = [];
      const acc = [...leads];
      let rawFresh: ProspLead[] = [];
      let linhas = 0;
      for (const f of files) {
        const batch = f.name.replace(/\.(csv|xlsx?|xls)$/i, "");
        const res = await parseFile(f, batch, nicho, null);
        matched = res.matched; missing = res.missing;
        linhas += res.leads.length;
        rawFresh = [...rawFresh, ...res.leads];
      }
      // 1) UNIFICA sócios da mesma empresa (1 card por empresa)
      const unificados = dedupeByCompany(rawFresh);
      const socDup = linhas - unificados.length;
      // tira empresas já existentes (por id) pra não duplicar
      const existingIds = new Set(acc.map((l) => l.id));
      const novos = unificados.filter((l) => !existingIds.has(l.id));
      // 2) ENRIQUECE no Lemit (dados cadastrais + telefones + quadro societário + decisor)
      const enriquecidos = novos.map((l) => ({ ...enrichProsp(l), enviadoHub: false, updatedAt: new Date().toISOString() }));
      // 3) DIVISÃO QUALIFICADA entre os donos escolhidos
      const assigned = distributeQualified(enriquecidos, alvo);
      persist([...acc, ...assigned]);
      const cont: Record<string, number> = {};
      assigned.forEach((l) => { if (l.bdr) cont[l.bdr] = (cont[l.bdr] || 0) + 1; });
      const split = Object.entries(cont).map(([b, n]) => `${b}: ${n}`).join(" · ");
      setBanner({ ok: true, msg: `${linhas} linha(s) → ${assigned.length} empresa(s)${socDup > 0 ? ` (${socDup} sócio(s)/linha(s) unificados)` : ""} · enriquecidas no Lemit · divisão qualificada: ${split || "—"} · em REVISÃO (revise e envie ao Hub) · nicho: ${nicho} · colunas ${matched.length}/13${missing.length ? " · faltando: " + missing.join(", ") : ""}` });
    } catch (e: any) {
      setBanner({ ok: false, msg: "Falha ao ler/enriquecer: " + (e?.message || e) });
    }
  };

  // fluxo: escolher arquivo PRIMEIRO → depois abre o modal pra definir o BDR/nicho
  const onFilePicked = async (files: FileList | null) => {
    if (!files?.length) return;
    // snapshot: FileList é vivo e esvazia ao limpar o input — guardamos os File num array
    const arr = Array.from(files);
    setPending(arr);
    if (fileRef.current) fileRef.current.value = "";
    try { const r = await parseFile(arr[0], arr[0].name, nichoSel, null); setPreview({ count: r.leads.length, matched: r.matched.length, missing: r.missing }); }
    catch { setPreview(null); }
  };
  const confirmImport = (owners: string[], nicho: string) => { handleFiles(pending, owners, nicho); setPending(null); setPreview(null); };

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

  // seleção (remover leads um a um)
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAllVisible = () => setSelected((s) => { const n = new Set(s); if (allVisibleSelected) filtered.forEach((l) => n.delete(l.id)); else filtered.forEach((l) => n.add(l.id)); return n; });
  const removeSelected = () => { if (!selected.size) return; if (confirm(`Remover ${selected.size} lead(s) selecionado(s)?`)) { persist(leads.filter((l) => !selected.has(l.id))); setSelected(new Set()); } };

  const exportCSV = () => {
    const rows = bdrFilter === "todos" ? leads : leads.filter((l) => l.bdr === bdrFilter);
    if (!rows.length) { setBanner({ ok: false, msg: "Nada pra exportar." }); return; }
    downloadCSV(`prospeccao_${bdrFilter}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  };
  const clearAll = () => { if (confirm("Apagar TODAS as listas deste navegador?")) persist([]); };

  // ---- revisão: contagens, limpeza de incompletos e envio ao Hub ----
  const emRevisao = useMemo(() => leads.filter((l) => !l.enviadoHub), [leads]);
  const enviadosCount = leads.length - emRevisao.length;
  const incompletos = useMemo(() => leads.filter((l) => isIncompleto(l, reqs)), [leads, reqs]);
  const toggleReq = (rq: ReqCampo) => setReqs((r) => (r.includes(rq) ? r.filter((x) => x !== rq) : [...r, rq]));
  const removerIncompletos = () => {
    if (!incompletos.length) { setBanner({ ok: true, msg: "Nenhum lead incompleto pelos critérios atuais." }); return; }
    if (confirm(`Remover ${incompletos.length} empresa(s) incompleta(s) (faltando: ${reqs.join(", ")})?`)) {
      const ids = new Set(incompletos.map((l) => l.id));
      persist(leads.filter((l) => !ids.has(l.id))); setLimpezaOpen(false);
      setBanner({ ok: true, msg: `${ids.size} empresa(s) incompleta(s) removida(s).` });
    }
  };
  const enviarAoHub = (owners: string[]) => {
    const alvo = owners.length ? owners : teamNames;
    const pendentes = leads.filter((l) => !l.enviadoHub);
    if (!pendentes.length) { setBanner({ ok: false, msg: "Nada em revisão pra enviar." }); return; }
    const redistribuidos = distributeQualified(pendentes, alvo);
    const byId = new Map(redistribuidos.map((l) => [l.id, l]));
    hubUndismiss(pendentes.map((l) => l.id)); // reenvio explícito sempre entrega (mesmo se removido antes no Hub)
    persist(leads.map((l) => { const r = byId.get(l.id); return r ? { ...r, enviadoHub: true, updatedAt: new Date().toISOString() } : l; }));
    setSendOpen(false);
    const cont: Record<string, number> = {};
    redistribuidos.forEach((l) => { if (l.bdr) cont[l.bdr] = (cont[l.bdr] || 0) + 1; });
    setBanner({ ok: true, msg: `${pendentes.length} empresa(s) enviada(s) ao Hub Outbound · divisão qualificada: ${Object.entries(cont).map(([b, n]) => `${b}: ${n}`).join(" · ")}` });
  };

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
        <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" multiple className="hidden" onChange={(e) => onFilePicked(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}>
          <Upload size={15} /> Subir lista
        </button>
        {leads.length > 0 && (
          <button onClick={() => setLimpezaOpen(true)} title="Remover empresas com campos em branco" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-v4-border)] text-sm font-semibold text-white hover:bg-[var(--color-v4-card-hover)]">
            <Filter size={15} /> Limpeza{incompletos.length ? ` (${incompletos.length})` : ""}
          </button>
        )}
        {emRevisao.length > 0 && (
          <button onClick={() => setSendOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-bold" style={{ background: RED }}>
            <Send size={15} /> Enviar ao Hub ({emRevisao.length})
          </button>
        )}
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-v4-border)] text-sm font-semibold text-white hover:bg-[var(--color-v4-card-hover)]">
          <Download size={15} /> Exportar
        </button>
        {leads.length > 0 && (
          <button onClick={clearAll} title="Remover todos" className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)] text-sm"><Trash2 size={15} /></button>
        )}
      </div>

      <div className="p-6">
        {banner && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border ${banner.ok ? "bg-[var(--color-v4-surface)] text-white border-[var(--color-v4-border)]" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
            {banner.msg} <button onClick={() => setBanner(null)} className="float-right text-[var(--color-v4-text-muted)] hover:text-white"><X size={14} /></button>
          </div>
        )}

        {leads.length === 0 ? (
          <EmptyState onOpen={() => fileRef.current?.click()} />
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

            {/* status de revisão */}
            <div className="flex flex-wrap items-center gap-3 mb-4 text-[12px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30"><ClipboardList size={13} /> Em revisão: <b>{emRevisao.length}</b></span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><Check size={13} /> Enviados ao Hub: <b>{enviadosCount}</b></span>
              <span className="text-[var(--color-v4-text-muted)]">Suba a lista → unifica sócios + enriquece no Lemit → revise/limpe → <b className="text-white">Enviar ao Hub</b> (divisão qualificada).</span>
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

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">
                <span className="text-sm text-white font-medium">{selected.size} selecionado(s)</span>
                <button onClick={removeSelected} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ background: RED }}><Trash2 size={13} /> Remover selecionados</button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-v4-text-muted)] underline hover:text-white">limpar seleção</button>
              </div>
            )}

            <div className={`overflow-x-auto ${card}`}>
              <table className="w-full text-sm min-w-[1120px]">
                <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2.5 w-8"><Cbox checked={allVisibleSelected} onChange={toggleAllVisible} title="Selecionar / limpar todos" /></th>
                    <th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Nicho</th><th className="px-3 py-2.5">Cidade/UF</th>
                    <th className="px-3 py-2.5">Decisor</th><th className="px-3 py-2.5">Dados</th><th className="px-3 py-2.5">Dono</th><th className="px-3 py-2.5">Presença</th>
                    <th className="px-3 py-2.5">Envio</th><th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const nSoc = 1 + (l.sociosExtra?.length || 0);
                    const nTel = allPhonesProsp(l).length;
                    return (
                    <tr key={l.id} className={`border-t border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)] cursor-pointer text-white ${selected.has(l.id) ? "bg-[var(--color-v4-surface)]/60" : ""}`} onClick={() => setOpenId(l.id)}>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><Cbox checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} title="Selecionar este lead" /></td>
                      <td className="px-3 py-2.5 font-semibold"><span className="flex items-center gap-2"><Building2 size={14} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</span>{(l.linhasUnificadas || 1) > 1 && <span className="text-[9px] text-[var(--color-v4-text-muted)] ml-6">{l.linhasUnificadas} linhas unificadas</span>}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)] text-[11px]">{l.nicho || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{[l.cidade, l.estado].filter(Boolean).join("/") || "—"}</td>
                      <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.decisorNome || l.socio1 || "—"}{l.decisorCargo ? <span className="text-[10px]"> · {l.decisorCargo}</span> : ""}</td>
                      <td className="px-3 py-2.5 text-[11px] text-[var(--color-v4-text-muted)]">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-0.5"><Users2 size={11} />{nSoc}</span>
                          <span className="inline-flex items-center gap-0.5"><Phone size={11} />{nTel}</span>
                          {l.enriquecidoEm && <span className="inline-flex items-center gap-0.5" style={{ color: RED }}><Database size={11} />Lemit</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">{l.bdr || "—"}</span></td>
                      <td className="px-3 py-2.5"><Stars value={l.maturidade} readOnly /></td>
                      <td className="px-3 py-2.5">{l.enviadoHub
                        ? <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Enviado</span>
                        : <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Em revisão</span>}</td>
                      <td className="px-3 py-2.5 text-right"><span className="text-[11px] font-semibold" style={{ color: RED }}>Abrir →</span></td>
                    </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--color-v4-text-muted)]">Nenhum lead nesse filtro.</td></tr>}
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
      {pending && <BdrModal team={teamNames} preview={preview} fileName={pending[0]?.name || ""} nFiles={pending.length} defOwners={ownersSel} defNicho={nichoSel}
        onCancel={() => { setPending(null); setPreview(null); }} onConfirm={confirmImport} />}
      {limpezaOpen && <LimpezaModal reqs={reqs} toggleReq={toggleReq} incompletos={incompletos} total={leads.length} onClose={() => setLimpezaOpen(false)} onConfirm={removerIncompletos} />}
      {sendOpen && <SendHubModal team={teamNames} leads={emRevisao} defOwners={ownersSel.length ? ownersSel : teamNames} onClose={() => setSendOpen(false)} onConfirm={enviarAoHub} />}
    </div>
  );
};

// ---------------- Modal Limpeza: remover empresas com campos em branco ----------------
const REQ_LABELS: Record<ReqCampo, string> = { empresa: "Sem nome da empresa", telefone: "Sem telefone", email: "Sem e-mail", socio: "Sem sócio/decisor" };
const LimpezaModal: React.FC<{ reqs: ReqCampo[]; toggleReq: (r: ReqCampo) => void; incompletos: ProspLead[]; total: number; onClose: () => void; onConfirm: () => void }> = ({ reqs, toggleReq, incompletos, total, onClose, onConfirm }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center">
    <div className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div className={`relative w-full max-w-md ${card} p-5`}>
      <div className="flex items-center gap-2 mb-3"><Filter size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Limpeza — remover incompletos</h3><div className="flex-1" /><button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button></div>
      <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Marque quais campos são obrigatórios. Empresas com <b>qualquer</b> um em branco serão removidas.</p>
      <div className="space-y-1.5">
        {(Object.keys(REQ_LABELS) as ReqCampo[]).map((rq) => {
          const on = reqs.includes(rq);
          return (
            <button key={rq} onClick={() => toggleReq(rq)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left ${on ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`} style={on ? { background: RED } : undefined}>
              <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center border-2 ${on ? "border-white/70" : "border-[var(--color-v4-text-muted)]"}`}>{on && <Check size={11} className="text-white" strokeWidth={3} />}</span>
              {REQ_LABELS[rq]}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] mt-3 flex items-center gap-1.5" style={{ color: incompletos.length ? "#ef4444" : "var(--color-v4-text-muted)" }}>
        <AlertTriangle size={13} /> {incompletos.length} de {total} empresa(s) serão removidas.
      </p>
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
        <button disabled={!incompletos.length || !reqs.length} onClick={onConfirm} className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-30 bg-red-600"><Trash2 size={14} /> Remover {incompletos.length || ""} incompleto(s)</button>
      </div>
    </div>
  </div>
);

// ---------------- Modal Enviar ao Hub: divisão qualificada ----------------
const SendHubModal: React.FC<{ team: string[]; leads: ProspLead[]; defOwners: string[]; onClose: () => void; onConfirm: (owners: string[]) => void }> = ({ team, leads, defOwners, onClose, onConfirm }) => {
  const [owners, setOwners] = useState<string[]>(defOwners);
  const toggle = (n: string) => setOwners((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  const alvo = owners.length ? owners : team;
  const total = leads.length;
  const base = Math.floor(total / (alvo.length || 1)); const resto = total % (alvo.length || 1);
  // preview qualificado: mostra quantos de cada faixa de maturidade cada dono recebe (aprox.)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-md ${card} p-5`}>
        <div className="flex items-center gap-2 mb-3"><Send size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Enviar {total} empresa(s) ao Hub Outbound</h3><div className="flex-1" /><button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button></div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Divisão <b className="text-white">qualificada</b>: ordena por presença digital e distribui alternado, pra cada dono receber um mix equilibrado de leads bons e fracos.</p>
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-[var(--color-v4-text-muted)] uppercase font-semibold">Donos</label>
          <button onClick={() => setOwners(owners.length === team.length ? [] : [...team])} className="text-[10.5px] underline text-[var(--color-v4-text-muted)] hover:text-white">{owners.length === team.length ? "limpar" : "todos"}</button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          {team.map((n) => {
            const on = owners.includes(n);
            return (
              <button key={n} onClick={() => toggle(n)} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm text-left ${on ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`} style={on ? { background: RED } : undefined}>
                <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center border-2 ${on ? "border-white/70" : "border-[var(--color-v4-text-muted)]"}`}>{on && <Check size={11} className="text-white" strokeWidth={3} />}</span>
                {n}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] mt-2" style={{ color: RED }}>{alvo.length ? `~${base}${resto ? `–${base + 1}` : ""} empresa(s) por dono (${alvo.join(", ")})` : "escolha ao menos 1 dono"}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button onClick={() => onConfirm(owners)} className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-white text-sm font-bold" style={{ background: RED }}><Send size={14} /> Enviar ao Hub</button>
        </div>
      </div>
    </div>
  );
};

// Checkbox customizado — nativo desmarcado some no dark; este fica sempre visível.
const Cbox: React.FC<{ checked: boolean; onChange: () => void; title?: string }> = ({ checked, onChange, title }) => (
  <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onChange(); }}
    className={`w-5 h-5 shrink-0 rounded flex items-center justify-center border-2 transition-colors ${checked ? "border-transparent" : "border-[var(--color-v4-text-muted)] bg-[var(--color-v4-bg)] hover:border-[var(--color-v4-red)]"}`}
    style={checked ? { background: RED } : undefined}>
    {checked && <Check size={13} className="text-white" strokeWidth={3} />}
  </button>
);

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

const EmptyState: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <div className="border-2 border-dashed border-[var(--color-v4-border)] rounded-2xl py-16 flex flex-col items-center justify-center text-center">
    <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: RED }}><Upload size={26} className="text-white" /></div>
    <h2 className="text-lg font-bold text-white">Suba a lista enriquecida do Lemit</h2>
    <p className="text-sm text-[var(--color-v4-text-muted)] max-w-md mt-1">Clique em <b>Subir lista</b> pra escolher o <b>dono/responsável</b> e o <b>nicho</b> e enviar o CSV/XLS. Colunas no padrão Lemit
      (NOME EMPRESA, SÓCIO 1/2, WHATSAPP 1/2, EMAIL, SITE, CIDADE, ESTADO, LINKS…).</p>
    <button onClick={onOpen} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}><Upload size={15} /> Subir lista</button>
  </div>
);

// ---------------- Modal pós-arquivo: escolher BDR(s)/dono(s) + nicho ----------------
const BdrModal: React.FC<{ team: string[]; preview: { count: number; matched: number; missing: string[] } | null; fileName: string; nFiles: number; defOwners: string[]; defNicho: string; onCancel: () => void; onConfirm: (owners: string[], nicho: string) => void }> = ({ team, preview, fileName, nFiles, defOwners, defNicho, onCancel, onConfirm }) => {
  const [owners, setOwners] = useState<string[]>(defOwners);
  const [nicho, setNicho] = useState(defNicho);
  const toggle = (n: string) => setOwners((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  const total = preview?.count || 0;
  const alvo = owners.length ? owners : team;           // quem recebe (vazio = todos)
  const base = Math.floor(total / (alvo.length || 1));  // split estimado
  const resto = total % (alvo.length || 1);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className={`relative w-full max-w-md ${card} p-5`}>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Para qual(is) BDR(s) vai essa lista?</h3>
          <div className="flex-1" /><button onClick={onCancel} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button>
        </div>
        <div className="rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)] px-3 py-2 mb-3 text-[11px] text-[var(--color-v4-text-muted)]">
          📄 <b className="text-white">{fileName}</b>{nFiles > 1 ? ` +${nFiles - 1}` : ""}{preview ? ` · ${preview.count} lead(s) · colunas ${preview.matched}/13` : ""}
          {preview && preview.missing.length > 0 && <div className="text-amber-400 mt-0.5">faltando: {preview.missing.join(", ")}</div>}
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-[var(--color-v4-text-muted)] uppercase font-semibold">Dono(s) — pode marcar VÁRIOS {owners.length > 0 && <span className="text-white">· {owners.length} selecionado(s)</span>}</label>
              <button onClick={() => setOwners([...team])} className="text-[10.5px] underline hover:text-white" style={{ color: RED }}>Dividir entre a equipe (todos)</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {team.map((n) => {
                const on = owners.includes(n);
                return (
                  <button key={n} onClick={() => toggle(n)} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm text-left ${on ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`} style={on ? { background: RED } : undefined}>
                    <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center border-2 ${on ? "border-white/70" : "border-[var(--color-v4-text-muted)]"}`}>{on && <Check size={11} className="text-white" strokeWidth={3} />}</span>
                    {n}
                  </button>
                );
              })}
            </div>
            {owners.length > 0 && (
              <button onClick={() => setOwners([])} className="text-[10.5px] underline text-[var(--color-v4-text-muted)] hover:text-white mt-1">limpar seleção</button>
            )}
            <p className="text-[11px] mt-1.5" style={{ color: RED }}>
              {owners.length === 0
                ? `Nenhum marcado → divide entre todos (${team.length}) · ~${base}${resto ? `–${base + 1}` : ""} cada`
                : owners.length === 1
                  ? `Tudo para ${owners[0]} (${total} lead(s))`
                  : `Divide ${total} igualmente entre ${owners.length} → ~${base}${resto ? `–${base + 1}` : ""} cada (${owners.join(", ")})`}
            </p>
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)] uppercase font-semibold">Nicho da lista</label>
            <select value={nicho} onChange={(e) => setNicho(e.target.value)} className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm">
              {NICHOS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button onClick={() => onConfirm(owners, nicho)} className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-white text-sm font-bold" style={{ background: RED }}>
            <Upload size={14} /> Importar {preview ? `${preview.count} lead(s)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

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

          {/* ENRIQUECIMENTO (Lemit) — dados da empresa + sócios unificados */}
          {lead.enriquecidoEm && (
            <div className={`${card} p-4`}>
              <p className="text-sm font-bold text-white flex items-center gap-1.5 mb-2"><Database size={15} style={{ color: RED }} /> Enriquecimento <span className="text-[11px] font-normal text-[var(--color-v4-text-muted)]">· Lemit</span>{(lead.linhasUnificadas || 1) > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)]">{lead.linhasUnificadas} linhas unificadas</span>}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
                {([["CNPJ", lead.cnpj], ["Porte", lead.empresaInfo?.porte], ["Situação", lead.empresaInfo?.situacao], ["Atividade", lead.empresaInfo?.atividade ? `${lead.empresaInfo.atividade}${lead.empresaInfo.cnae ? ` (${lead.empresaInfo.cnae})` : ""}` : ""], ["Capital", lead.empresaInfo?.capitalSocial], ["Abertura", lead.empresaInfo?.dataAbertura], ["Funcionários", lead.empresaInfo?.funcionariosEstimado], ["Faturamento", lead.empresaInfo?.faturamentoEstimado]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="text-[12px]"><span className="text-[var(--color-v4-text-muted)]">{k}: </span><span className="text-white">{v}</span></div>
                ))}
              </div>
              {(lead.sociosExtra?.length || 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1 flex items-center gap-1"><Users2 size={11} /> Sócios / quadro societário</p>
                  <div className="space-y-1">
                    {lead.sociosExtra!.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">
                        <UserCheck size={12} className="text-[var(--color-v4-text-muted)]" /><span className="text-white font-medium">{s.nome}</span>
                        {s.cargo && <span className="text-[var(--color-v4-text-muted)] text-[10.5px]">{s.cargo}</span>}
                        {s.participacao && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-v4-card)] text-[var(--color-v4-text-muted)]">{s.participacao}</span>}
                        {s.telefone && <a href={telLink(s.telefone)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: RED }}><Phone size={11} />{s.telefone}</a>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-2 opacity-70">Enriquecido em {new Date(lead.enriquecidoEm).toLocaleString("pt-BR")} · protótipo (dados simulados). Produção: API do Lemit por CNPJ.</p>
            </div>
          )}

          {/* click-to-call — TODOS os telefones (decisor + principais + extras + sócios) */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5 flex items-center gap-1.5"><Phone size={12} /> Telefones — click-to-call <span className="normal-case font-normal text-[10px]">({allPhonesProsp(lead).length})</span></p>
            <div className="flex flex-col gap-2">
              {allPhonesProsp(lead).map((ph, i) => (
                <div key={i} className="inline-flex items-center rounded-lg border border-[var(--color-v4-border)] overflow-hidden w-fit">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--color-v4-text-muted)] px-2 py-1.5 border-r border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] min-w-[92px]">{ph.tipo}</span>
                  <a href={telLink(ph.numero)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white" style={{ background: RED }}><Phone size={13} /> {ph.numero}</a>
                  <a href={callLink(ph.numero)} title="Discar via API4COM (requer app 4COM)" className="px-2 py-1.5 text-[10px] text-[var(--color-v4-text-muted)] hover:text-white border-l border-[var(--color-v4-border)]">4COM</a>
                  <a href={whatsappLink(ph.numero)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm text-green-400 hover:bg-[var(--color-v4-surface)] border-l border-[var(--color-v4-border)]"><MessageCircle size={14} /></a>
                </div>
              ))}
              {allPhonesProsp(lead).length === 0 && <span className="text-sm text-[var(--color-v4-text-muted)]">Sem telefone.</span>}
            </div>
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
