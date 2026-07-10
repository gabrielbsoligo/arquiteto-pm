/**
 * verify-no-write.ts — PROVA de que o cliente Supabase do Labs NÃO escreve.
 *
 * Recria o cliente exatamente como o app (createClient + makeReadonlyClient) e
 * dispara, pelas MESMAS chamadas que as telas herdadas usam, cada vetor de
 * escrita. Espera que todos sejam BLOQUEADOS (code LABS_READONLY, nada gravado),
 * e que as leituras continuem passando. É offline: as escritas são
 * curto-circuitadas antes de qualquer request, então nada vai pra rede.
 *
 * Uso:  npm run labs:verify-nowrite
 */
import { createClient } from '@supabase/supabase-js';
import { makeReadonlyClient, LABS_READONLY_CODE } from '../../src/lib/readonlySupabase';

const raw = createClient('https://placeholder.supabase.co', 'placeholder-anon-key');
const supabase = makeReadonlyClient(raw);

let pass = 0;
let fail = 0;

async function expectBlocked(label: string, thenable: any) {
  const r = await thenable;
  const ok = !!(r && r.error && r.error.code === LABS_READONLY_CODE) && r.data == null;
  console.log(`${ok ? '✓' : '✗'} BLOQUEADO  ${label}  ->  ${ok ? r.error.message : JSON.stringify(r)}`);
  ok ? pass++ : fail++;
}

function expectAllowed(label: string, builder: any) {
  // Leitura: NÃO pode ser um "builder envenenado" (sem await, sem rede).
  const ok = !builder?.isLabsBlocked;
  console.log(`${ok ? '✓' : '✗'} PASSA (read) ${label}`);
  ok ? pass++ : fail++;
}

console.log('— Escritas (têm que ser TODAS bloqueadas) —');
// O cenário reportado: mover lead de etapa via UPDATE.
await expectBlocked("from('leads').update({etapa}).eq('id',1)", supabase.from('leads').update({ etapa: 'ganho' }).eq('id', 1));
await expectBlocked("from('deals').update({status}).eq('id',1)", supabase.from('deals').update({ status: 'won' }).eq('id', 1));
await expectBlocked("from('leads').insert({...})", supabase.from('leads').insert({ nome: 'x' }));
await expectBlocked("from('deals').delete().eq('id',1)", supabase.from('deals').delete().eq('id', 1));
await expectBlocked("from('metas').upsert({...})", supabase.from('metas').upsert({ id: 1 }));
await expectBlocked("rpc('roleta_reset') [write]", supabase.rpc('roleta_reset', {}));
await expectBlocked("rpc('reconcile_leadbroker_csv') [write]", supabase.rpc('reconcile_leadbroker_csv', {}));
await expectBlocked("functions.invoke('notify-rokko-ganho')", supabase.functions.invoke('notify-rokko-ganho', {}));
await expectBlocked("storage.from('contratos').upload(...)", supabase.storage.from('contratos').upload('a.pdf', new Uint8Array()));
await expectBlocked("storage.from('contratos').remove(...)", supabase.storage.from('contratos').remove(['a.pdf']));

console.log('\n— Leituras (têm que continuar passando) —');
expectAllowed("from('leads').select('*')", supabase.from('leads').select('*'));
expectAllowed("from('deals').select().eq('id',1)", supabase.from('deals').select('*').eq('id', 1));
expectAllowed("rpc('get_dashboard_data') [read]", supabase.rpc('get_dashboard_data', {}));

console.log(`\n${fail === 0 ? '✅' : '❌'} resultado: ${pass} ok, ${fail} falha(s).`);
if (fail === 0) {
  console.log('✅ O Labs NÃO consegue escrever: toda mutação é bloqueada no cliente (nada vai ao banco).');
} else {
  console.log('❌ Existe caminho de escrita não bloqueado — revisar readonlySupabase.ts.');
}
process.exit(fail === 0 ? 0 : 1);
