/**
 * api/labs/query.ts — função serverless (estilo Vercel) que expõe a via
 * READ-ONLY do Labs em produção/deploy. Em `npm run dev` a MESMA lógica é
 * servida pelo middleware do Vite (ver vite.config.ts). O front nunca fala
 * com o Postgres direto — só chama POST /api/labs/query.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLabsQuery } from '../../server/labsReadonly';

async function readJson(req: IncomingMessage): Promise<unknown> {
  // Alguns runtimes já entregam req.body parseado.
  const maybe = (req as unknown as { body?: unknown }).body;
  if (maybe && typeof maybe === 'object') return maybe;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(
  req: IncomingMessage & { method?: string },
  res: ServerResponse,
) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Use POST.' }));
    return;
  }
  let out: { status: number; body: Record<string, unknown> };
  try {
    const body = await readJson(req);
    out = await handleLabsQuery(body);
  } catch (err) {
    out = { status: 400, body: { error: (err as Error).message ?? 'Body inválido.' } };
  }
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out.body));
}
