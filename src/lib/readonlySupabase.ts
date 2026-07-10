/**
 * readonlySupabase — transforma um SupabaseClient normal num cliente
 * FISICAMENTE incapaz de escrever, para o ambiente Labs.
 *
 * POR QUÊ: as telas herdadas gravam pela anon key (`supabase.from().update()`,
 * etc.). No banco de PRODUÇÃO o RLS tem policies `INSERT/UPDATE WITH CHECK (true)`,
 * então a anon **escreve** — e o RLS é compartilhado com o SalesHub real, não dá
 * pra mexer nele aqui. A solução no Labs é neutralizar a escrita no cliente: toda
 * operação de mutação é interceptada ANTES de sair pela rede e devolve um erro
 * read-only (`code: 'LABS_READONLY'`), sem tocar no banco.
 *
 * O que é BLOQUEADO (nenhuma tela consegue gravar, nem por engano):
 *   - `.from(x).insert/update/delete/upsert(...)`  (mutação de tabela)
 *   - `.rpc('nome', ...)` que NÃO comece com `get_`  (ex.: roleta_*, reconcile_*)
 *   - `.functions.invoke(...)`  (edge functions rodam com service_role → escrevem)
 *   - `.storage.from(b).upload/remove/update/move/copy(...)`  (escrita em bucket)
 *   - gestão de bucket (`createBucket`/`deleteBucket`/`emptyBucket`/`updateBucket`)
 *
 * O que CONTINUA funcionando (só leitura / sem efeito colateral no banco):
 *   - `.auth.*`  (login segue normal)
 *   - `.from(x).select(...)`  (leitura via RLS de leitura)
 *   - `.rpc('get_*', ...)`  (RPCs de leitura: dashboards, perf, funil…)
 *   - `.channel(...)` / realtime  (assinatura = leitura)
 *   - `.storage` reads (`download`/`list`/`getPublicUrl`/`createSignedUrl`)
 *
 * Observação honesta: a anon key ainda existe no bundle (é necessária pro login).
 * Este wrapper garante que o CÓDIGO do app não escreve. A garantia física para a
 * via de DADOS é o proxy `erick_readonly` (/api/labs/query), que é a forma
 * recomendada de LER dados nos componentes novos de `src/components/labs/`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const LABS_READONLY_CODE = 'LABS_READONLY';

function readonlyError(op: string) {
  return {
    message: `🔒 Labs é somente leitura — "${op}" bloqueado. Nada foi gravado no banco.`,
    code: LABS_READONLY_CODE,
    details: 'Cliente Supabase do Labs neutralizado (sem poder de escrita). Ver src/lib/readonlySupabase.ts.',
    hint: 'Para gravar de verdade, o trabalho vira PR pro Gabriel portar pro saleshub-ruston.',
  };
}

/** Resultado no formato PostgREST que as telas esperam ao dar `await`. */
function blockedResult(op: string) {
  return { data: null, error: readonlyError(op), count: null, status: 403, statusText: 'Forbidden (Labs read-only)' };
}

/**
 * "Builder envenenado": é thenable (resolve com o erro read-only) e chainable
 * (qualquer método — .eq/.match/.select/.single… — devolve ele mesmo), pra
 * imitar `.update({...}).eq('id', id)` sem nunca fazer request de escrita.
 */
function blockedBuilder(op: string): any {
  const result = blockedResult(op);
  const target = function () {} as unknown as object;
  const proxy: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'isLabsBlocked') return true;
      if (prop === 'then') return (res: any, rej?: any) => Promise.resolve(result).then(res, rej);
      if (prop === 'catch') return (rej: any) => Promise.resolve(result).catch(rej);
      if (prop === 'finally') return (cb: any) => Promise.resolve(result).finally(cb);
      if (prop === Symbol.toStringTag) return 'LabsBlockedBuilder';
      // qualquer outro acesso vira função chainable que devolve o próprio builder
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  if (typeof console !== 'undefined') {
    console.warn(`[Labs read-only] escrita bloqueada: ${op} — nada foi gravado.`);
  }
  return proxy;
}

const WRITE_FROM = new Set(['insert', 'update', 'upsert', 'delete']);
const WRITE_STORAGE = new Set([
  'upload', 'remove', 'update', 'move', 'copy', 'createSignedUploadUrl', 'uploadToSignedUrl',
]);
const WRITE_STORAGE_ADMIN = new Set(['createBucket', 'deleteBucket', 'emptyBucket', 'updateBucket']);

function wrapFromBuilder(builder: any, table: string): any {
  return new Proxy(builder, {
    get(t, prop, r) {
      if (typeof prop === 'string' && WRITE_FROM.has(prop)) {
        return () => blockedBuilder(`from('${table}').${prop}()`);
      }
      const v = Reflect.get(t, prop, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

function wrapStorage(storage: any): any {
  return new Proxy(storage, {
    get(t, prop, r) {
      if (typeof prop === 'string' && WRITE_STORAGE_ADMIN.has(prop)) {
        return () => Promise.resolve(blockedResult(`storage.${prop}()`));
      }
      if (prop === 'from') {
        return (bucket: string) => {
          const bucketApi = t.from(bucket);
          return new Proxy(bucketApi, {
            get(bt, bprop, br) {
              if (typeof bprop === 'string' && WRITE_STORAGE.has(bprop)) {
                return () => Promise.resolve(blockedResult(`storage.from('${bucket}').${bprop}()`));
              }
              const bv = Reflect.get(bt, bprop, br);
              return typeof bv === 'function' ? bv.bind(bt) : bv;
            },
          });
        };
      }
      const v = Reflect.get(t, prop, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

function wrapFunctions(functions: any): any {
  return new Proxy(functions, {
    get(t, prop, r) {
      if (prop === 'invoke') {
        return (name: string) => Promise.resolve(blockedResult(`functions.invoke('${name}')`));
      }
      const v = Reflect.get(t, prop, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/**
 * Envolve um SupabaseClient e devolve uma versão read-only (mesma API/tipo).
 * Reads e `.auth` passam direto; toda escrita é interceptada.
 */
export function makeReadonlyClient(client: SupabaseClient): SupabaseClient {
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      switch (prop) {
        case 'from':
          return (table: string) => wrapFromBuilder(target.from(table), table);
        case 'rpc':
          return (fn: string, args?: any, opts?: any) => {
            // Só RPCs de leitura (convenção get_*) passam; o resto é bloqueado.
            if (/^get_/i.test(String(fn))) return (target.rpc as any)(fn, args, opts);
            return blockedBuilder(`rpc('${fn}')`);
          };
        case 'storage':
          return wrapStorage(target.storage);
        case 'functions':
          return wrapFunctions((target as any).functions);
        default: {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
      }
    },
  });
  return proxy as SupabaseClient;
}
