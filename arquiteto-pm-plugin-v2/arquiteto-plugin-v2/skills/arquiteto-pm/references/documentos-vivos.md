# Documentos Vivos — Referência

Todo projeto gerenciado pelo Arquiteto PM deve manter dois documentos atualizados continuamente.

---

## 1. Plano de Ação

Roadmap visual com fases, itens e status. Atualizar a cada entrega concluída.

**Template:**

```markdown
# Plano de Ação — [Nome do Projeto]

## Fase 1: Fundação
- ✅ Schema do banco de dados
- ✅ Autenticação (login/logout)
- ✅ Deploy inicial
- ⚠️ Seed com dados realistas (parcial)

## Fase 2: CRUD Principal
- ✅ CRUD de [Entidade A]
- [ ] CRUD de [Entidade B]
- [ ] CRUD de [Entidade C]

## Fase 3: Permissões
- [ ] Middleware de roles
- [ ] Filtros por equipe/usuário
- [ ] Testes com 3 roles

## Fase 4: Features Avançadas
- [ ] Dashboard com métricas
- [ ] Geração com IA
- [ ] Export PDF
- [ ] Notificações por email

## Backlog (priorizar depois)
- [ ] Feature X mencionada em [data]
- [ ] Melhoria Y sugerida em [data]
```

**Regras:**
- ✅ = concluído e testado
- ⚠️ = parcial ou com problema conhecido
- [ ] = pendente
- Adicionar novos itens quando o humano mencionar
- Reordenar prioridades quando o contexto mudar
- Sempre informar o humano quando modificar o plano

---

## 2. Base de Conhecimento

Referência técnica viva do projeto. Tudo que alguém precisa saber para trabalhar nele.

**Template:**

```markdown
# Base de Conhecimento — [Nome do Projeto]

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Prisma
- Banco: PostgreSQL
- Deploy: Frontend em Vercel, Backend em Railway

## URLs
- Frontend local: http://localhost:5173
- Backend local: http://localhost:3001
- Frontend produção: https://app.meusite.com
- Backend produção: https://api.meusite.com

## Variáveis de ambiente

### Backend (.env)
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
OPENAI_API_KEY=sk-...
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:3001
```

## Estrutura de pastas
```
projeto/
├── frontend/    (React + Vite)
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/   (chamadas API)
│       └── contexts/   (auth, etc)
└── backend/     (Node + Express)
    ├── prisma/
    │   ├── schema.prisma
    │   └── seed.ts
    ├── src/
    │   ├── routes/
    │   ├── controllers/
    │   ├── middlewares/
    │   └── services/
    └── .env
```

## Permissões por role
| Recurso | Admin | Manager | Collaborator |
|---------|-------|---------|-------------|
| (preencher conforme o projeto) |

## Comandos úteis
```bash
# Subir backend
cd backend && npm run dev

# Subir frontend
cd frontend && npm run dev

# Atualizar schema no banco
cd backend && npx prisma db push

# Rodar seed
cd backend && npx prisma db seed

# Build de produção
cd frontend && npm run build
cd backend && npm run build
```

## Problemas conhecidos
- (listar problemas identificados e workarounds)

## Decisões técnicas
- (registrar decisões importantes e o motivo)
```

**Regras:**
- Atualizar URLs, variáveis e estrutura a cada mudança significativa
- Registrar todo problema conhecido com workaround
- Registrar decisões técnicas com data e motivo
- Este documento é a referência para montar contexto nos prompts
