import React, { useEffect, useRef, useState } from "react";
import { ShoppingCart, X, TrendingUp, DollarSign, Target } from "lucide-react";
import { useAppStore } from "../../store";
import type { Lead, Deal } from "../../types";

/**
 * LeadbrokerWatcher — vigia o canal LeadBroker (V4, clone Labs). Sempre que ENTRAM
 * leads novos com canal 'leadbroker' (comparado a um baseline salvo em localStorage),
 * mostra um CARD CENTRAL com os totais do mês: nº de leads, investido (R$) e retorno
 * em vendas fechadas (R$). Só leitura — não escreve no banco nem cria leads.
 *
 * Montado globalmente no App (overlay em qualquer tela). Como o clone é read-only,
 * a detecção dispara quando os dados do store mudam (login/refetch) e há id novo.
 */
const RED = "var(--color-v4-red)";
const MUTED = "var(--color-v4-text-muted)";
const SEEN_KEY = "v4_lb_seen_ids_v1";
const brl = (n: number) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const ymOf = (v?: string | null) => (v ? String(v).slice(0, 7) : "");
const dealValor = (d: Deal) => {
  const a = (Number(d.valor_mrr) || 0) + (Number(d.valor_ot) || 0);
  return a > 0 ? a : (Number(d.valor_escopo) || 0) + (Number(d.valor_recorrente) || 0);
};

export interface LbMes { totalLeads: number; investido: number; retorno: number; fechados: number; }
/** Métricas do mês `ym` (YYYY-MM) para o canal leadbroker. Pura. */
export function computeLbMes(leads: Lead[], deals: Deal[], ym: string): LbMes {
  const lb = leads.filter((l) => (l.canal || "").toLowerCase() === "leadbroker" && ymOf(l.data_cadastro || (l as any).created_at) === ym);
  const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const fechados = deals.filter((d) => {
    if (d.status !== "contrato_assinado") return false;
    const org = (d.origem || d.lead?.canal || (d.lead_id ? leadById.get(d.lead_id)?.canal : "") || "").toLowerCase();
    return org === "leadbroker" && ymOf(d.data_fechamento || d.data_call || (d as any).created_at) === ym;
  });
  return {
    totalLeads: lb.length,
    investido: lb.reduce((a, l) => a + (Number(l.valor_lead) || 0), 0),
    retorno: fechados.reduce((a, d) => a + dealValor(d), 0),
    fechados: fechados.length,
  };
}

const readSeen = (): string[] | null => { try { const r = localStorage.getItem(SEEN_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* quota */ } };

// ---------------- Card central ----------------
export const LeadbrokerCard: React.FC<{ novos: number; mes: LbMes; mesLabel: string; onClose: () => void }> = ({ novos, mes, mesLabel, onClose }) => (
  <div style={{ position: "fixed", top: 74, left: "50%", transform: "translateX(-50%)", zIndex: 90 }} className="w-[min(92vw,460px)]">
    <div className="rounded-2xl border shadow-2xl overflow-hidden" style={{ borderColor: RED, background: "var(--color-v4-card)" }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: RED }}>
        <ShoppingCart size={16} className="text-white" />
        <span className="text-[13px] font-bold text-white flex-1">
          {novos > 0 ? `${novos} novo(s) lead(s) LeadBroker!` : "LeadBroker — resumo do mês"}
        </span>
        <button onClick={onClose} className="text-white/80 hover:text-white" title="Fechar"><X size={16} /></button>
      </div>
      <div className="p-4">
        <p className="text-[11px] mb-3" style={{ color: MUTED }}>Controle atualizado do canal LeadBroker · <b className="text-white">{mesLabel}</b></p>
        <div className="grid grid-cols-3 gap-2">
          <Metric icon={Target} label="Leads no mês" value={String(mes.totalLeads)} />
          <Metric icon={DollarSign} label="Investido" value={brl(mes.investido)} />
          <Metric icon={TrendingUp} label="Retorno (vendas)" value={brl(mes.retorno)} accent />
        </div>
        <div className="mt-3 text-[10.5px] flex items-center justify-between" style={{ color: MUTED }}>
          <span>{mes.fechados} contrato(s) fechado(s) no mês</span>
          <span>ROAS {mes.investido > 0 ? `${(mes.retorno / mes.investido).toFixed(2)}x` : "—"}</span>
        </div>
      </div>
    </div>
  </div>
);

const Metric: React.FC<{ icon: any; label: string; value: string; accent?: boolean }> = ({ icon: Icon, label, value, accent }) => (
  <div className="rounded-lg p-2.5 border border-[var(--color-v4-border)]" style={{ background: "var(--color-v4-surface)" }}>
    <div className="flex items-center gap-1 mb-1"><Icon size={12} style={{ color: accent ? RED : MUTED }} /><span className="text-[9px] uppercase tracking-wide truncate" style={{ color: MUTED }}>{label}</span></div>
    <div className="text-[15px] font-bold" style={{ color: accent ? RED : "#fff" }}>{value}</div>
  </div>
);

// ---------------- Watcher (montado no App) ----------------
export const LabLeadbrokerWatcher: React.FC = () => {
  const { leads, deals } = useAppStore();
  const [card, setCard] = useState<{ novos: number; mes: LbMes } | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!leads || !leads.length) return;
    const lbIds = leads.filter((l) => (l.canal || "").toLowerCase() === "leadbroker").map((l) => l.id);
    if (!lbIds.length) return;
    const seen = readSeen();
    if (seen === null) { writeSeen(lbIds); return; } // 1ª vez: baseline silencioso (não notifica)
    const seenSet = new Set(seen);
    const novos = lbIds.filter((id) => !seenSet.has(id));
    if (novos.length) {
      const ym = new Date().toISOString().slice(0, 7);
      setCard({ novos: novos.length, mes: computeLbMes(leads, deals, ym) });
      writeSeen(Array.from(new Set([...seen, ...lbIds])));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCard(null), 15000); // auto-fecha em 15s
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [leads, deals]);

  if (!card) return null;
  const mesLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return <LeadbrokerCard novos={card.novos} mes={card.mes} mesLabel={mesLabel} onClose={() => setCard(null)} />;
};

// ---------------- Demo (verificação): ?labs=lbwatch&demo=1 ----------------
export const LabLeadbrokerWatcherDemo: React.FC = () => {
  const [card, setCard] = useState<{ novos: number; mes: LbMes } | null>({ novos: 2, mes: { totalLeads: 37, investido: 2480, retorno: 96000, fechados: 3 } });
  const mesLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return (
    <div className="flex-1 min-h-screen bg-[var(--color-v4-bg)] text-white p-8">
      <h1 className="text-lg font-bold mb-2">Demo — notificação LeadBroker</h1>
      <p className="text-sm mb-4" style={{ color: MUTED }}>Simula a entrada de novos leads LeadBroker e o card central de resumo do mês.</p>
      <button onClick={() => setCard({ novos: 1 + Math.floor(Math.random() * 4), mes: { totalLeads: 30 + Math.floor(Math.random() * 20), investido: 2000 + Math.floor(Math.random() * 3000), retorno: 50000 + Math.floor(Math.random() * 120000), fechados: 1 + Math.floor(Math.random() * 5) } })}
        className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: RED }}>
        Simular novo lead LeadBroker
      </button>
      {card && <LeadbrokerCard novos={card.novos} mes={card.mes} mesLabel={mesLabel} onClose={() => setCard(null)} />}
    </div>
  );
};

export default LabLeadbrokerWatcher;
