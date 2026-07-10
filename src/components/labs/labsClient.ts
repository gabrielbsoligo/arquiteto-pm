/**
 * labsClient — helper do Erick pra ler dados no playground.
 *
 * Fonte de dados = via READ-ONLY (usuário Postgres `erick_readonly`), servida
 * pelo endpoint local /api/labs/query. Você NÃO fala com o Supabase/anon key
 * aqui: passa um SELECT e recebe as linhas. Como a credencial do servidor é a
 * do erick_readonly (só SELECT), é impossível escrever no banco por este caminho.
 *
 * Uso:
 *   const rows = await labsQuery('select id, nome from team_members limit $1', [10]);
 *
 * Regras (ver CLAUDE.md na raiz):
 *   - Só SELECT/WITH. Nada de insert/update/delete (o banco recusaria de qualquer jeito).
 *   - Um statement por chamada. Use params ($1, $2, ...) em vez de concatenar strings.
 */
export type LabsRow = Record<string, unknown>;

export interface LabsQueryResponse {
  rows: LabsRow[];
  rowCount: number;
  fields: string[];
}

export async function labsQueryFull(
  sql: string,
  params: unknown[] = [],
): Promise<LabsQueryResponse> {
  const res = await fetch('/api/labs/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Resposta inválida do /api/labs/query (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(String(json.error ?? `HTTP ${res.status}`));
  }
  return {
    rows: (json.rows as LabsRow[]) ?? [],
    rowCount: (json.rowCount as number) ?? 0,
    fields: (json.fields as string[]) ?? [],
  };
}

/** Atalho: devolve só as linhas. */
export async function labsQuery(sql: string, params: unknown[] = []): Promise<LabsRow[]> {
  return (await labsQueryFull(sql, params)).rows;
}
