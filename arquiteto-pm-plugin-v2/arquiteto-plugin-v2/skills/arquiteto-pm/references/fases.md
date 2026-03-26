# Fases do Projeto — Referência Completa

## Fase 1: Schema e Fundação

Esta é a fase mais crítica. Erros aqui se propagam por todo o projeto.

**Antes de começar:**
- Peça para a IA de código mostrar o schema completo do Prisma
- Identifique: campos com tipo errado, relações faltando, campos não usados
- Defina todas as entidades e relacionamentos antes de qualquer código

**Regras:**
- Monte UM prompt grande com todas as mudanças de schema (é uma unidade atômica)
- Sempre peça seed atualizado junto com mudança de schema
- Após mudança de schema, teste login e navegação em TODAS as telas
- Inclua no prompt: `npx prisma db push` e `npx prisma generate`

**Prompt modelo para schema:**
```
Atualizar o schema do Prisma com as seguintes mudanças:

[Lista completa de mudanças]

Após as mudanças:
1. Rodar prisma generate
2. Rodar prisma db push
3. Atualizar o seed para incluir dados de exemplo para os novos models
4. Rodar o seed
5. Verificar que o servidor sobe sem erros

CHECKLIST:
- [ ] Schema compilando sem erros
- [ ] Seed rodando sem erros
- [ ] Servidor subindo sem erros
- [ ] Login funcionando
- [ ] Telas existentes carregando sem erros
- [ ] Commit e push
```

---

## Fase 2: CRUD

Uma entidade por prompt. Sempre backend + frontend + permissões juntos.

**Regras:**
- Peça para verificar se a rota já existe antes de criar
- Inclua: listar, criar, editar, deletar
- Após cada CRUD, humano deve testar as 4 operações

**Prompt modelo para CRUD:**
```
Implementar CRUD completo de [Entidade].

## BACKEND
- GET /api/[entidade] — listar (filtro por companyId do usuário logado)
- GET /api/[entidade]/:id — buscar um
- POST /api/[entidade] — criar (body: { campos })
- PUT /api/[entidade]/:id — editar
- DELETE /api/[entidade]/:id — deletar (soft delete se aplicável)

Permissões:
- admin: todas as operações
- manager: criar, editar, ver os da sua equipe
- collaborator: ver apenas os seus

## FRONTEND
- Tela de listagem em /[entidade] com tabela
- Botão "Novo" abre modal de criação
- Click na linha abre modal de edição
- Botão de deletar com confirmação
- Loading states em todas as operações
- Toast de sucesso/erro

## CHECKLIST
- [ ] Listar funcionando com dados do seed
- [ ] Criar novo registro
- [ ] Editar registro existente
- [ ] Deletar registro
- [ ] Permissões funcionando (testar com 3 roles)
- [ ] Build sem erros
- [ ] Commit e push
```

---

## Fase 3: Permissões

**Regras:**
- Defina a tabela de permissões uma vez no Plano de Ação
- Referencie essa tabela em todo prompt
- Sempre peça teste com admin, manager e collaborator
- Permissões quebram silenciosamente — botão aparece mas dá 403

**Tabela modelo:**
```
| Recurso        | Admin | Manager      | Collaborator |
|----------------|-------|-------------|-------------|
| Criar PDI      | ✅    | ✅ (equipe) | ❌          |
| Editar PDI     | ✅    | ✅ (equipe) | ✅ (próprio)|
| Ver PDI        | ✅    | ✅ (equipe) | ✅ (próprio)|
| Deletar PDI    | ✅    | ❌          | ❌          |
| Dashboard      | ✅    | ✅ (equipe) | ✅ (próprio)|
```

---

## Fase 4: Deploy

O humano pode não ter experiência com deploy. Guie passo a passo.

**Regras:**
- Anote TODA URL, variável e comando na Base de Conhecimento
- Teste o deploy ANTES de construir mais features
- Dê comandos exatos com paths completos

**Problemas comuns:**
- CORS: backend precisa permitir origin do frontend
- URLs hardcoded: trocar localhost por variáveis de ambiente
- Filesystem efêmero: uploads somem após redeploy
- Variáveis faltando: cada variável do .env precisa existir no hosting

**Checklist de deploy:**
```
- [ ] Variáveis de ambiente configuradas no hosting
- [ ] CORS configurado para aceitar URL do frontend
- [ ] Nenhum localhost hardcoded no código
- [ ] Database URL apontando para banco de produção
- [ ] Prisma db push rodado no banco de produção
- [ ] Seed rodado (se necessário)
- [ ] Frontend acessível pela URL de produção
- [ ] Login funcionando em produção
- [ ] Todas as telas carregando
```

---

## Fase 5: IA e Integrações

**Regras:**
- Chamadas a API externa SEMPRE no backend (nunca no frontend — expõe chaves)
- Output da IA sempre em JSON com tratamento de fallback
- Timeouts generosos: 30-60 segundos para APIs de IA
- Teste com dados reais, não inventados

**Prompt modelo para integração IA:**
```
Implementar geração de [X] com OpenAI/Anthropic.

## BACKEND
- POST /api/[recurso]/generate — recebe { contexto necessário }
- Chama a API [OpenAI/Anthropic] com prompt estruturado
- Prompt deve pedir resposta em JSON com campos: [listar campos]
- Timeout de 60 segundos
- Se a resposta não for JSON válido, retornar erro amigável
- API key vem de variável de ambiente (OPENAI_API_KEY / ANTHROPIC_API_KEY)

## FRONTEND
- Botão "Gerar com IA" na tela de [recurso]
- Loading state com mensagem "Gerando... pode levar até 1 minuto"
- Preencher os campos do formulário com a resposta
- Permitir edição manual após geração
- Toast de erro se falhar

## CHECKLIST
- [ ] API key configurada como variável de ambiente
- [ ] Endpoint retorna JSON válido
- [ ] Frontend exibe os dados gerados
- [ ] Edição manual funciona após geração
- [ ] Erro tratado graciosamente (sem crash)
- [ ] Timeout não mata o servidor
- [ ] NÃO expor API key no frontend
- [ ] Build sem erros
- [ ] Commit e push
```
