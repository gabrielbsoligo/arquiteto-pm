import { createClient } from '@supabase/supabase-js'
import { makeReadonlyClient } from './readonlySupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Supabase URL ou Anon Key não configurados. Crie um arquivo .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
}

// Cliente base (anon key). ATENÇÃO: a anon NÃO é read-only — no RLS de produção
// as policies têm INSERT/UPDATE WITH CHECK (true), então a anon ESCREVE.
// Por isso, no Labs, NUNCA exportamos o cliente cru: ele é envolvido por
// makeReadonlyClient(), que bloqueia toda escrita (insert/update/delete/upsert,
// RPC de escrita, functions.invoke, storage write). Login/leitura seguem normais.
// A via de DADOS recomendada continua sendo o proxy erick_readonly (labsQuery).
const rawClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
)

export const supabase = makeReadonlyClient(rawClient)
