import React, { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { labsQueryFull } from "./labsClient";

/**
 * LabHello — componente-molde do playground do Erick.
 *
 * O que ele faz: lê dados pela via READ-ONLY (usuário Postgres `erick_readonly`,
 * servida pelo endpoint local /api/labs/query), faz UM `SELECT` numa tabela real
 * e mostra o resultado numa tabelinha, reusando o estilo visual do app
 * (variáveis --color-v4-*).
 *
 * Regras (ver CLAUDE.md na raiz):
 *  - SOMENTE leitura. A credencial do servidor é a do erick_readonly, que só tem
 *    GRANT de SELECT — insert/update/delete são recusados pelo próprio Postgres.
 *  - NÃO usamos mais a anon key do Supabase pra dados: a anon consegue ESCREVER
 *    (as policies de produção têm INSERT WITH CHECK (true)). Por isso a via de
 *    dados do Labs é o erick_readonly, não a anon.
 *  - Copie este arquivo como ponto de partida pros seus experimentos em labs/.
 *
 * Troque SQL/params pela consulta que quiser inspecionar. Use sempre params
 * ($1, $2, ...) em vez de concatenar valores na string.
 */
const SQL = "select * from team_members limit $1";
const LIMITE = 10;

export function LabHello() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alivo = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Leitura pura via erick_readonly. Sem nenhuma mutação possível.
        const { rows, fields } = await labsQueryFull(SQL, [LIMITE]);
        if (!alivo) return;
        setRows(rows as Record<string, unknown>[]);
        setColunas((fields.length ? fields : Object.keys(rows[0] ?? {})).slice(0, 5));
      } catch (e) {
        if (!alivo) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alivo) setLoading(false);
      }
    })();
    return () => {
      alivo = false;
    };
  }, []);

  return (
    <div className="p-4 rounded-xl border border-[var(--color-v4-border)] bg-[var(--color-v4-surface)]/40 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-4 h-4 text-[var(--color-v4-text-muted)]" />
        <h2 className="text-sm font-semibold text-white">
          Lab Hello — leitura de <code className="text-[var(--color-v4-text-muted)]">team_members</code>
        </h2>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-v4-text-muted)] mb-3">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
        via <code>erick_readonly</code> — só SELECT (a credencial não escreve no banco)
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-v4-text-muted)] py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-amber-400/90 py-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Não consegui ler os dados.</p>
            <p className="text-[var(--color-v4-text-muted)]">{error}</p>
            <p className="text-[var(--color-v4-text-muted)] mt-1">
              Rode o app localmente (<code>npm run dev</code>) com o
              <code> .env.local</code> preenchido (ver <code>.env.example</code>):
              a via read-only precisa alcançar o Postgres do Supabase. No preview do
              Code Web as portas 5432/6543 ficam bloqueadas — use o preview só pra UI.
            </p>
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--color-v4-text-muted)] py-4">
          Consulta OK, mas voltou vazia (0 linhas).
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[11px] text-[var(--color-v4-text-muted)] text-left">
                {colunas.map((c) => (
                  <th key={c} className="px-2 py-1">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-[var(--color-v4-border)] text-white">
                  {colunas.map((c) => (
                    <td key={c} className="px-2 py-1.5">{formatCell(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[var(--color-v4-text-muted)] mt-2">
            {rows.length} linha(s) · máx. {LIMITE} · somente leitura
          </p>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default LabHello;
