# `src/components/labs/` — playground do Erick

Esta é a **única** pasta onde você cria arquivos. Tudo aqui é experimental e
descartável; o que der certo vira PR pro Gabriel portar pro produto.

## Regras (resumo — o detalhe está no `CLAUDE.md` da raiz)

- ✅ Crie componentes **novos** aqui dentro.
- ✅ Leia dados só com `labsQuery('select ... limit $1', [10])` — via **read-only**
  (usuário Postgres `erick_readonly`, que só faz `SELECT`).
- ✅ Reuse o que já existe importando (ex.: `../ui/...`).
- ❌ Não edite arquivos fora desta pasta.
- ❌ Nada de escrita no banco (`insert`/`update`/`delete`/migration/RPC de escrita) —
  o `erick_readonly` recusaria de qualquer jeito (erro `42501`).
- ❌ Nada de `service_role` / usuário `postgres` / `sbp_...`. E **nem a `anon` key
  pra dados**: a anon **escreve** (policies `INSERT WITH CHECK (true)` em produção).

## Como ler dados (`labsClient.ts`)

```tsx
import { labsQuery } from './labsClient';

const rows = await labsQuery('select id, nome from team_members limit $1', [10]);
```

`labsQuery` bate no endpoint local `/api/labs/query`, que roda o SELECT como
`erick_readonly` **no servidor** — a connection string nunca chega ao navegador.
Use sempre params (`$1`, `$2`, ...) em vez de concatenar valores na string.

## Exemplo

`LabHello.tsx` — molde mínimo: faz um `SELECT` via `labsQuery` e mostra o
resultado numa tabelinha com o mesmo estilo visual do app. Copie ele como ponto
de partida e troque a query.

```tsx
import { LabHello } from './components/labs/LabHello';
// ...em algum lugar do app durante o experimento:
<LabHello />
```

## Rodando

- **Localmente** (`npm install` → `npm run dev`): a leitura de dados funciona,
  desde que o `.env.local` tenha `DATABASE_URL_READONLY` preenchido (ver `.env.example`).
- **Preview do Code Web**: as portas Postgres (5432/6543) ficam bloqueadas, então
  a leitura de dados não conecta — use o preview só pra mexer na UI.
- Pra provar que a credencial só lê: `npm run labs:verify`
  (roda um `SELECT` que funciona e um `INSERT/UPDATE` que é recusado).
