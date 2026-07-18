import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { Mail, MailCheck, Plus, Trash2, X, Calendar, TrendingUp, Building2, ArrowRight } from "lucide-react";
import { useAppStore } from "../../store";
import { pushToHub } from "./hubOutbound/hubLib";

/**
 * EmailDisparos — acompanhamento de disparos de E-MAIL (protótipo Labs).
 * Sem custo. Mede Emails Disparados e Retornos Engajados por período, e permite
 * registrar QUEM engajou → vai pro Hub Outbound (Prospecção Ativa · canal Email).
 */
const RED = "var(--color-v4-red)";
const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const KEY = "v4_email_disparos_v1";
const FALLBACK_TEAM = ["Lary", "Edric", "Bianca", "Erick"];

interface EngajLead { empresa: string; contato: string; email: string; bdr?: string; }
interface Dia { id: string; data: string; emails: number; engajados: number; engajLeads?: EngajLead[]; }

const load = (): Dia[] => { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const save = (d: Dia[]) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ } };
const hojeISO = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDia = (iso: string) => { try { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; } catch { return iso; } };

export const EmailDisparos: React.FC<{ team?: string[] }> = ({ team = FALLBACK_TEAM }) => {
  const [dias, setDias] = useState<Dia[]>(() => load());
  const [banner, setBanner] = useState<string | null>(null);
  const [engajModal, setEngajModal] = useState<{ n: number; data: string; emails: number } | null>(null);
  const [data, setData] = useState(hojeISO());
  const [emails, setEmails] = useState("");
  const [engajados, setEngajados] = useState("");
  const [preset, setPreset] = useState<"tudo" | "hoje" | "7d" | "30d" | "custom">("30d");
  const [de, setDe] = useState(""); const [ate, setAte] = useState("");

  const persist = (next: Dia[]) => { setDias(next); save(next); };
  const salvarDia = (em: number, eng: number, engajLeads?: EngajLead[]) => {
    const semData = dias.filter((d) => d.data !== data);
    persist([...semData, { id: data, data, emails: em, engajados: eng, engajLeads }].sort((a, b) => b.data.localeCompare(a.data)));
    setEmails(""); setEngajados("");
  };
  const registrar = () => {
    const em = parseInt(emails || "0", 10) || 0;
    if (em <= 0) { setBanner("Informe a quantidade de e-mails disparados."); return; }
    const eng = parseInt(engajados || "0", 10) || 0;
    if (eng >= 1) { setEngajModal({ n: eng, data, emails: em }); return; }
    salvarDia(em, eng); setBanner(`Registrado ${fmtDia(data)}: ${em} e-mails · 0 engajados.`);
  };
  const confirmarEngaj = (leads: EngajLead[]) => {
    if (!engajModal) return;
    const validos = leads.filter((l) => (l.empresa || l.contato || l.email).trim());
    salvarDia(engajModal.emails, validos.length, validos);
    const now = new Date().toISOString();
    const paraHub = validos.map((l, i) => ({
      id: `email-${engajModal.data}-${Date.now()}-${i}`,
      empresa: l.empresa || l.contato || "Lead do e-mail", cnpj: "",
      socio1: l.contato || "", socio2: "", whatsapp1: "", whatsapp2: "", email: l.email || "", site: "",
      cidade: "", estado: "", instagram: "", facebook: "", linkedin: "", youtube: "",
      nicho: "Outro", origem: "Email",
      decisorNome: l.contato || "", decisorCargo: "", decisorTel: "", decisorEmail: l.email || "", decisorLinkedin: "",
      bdr: l.bdr || null, maturidade: 1, maturidadeNivel: "Baixa", abordagem: "",
      status: "prospeccao_ativa", canal: "Email",
      atividades: [{ id: `${Date.now()}-${i}`, tipo: "cold_mail", resultado: "conectou", dataHora: now, nota: "Retorno engajado (e-mail)" }],
      notas: "Origem: disparo de e-mail (engajou)", batch: "email", createdAt: now, updatedAt: now, enviadoHub: true,
    }));
    const res = pushToHub(paraHub);
    setEngajModal(null);
    setBanner(`${fmtDia(engajModal.data)}: ${validos.length} engajado(s) → Hub Outbound (Prospecção Ativa · canal Email). Hub agora com ${res.total} lead(s).`);
  };
  const remover = (id: string) => { if (confirm("Remover este dia?")) persist(dias.filter((d) => d.id !== id)); };
  const limparTudo = () => { if (confirm("Apagar TODOS os registros de e-mail?")) persist([]); };

  const range = useMemo<[string, string]>(() => {
    const iso = (dt: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; };
    const now = new Date();
    if (preset === "hoje") return [iso(now), iso(now)];
    if (preset === "7d") return [iso(new Date(now.getTime() - 6 * 864e5)), iso(now)];
    if (preset === "30d") return [iso(new Date(now.getTime() - 29 * 864e5)), iso(now)];
    if (preset === "custom") return [de || "0000-01-01", ate || "9999-12-31"];
    return ["0000-01-01", "9999-12-31"];
  }, [preset, de, ate]);
  const filtrados = useMemo(() => dias.filter((d) => d.data >= range[0] && d.data <= range[1]).sort((a, b) => b.data.localeCompare(a.data)), [dias, range]);
  const tot = useMemo(() => {
    const em = filtrados.reduce((s, d) => s + d.emails, 0);
    const eng = filtrados.reduce((s, d) => s + d.engajados, 0);
    return { em, eng, taxa: em ? +((100 * eng) / em).toFixed(2) : 0, dias: filtrados.length };
  }, [filtrados]);
  const engajLeadsPeriodo = useMemo(() => filtrados.flatMap((d) => (d.engajLeads || []).map((l) => ({ ...l, data: d.data }))), [filtrados]);
  const chartData = useMemo(() => [...filtrados].reverse().map((d) => ({ dia: fmtDia(d.data), Emails: d.emails, Engajados: d.engajados })), [filtrados]);
  const maxFunil = Math.max(1, tot.em);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      <div className="sticky top-0 z-10 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-6 py-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-md flex items-center justify-center font-black text-white" style={{ background: RED }}><Mail size={16} /></div>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-white">Disparo de <span style={{ color: RED }}>Emails</span></h1>
          <p className="text-[11px] text-[var(--color-v4-text-muted)]">Emails Disparados → Retornos Engajados · sem custo · engajados vão pro Hub (canal Email)</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {banner && <div className="px-4 py-2.5 rounded-lg text-sm border bg-[var(--color-v4-surface)] text-white border-[var(--color-v4-border)]">{banner} <button onClick={() => setBanner(null)} className="float-right text-[var(--color-v4-text-muted)] hover:text-white"><X size={14} /></button></div>}

        {/* REGISTRAR */}
        <div className={`${card} p-4`}>
          <p className="text-sm font-bold text-white flex items-center gap-1.5 mb-3"><Plus size={15} style={{ color: RED }} /> Registrar dia</p>
          <div className="flex flex-wrap items-end gap-3">
            <Campo label="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <Campo label="Emails disparados"><input type="number" min="0" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="0" className="w-32 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <Campo label="Retornos engajados" hint="responderam/interessados"><input type="number" min="0" value={engajados} onChange={(e) => setEngajados(e.target.value)} placeholder="0" className="w-32 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <button onClick={registrar} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-bold" style={{ background: RED }}><Plus size={15} /> Registrar</button>
            <span className="text-[11px] text-[var(--color-v4-text-muted)]">Com engajados ≥ 1, você registra quem engajou (vai pro Hub).</span>
          </div>
        </div>

        {/* FILTRO */}
        <div className="flex flex-wrap items-center gap-2">
          <Calendar size={14} className="text-[var(--color-v4-text-muted)]" />
          <select value={preset} onChange={(e) => setPreset(e.target.value as any)} className="rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white px-2 py-1.5 text-xs">
            <option value="tudo">Todo o período</option><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="custom">Personalizado…</option>
          </select>
          {preset === "custom" && (<>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white px-2 py-1.5 text-xs" />
            <span className="text-[var(--color-v4-text-muted)] text-xs">até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white px-2 py-1.5 text-xs" />
          </>)}
          <span className="text-[11px] text-[var(--color-v4-text-muted)]">{tot.dias} dia(s) no período</span>
          <div className="flex-1" />
          {dias.length > 0 && <button onClick={limparTudo} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)] hover:border-[var(--color-v4-red)] px-2.5 py-1.5 text-xs"><Trash2 size={13} /> Limpar tudo</button>}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          <Kpi icon={Mail} label="Emails disparados" value={tot.em.toLocaleString("pt-BR")} />
          <Kpi icon={MailCheck} label="Retornos engajados" value={tot.eng.toLocaleString("pt-BR")} accent hint={`${tot.taxa}% dos emails`} />
          <Kpi icon={TrendingUp} label="Taxa de engajamento" value={`${tot.taxa}%`} />
        </div>

        {/* FUNIL */}
        <div className={`${card} p-4`}>
          <p className="text-sm font-bold text-white mb-3">Funil dos e-mails</p>
          {[{ k: "Emails disparados", v: tot.em, c: "#6b7280", hint: "" }, { k: "Retornos engajados", v: tot.eng, c: "#34d399", hint: `${tot.taxa}%` }].map((row) => (
            <div key={row.k} className="flex items-center gap-2 mb-2">
              <span className="text-[12px] text-white w-48 shrink-0">{row.k}</span>
              <div className="flex-1 h-6 rounded bg-[var(--color-v4-surface)] overflow-hidden">
                <div className="h-full rounded flex items-center justify-end pr-2 text-[10px] text-white font-semibold" style={{ width: `${Math.max(2, Math.round((100 * row.v) / maxFunil))}%`, background: row.c }}>{row.v > 0 ? row.v : ""}</div>
              </div>
              <span className="text-[11px] text-[var(--color-v4-text-muted)] w-16 text-right">{row.hint}</span>
            </div>
          ))}
        </div>

        {/* GRÁFICO */}
        {chartData.length > 0 && (
          <div className={`${card} p-4`}>
            <p className="text-sm font-bold text-white mb-3">Emails e engajados por dia</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 6, right: 10, bottom: 6, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="Emails" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Engajados" radius={[4, 4, 0, 0]}>{chartData.map((_, i) => <Cell key={i} fill="#34d399" />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* QUEM engajou */}
        {engajLeadsPeriodo.length > 0 && (
          <div className={`overflow-x-auto ${card}`}>
            <div className="px-4 py-3 border-b border-[var(--color-v4-border)] flex items-center gap-2">
              <MailCheck size={15} style={{ color: RED }} /><span className="text-sm font-bold text-white">Quem engajou (retornos)</span>
              <span className="text-[11px] text-[var(--color-v4-text-muted)]">{engajLeadsPeriodo.length} no período · enviados ao Hub (Prospecção Ativa · canal Email)</span>
            </div>
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
                <tr><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Contato</th><th className="px-3 py-2.5">E-mail</th><th className="px-3 py-2.5">Dono</th><th className="px-3 py-2.5"></th></tr>
              </thead>
              <tbody>
                {engajLeadsPeriodo.map((l, i) => (
                  <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{fmtDia(l.data)}</td>
                    <td className="px-3 py-2.5 font-medium"><span className="inline-flex items-center gap-1.5"><Building2 size={13} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</span></td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.contato || "—"}</td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.email || "—"}</td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.bdr || "—"}</td>
                    <td className="px-3 py-2.5 text-right"><span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400"><ArrowRight size={11} /> Hub</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TABELA por dia */}
        <div className={`overflow-x-auto ${card}`}>
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
              <tr><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Emails</th><th className="px-3 py-2.5">Engajados</th><th className="px-3 py-2.5">Taxa</th><th className="px-3 py-2.5"></th></tr>
            </thead>
            <tbody>
              {filtrados.map((d) => (
                <tr key={d.id} className="border-t border-[var(--color-v4-border)] text-white hover:bg-[var(--color-v4-card-hover)]">
                  <td className="px-3 py-2.5 font-medium">{fmtDia(d.data)}</td>
                  <td className="px-3 py-2.5">{d.emails.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2.5 text-emerald-400">{d.engajados}</td>
                  <td className="px-3 py-2.5 font-semibold" style={{ color: RED }}>{d.emails ? Math.round((100 * d.engajados) / d.emails) : 0}%</td>
                  <td className="px-3 py-2.5 text-right"><button onClick={() => remover(d.id)} className="text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)]"><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--color-v4-text-muted)]">Nenhum e-mail no período. Registre um dia acima.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)]">Protótipo local (localStorage). Em produção, integra com a ferramenta de e-mail (API) pra puxar disparos/aberturas/respostas.</p>
      </div>

      {engajModal && <EngajModal n={engajModal.n} data={engajModal.data} team={team} onClose={() => setEngajModal(null)} onConfirm={confirmarEngaj} />}
    </div>
  );
};

const EngajModal: React.FC<{ n: number; data: string; team: string[]; onClose: () => void; onConfirm: (leads: EngajLead[]) => void }> = ({ n, data, team, onClose, onConfirm }) => {
  const [rows, setRows] = useState<EngajLead[]>(() => Array.from({ length: Math.max(1, n) }, () => ({ empresa: "", contato: "", email: "", bdr: "" })));
  const setRow = (i: number, k: keyof EngajLead, v: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const preenchidos = rows.filter((l) => (l.empresa || l.contato || l.email).trim()).length;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-2xl ${card} p-5 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center gap-2 mb-1"><MailCheck size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Quem engajou? — {fmtDia(data)}</h3><div className="flex-1" /><button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button></div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Registre as empresas/pessoas que <b className="text-white">responderam/engajaram</b> — vão pro <b className="text-white">Hub Outbound</b> em <b style={{ color: RED }}>Prospecção Ativa</b>, canal <b className="text-white">Email</b>.</p>
        <div className="space-y-2">
          <div className="grid grid-cols-[1.4fr_1.2fr_1.4fr_0.9fr_auto] gap-2 text-[10px] uppercase font-semibold text-[var(--color-v4-text-muted)] px-1">
            <span>Empresa</span><span>Contato</span><span>E-mail</span><span>Dono</span><span></span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1.2fr_1.4fr_0.9fr_auto] gap-2 items-center">
              <input value={row.empresa} onChange={(e) => setRow(i, "empresa", e.target.value)} placeholder="Empresa" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <input value={row.contato} onChange={(e) => setRow(i, "contato", e.target.value)} placeholder="Contato" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <input value={row.email} onChange={(e) => setRow(i, "email", e.target.value)} placeholder="email@empresa.com" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <select value={row.bdr} onChange={(e) => setRow(i, "bdr", e.target.value)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2 py-2 text-sm">
                <option value="">— dono —</option>{team.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} className="text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)] p-1" title="Remover"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setRows((r) => [...r, { empresa: "", contato: "", email: "", bdr: "" }])} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-v4-text-muted)] hover:text-white"><Plus size={13} /> adicionar mais um</button>
        <div className="flex gap-2 mt-4 items-center">
          <span className="text-[11px] text-[var(--color-v4-text-muted)]">{preenchidos} preenchido(s)</span><div className="flex-1" />
          <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button disabled={!preenchidos} onClick={() => onConfirm(rows)} className="inline-flex items-center gap-2 py-2 px-4 rounded-lg text-white text-sm font-bold disabled:opacity-30" style={{ background: RED }}><ArrowRight size={14} /> Registrar e enviar ao Hub</button>
        </div>
      </div>
    </div>
  );
};

const Campo: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div><label className="text-[11px] text-[var(--color-v4-text-muted)] uppercase font-semibold block mb-1">{label}{hint && <span className="normal-case font-normal"> · {hint}</span>}</label>{children}</div>
);
const Kpi: React.FC<{ icon: any; label: string; value: React.ReactNode; hint?: string; accent?: boolean }> = ({ icon: Icon, label, value, hint, accent }) => (
  <div className={`${card} px-3 py-2.5`}>
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-v4-text-muted)] flex items-center gap-1"><Icon size={11} /> {label}</div>
    <div className="text-xl font-bold" style={{ color: accent ? RED : "#fff" }}>{value}</div>
    {hint && <div className="text-[10px] text-[var(--color-v4-text-muted)]">{hint}</div>}
  </div>
);

export const LabEmailDisparosRoute: React.FC = () => {
  const store = useAppStore();
  const team = useMemo(() => {
    const t = store.members.filter((m) => m.active && (m.role === "sdr" || m.role === "gestor")).map((m) => m.name);
    return t.length ? t : FALLBACK_TEAM;
  }, [store.members]);
  return <EmailDisparos team={team} />;
};
export default EmailDisparos;
