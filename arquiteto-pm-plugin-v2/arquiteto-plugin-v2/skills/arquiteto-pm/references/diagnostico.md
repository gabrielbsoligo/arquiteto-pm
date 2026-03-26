# Diagnóstico de Problemas — Referência Completa

Quando o humano reportar um problema, siga este fluxo:

1. Peça print de tela ou mensagem de erro exata
2. Consulte a tabela abaixo para identificar categoria
3. Se causa é clara → monte prompt de correção direto
4. Se causa é incerta → monte prompt de investigação primeiro

---

## Erro 500 / "Erro interno do servidor"

**Causas prováveis:**
- Schema do Prisma mudou mas banco não foi atualizado (`prisma db push` ou `prisma migrate`)
- Query referencia campo que não existe ou foi renomeado
- Variável de ambiente faltando no servidor
- Erro de lógica no controller (null reference, tipo errado)

**Perguntas para o humano:**
- "Rodou `prisma db push` após a última mudança no schema?"
- "Consegue abrir o terminal e rodar `npm run dev` para ver o log completo do erro?"

**Prompt de investigação:**
```
O endpoint [X] está retornando erro 500. Preciso que você:
1. Mostre o código completo do controller/route handler desse endpoint
2. Mostre o model do Prisma relacionado
3. Rode uma query manual no Prisma Studio para ver se os dados existem
Não corrija nada — só me mostre.
```

---

## "Failed to fetch" / "Cannot GET" / Network Error

**Causas prováveis:**
- URL hardcoded para `localhost:3001` em vez de `API_URL`
- CORS não configurado no backend
- Rota não registrada no Express/Fastify
- Servidor não foi reiniciado após adicionar rota

**Perguntas para o humano:**
- "O servidor da API está rodando?"
- "Esse erro aparece em produção ou local?"

**Prompt de investigação:**
```
O frontend não consegue chamar [endpoint]. Preciso ver:
1. Como o fetch é feito no frontend — mostre a URL sendo usada
2. A configuração de CORS no backend
3. Se a rota está registrada no router
Não corrija nada — só me mostre.
```

---

## JSON parse error / "Unexpected token <"

**Causa quase certa:** O frontend está recebendo HTML (página 404 ou erro) em vez de JSON.

**Significa que:** A rota não existe, o path está errado, ou o servidor está retornando a página de fallback do SPA.

**Prompt de correção:**
```
O frontend está recebendo HTML em vez de JSON ao chamar [endpoint].
Verificar:
1. A rota existe no backend? Qual é o path exato?
2. O fetch no frontend está chamando o path correto?
3. O middleware de API está antes do middleware de SPA/static?
Corrigir o que encontrar. Commit e push.
```

---

## Dados não aparecem / Tela vazia

**Causas prováveis:**
- Filtro de permissão no backend filtrando demais (where clause restritivo)
- ID do usuário logado não bate com o filtro
- Dados existem mas o frontend não está renderizando (campo errado, map vazio)
- O fetch retorna 200 mas array vazio

**Prompt de investigação:**
```
A tela [X] está vazia mas deveria mostrar dados. Preciso ver:
1. O where clause da query no backend — mostre completo
2. Qual userId/companyId está sendo usado no filtro
3. No frontend, como o array de dados é renderizado
4. Rode uma query sem filtros para confirmar que os dados existem
Não corrija nada — só me mostre.
```

---

## Funciona local, não funciona em produção

**Causas prováveis:**
- Variável de ambiente não configurada no Railway/Vercel/hosting
- O deploy não foi acionado após o último push
- URL de API diferente entre local e produção
- Banco de produção tem schema desatualizado

**Perguntas para o humano:**
- "As variáveis de ambiente estão configuradas no Railway/Vercel?"
- "O deploy foi feito depois do último commit?"
- "Consegue ver os logs de produção?"

---

## Arquivo/foto/upload sumiu após redeploy

**Causa certa em Railway/Render:** Filesystem efêmero — arquivos salvos em disco são apagados a cada deploy.

**Soluções:**
- Temporária: usar links externos (URLs públicas)
- Definitiva: storage permanente (AWS S3, Cloudflare R2, Supabase Storage)

**Prompt para solução definitiva:**
```
Implementar upload de arquivos com storage permanente usando [S3/R2/Supabase Storage].
1. BACKEND: Criar rota POST /api/upload que recebe multipart/form-data,
   faz upload para o bucket e retorna a URL pública
2. Atualizar os campos de foto/arquivo no schema para guardar a URL externa
3. FRONTEND: Trocar o input de arquivo para usar a nova rota
4. Remover qualquer referência a fs.writeFile ou salvamento local

CHECKLIST:
- [ ] Upload funciona e retorna URL pública
- [ ] URL é salva no banco
- [ ] Imagem/arquivo é exibido corretamente na interface
- [ ] Arquivo persiste após redeploy
- [ ] Build sem erros
- [ ] Commit e push
```

---

## Permissão negada / 403 Forbidden

**Causas prováveis:**
- Middleware de auth rejeitando o role do usuário
- Token JWT expirado ou inválido
- O endpoint exige role X mas o usuário é role Y
- O frontend mostra o botão mas o backend bloqueia

**Prompt de investigação:**
```
O usuário com role [X] está recebendo 403 ao acessar [endpoint]. Preciso ver:
1. O middleware de permissão desse endpoint — quais roles são permitidos?
2. O token do usuário — qual role está no JWT?
3. A lógica de verificação de permissão
Não corrija nada — só me mostre.
```
