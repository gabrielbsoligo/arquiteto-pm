/**
 * verify-readonly.mjs — PROVA de que a via de dados do Labs é read-only.
 *
 * Conecta como `erick_readonly` (DATABASE_URL_READONLY do .env.local) e:
 *   1) roda um SELECT  -> deve FUNCIONAR;
 *   2) tenta um INSERT -> deve ser RECUSADO (Postgres 42501 insufficient_privilege);
 *   3) tenta um UPDATE -> deve ser RECUSADO (idem).
 *
 * Se qualquer escrita PASSAR, a credencial está errada (não é read-only) e o
 * script sai com código != 0. As tentativas de escrita rodam dentro de uma
 * transação com ROLLBACK garantido — nada é persistido nem no pior caso.
 *
 * Uso:  npm run labs:verify     (precisa de DATABASE_URL_READONLY no .env.local)
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL_READONLY;
if (!url) {
  console.error(
    '✗ DATABASE_URL_READONLY não definida. Copie .env.example para .env.local ' +
      'e cole a connection string do erick_readonly (SÓ LEITURA).',
  );
  process.exit(2);
}

// Guarda de sanidade: essa via NUNCA deve usar o superusuário postgres.
if (/:\/\/postgres[:@]/i.test(url)) {
  console.error('✗ DATABASE_URL_READONLY aponta para o usuário `postgres`. Use erick_readonly.');
  process.exit(2);
}

const WRITE_TABLE = 'leads'; // tabela real com policy INSERT WITH CHECK (true) em produção
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

function isPermissionDenied(err) {
  return err && (err.code === '42501' || /permission denied/i.test(err.message || ''));
}

let selectOk = false;
let insertDenied = false;
let updateDenied = false;

try {
  await client.connect();

  // 1) SELECT — deve funcionar
  try {
    const r = await client.query('select current_user as usuario, count(*)::int as n from public.leads');
    selectOk = true;
    console.log(`✓ SELECT ok  — conectado como "${r.rows[0].usuario}", public.leads tem ${r.rows[0].n} linha(s).`);
  } catch (err) {
    console.log(`✗ SELECT FALHOU (não deveria): ${err.code || ''} ${err.message}`);
  }

  // 2) INSERT — deve ser recusado. ROLLBACK garantido.
  try {
    await client.query('BEGIN');
    await client.query(`insert into public.${WRITE_TABLE} (nome) values ($1)`, ['__labs_readonly_probe__']);
    await client.query('ROLLBACK');
    console.log('✗ INSERT PASSOU (FALHA DE SEGURANÇA): a credencial CONSEGUE escrever!');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    insertDenied = isPermissionDenied(err);
    console.log(
      `${insertDenied ? '✓' : '✗'} INSERT recusado — ${err.code || ''} ${err.message}` +
        (insertDenied ? '' : '  (esperado 42501 permission denied)'),
    );
  }

  // 3) UPDATE — deve ser recusado. ROLLBACK garantido.
  try {
    await client.query('BEGIN');
    await client.query(`update public.${WRITE_TABLE} set nome = nome where false`);
    await client.query('ROLLBACK');
    console.log('✗ UPDATE PASSOU (FALHA DE SEGURANÇA): a credencial CONSEGUE escrever!');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    updateDenied = isPermissionDenied(err);
    console.log(
      `${updateDenied ? '✓' : '✗'} UPDATE recusado — ${err.code || ''} ${err.message}` +
        (updateDenied ? '' : '  (esperado 42501 permission denied)'),
    );
  }
} catch (err) {
  console.error(`✗ Erro de conexão: ${err.code || ''} ${err.message}`);
  console.error(
    '  (No preview do Code Web as portas 5432/6543 do Postgres ficam bloqueadas; ' +
      'rode este teste numa máquina com acesso ao Supabase.)',
  );
  process.exit(3);
} finally {
  await client.end().catch(() => {});
}

const ok = selectOk && insertDenied && updateDenied;
console.log(
  '\n' +
    (ok
      ? '✅ PROVA OK: lê (SELECT) e NÃO escreve (INSERT/UPDATE recusados). Credencial read-only confirmada.'
      : '❌ PROVA FALHOU: veja acima. A credencial NÃO está garantidamente read-only.'),
);
process.exit(ok ? 0 : 1);
