import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { Send, DollarSign, Hand, Ban, Plus, Trash2, X, Calendar, TrendingUp, Building2, ArrowRight } from "lucide-react";
import { useAppStore } from "../../store";
import { pushToHub } from "./hubOutbound/hubLib";

/**
 * DisparosCalc — Calculadora de disparos de WhatsApp (protótipo Labs).
 * Registra disparos por dia (cada disparo custa R$ 0,35), acompanha custo por
 * período e o funil Disparos → Eu Quero (levantou a mão) → Bloquear.
 * Persiste em localStorage. Tema dark, acento vermelho. (o clone é read-only)
 */
const RED = "var(--color-v4-red)";
const card = "rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-card)]";
const KEY = "v4_disparos_v1";
const KEY_CUSTO = "v4_disparos_custo_v1";
const CUSTO_PADRAO = 0.35;

interface EuQueroLead { empresa: string; contato: string; tel: string; bdr?: string; }
interface Dia { id: string; data: string; disparos: number; euQuero: number; bloquear: number; nota?: string; euQueroLeads?: EuQueroLead[]; }
const FALLBACK_TEAM = ["Lary", "Edric", "Bianca", "Erick"];

const load = (): Dia[] => { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const save = (d: Dia[]) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ } };
const loadCusto = (): number => { try { const r = localStorage.getItem(KEY_CUSTO); return r ? parseFloat(r) : CUSTO_PADRAO; } catch { return CUSTO_PADRAO; } };
const saveCusto = (v: number) => { try { localStorage.setItem(KEY_CUSTO, String(v)); } catch { /* */ } };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hojeISO = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDia = (iso: string) => { try { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; } catch { return iso; } };

export const DisparosCalc: React.FC<{ team?: string[] }> = ({ team = FALLBACK_TEAM }) => {
  const [dias, setDias] = useState<Dia[]>(() => load());
  const [custo, setCusto] = useState<number>(() => loadCusto());
  const [banner, setBanner] = useState<string | null>(null);
  const [euQueroModal, setEuQueroModal] = useState<{ n: number; data: string; disparos: number; bloquear: number } | null>(null);
  // form
  const [data, setData] = useState(hojeISO());
  const [disparos, setDisparos] = useState("");
  const [euQuero, setEuQuero] = useState("");
  const [bloquear, setBloquear] = useState("");
  // filtro período
  const [preset, setPreset] = useState<"tudo" | "hoje" | "7d" | "30d" | "custom">("30d");
  const [de, setDe] = useState(""); const [ate, setAte] = useState("");

  const persist = (next: Dia[]) => { setDias(next); save(next); };
  const setCustoP = (v: number) => { setCusto(v); saveCusto(v); };

  const salvarDia = (disp: number, eq: number, bl: number, euQueroLeads?: EuQueroLead[]) => {
    const semData = dias.filter((d) => d.data !== data);
    const registro: Dia = { id: data, data, disparos: disp, euQuero: eq, bloquear: bl, euQueroLeads };
    persist([...semData, registro].sort((a, b) => b.data.localeCompare(a.data)));
    setDisparos(""); setEuQuero(""); setBloquear("");
  };
  const registrar = () => {
    const disp = parseInt(disparos || "0", 10) || 0;
    if (disp <= 0) { setBanner("Informe a quantidade de disparos do dia."); return; }
    const eq = parseInt(euQuero || "0", 10) || 0;
    const bl = parseInt(bloquear || "0", 10) || 0;
    if (eq >= 1) { setEuQueroModal({ n: eq, data, disparos: disp, bloquear: bl }); return; } // registra QUEM levantou a mão
    salvarDia(disp, eq, bl);
    setBanner(`Registrado ${fmtDia(data)}: ${disp} disparos · 0 eu quero · ${bl} bloquear.`);
  };
  // confirma quem levantou a mão → salva o dia + manda os leads pro Hub (Prospecção Ativa, canal Disparo)
  const confirmarEuQuero = (leads: EuQueroLead[]) => {
    if (!euQueroModal) return;
    const validos = leads.filter((l) => (l.empresa || l.contato || l.tel).trim());
    salvarDia(euQueroModal.disparos, validos.length, euQueroModal.bloquear, validos);
    const now = new Date().toISOString();
    const paraHub = validos.map((l, i) => ({
      id: `disparo-${euQueroModal.data}-${Date.now()}-${i}`,
      empresa: l.empresa || l.contato || "Lead do disparo", cnpj: "",
      socio1: l.contato || "", socio2: "", whatsapp1: l.tel || "", whatsapp2: "", email: "", site: "",
      cidade: "", estado: "", instagram: "", facebook: "", linkedin: "", youtube: "",
      nicho: "Outro", origem: "Disparo",
      decisorNome: l.contato || "", decisorCargo: "", decisorTel: l.tel || "", decisorEmail: "", decisorLinkedin: "",
      bdr: l.bdr || null, maturidade: 1, maturidadeNivel: "Baixa", abordagem: "",
      status: "prospeccao_ativa", canal: "Disparo",
      atividades: [{ id: `${Date.now()}-${i}`, tipo: "whatsapp", resultado: "conectou", dataHora: now, nota: "Levantou a mão (Eu Quero) no disparo" }],
      notas: "Origem: disparo de WhatsApp (Eu Quero)", batch: "disparo", createdAt: now, updatedAt: now, enviadoHub: true,
    }));
    const res = pushToHub(paraHub);
    setEuQueroModal(null);
    setBanner(`${fmtDia(euQueroModal.data)}: ${validos.length} "Eu Quero" registrado(s) → enviados ao Hub Outbound (Prospecção Ativa · canal Disparo). Hub agora com ${res.total} lead(s).`);
  };
  const remover = (id: string) => { if (confirm("Remover este dia?")) persist(dias.filter((d) => d.id !== id)); };
  const limparTudo = () => { if (confirm("Apagar TODOS os registros de disparos?")) persist([]); };

  const range = useMemo<[string, string]>(() => {
    const iso = (dt: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; };
    const now = new Date();
    if (preset === "hoje") return [iso(now), iso(now)];
    if (preset === "7d") { const d = new Date(now.getTime() - 6 * 864e5); return [iso(d), iso(now)]; }
    if (preset === "30d") { const d = new Date(now.getTime() - 29 * 864e5); return [iso(d), iso(now)]; }
    if (preset === "custom") return [de || "0000-01-01", ate || "9999-12-31"];
    return ["0000-01-01", "9999-12-31"];
  }, [preset, de, ate]);

  const filtrados = useMemo(() => dias.filter((d) => d.data >= range[0] && d.data <= range[1]).sort((a, b) => b.data.localeCompare(a.data)), [dias, range]);
  const tot = useMemo(() => {
    const disp = filtrados.reduce((s, d) => s + d.disparos, 0);
    const eq = filtrados.reduce((s, d) => s + d.euQuero, 0);
    const bl = filtrados.reduce((s, d) => s + d.bloquear, 0);
    const custoTotal = disp * custo;
    return {
      disp, eq, bl, custoTotal,
      taxaEq: disp ? +((100 * eq) / disp).toFixed(2) : 0,
      taxaBl: disp ? +((100 * bl) / disp).toFixed(2) : 0,
      custoPorLead: eq ? custoTotal / eq : 0,
      dias: filtrados.length,
    };
  }, [filtrados, custo]);

  const euQueroLeadsPeriodo = useMemo(() => filtrados.flatMap((d) => (d.euQueroLeads || []).map((l) => ({ ...l, data: d.data }))), [filtrados]);
  const chartData = useMemo(() => [...filtrados].reverse().map((d) => ({ dia: fmtDia(d.data), Disparos: d.disparos, "Eu Quero": d.euQuero, custo: d.disparos * custo })), [filtrados, custo]);
  const maxFunil = Math.max(1, tot.disp);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-v4-bg)] text-[var(--color-v4-text)] min-h-full">
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-[var(--color-v4-card)] border-b border-[var(--color-v4-border)] px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center font-black text-white" style={{ background: RED }}><Send size={16} /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">Calculadora de <span style={{ color: RED }}>Disparos</span> (WhatsApp)</h1>
            <p className="text-[11px] text-[var(--color-v4-text-muted)]">Disparos → Eu Quero → Bloquear · custo por período e por lead que levantou a mão</p>
          </div>
        </div>
        <div className="flex-1" />
        <label className="text-[11px] text-[var(--color-v4-text-muted)]">Custo/disparo</label>
        <div className="inline-flex items-center rounded-lg border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] px-2 py-1.5">
          <span className="text-[var(--color-v4-text-muted)] text-sm">R$</span>
          <input type="number" step="0.01" min="0" value={custo} onChange={(e) => setCustoP(parseFloat(e.target.value) || 0)} className="w-16 bg-transparent text-white text-sm px-1 focus:outline-none" />
        </div>
      </div>

      <div className="p-6 space-y-4">
        {banner && (
          <div className="px-4 py-2.5 rounded-lg text-sm border bg-[var(--color-v4-surface)] text-white border-[var(--color-v4-border)]">
            {banner} <button onClick={() => setBanner(null)} className="float-right text-[var(--color-v4-text-muted)] hover:text-white"><X size={14} /></button>
          </div>
        )}

        {/* REGISTRAR DIA */}
        <div className={`${card} p-4`}>
          <p className="text-sm font-bold text-white flex items-center gap-1.5 mb-3"><Plus size={15} style={{ color: RED }} /> Registrar dia</p>
          <div className="flex flex-wrap items-end gap-3">
            <Campo label="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <Campo label="Disparos"><input type="number" min="0" value={disparos} onChange={(e) => setDisparos(e.target.value)} placeholder="0" className="w-28 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <Campo label="Eu Quero" hint="levantaram a mão"><input type="number" min="0" value={euQuero} onChange={(e) => setEuQuero(e.target.value)} placeholder="0" className="w-28 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <Campo label="Bloquear" hint="sem interesse"><input type="number" min="0" value={bloquear} onChange={(e) => setBloquear(e.target.value)} placeholder="0" className="w-28 border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-3 py-2 text-sm" /></Campo>
            <button onClick={registrar} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-bold" style={{ background: RED }}><Plus size={15} /> Registrar</button>
            <span className="text-[11px] text-[var(--color-v4-text-muted)]">Registrar de novo a mesma data <b>substitui</b> o dia.</span>
          </div>
        </div>

        {/* FILTRO PERÍODO */}
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Kpi icon={Send} label="Disparos" value={tot.disp.toLocaleString("pt-BR")} />
          <Kpi icon={DollarSign} label="Custo total" value={brl(tot.custoTotal)} accent />
          <Kpi icon={Hand} label="Eu Quero" value={tot.eq.toLocaleString("pt-BR")} hint={`${tot.taxaEq}% dos disparos`} />
          <Kpi icon={Ban} label="Bloquear" value={tot.bl.toLocaleString("pt-BR")} hint={`${tot.taxaBl}% dos disparos`} danger />
          <Kpi icon={TrendingUp} label="Custo / lead (Eu Quero)" value={tot.eq ? brl(tot.custoPorLead) : "—"} accent />
        </div>

        {/* FUNIL */}
        <div className={`${card} p-4`}>
          <p className="text-sm font-bold text-white mb-3">Funil dos disparos</p>
          {[{ k: "Disparos", v: tot.disp, c: "#6b7280", hint: brl(tot.custoTotal) },
            { k: "Eu Quero (levantou a mão)", v: tot.eq, c: "#34d399", hint: `${tot.taxaEq}%` },
            { k: "Bloquear (sem interesse)", v: tot.bl, c: "#ef4444", hint: `${tot.taxaBl}%` }].map((row) => (
            <div key={row.k} className="flex items-center gap-2 mb-2">
              <span className="text-[12px] text-white w-52 shrink-0">{row.k}</span>
              <div className="flex-1 h-6 rounded bg-[var(--color-v4-surface)] overflow-hidden">
                <div className="h-full rounded flex items-center justify-end pr-2 text-[10px] text-white font-semibold" style={{ width: `${Math.max(2, Math.round((100 * row.v) / maxFunil))}%`, background: row.c }}>{row.v > 0 ? row.v : ""}</div>
              </div>
              <span className="text-[11px] text-[var(--color-v4-text-muted)] w-24 text-right">{row.hint}</span>
            </div>
          ))}
          <p className="text-[10px] text-[var(--color-v4-text-muted)] mt-1">Cada lead que aperta <b className="text-white">Eu Quero</b> custou em média <b style={{ color: RED }}>{tot.eq ? brl(tot.custoPorLead) : "—"}</b> (custo total ÷ eu quero).</p>
        </div>

        {/* GRÁFICO por dia */}
        {chartData.length > 0 && (
          <div className={`${card} p-4`}>
            <p className="text-sm font-bold text-white mb-3">Disparos e Eu Quero por dia</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 6, right: 10, bottom: 6, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-v4-border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#9a9a9a", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--color-v4-card)", border: "1px solid var(--color-v4-border)", borderRadius: 8, color: "#fff", fontSize: 12 }}
                    formatter={(v: any, n: any) => n === "custo" ? [brl(v as number), "Custo"] : [v, n]} />
                  <Bar dataKey="Disparos" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Eu Quero" radius={[4, 4, 0, 0]}>{chartData.map((_, i) => <Cell key={i} fill="#34d399" />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* TABELA por dia */}
        <div className={`overflow-x-auto ${card}`}>
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Disparos</th><th className="px-3 py-2.5">Custo</th>
                <th className="px-3 py-2.5">Eu Quero</th><th className="px-3 py-2.5">Bloquear</th><th className="px-3 py-2.5">Tx. Eu Quero</th><th className="px-3 py-2.5">Custo/lead</th><th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((d) => {
                const c = d.disparos * custo; const tx = d.disparos ? Math.round((100 * d.euQuero) / d.disparos) : 0; const cpl = d.euQuero ? c / d.euQuero : 0;
                return (
                  <tr key={d.id} className="border-t border-[var(--color-v4-border)] text-white hover:bg-[var(--color-v4-card-hover)]">
                    <td className="px-3 py-2.5 font-medium">{fmtDia(d.data)}</td>
                    <td className="px-3 py-2.5">{d.disparos.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2.5">{brl(c)}</td>
                    <td className="px-3 py-2.5 text-emerald-400">{d.euQuero}</td>
                    <td className="px-3 py-2.5 text-red-400">{d.bloquear}</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: RED }}>{tx}%</td>
                    <td className="px-3 py-2.5">{d.euQuero ? brl(cpl) : "—"}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => remover(d.id)} className="text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)]"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-v4-text-muted)]">Nenhum disparo no período. Registre um dia acima.</td></tr>}
            </tbody>
          </table>
        </div>
        {/* QUEM levantou a mão (Eu Quero) */}
        {euQueroLeadsPeriodo.length > 0 && (
          <div className={`overflow-x-auto ${card}`}>
            <div className="px-4 py-3 border-b border-[var(--color-v4-border)] flex items-center gap-2">
              <Hand size={15} style={{ color: RED }} /><span className="text-sm font-bold text-white">Quem levantou a mão (Eu Quero)</span>
              <span className="text-[11px] text-[var(--color-v4-text-muted)]">{euQueroLeadsPeriodo.length} no período · enviados ao Hub (Prospecção Ativa · canal Disparo)</span>
            </div>
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-[var(--color-v4-surface)] text-[var(--color-v4-text-muted)] text-left text-[11px] uppercase tracking-wide">
                <tr><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Empresa</th><th className="px-3 py-2.5">Contato</th><th className="px-3 py-2.5">Telefone</th><th className="px-3 py-2.5">Dono</th><th className="px-3 py-2.5"></th></tr>
              </thead>
              <tbody>
                {euQueroLeadsPeriodo.map((l, i) => (
                  <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{fmtDia(l.data)}</td>
                    <td className="px-3 py-2.5 font-medium"><span className="inline-flex items-center gap-1.5"><Building2 size={13} className="text-[var(--color-v4-text-muted)]" />{l.empresa || "—"}</span></td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.contato || "—"}</td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.tel || "—"}</td>
                    <td className="px-3 py-2.5 text-[var(--color-v4-text-muted)]">{l.bdr || "—"}</td>
                    <td className="px-3 py-2.5 text-right"><span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400"><ArrowRight size={11} /> Hub</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-[var(--color-v4-text-muted)]">Protótipo local (localStorage). Em produção, integra com a ferramenta de disparo (API) pra puxar os números automaticamente.</p>
      </div>

      {euQueroModal && <EuQueroModal n={euQueroModal.n} data={euQueroModal.data} team={team} onClose={() => setEuQueroModal(null)} onConfirm={confirmarEuQuero} />}
    </div>
  );
};

// ---------------- Modal: quem levantou a mão (Eu Quero) ----------------
const EuQueroModal: React.FC<{ n: number; data: string; team: string[]; onClose: () => void; onConfirm: (leads: EuQueroLead[]) => void }> = ({ n, data, team, onClose, onConfirm }) => {
  const [rows, setRows] = useState<EuQueroLead[]>(() => Array.from({ length: Math.max(1, n) }, () => ({ empresa: "", contato: "", tel: "", bdr: "" })));
  const setRow = (i: number, k: keyof EuQueroLead, v: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, { empresa: "", contato: "", tel: "", bdr: "" }]);
  const delRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const preenchidos = rows.filter((l) => (l.empresa || l.contato || l.tel).trim()).length;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative w-full max-w-2xl ${card} p-5 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center gap-2 mb-1"><Hand size={16} style={{ color: RED }} /><h3 className="text-sm font-bold text-white">Quem levantou a mão? — {fmtDia(data)}</h3><div className="flex-1" /><button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button></div>
        <p className="text-[11px] text-[var(--color-v4-text-muted)] mb-3">Registre as empresas/pessoas que apertaram <b className="text-white">Eu Quero</b>. Vão pro <b className="text-white">Hub Outbound</b> na etapa <b style={{ color: RED }}>Prospecção Ativa</b> com canal <b className="text-white">Disparo</b>.</p>
        <div className="space-y-2">
          <div className="grid grid-cols-[1.4fr_1.2fr_1fr_0.9fr_auto] gap-2 text-[10px] uppercase font-semibold text-[var(--color-v4-text-muted)] px-1">
            <span>Empresa</span><span>Contato</span><span>Telefone</span><span>Dono</span><span></span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1.2fr_1fr_0.9fr_auto] gap-2 items-center">
              <input value={row.empresa} onChange={(e) => setRow(i, "empresa", e.target.value)} placeholder="Empresa" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <input value={row.contato} onChange={(e) => setRow(i, "contato", e.target.value)} placeholder="Nome do contato" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <input value={row.tel} onChange={(e) => setRow(i, "tel", e.target.value)} placeholder="WhatsApp" className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2.5 py-2 text-sm" />
              <select value={row.bdr} onChange={(e) => setRow(i, "bdr", e.target.value)} className="border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)] text-white rounded-lg px-2 py-2 text-sm">
                <option value="">— dono —</option>
                {team.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => delRow(i)} className="text-[var(--color-v4-text-muted)] hover:text-[var(--color-v4-red)] p-1" title="Remover linha"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-v4-text-muted)] hover:text-white"><Plus size={13} /> adicionar mais um</button>
        <div className="flex gap-2 mt-4 items-center">
          <span className="text-[11px] text-[var(--color-v4-text-muted)]">{preenchidos} lead(s) preenchido(s)</span>
          <div className="flex-1" />
          <button onClick={onClose} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button disabled={!preenchidos} onClick={() => onConfirm(rows)} className="inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-white text-sm font-bold disabled:opacity-30" style={{ background: RED }}><ArrowRight size={14} /> Registrar e enviar ao Hub</button>
        </div>
      </div>
    </div>
  );
};

const Campo: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="text-[11px] text-[var(--color-v4-text-muted)] uppercase font-semibold block mb-1">{label}{hint && <span className="normal-case font-normal"> · {hint}</span>}</label>
    {children}
  </div>
);
const Kpi: React.FC<{ icon: any; label: string; value: React.ReactNode; hint?: string; accent?: boolean; danger?: boolean }> = ({ icon: Icon, label, value, hint, accent, danger }) => (
  <div className={`${card} px-3 py-2.5`}>
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-v4-text-muted)] flex items-center gap-1"><Icon size={11} /> {label}</div>
    <div className="text-xl font-bold" style={{ color: accent ? RED : danger ? "#ef4444" : "#fff" }}>{value}</div>
    {hint && <div className="text-[10px] text-[var(--color-v4-text-muted)]">{hint}</div>}
  </div>
);

export const LabDisparosRoute: React.FC = () => {
  const store = useAppStore();
  const team = useMemo(() => {
    const t = store.members.filter((m) => m.active && (m.role === "sdr" || m.role === "gestor")).map((m) => m.name);
    return t.length ? t : FALLBACK_TEAM;
  }, [store.members]);
  return <DisparosCalc team={team} />;
};
export default DisparosCalc;
