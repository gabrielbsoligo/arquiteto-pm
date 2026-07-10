# SalesHub Labs — Regras de Ouro (LEIA ANTES DE QUALQUER COISA)

Este repositório (`saleshub-labs`) é um **ambiente de experimentação read-only** do
SalesHub, mantido para o **Erick** prototipar telas e componentes. É uma **cópia**
do `saleshub-ruston` (a origem, o produto de verdade). O que vale aqui:

> **Nada que você fizer aqui altera o produto nem o banco.** Todo trabalho útil
> vira um **Pull Request** para o Gabriel revisar e portar pro `saleshub-ruston`.

---

## 🔌 FONTE DE DADOS = conexão READ-ONLY (`erick_readonly`)

A fonte de dados do Labs é o **usuário Postgres `erick_readonly`**, que só tem
`GRANT` de **SELECT** em `public`+`kommo`. Qualquer `INSERT/UPDATE/DELETE` é
**recusado pelo próprio Postgres** (erro `42501`). Você lê chamando o helper
`labsQuery(...)` de `src/components/labs/labsClient.ts`, que bate num endpoint
local (`/api/labs/query`); a connection string (`DATABASE_URL_READONLY`, no seu
`.env.local`) fica **só no servidor** e **nunca** entra no bundle do navegador.

> ⚠️ **NÃO use a `anon` key do Supabase pra dados.** A anon **NÃO é read-only**:
> as policies de produção têm `INSERT WITH CHECK (true)`, então a anon **escreve**.
> Por isso a via de dados do Labs é o `erick_readonly`, e não a anon.
> Nunca use a `service_role` key nem o usuário `postgres` (ignoram grants/RLS).

> 🛡️ **O cliente Supabase compartilhado (`src/lib/supabase.ts`) foi neutralizado:**
> `makeReadonlyClient` (`src/lib/readonlySupabase.ts`) intercepta **toda escrita**
> (`insert/update/delete/upsert`, RPC de escrita, `functions.invoke`, storage write)
> e devolve erro `LABS_READONLY` **sem tocar o banco** — então nenhuma tela herdada
> grava, nem por engano. Login e leitura (`select`, RPC `get_*`) seguem normais.
> Prova: `npm run labs:verify-nowrite`. (Não se mexe no RLS — ele é compartilhado
> com o SalesHub de produção.)

---

## ✅ PODE

- **CRIAR** arquivos novos **somente** dentro de `src/components/labs/`.
- **LER** dados **apenas com SELECT**, via `labsQuery(...)` (`labsClient.ts`),
  que usa a conexão **read-only** do `erick_readonly` (`DATABASE_URL_READONLY`).
- Reusar os componentes visuais e utilitários que já existem no projeto
  (ex.: `src/components/ui/`) — **importando**, sem editá-los.
- Rodar o app localmente (`npm install` → `npm run dev`) e abrir o preview.
  (No preview do **Code Web** as portas Postgres 5432/6543 ficam bloqueadas —
  a leitura de dados só funciona rodando localmente; use o Code Web só pra UI.)

## ❌ NÃO PODE (nunca)

- **NUNCA editar** um arquivo que já existe fora de `src/components/labs/`.
  (Nada de mexer em telas, store, tipos, libs, migrations, edge functions, etc.)
- **NUNCA** rodar migration, `INSERT`, `UPDATE`, `DELETE`, `upsert`, RPC de escrita,
  ou qualquer coisa que altere dados/estrutura do banco. (Com o `erick_readonly`
  isso já é impossível — mas nem *tente*.)
- **NUNCA** usar a **`service_role` key**, o usuário **`postgres`**, nem um
  **Personal Access Token (`sbp_...`)**. Nem a **`anon` key** pra dados (ela escreve).
  Se você viu uma credencial dessas em algum lugar, ela está **errada/vazada** —
  pare e avise o Gabriel.
- **NUNCA** commitar segredos (`.env`, chaves, tokens) no repositório.
- **NUNCA** dar push direto na `main`. Todo trabalho sai em **branch + PR**.

---

## Fluxo de trabalho do Erick

1. Trabalhe sempre numa branch (`git checkout -b labs/minha-ideia`).
2. Crie seus componentes **dentro de `src/components/labs/`**.
3. Leia dados só com `labsQuery('select ... limit $1', [10])` (read-only, `erick_readonly`).
4. Rode `npm run dev` **localmente**, valide no preview.
5. Abra um **PR** descrevendo a ideia. O Gabriel revisa e porta pro produto.

Comece olhando `src/components/labs/README.md` e o exemplo `LabHello.tsx`.
Pra provar que a credencial só lê: `npm run labs:verify` (SELECT ok / escrita recusada).

---

## Por que tão rígido?

A trava real é o **usuário Postgres `erick_readonly`**: ele só tem `GRANT` de
`SELECT`, então o banco **recusa** qualquer escrita vinda do Labs — não dá pra
quebrar o produto nem sem querer. (Antes o plano era "anon + RLS", mas a `anon`
**não** é read-only: as policies de produção têm `INSERT WITH CHECK (true)`, ou
seja, a anon **escreve**. Por isso trocamos a fonte de dados pro `erick_readonly`.)

O ambiente só continua seguro enquanto **ninguém** trouxer uma credencial
privilegiada pra cá (`service_role`, usuário `postgres`, PAT `sbp_...`): essas
ignoram grants/RLS e dão acesso total — por isso **jamais** entram neste repo.
Mantendo a regra "só cria em `labs/`, só lê (via `erick_readonly`), só PR",
nada que acontece aqui pode quebrar o produto.
