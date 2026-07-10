/**
 * server/labsReadonly.ts — NÚCLEO da via de dados READ-ONLY do Labs.
 *
 * Isto roda SEMPRE no servidor (Vite dev middleware ou função serverless),
 * NUNCA no navegador. É o único lugar do projeto que abre conexão Postgres.
 *
 * A conexão usa o usuário `erick_readonly` (string em DATABASE_URL_READONLY,
 * uma env var SEM o prefixo VITE_, então ela jamais entra no bundle do cliente).
 * Esse usuário só tem GRANT de SELECT em public+kommo — qualquer INSERT/UPDATE/
 * DELETE é recusado pelo próprio Postgres (erro 42501).
 *
 * Defesa em profundidade (a trava real é o GRANT do usuário no banco):
 *   1) a credencial que chega aqui é a do erick_readonly (só lê);
 *   2) recusamos qualquer statement que não comece com SELECT/WITH;
 *   3) rodamos dentro de uma transação `READ ONLY`.
 *
 * ⛔ NUNCA aponte DATABASE_URL_READONLY para o usuário `postgres`/service_role.
 */
import pg from 'pg';

// Não deixa o driver "adivinhar" datas/numeric como objetos estranhos no JSON.
pg.types.setTypeParser(1114, (v) => v); // timestamp -> string
pg.types.setTypeParser(1184, (v) => v); // timestamptz -> string

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL_READONLY;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_READONLY não configurada. Copie .env.example para .env.local ' +
        'e cole a connection string do usuário erick_readonly (SÓ LEITURA).',
    );
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      // Supabase exige TLS; o pooler/So certs públicos bastam.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

const READ_ONLY_RE = /^\s*(select|with)\b/i;

export interface LabsQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
}

/**
 * Executa UMA consulta de leitura como erick_readonly, dentro de uma
 * transação READ ONLY. Lança se o statement não for SELECT/WITH.
 */
export async function runReadonlyQuery(
  sql: string,
  params: unknown[] = [],
): Promise<LabsQueryResult> {
  const trimmed = String(sql ?? '').trim().replace(/;\s*$/, '');
  if (!trimmed) throw new Error('SQL vazio.');
  if (trimmed.includes(';')) {
    throw new Error('Só é permitido um único statement (sem ";").');
  }
  if (!READ_ONLY_RE.test(trimmed)) {
    throw new Error('Só leitura: o statement precisa começar com SELECT ou WITH.');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const res = await client.query(trimmed, params);
    await client.query('COMMIT');
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? res.rows.length,
      fields: res.fields?.map((f) => f.name) ?? [],
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Handler agnóstico de framework: recebe o body já parseado ({ sql, params }),
 * devolve { status, body } pronto pra virar resposta HTTP. Usado tanto pelo
 * middleware do Vite (dev) quanto pela função serverless (Vercel).
 */
export async function handleLabsQuery(
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { sql, params } = (body ?? {}) as { sql?: unknown; params?: unknown };
  if (typeof sql !== 'string') {
    return { status: 400, body: { error: 'Campo "sql" (string) é obrigatório.' } };
  }
  const paramsArr = Array.isArray(params) ? params : [];
  try {
    const result = await runReadonlyQuery(sql, paramsArr);
    return { status: 200, body: { ...result } };
  } catch (err) {
    const e = err as { message?: string; code?: string };
    // 42501 = insufficient_privilege (a prova de que erick_readonly não escreve).
    const status = e.code === '42501' ? 403 : 400;
    return { status, body: { error: e.message ?? String(err), code: e.code } };
  }
}
