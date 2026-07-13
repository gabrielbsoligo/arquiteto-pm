import React, { useState } from "react";
import { X, Check, XCircle, Calendar, User } from "lucide-react";
import type { Reuniao } from "../types";
import { useAppStore } from "../store";

interface Props {
  reuniao: Reuniao;
  onConfirm: (show: boolean, closerConfirmadoId: string) => void;
  onClose: () => void;
  /** Reagenda a reunião pra nova data (atualiza SalesHub + Google Calendar via rescheduleReuniao). */
  onReagendar?: (dataISO: string) => void | Promise<void>;
}

export const ConfirmarReuniaoModal: React.FC<Props> = ({ reuniao, onConfirm, onClose, onReagendar }) => {
  const { members } = useAppStore();
  const closers = members.filter(m => (m.role === 'closer' || m.role === 'gestor') && m.active);
  const [closerConfirmadoId, setCloserConfirmadoId] = useState(reuniao.closer_id || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [reagendarMode, setReagendarMode] = useState(false);
  const toLocalInput = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [novaData, setNovaData] = useState(toLocalInput(reuniao.data_reuniao));

  const handleConfirm = async (show: boolean) => {
    if (isProcessing || !closerConfirmadoId) return;
    setIsProcessing(true);
    onConfirm(show, closerConfirmadoId);
  };

  const handleReagendar = async () => {
    if (isProcessing || !novaData || !onReagendar) return;
    setIsProcessing(true);
    try { await onReagendar(new Date(novaData).toISOString()); } finally { setIsProcessing(false); }
  };

  const inputClass = "w-full px-3 py-2 rounded-lg bg-[var(--color-v4-bg)] border border-[var(--color-v4-border)] text-white text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-v4-red)]";

  const dataReuniao = reuniao.data_reuniao ? new Date(reuniao.data_reuniao) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[var(--color-v4-card)] border border-[var(--color-v4-border)] rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-green-500/10 border-b border-green-500/20 px-5 py-4 flex items-center gap-3">
          <Calendar size={18} className="text-green-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-green-400">Confirmar Reunião</h3>
            <p className="text-xs text-[var(--color-v4-text-muted)]">{reuniao.empresa}</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-v4-text-muted)] hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-[var(--color-v4-surface)] rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-v4-text-muted)]">Empresa</span>
              <span className="text-sm text-white font-medium">{reuniao.empresa}</span>
            </div>
            {reuniao.nome_contato && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-v4-text-muted)]">Contato</span>
                <span className="text-sm text-white">{reuniao.nome_contato}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-v4-text-muted)]">Data</span>
              <span className="text-sm text-white">{dataReuniao ? dataReuniao.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-v4-text-muted)]">SDR</span>
              <span className="text-sm text-white">{reuniao.sdr?.name || '—'}</span>
            </div>
            {reuniao.closer && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-v4-text-muted)]">Closer agendado</span>
                <span className="text-sm text-white">{reuniao.closer.name}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-v4-text-muted)] mb-1">
              <User size={12} className="inline mr-1" />
              Closer que executou a reunião *
            </label>
            <select className={inputClass} value={closerConfirmadoId} onChange={e => setCloserConfirmadoId(e.target.value)}>
              <option value="">Selecionar closer</option>
              {closers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {reuniao.closer_id && closerConfirmadoId && reuniao.closer_id !== closerConfirmadoId && (
              <p className="text-[10px] text-yellow-400 mt-1">⚠️ Closer diferente do agendado</p>
            )}
          </div>

          {!reagendarMode && <p className="text-xs text-[var(--color-v4-text-muted)] text-center">A reunião aconteceu?</p>}

          {onReagendar && (!reagendarMode ? (
            <button onClick={() => setReagendarMode(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] hover:text-white hover:border-[var(--color-v4-border-strong)] text-sm">
              <Calendar size={14} /> Reagendar para outra data
            </button>
          ) : (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
              <label className="block text-xs font-medium text-yellow-400">Nova data e hora</label>
              <input type="datetime-local" className={inputClass} value={novaData} onChange={e => setNovaData(e.target.value)} />
              <p className="text-[10px] text-[var(--color-v4-text-muted)]">Atualiza no SalesHub e no Google Calendar automaticamente.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setReagendarMode(false)} className="py-2 px-3 rounded-lg border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Voltar</button>
                <button onClick={handleReagendar} disabled={!novaData || isProcessing}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 disabled:opacity-30 text-black font-bold text-sm">
                  <Calendar size={14} /> {isProcessing ? 'Reagendando...' : 'Confirmar reagendamento'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {!reagendarMode && (
        <div className="px-5 py-4 border-t border-[var(--color-v4-border)] flex gap-3">
          <button onClick={onClose} className="py-2.5 px-4 rounded-xl border border-[var(--color-v4-border)] text-[var(--color-v4-text-muted)] text-sm">Cancelar</button>
          <button onClick={() => handleConfirm(false)} disabled={!closerConfirmadoId || isProcessing}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 disabled:opacity-30 text-red-400 font-medium text-sm">
            <XCircle size={14} /> {isProcessing ? '...' : 'No-show'}
          </button>
          <button onClick={() => handleConfirm(true)} disabled={!closerConfirmadoId || isProcessing}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-30 text-black font-bold text-sm">
            <Check size={14} /> {isProcessing ? '...' : 'Realizada'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
};
