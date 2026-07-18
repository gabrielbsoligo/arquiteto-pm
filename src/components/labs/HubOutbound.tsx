import React, { useMemo, useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from "recharts";
import {
  Download, Phone, MessageCircle, Star, Globe, Instagram, Facebook, Linkedin, Youtube,
  MapPin, Search, Sparkles, X, Building2, Copy, Check, ClipboardList, Users, Trash2, Calendar, Clock,
  LayoutGrid, Table2, BarChart3, Plus, UserCheck, Activity, AlertTriangle, TrendingUp, Beaker, Rocket,
  Database, RefreshCw, Briefcase, Users2,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  loadLeads, saveLeads, markDismissed, channelLink, telLink, callLink, whatsappLink, enrichLead, allPhones,
  generateApproach, toCSV, downloadCSV, canMoveTo, funnelMetrics, listQuality, maturityConversion, bdrProductivity,
  STATUS_LABELS, STATUS_ORDER, STATUS_HINT, STATUS_COLOR, NIVEIS, MOTIVOS_PERDA,
  ATIVIDADE_TIPOS, ATIVIDADE_RESULTADOS, tipoLabel, resultadoLabel, maturidadeMotivo, maturidadeBanda, nivelToNum,
  type ProspLead, type Status, type Nivel, type Touchpoint, type AtividadeTipo, type AtividadeResultado,
} from "./hubOutbound/hubLib";

/**
 * ProspeccaoHub — Plataforma de Gestão de Outbound (V4). Protótipo no clone Labs.
 * Pipeline de 9 etapas (Kanban com drag-and-drop), entidade Decisor, log de
 * Atividades (touchpoints), regras de bloqueio de etapa (Reunião Agendada exige
 * data+decisor; Perdido exige motivo) e painel de gestão (qualidade de lista,
 * maturidade×conversão, produtividade dos BDRs). Persiste em localStorage
 * (o clone é read-only). Tema dark, acento vermelho.
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
type ViewMode = "kanban" | "tabela" | "gestao";
interface HubProps { teamMembers?: Member[]; closers?: Member[]; }

const FALLBACK_TEAM = ["Lary", "Edric", "Bianca", "Erick"].map((n) => ({ id: n, name: n }));

export const HubOutbound: React.FC<HubProps> = ({ teamMembers, closers = [] }) => {
  const team = (teamMembers && teamMembers.length ? teamMembers : FALLBACK_TEAM);
  const teamNames = team.map((t) => t.name);

  const [leads, setLeads] = useState<ProspLead[]>(() => loadLeads());
  const [view, setView] = useState<ViewMode>("kanban");
  const [bdrFilter, setBdrFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [agendarFor, setAgendarFor] = useState<ProspLead | null>(null);
  const [perdaFor, setPerdaFor] = useState<ProspLead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const persist = (next: ProspLead[]) => { setLeads(next); saveLeads(next); };
  const updateLead = (id: string, patch: Partial<ProspLead>) => {
    const next = leads.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: new Date().toISOString() } : l));
    persist(next); return next.find((l) => l.id === id)!;
  };

  // integração: o upload é feito só na aba Prospecção. Aqui a gente re-sincroniza
  // (ingere leads novos) quando a aba ganha foco ou quando a Prospecção grava
  // (evento 'storage', dispara entre abas). Ver loadLeads() em hubLib.
  useEffect(() => {
    const resync = () => setLeads(loadLeads());
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === "v4_prospeccao_leads_v1") resync(); };
    window.addEventListener("focus", resync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("focus", resync); window.removeEventListener("storage", onStorage); };
  }, []);

  // auto-conserto: leads com dono fora do time atual → redistribuídos.
  useEffect(() => {
    if (!leads.length || !teamNames.length) return;
    const set = new Set(teamNames);
    const orphans = leads.filter((l) => !l.bdr || !set.has(l.bdr));
    if (!orphans.length) return;
    let i = 0;
    const next = leads.map((l) => (l.bdr && set.has(l.bdr) ? l : { ...l, bdr: teamNames[i++ % teamNames.length] }));
    persist(next);
    setBanner({ ok: true, msg: `Corrigi ${orphans.length} lead(s) com dono antigo → redistribuídos entre ${teamNames.join(", ")}.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNames.join(",")]);

  const bdrLeads = useMemo(() => leads.filter((l) => bdrFilter === "todos" || l.bdr === bdrFilter), [leads, bdrFilter]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bdrLeads.filter((l) =>
      (!statusFilter || l.status === statusFilter) &&
      (!s || l.empresa.toLowerCase().includes(s) || l.cidade.toLowerCase().includes(s) || (l.decisorNome || "").toLowerCase().includes(s)))
      .sort((a, b) => b.maturidade - a.maturidade);
  }, [bdrLeads, statusFilter, search]);

  const metrics = useMemo(() => funnelMetrics(bdrLeads), [bdrLeads]);
  const countByBdr = (b: string) => leads.filter((l) => l.bdr === b).length;
  const open = openId ? leads.find((l) => l.id === openId) || null : null;

  // seleção (remover leads)
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAllVisible = () => setSelected((s) => { const n = new Set(s); if (allVisibleSelected) filtered.forEach((l) => n.delete(l.id)); else filtered.forEach((l) => n.add(l.id)); return n; });
  const removeSelected = () => { if (!selected.size) return; if (confirm(`Remover ${selected.size} lead(s) do Hub? (não some da Prospecção)`)) { markDismissed(Array.from(selected)); persist(leads.filter((l) => !selected.has(l.id))); setSelected(new Set()); } };

  const exportCSV = () => {
    const rows = bdrFilter === "todos" ? leads : leads.filter((l) => l.bdr === bdrFilter);
    if (!rows.length) { setBanner({ ok: false, msg: "Nada pra exportar." }); return; }
    downloadCSV(`prospeccao_${bdrFilter}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows));
  };
  const clearAll = () => { if (confirm("Limpar o board do Hub? (os leads continuam na Prospecção; leads novos voltam a aparecer no próximo upload)")) { markDismissed(leads.map((l) => l.id)); persist([]); } };

  // ---------------- MOVIMENTAÇÃO com REGRAS DE NEGÓCIO ----------------
  const moveLead = (lead: ProspLead, to: Status) => {
    if (to === lead.status) return;
    if (to === "reuniao_agendada") {
      const chk = canMoveTo(lead, to);
      if (chk.ok) { updateLead(lead.id, { status: to }); }
      else setAgendarFor(lead); // modal coleta decisor + data e então promove
      return;
    }
    if (to === "perdido") { setPerdaFor(lead); return; } // modal coleta motivo (obrigatório)
    // ao ENTRAR em Enriquecimento, puxa mais dados do Lemit (se ainda não puxou)
    if (to === "enriquecimento" && !lead.enriquecidoEm) {
      const dados = enrichLead(lead);
      updateLead(lead.id, { status: to, ...dados });
      setBanner({ ok: true, msg: `${lead.empresa}: enriquecido via Lemit — decisor ${dados.decisorNome || "—"} preenchido · +${dados.telefonesExtra?.length || 0} telefone(s), +${dados.sociosExtra?.length || 0} sócio(s) e dados cadastrais.` });
      return;
    }
    updateLead(lead.id, { status: to });
  };

  // enriquecer manualmente (botão no painel) — re-puxa do Lemit
  const enrich = (lead: ProspLead) => {
    const dados = enrichLead(lead);
    updateLead(lead.id, dados);
    setBanner({ ok: true, msg: `${lead.empresa}: dados do Lemit atualizados — decisor ${dados.decisorNome || "—"} · ${dados.telefonesExtra?.length || 0} telefone(s) extra, ${dados.sociosExtra?.length || 0} sócio(s), dados cadastrais.` });
  };

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const to = r.destination.droppableId as Status;
    const lead = leads.find((l) => l.id === r.draggableId);
    if (lead) moveLead(lead, to);
  };

  const confirmAgendar = (opts: { dataISO: string; closerId?: string; canal: string; closerNome?: string; decisorNome: string }) => {
    if (!agendarFor) return;
    const closerNome = closers.find((c) => c.id === opts.closerId)?.name || opts.closerNome || "";
    updateLead(agendarFor.id, { status: "reuniao_agendada", dataReuniao: opts.dataISO, closerId: opts.closerId, closerNome, canal: opts.canal, decisorNome: opts.decisorNome || agendarFor.decisorNome });
    setAgendarFor(null);
    setBanner({ ok: true, msg: `Reunião agendada com ${closerNome || "closer"} — ${new Date(opts.dataISO).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (simulação local).` });
  };
  const confirmPerda = (motivo: string, nota: string) => {
    if (!perdaFor) return;
    updateLead(perdaFor.id, { status: "perdido", motivoPerda: motivo, notas: nota ? `${perdaFor.notas ? perdaFor.notas + " · " : ""}Perda: ${nota}` : perdaFor.notas });
    setPerdaFor(null);
    setBanner({ ok: true, msg: `Lead marcado como Perdido · motivo: ${motivo}.` });
  };
  const addAtividade = (lead: ProspLead, tp: Omit<Touchpoint, "id">) => {
    const nova: Touchpoint = { ...tp, id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, bdr: lead.bdr };
    updateLead(lead.id, { atividades: [...(lead.atividades || []), nova] });
  };

  // dados de exemplo p/ o gestor ver os dashboards preenchidos (simulação local)
  const loadDemo = () => { if (!leads.length || confirm("Isto substitui os leads atuais por uma base de exemplo. Continuar?")) { const demo = seedDemo(teamNames); persist(demo); setBanner({ ok: true, msg: `${demo.length} leads de exemplo carregados (3 BDRs · 3 nichos · atividades e perdas) — explore o Kanban e a Gestão.` }); } };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      {/* HEADER */}
      <div className="sticky top-0 z-20 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center font-black text-white" style={{ background: RED }}>V4</div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">Gestão de <span style={{ color: RED }}>Outbound</span></h1>
            <p className="text-[11px] text-[var(--color-v4-text-muted)]">Pipeline · Decisores · Atividades · Gestão — São José dos Campos & Vale do Paraíba</p>
          </div>
        </div>
        <div className="flex-1" />
        {/* toggle de visão */}
        <div className="inline-flex rounded-lg border border-[var(--color-v4-border)] overflow-hidden">
          <ViewTab active={view === "kanban"} onClick={() => setView("kanban")} icon={LayoutGrid} label="Kanban" />
          <ViewTab active={view === "tabela"} onClick={() => setView("tabela")} icon={Table2} label="Tabela" />
          <ViewTab active={view === "gestao"} onClick={() => setView("gestao")} icon={BarChart3} label="Gestão" />
        </div>
        <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] text-[var(--color-v4-text-muted)] px-2.5 py-2 rounded-lg border border-dashed border-[var(--color-v4-border)]">
          <Rocket size={13} style={{ color: RED }} /> Listas vêm da aba <b className="text-white">Prospecção</b>
        </span>
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-v4-border)] text-sm font-semibold text-white hover:bg-[var(--color-v4-card-hover)]">
          <Download size={15} /> Exportar
        </button>
        {leads.length > 0 && (
          <button onClick={clearAll} title="Limpar board do Hub" className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)] text-sm"><Trash2 size={15} /></button>
        )}
      </div>

      <div className="p-6">
        {banner && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border ${banner.ok ? "bg-[var(--color-v4-surface)] text-white border-[var(--color-v4-border)]" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
            {banner.msg} <button onClick={() => setBanner(null)} className="float-right text-[var(--color-v4-text-muted)] hover:text-white"><X size={14} /></button>
          </div>
        )}

        {leads.length === 0 ? (
          <EmptyState onDemo={loadDemo} />
        ) : (
          <>
            {/* filtros BDR + busca + métricas topo */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Users size={15} className="text-[var(--color-v4-text-muted)]" />
              <TabBtn active={bdrFilter === "todos"} onClick={() => setBdrFilter("todos")} label={`Todos (${leads.length})`} />
              {teamNames.map((b) => <TabBtn key={b} active={bdrFilter === b} onClick={() => setBdrFilter(b)} label={`${b} (${countByBdr(b)})`} />)}
              <div className="flex-1" />
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-v4-text-muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa, cidade, decisor…"
                  className="pl-8 pr-3 py-2 rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </div>
            </div>

            <MetricStrip m={metrics} />

            {view === "kanban" && (
              <KanbanBoard leads={filtered} onDragEnd={onDragEnd} onOpen={(id) => setOpenId(id)} />
            )}

            {view === "tabela" && (
              <TabelaView
                filtered={filtered} selected={selected} allVisibleSelected={allVisibleSelected}
                toggleSel={toggleSel} toggleAllVisible={toggleAllVisible} removeSelected={removeSelected}
                clearSel={() => setSelected(new Set())} onOpen={(id) => setOpenId(id)}
                statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              />
            )}

            {view === "gestao" && (
              <GestaoPanel leads={bdrLeads} team={bdrFilter === "todos" ? teamNames : [bdrFilter]} onDemo={loadDemo} />
            )}
          </>
        )}
      </div>

      {open && <LeadPanel lead={open} closers={closers} onClose={() => setOpenId(null)}
        onUpdate={(patch) => updateLead(open.id, patch)} onMove={(s) => moveLead(open, s)} onAddAtividade={(tp) => addAtividade(open, tp)} onEnrich={() => enrich(open)} />}
      {agendarFor && <AgendarModal lead={agendarFor} closers={closers} onClose={() => setAgendarFor(null)} onConfirm={confirmAgendar} />}
      {perdaFor && <PerdaModal lead={perdaFor} onClose={() => setPerdaFor(null)} onConfirm={confirmPerda} />}
    </div>
  );
};

// ================= MÉTRICAS (topo) =================
const MetricStrip: React.FC<{ m: ReturnType<typeof funnelMetrics> }> = ({ m }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
    <Kpi label="Leads no funil" value={m.total} />
    <Kpi label="Taxa de agendamento" value={`${m.taxaAgendamento}%`} hint="reuniões agendadas / total" accent />
    <Kpi label="Ganhos" value={m.ganhos} hint={`${m.taxaGanho}% do total`} />
    <Kpi label="Perdidos" value={m.perdidos} hint="com motivo" danger />
  </div>
);
const Kpi: React.FC<{ label: string; value: React.ReactNode; hint?: string; accent?: boolean; danger?: boolean }> = ({ label, value, hint, accent, danger }) => (
  <div className={`${card} px-3 py-2`}>
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-v4-text-muted)]">{label}</div>
    <div className="text-2xl font-bold" style={{ color: accent ? RED : danger ? "#ef4444" : "#fff" }}>{value}</div>
    {hint && <div className="text-[10px] text-[var(--color-v4-text-muted)]">{hint}</div>}
  </div>
);

// ================= KANBAN =================
const KanbanBoard: React.FC<{ leads: ProspLead[]; onDragEnd: (r: DropResult) => void; onOpen: (id: string) => void }> = ({ leads, onDragEnd, onOpen }) => {
  const byStatus = (s: Status) => leads.filter((l) => l.status === s);
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STATUS_ORDER.map((s) => {
          const col = byStatus(s);
          return (
            <div key={s} className="w-[230px] shrink-0">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                <span className="text-[11px] font-bold text-white uppercase tracking-wide truncate">{STATUS_LABELS[s]}</span>
                <span className="ml-auto text-[11px] text-[var(--color-v4-text-muted)] font-semibold">{col.length}</span>
              </div>
              <Droppable droppableId={s}>
                {(provided, snap) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}
                    className={`rounded-xl border p-2 min-h-[120px] transition-colors ${snap.isDraggingOver ? "border-[var(--color-v4-red)] bg-[var(--color-v4-surface)]" : "border-[var(--color-v4-border)] bg-[var(--color-v4-card)]"}`}>
                    <div className="text-[9px] text-[var(--color-v4-text-muted)] mb-1.5 px-1">{STATUS_HINT[s]}</div>
                    {col.map((l: ProspLead, i: number) => (
                      <Draggable draggableId={l.id} index={i} key={l.id}>
                        {(prov, dsnap) => (
                          <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                            onClick={() => onOpen(l.id)}
                            className={`mb-2 rounded-lg border bg-[var(--color-v4-surface)] p-2.5 cursor-pointer select-none ${dsnap.isDragging ? "border-[var(--color-v4-red)] shadow-lg" : "border-[var(--color-v4-border)] hover:border-[var(--color-v4-red)]"}`}>
                            <div className="flex items-start gap-1.5">
                              <Building2 size={13} className="text-[var(--color-v4-text-muted)] mt-0.5 shrink-0" />
                              <span className="text-[12.5px] font-semibold text-white leading-tight">{l.empresa || "—"}</span>
                            </div>
                            <div className="text-[10.5px] text-[var(--color-v4-text-muted)] mt-1 flex items-center gap-1"><MapPin size={10} />{[l.cidade, l.estado].filter(Boolean).join("/") || "—"}</div>
                            {l.decisorNome && <div className="text-[10.5px] text-[var(--color-v4-text-muted)] flex items-center gap-1 mt-0.5"><UserCheck size={10} />{l.decisorNome}{l.decisorCargo ? ` · ${l.decisorCargo}` : ""}</div>}
                            {l.status === "reuniao_agendada" && l.dataReuniao && <div className="text-[10px] mt-1" style={{ color: STATUS_COLOR.reuniao_agendada }}>📅 {new Date(l.dataReuniao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>}
                            {l.status === "perdido" && l.motivoPerda && <div className="text-[10px] mt-1 text-red-400">✕ {l.motivoPerda}</div>}
                            {l.enriquecidoEm && (
                              <div className="mt-1.5 rounded-md bg-[var(--color-v4-card)] border border-[var(--color-v4-border)] px-1.5 py-1 space-y-0.5">
                                <div className="flex items-center gap-1 text-[9px] font-semibold" style={{ color: RED }}><Database size={9} /> LEMIT ✓{l.empresaInfo?.porte ? ` · ${l.empresaInfo.porte}` : ""}</div>
                                <div className="flex items-center gap-2 text-[9.5px] text-[var(--color-v4-text-muted)]">
                                  <span className="inline-flex items-center gap-0.5"><Phone size={9} />{allPhones(l).length} tel</span>
                                  <span className="inline-flex items-center gap-0.5"><Users2 size={9} />{1 + (l.sociosExtra?.length || 0)} sócio(s)</span>
                                </div>
                                {l.empresaInfo?.atividade && <div className="text-[9px] text-[var(--color-v4-text-muted)] truncate">{l.empresaInfo.atividade}</div>}
                              </div>
                            )}
                            {l.status === "enriquecimento" && !l.enriquecidoEm && <div className="text-[9.5px] mt-1 text-amber-400 flex items-center gap-1"><RefreshCw size={9} /> enriquecendo via Lemit…</div>}
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[var(--color-v4-card)] border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)]">{l.bdr || "—"}</span>
                              <Stars value={l.maturidade} readOnly small />
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {col.length === 0 && <div className="text-[10px] text-[var(--color-v4-text-muted)] text-center py-3 opacity-50">arraste um card aqui</div>}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
};

// ================= TABELA =================
const TabelaView: React.FC<{
  filtered: ProspLead[]; selected: Set<string>; allVisibleSelected: boolean;
  toggleSel: (id: string) => void; toggleAllVisible: () => void; removeSelected: () => void; clearSel: () => void;
  onOpen: (id: string) => void; statusFilter: Status | null; setStatusFilter: (s: Status | null) => void;
}> = ({ filtered, selected, allVisibleSelected, toggleSel, toggleAllVisible, removeSelected, clearSel, onOpen, statusFilter, setStatusFilter }) => (
  <>
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <span className="text-[11px] text-[var(--color-v4-text-muted)]">Filtrar etapa:</span>
      {STATUS_ORDER.map((s) => (
        <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
          className={`text-[10.5px] px-2 py-0.5 rounded-full border ${statusFilter === s ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`}
          style={statusFilter === s ? { background: STATUS_COLOR[s] } : undefined}>{STATUS_LABELS[s]}</button>
      ))}
      {statusFilter && <button onClick={() => setStatusFilter(null)} className="text-[10.5px] underline text-[var(--color-v4-text-muted)]">limpar</button>}
    </div>

    {selected.size > 0 && (
      <div className="flex flex-wrap items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">
        <span className="text-sm text-white font-medium">{selected.size} selecionado(s)</span>
        <button onClick={removeSelected} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ background: RED }}><Trash2 size={13} /> Remover selecionados</button>
        <button onClick={clearSel} className="text-xs text-[var(--color-v4-text-muted)] underline hover:text-white">limpar seleção</button>
      </div>
    )}

    <div className={`overflow-x-auto ${card}`}>
      <table className="w-full text-sm min-w-[980px]">
        <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2.5 w-8"><Cbox checked={allVisibleSelected} onChange={toggleAllVisible} title="Selecionar / limpar todos" /></th>
            <th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Nicho</th><th className="px-3 py-2.5">Cidade/UF</th>
            <th className="px-3 py-2.5">Decisor</th><th className="px-3 py-2.5">Dono</th><th className="px-3 py-2.5">Presença</th>
            <th className="px-3 py-2.5">Etapa</th><th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((l) => (
            <tr key={l.id} className={`border-t border-[var(--color-v4-border)] hover:bg-[var(--color-v4-card-hover)] cursor-pointer text-white ${selected.has(l.id) ? "bg-[var(--color-v4-surface)]/60" : ""}`} onClick={() => onOpen(l.id)}>
              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><Cbox checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} title="Selecionar este lead" /></td>
              <td className="px-3 py-2.5 font-semibold flex items-center gap-2"><Building2 size={14} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</td>
              <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)] text-[11px]">{l.nicho || "—"}</td>
              <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{[l.cidade, l.estado].filter(Boolean).join("/") || "—"}</td>
              <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.decisorNome || "—"}{l.decisorCargo ? <span className="text-[10px]"> · {l.decisorCargo}</span> : ""}</td>
              <td className="px-3 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">{l.bdr || "—"}</span></td>
              <td className="px-3 py-2.5"><Stars value={l.maturidade} readOnly /></td>
              <td className="px-3 py-2.5"><StatusPill status={l.status} /></td>
              <td className="px-3 py-2.5 text-right"><span className="text-[11px] font-semibold" style={{ color: RED }}>Abrir →</span></td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--color-v4-text-muted)]">Nenhum lead nesse filtro.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-[11px] text-[var(--color-v4-text-muted)] mt-2">{filtered.length} lead(s) · ordenados por presença digital · salvos neste navegador</p>
  </>
);

// ================= GESTÃO (dashboards) =================
const GestaoPanel: React.FC<{ leads: ProspLead[]; team: string[]; onDemo: () => void }> = ({ leads, team, onDemo }) => {
  const quality = useMemo(() => listQuality(leads), [leads]);
  const matrix = useMemo(() => maturityConversion(leads), [leads]);
  const prod = useMemo(() => bdrProductivity(leads, team), [leads, team]);
  const semAtividade = prod.every((p) => p.atividades === 0);

  return (
    <div className="space-y-4">
      {/* 1) Qualidade da lista */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-1"><ClipboardList size={15} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Qualidade da Lista</h3></div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Cruza a origem da lista com a taxa de reuniões agendadas e as perdas por dados incorretos.</p>
        {quality.length === 0 ? <Empty msg="Sem listas ainda." /> : (
          <div className="grid md:grid-cols-2 gap-4">
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={quality} margin={{ top: 6, right: 10, bottom: 6, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" vertical={false} />
                  <XAxis dataKey="origem" tick={{ fill: "#9a9a9a", fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={44} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, "Taxa agendamento"]} />
                  <Bar dataKey="taxaAgendamento" radius={[4, 4, 0, 0]}>
                    {quality.map((q, i) => <Cell key={i} fill={q.taxaDadosRuins > 15 ? "#ef4444" : "#e63946"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[var(--color-v4-text-muted)] text-left text-[10px] uppercase">
                  <tr><th className="py-1.5 pr-2">Origem</th><th className="py-1.5 px-2">Leads</th><th className="py-1.5 px-2">Agend.</th><th className="py-1.5 px-2">Tx. Agend.</th><th className="py-1.5 px-2">Dados ruins</th></tr>
                </thead>
                <tbody className="text-white">
                  {quality.map((q) => (
                    <tr key={q.origem} className="border-t border-[var(--color-v4-border)]">
                      <td className="py-1.5 pr-2 font-medium truncate max-w-[160px]">{q.origem}</td>
                      <td className="py-1.5 px-2">{q.total}</td>
                      <td className="py-1.5 px-2">{q.agendadas}</td>
                      <td className="py-1.5 px-2 font-semibold" style={{ color: RED }}>{q.taxaAgendamento}%</td>
                      <td className="py-1.5 px-2"><span className={q.taxaDadosRuins > 15 ? "text-red-400 font-semibold" : "text-[var(--color-v4-text-muted)]"}>{q.perdasDados} ({q.taxaDadosRuins}%)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-2 flex items-center gap-1"><AlertTriangle size={11} className="text-red-400" /> Origem com &gt;15% de perda por dados incorretos aparece em vermelho — candidata a trocar de fornecedor.</p>
            </div>
          </div>
        )}
      </div>

      {/* 2) Maturidade vs Conversão por nicho */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-1"><TrendingUp size={15} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Maturidade Digital × Conversão (por nicho)</h3></div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Qual nível de maturidade digital converte mais em reunião, em cada nicho. Célula = taxa de agendamento (nº agendadas / leads).</p>
        {matrix.length === 0 ? <Empty msg="Sem dados de nicho ainda." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[var(--color-v4-text-muted)] text-left text-[10px] uppercase">
                <tr><th className="py-1.5 pr-3">Nicho</th>{NIVEIS.map((nv) => <th key={nv} className="py-1.5 px-3 text-center">{nv}</th>)}<th className="py-1.5 px-3 text-center">Total</th></tr>
              </thead>
              <tbody className="text-white">
                {matrix.map((row: any) => (
                  <tr key={row.nicho} className="border-t border-[var(--color-v4-border)]">
                    <td className="py-1.5 pr-3 font-medium">{row.nicho}</td>
                    {NIVEIS.map((nv) => {
                      const c = row[nv]; const taxa = c.taxa;
                      return (
                        <td key={nv} className="py-1.5 px-3 text-center">
                          {c.total === 0 ? <span className="text-[var(--color-v4-text-muted)]">—</span> : (
                            <div><span className="font-bold" style={{ color: heat(taxa) }}>{taxa}%</span>
                              <div className="text-[9px] text-[var(--color-v4-text-muted)]">{c.agendadas}/{c.total}</div></div>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-3 text-center text-[var(--color-v4-text-muted)]">{row._total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-2">Verde = converte melhor · vermelho = pior. Em produção, dá pra medir também a <b>velocidade</b> (dias até agendar) usando o histórico de etapas.</p>
          </div>
        )}
      </div>

      {/* 3) Produtividade dos BDRs */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-1"><Activity size={15} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Produtividade dos BDRs</h3>
          {semAtividade && <button onClick={onDemo} className="ml-auto text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-white"><Beaker size={12} /> Carregar dados de exemplo</button>}
        </div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Volume de atividades por BDR: total de ligações (cold call) vs. total de conexões (falou com o decisor).</p>
        {prod.length === 0 ? <Empty msg="Sem BDRs." /> : (
          <div className="grid md:grid-cols-2 gap-4">
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={prod} margin={{ top: 6, right: 10, bottom: 6, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" vertical={false} />
                  <XAxis dataKey="bdr" tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="ligacoes" name="Ligações" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="conexoes" name="Conexões" fill="#e63946" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[var(--color-v4-text-muted)] text-left text-[10px] uppercase">
                  <tr><th className="py-1.5 pr-2">BDR</th><th className="py-1.5 px-2">Ativ.</th><th className="py-1.5 px-2">Ligações</th><th className="py-1.5 px-2">Conexões</th><th className="py-1.5 px-2">Tx. Conex.</th><th className="py-1.5 px-2">Agend.</th></tr>
                </thead>
                <tbody className="text-white">
                  {prod.map((p) => (
                    <tr key={p.bdr} className="border-t border-[var(--color-v4-border)]">
                      <td className="py-1.5 pr-2 font-medium">{p.bdr}</td>
                      <td className="py-1.5 px-2">{p.atividades}</td>
                      <td className="py-1.5 px-2">{p.ligacoes}</td>
                      <td className="py-1.5 px-2">{p.conexoes}</td>
                      <td className="py-1.5 px-2 font-semibold" style={{ color: RED }}>{p.taxaConexao}%</td>
                      <td className="py-1.5 px-2">{p.agendadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-2">Registre as atividades no painel do lead (aba “Atividades”) que estes números se atualizam.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
const heat = (taxa: number | null) => taxa == null ? "#9a9a9a" : taxa >= 40 ? "#34d399" : taxa >= 20 ? "#f59e0b" : "#ef4444";
const tooltipStyle = { background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, color: "#fff", fontSize: 12 } as const;
const Empty: React.FC<{ msg: string }> = ({ msg }) => <div className="py-8 text-center text-[var(--color-v4-text-muted)] text-sm">{msg}</div>;

// ================= UI helpers =================
const ViewTab: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${active ? "text-white" : "text-[var(--color-v4-text-muted)] hover:bg-[var(--color-v4-card-hover)]"}`} style={active ? { background: RED } : undefined}>
    <Icon size={14} /> {label}
  </button>
);

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

const StatusPill: React.FC<{ status: Status }> = ({ status }) => (
  <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: STATUS_COLOR[status] + "26", color: STATUS_COLOR[status] }}>{STATUS_LABELS[status]}</span>
);

const Stars: React.FC<{ value: number; onChange?: (v: number) => void; readOnly?: boolean; small?: boolean }> = ({ value, onChange, readOnly, small }) => (
  <div className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} disabled={readOnly} onClick={(e) => { e.stopPropagation(); onChange?.(n); }} className={readOnly ? "" : "hover:scale-110 transition-transform"}>
        <Star size={readOnly ? (small ? 11 : 13) : 22} fill={n <= value ? "#e63946" : "none"} color={n <= value ? "#e63946" : "#4a4a4a"} />
      </button>
    ))}
  </div>
);

const EmptyState: React.FC<{ onDemo: () => void }> = ({ onDemo }) => (
  <div className="border-2 border-dashed border-[var(--color-v4-border)] rounded-2xl py-16 flex flex-col items-center justify-center text-center">
    <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: RED }}><LayoutGrid size={26} className="text-white" /></div>
    <h2 className="text-lg font-bold text-white">Plataforma de Gestão de Outbound</h2>
    <p className="text-sm text-[var(--color-v4-text-muted)] max-w-md mt-1">Os leads chegam aqui automaticamente quando você <b className="text-white">sobe uma lista na aba Prospecção</b> — o upload é feito só lá pra não ter dois lugares com a mesma ação. Depois é só trabalhar o pipeline de 9 etapas aqui.</p>
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
      <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm"><Rocket size={15} style={{ color: RED }} /> Suba a lista na aba Prospecção</span>
      <button onClick={onDemo} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-v4-border)] text-white text-sm font-semibold hover:bg-[var(--color-v4-card-hover)]"><Beaker size={15} /> Carregar dados de exemplo</button>
    </div>
  </div>
);

// ---------------- Modal Agendar (regra: exige Decisor + Data) ----------------
const AgendarModal: React.FC<{ lead: ProspLead; closers: Member[]; onClose: () => void; onConfirm: (o: { dataISO: string; closerId?: string; canal: string; closerNome?: string; decisorNome: string }) => void }> = ({ lead, closers, onClose, onConfirm }) => {
  const now = new Date(Date.now() + 864e5); const p = (n: number) => String(n).padStart(2, "0");
  const [data, setData] = useState(lead.dataReuniao ? lead.dataReuniao.slice(0, 16) : `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T10:00`);
  const [decisor, setDecisor] = useState(lead.decisorNome || "");
  const [closerId, setCloserId] = useState(closers[0]?.id || "");
  const [closerNome, setCloserNome] = useState("");
  const [canal, setCanal] = useState("outbound");
  const ok = !!data && !!decisor.trim() && (!!closerId || !!closerNome.trim());
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-sm ${card} p-5`}>
        <div className="flex items-center gap-2 mb-1"><Calendar size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Agendar reunião — {lead.empresa}</h3></div>
        <p className="text-[11px] text-amber-400 mb-3 flex items-center gap-1"><AlertTriangle size={12} /> Regra: só entra em “Reunião Agendada” com Decisor + Data preenchidos.</p>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)]">Decisor *</label>
            <input value={decisor} onChange={(e) => setDecisor(e.target.value)} placeholder="Nome do decisor" className="w-full mt-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-[var(--color-v4-text-muted)]">Data e hora *</label>
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
          <button disabled={!ok} onClick={() => onConfirm({ dataISO: new Date(data).toISOString(), closerId: closerId || undefined, canal, closerNome: closerNome || undefined, decisorNome: decisor })}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-30" style={{ background: RED }}>
            <Clock size={14} /> Agendar
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------- Modal Perda (regra: motivo obrigatório) ----------------
const PerdaModal: React.FC<{ lead: ProspLead; onClose: () => void; onConfirm: (motivo: string, nota: string) => void }> = ({ lead, onClose, onConfirm }) => {
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-sm ${card} p-5`}>
        <div className="flex items-center gap-2 mb-1"><AlertTriangle size={16} className="text-red-400" /><h3 className="text-sm font-bold text-white">Perder / descartar — {lead.empresa}</h3></div>
        <p className="text-[11px] text-amber-400 mb-3">Regra: o motivo da perda é obrigatório (alimenta a análise de qualidade da lista).</p>
        <label className="text-[11px] text-[var(--color-v4-text-muted)]">Motivo *</label>
        <div className="grid grid-cols-1 gap-1.5 mt-1 mb-3">
          {MOTIVOS_PERDA.map((m) => (
            <button key={m} onClick={() => setMotivo(m)} className={`text-left text-[12.5px] px-3 py-1.5 rounded-lg border ${motivo === m ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`} style={motivo === m ? { background: RED } : undefined}>{m}</button>
          ))}
        </div>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observação (opcional)" className="w-full border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button disabled={!motivo} onClick={() => onConfirm(motivo, nota)} className="flex-1 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-30 bg-red-600">Confirmar perda</button>
        </div>
      </div>
    </div>
  );
};

// ---------------- Painel do Lead ----------------
const LeadPanel: React.FC<{ lead: ProspLead; closers: Member[]; onClose: () => void; onUpdate: (patch: Partial<ProspLead>) => void; onMove: (s: Status) => void; onAddAtividade: (tp: Omit<Touchpoint, "id">) => void; onEnrich: () => void }> = ({ lead, onClose, onUpdate, onMove, onAddAtividade, onEnrich }) => {
  const [copied, setCopied] = useState(false);
  const links = [
    { kind: "site", label: "Site", Icon: Globe }, { kind: "instagram", label: "Instagram", Icon: Instagram },
    { kind: "facebook", label: "Facebook", Icon: Facebook }, { kind: "linkedin", label: "LinkedIn", Icon: Linkedin },
    { kind: "youtube", label: "YouTube", Icon: Youtube }, { kind: "gmb", label: "Google Meu Negócio", Icon: MapPin },
    { kind: "google", label: "Buscar no Google", Icon: Search },
  ] as const;
  const genApproach = () => onUpdate({ abordagem: generateApproach(lead) });
  const copy = () => { navigator.clipboard?.writeText(lead.abordagem); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const setNivel = (nv: Nivel) => onUpdate({ maturidadeNivel: nv, maturidade: nivelToNum(nv) });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-[var(--color-v4-card)] h-full overflow-y-auto shadow-2xl text-[var(--color-v4-text)] border-l border-[var(--color-v4-border)]">
        <div className="sticky top-0 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-5 py-4 flex items-start gap-3 z-10">
          <div>
            <h2 className="text-base font-extrabold flex items-center gap-2 text-white"><Building2 size={18} style={{ color: RED }} />{lead.empresa || "—"}</h2>
            <p className="text-xs text-[var(--color-v4-text-muted)]">{[lead.cidade, lead.estado].filter(Boolean).join("/")} · {lead.nicho} · dono {lead.bdr || "—"} · origem {lead.origem || "—"}</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* status / etapa (com regras) */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Etapa do pipeline</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button key={s} onClick={() => onMove(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${lead.status === s ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`}
                  style={lead.status === s ? { background: STATUS_COLOR[s] } : undefined}>{STATUS_LABELS[s]}</button>
              ))}
            </div>
            {lead.status === "reuniao_agendada" && lead.dataReuniao && (
              <p className="text-[11px] mt-1.5" style={{ color: STATUS_COLOR.reuniao_agendada }}>📅 {new Date(lead.dataReuniao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · closer {lead.closerNome || "—"} · {lead.canal}</p>
            )}
            {lead.status === "perdido" && lead.motivoPerda && <p className="text-[11px] text-red-400 mt-1.5">✕ Perdido — {lead.motivoPerda}</p>}
          </div>

          {/* DECISOR */}
          <div className={`${card} p-4`}>
            <p className="text-sm font-bold text-white flex items-center gap-1.5 mb-2"><UserCheck size={15} style={{ color: RED }} /> Decisor (contato)
              {lead.enriquecidoEm && <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ color: RED, background: "var(--color-v4-surface)" }}><Database size={9} /> preenchido via Lemit</span>}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FieldEdit label="Nome" value={lead.decisorNome} onChange={(v) => onUpdate({ decisorNome: v })} />
              <FieldEdit label="Cargo" value={lead.decisorCargo} onChange={(v) => onUpdate({ decisorCargo: v })} placeholder="CEO, Diretor Comercial, Sócia…" />
              <FieldEdit label="Telefone" value={lead.decisorTel} onChange={(v) => onUpdate({ decisorTel: v })} />
              <FieldEdit label="E-mail" value={lead.decisorEmail} onChange={(v) => onUpdate({ decisorEmail: v })} />
              <div className="col-span-2"><FieldEdit label="LinkedIn" value={lead.decisorLinkedin} onChange={(v) => onUpdate({ decisorLinkedin: v })} placeholder="linkedin.com/in/…" /></div>
            </div>
          </div>

          {/* ENRIQUECIMENTO (Lemit) */}
          <EnriquecimentoBox lead={lead} onEnrich={onEnrich} />

          {/* click-to-call — TODOS os telefones (principais + decisor + extras + sócios) */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5 flex items-center gap-1.5"><Phone size={12} /> Telefones — click-to-call <span className="normal-case font-normal text-[10px]">({allPhones(lead).length})</span></p>
            <div className="flex flex-col gap-2">
              {allPhones(lead).map((ph, i) => (
                <div key={i} className="inline-flex items-center rounded-lg border border-[var(--color-v4-border)] overflow-hidden w-fit">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--color-v4-text-muted)] px-2 py-1.5 border-r border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] min-w-[92px]">{ph.tipo}</span>
                  <a href={telLink(ph.numero)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white" style={{ background: RED }}><Phone size={13} /> {ph.numero}</a>
                  <a href={callLink(ph.numero)} title="Discar via API4COM (requer app 4COM)" className="px-2 py-1.5 text-[10px] text-[var(--color-v4-text-muted)] hover:text-white border-l border-[var(--color-v4-border)]">4COM</a>
                  <a href={whatsappLink(ph.numero)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm text-green-400 hover:bg-[var(--color-v4-surface)] border-l border-[var(--color-v4-border)]"><MessageCircle size={14} /></a>
                </div>
              ))}
              {allPhones(lead).length === 0 && <span className="text-sm text-[var(--color-v4-text-muted)]">Sem telefone. Mova pra “Enriquecimento” pra puxar do Lemit.</span>}
            </div>
          </div>

          {/* ATIVIDADES (touchpoints) */}
          <AtividadesBox lead={lead} onAdd={onAddAtividade} />

          {/* links */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1.5">Investigação — links clicáveis</p>
            <div className="flex flex-wrap gap-2">
              {links.map(({ kind, label, Icon }) => {
                const { href, derived } = channelLink(lead, kind);
                return (
                  <a key={kind} href={href} target="_blank" rel="noopener"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${derived ? "border-dashed border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)]" : "border-[var(--color-v4-border)] text-white hover:border-[var(--color-v4-red)]"}`}
                    title={derived ? "Não veio na lista — abre uma busca" : href}>
                    <Icon size={14} style={{ color: derived ? undefined : "#e63946" }} /> {label}{derived ? " 🔎" : ""}
                  </a>
                );
              })}
            </div>
          </div>

          {/* maturidade (Baixa/Média/Alta) + IA */}
          <div className={`${card} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">Maturidade digital</p>
                <p className="text-[11px] text-[var(--color-v4-text-muted)]">{maturidadeMotivo(lead)}</p>
              </div>
              <Stars value={lead.maturidade} onChange={(v) => onUpdate({ maturidade: v, maturidadeNivel: maturidadeBanda(v) })} />
            </div>
            <div className="flex gap-1.5 mt-3">
              {NIVEIS.map((nv) => (
                <button key={nv} onClick={() => setNivel(nv)} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border ${lead.maturidadeNivel === nv ? "text-white border-transparent" : "text-[var(--color-v4-text-muted)] border-[var(--color-v4-border)] hover:bg-[var(--color-v4-surface)]"}`} style={lead.maturidadeNivel === nv ? { background: RED } : undefined}>{nv}</button>
              ))}
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

// ---------------- Atividades (registro + histórico) ----------------
// ---------------- Enriquecimento (Lemit) ----------------
const EnriquecimentoBox: React.FC<{ lead: ProspLead; onEnrich: () => void }> = ({ lead, onEnrich }) => {
  const info = lead.empresaInfo;
  const rows: [string, string | undefined][] = [
    ["CNPJ", lead.cnpj], ["Porte", info?.porte], ["Situação", info?.situacao], ["Natureza jurídica", info?.naturezaJuridica],
    ["Atividade (CNAE)", info?.atividade ? `${info.atividade}${info.cnae ? ` (${info.cnae})` : ""}` : undefined],
    ["Capital social", info?.capitalSocial], ["Abertura", info?.dataAbertura],
    ["Funcionários (est.)", info?.funcionariosEstimado], ["Faturamento (est.)", info?.faturamentoEstimado],
  ];
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Database size={15} style={{ color: RED }} />
        <p className="text-sm font-bold text-white">Enriquecimento <span className="text-[11px] font-normal text-[var(--color-v4-text-muted)]">· Lemit</span></p>
        <div className="flex-1" />
        <button onClick={onEnrich} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ background: RED }}>
          <RefreshCw size={12} /> {lead.enriquecidoEm ? "Re-enriquecer" : "Enriquecer via Lemit"}
        </button>
      </div>
      {!lead.enriquecidoEm ? (
        <p className="text-[12px] text-[var(--color-v4-text-muted)]">Puxe do Lemit os dados cadastrais da empresa, o quadro societário e <b className="text-white">telefones/WhatsApp adicionais</b>. (Acontece automático ao mover o card pra <b className="text-white">Enriquecimento</b>.)</p>
      ) : (
        <div className="space-y-3">
          {/* dados cadastrais */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1 flex items-center gap-1"><Briefcase size={11} /> Dados da empresa</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="text-[12px]"><span className="text-[var(--color-v4-text-muted)]">{k}: </span><span className="text-white">{v}</span></div>
              ))}
            </div>
          </div>
          {/* sócios extras */}
          {(lead.sociosExtra?.length || 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1 flex items-center gap-1"><Users2 size={11} /> Quadro societário</p>
              <div className="space-y-1">
                {lead.sociosExtra!.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">
                    <UserCheck size={12} className="text-[var(--color-v4-text-muted)]" />
                    <span className="text-white font-medium">{s.nome}</span>
                    {s.cargo && <span className="text-[var(--color-v4-text-muted)] text-[10.5px]">{s.cargo}</span>}
                    {s.participacao && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-v4-card)] text-[var(--color-v4-text-muted)]">{s.participacao}</span>}
                    {s.telefone && <a href={telLink(s.telefone)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: RED }}><Phone size={11} />{s.telefone}</a>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* e-mails extras */}
          {(lead.emailsExtra?.length || 0) > 0 && (
            <div className="text-[12px]"><span className="text-[var(--color-v4-text-muted)]">Outros e-mails: </span><span className="text-white">{lead.emailsExtra!.join(", ")}</span></div>
          )}
          <p className="text-[10px] text-[var(--color-v4-text-muted)] opacity-70">Enriquecido em {new Date(lead.enriquecidoEm).toLocaleString("pt-BR")} · protótipo (dados simulados). Em produção vem da API do Lemit por CNPJ.</p>
        </div>
      )}
    </div>
  );
};

const AtividadesBox: React.FC<{ lead: ProspLead; onAdd: (tp: Omit<Touchpoint, "id">) => void }> = ({ lead, onAdd }) => {
  const [tipo, setTipo] = useState<AtividadeTipo>("cold_call");
  const [resultado, setResultado] = useState<AtividadeResultado>("nao_atendeu");
  const [nota, setNota] = useState("");
  const registrar = () => { onAdd({ tipo, resultado, nota: nota || undefined, dataHora: new Date().toISOString() }); setNota(""); };
  const hist = [...(lead.atividades || [])].reverse();
  return (
    <div className={`${card} p-4`}>
      <p className="text-sm font-bold text-white flex items-center gap-1.5 mb-2"><Activity size={15} style={{ color: RED }} /> Atividades (touchpoints) <span className="text-[11px] font-normal text-[var(--color-v4-text-muted)]">· {lead.atividades?.length || 0} registro(s)</span></p>
      <div className="grid grid-cols-2 gap-2">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as AtividadeTipo)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2 py-2 text-sm">
          {ATIVIDADE_TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={resultado} onChange={(e) => setResultado(e.target.value as AtividadeResultado)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2 py-2 text-sm">
          {ATIVIDADE_RESULTADOS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>
      <div className="flex gap-2 mt-2">
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota rápida (opcional)" className="flex-1 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" />
        <button onClick={registrar} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}><Plus size={14} /> Registrar</button>
      </div>
      {hist.length > 0 && (
        <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
          {hist.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg bg-[var(--color-v4-surface)] border border-[var(--color-v4-border)]">
              <span className="font-semibold text-white">{tipoLabel(a.tipo)}</span>
              <span className={a.resultado === "conectou" ? "text-emerald-400" : "text-[var(--color-v4-text-muted)]"}>{resultadoLabel(a.resultado)}</span>
              {a.nota && <span className="text-[var(--color-v4-text-muted)] truncate">· {a.nota}</span>}
              <span className="ml-auto text-[10px] text-[var(--color-v4-text-muted)]">{new Date(a.dataHora).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FieldEdit: React.FC<{ label: string; value?: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <div>
    <p className="text-[10px] font-semibold text-[var(--color-v4-text-muted)] uppercase mb-1">{label}</p>
    <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-1.5 text-sm" />
  </div>
);

// ---------------- dados de exemplo (simulação local) ----------------
function seedDemo(team: string[]): ProspLead[] {
  const bdrs = team.length ? team : ["BDR 1", "BDR 2", "BDR 3"];
  const nichos = ["SaaS / Tecnologia", "Saúde e Beleza", "Construtoras / Incorporadoras"];
  const cidades = [["São José dos Campos", "SP"], ["Jacareí", "SP"], ["Taubaté", "SP"], ["Caçapava", "SP"], ["Pindamonhangaba", "SP"]];
  const origens = ["Lemit", "Apollo", "Indicação", "Evento"];
  const empresasBase = ["Nexus", "Vale", "Alpha", "Prime", "Horizonte", "Vitta", "Bella", "Terra", "Norte", "Sirius", "Delta", "Aurora", "Meridian", "Quantum", "Solar", "Atlas", "Vertex", "Lumen", "Onda", "Cedro"];
  const sufixo: Record<string, string> = { "SaaS / Tecnologia": "Tech", "Saúde e Beleza": "Estética", "Construtoras / Incorporadoras": "Incorporadora" };
  const cargos = ["CEO", "Diretor Comercial", "Sócia", "Head de Marketing"];
  const now = Date.now();
  const stages: Status[] = ["inteligencia", "enriquecimento", "prospeccao_ativa", "conectado", "qualificado", "reuniao_agendada", "reuniao_realizada", "fechado", "perdido"];
  const out: ProspLead[] = [];
  let idc = 0;
  for (let i = 0; i < 42; i++) {
    const nicho = nichos[i % 3];
    const [cidade, estado] = cidades[i % cidades.length];
    const empresa = `${empresasBase[i % empresasBase.length]} ${sufixo[nicho]}`;
    const bdr = bdrs[i % bdrs.length];
    // distribuição de etapas: mais no começo do funil
    const stageWeights = [8, 6, 8, 6, 4, 4, 3, 2, 3];
    let pick = i % stageWeights.reduce((a, b) => a + b, 0);
    let si = 0; for (; si < stageWeights.length; si++) { if (pick < stageWeights[si]) break; pick -= stageWeights[si]; }
    const status = stages[Math.min(si, stages.length - 1)];
    const mat = 1 + ((i * 7) % 5);
    const temSite = mat >= 2, temInsta = mat >= 2, temLinkedin = mat >= 3, temYt = mat >= 4;
    const atividades: Touchpoint[] = [];
    const nAt = (["prospeccao_ativa", "conectado", "qualificado", "reuniao_agendada", "reuniao_realizada", "fechado", "perdido"].includes(status)) ? 2 + (i % 4) : (status === "enriquecimento" ? 1 : 0);
    for (let a = 0; a < nAt; a++) {
      const conectou = a === nAt - 1 && ["conectado", "qualificado", "reuniao_agendada", "reuniao_realizada", "fechado"].includes(status);
      atividades.push({ id: `d${idc}-a${a}`, tipo: (["cold_call", "cold_call", "cold_mail", "whatsapp"] as AtividadeTipo[])[a % 4], resultado: conectou ? "conectou" : (["nao_atendeu", "callback", "gatekeeper", "nao_atendeu"] as AtividadeResultado[])[a % 4], dataHora: new Date(now - (nAt - a) * 864e5).toISOString(), bdr });
    }
    const decisor = `${["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabi", "Hugo"][i % 8]} ${["Souza", "Lima", "Costa", "Alves", "Rocha"][i % 5]}`;
    const agendou = ["reuniao_agendada", "reuniao_realizada", "fechado"].includes(status);
    out.push({
      id: `demo-${idc++}`, empresa, cnpj: "", socio1: decisor, socio2: "",
      whatsapp1: `12${9}${String(80000000 + i * 137).slice(0, 8)}`, whatsapp2: "", email: `contato@${empresasBase[i % empresasBase.length].toLowerCase()}.com.br`,
      site: temSite ? `${empresasBase[i % empresasBase.length].toLowerCase()}.com.br` : "", cidade, estado,
      instagram: temInsta ? `instagram.com/${empresasBase[i % empresasBase.length].toLowerCase()}` : "", facebook: "",
      linkedin: temLinkedin ? `linkedin.com/company/${empresasBase[i % empresasBase.length].toLowerCase()}` : "", youtube: temYt ? `youtube.com/@${empresasBase[i % empresasBase.length].toLowerCase()}` : "",
      nicho, origem: origens[i % origens.length],
      decisorNome: decisor, decisorCargo: cargos[i % cargos.length], decisorTel: `129${String(80000000 + i * 137).slice(0, 8)}`, decisorEmail: `${decisor.split(" ")[0].toLowerCase()}@empresa.com`, decisorLinkedin: "",
      bdr, maturidade: mat, maturidadeNivel: maturidadeBanda(mat), abordagem: "", status,
      motivoPerda: status === "perdido" ? MOTIVOS_PERDA[i % MOTIVOS_PERDA.length] : undefined,
      dataReuniao: agendou ? new Date(now + ((i % 7) - 2) * 864e5).toISOString() : undefined,
      closerNome: agendou ? ["Rafael", "Marina"][i % 2] : undefined, canal: agendou ? "outbound" : undefined,
      atividades, notas: "", batch: "exemplo", createdAt: new Date(now - (i + 5) * 864e5).toISOString(), updatedAt: new Date(now - (i % 5) * 864e5).toISOString(),
    });
  }
  // leads a partir de "Enriquecimento" já vêm enriquecidos (como se tivessem passado pela etapa)
  const enriched = new Set<Status>(["enriquecimento", "prospeccao_ativa", "conectado", "qualificado", "reuniao_agendada", "reuniao_realizada", "fechado"]);
  return out.map((l) => (enriched.has(l.status) ? { ...l, ...enrichLead(l) } : l));
}

// ---------------- Route ----------------
export const LabHubOutboundRoute: React.FC = () => {
  const store = useAppStore();
  const teamMembers = useMemo(() => {
    const t = store.members.filter((m) => m.active && (m.role === "sdr" || m.role === "gestor")).map((m) => ({ id: m.id, name: m.name }));
    return t.length ? t : FALLBACK_TEAM;
  }, [store.members]);
  const closers = useMemo(() => store.members.filter((m) => m.active && (m.role === "closer" || m.role === "gestor")).map((m) => ({ id: m.id, name: m.name })), [store.members]);
  return <HubOutbound teamMembers={teamMembers} closers={closers} />;
};

export default HubOutbound;
