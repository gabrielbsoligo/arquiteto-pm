# PRD to Issues

Transforma um PRD em GitHub issues independentes usando vertical slices (tracer bullets).

## Quando usar

Quando o humano tem um PRD pronto e quer criar tickets/issues no GitHub para a equipe ou para a IA de código pegar.

## Processo

### 1. Localizar o PRD
Peça o número da issue do GitHub ou URL. Se não estiver no contexto, buscar com `gh issue view <number>`.

### 2. Explorar o codebase (opcional)
Entender estado atual do código.

### 3. Fatiar em vertical slices

Cada issue é um tracer bullet — fatia fina end-to-end.

As slices podem ser:
- **AFK** — pode ser implementada e mergeada sem interação humana (preferir estas)
- **HITL** — requer decisão humana (architectural decision, design review)

Regras:
- Cada slice entrega caminho COMPLETO por todas as camadas
- Slice completa é demoável sozinha
- Muitas fatias finas > poucas grossas

### 4. Validar com o humano

Para cada slice, mostrar:
- **Title**: nome descritivo curto
- **Type**: HITL / AFK
- **Blocked by**: quais outras slices precisam completar antes
- **User stories**: quais user stories do PRD são cobertas

Perguntar: granularidade ok? Dependências corretas? Unir ou separar algo? HITL/AFK correto?

### 5. Criar as issues no GitHub

Usar `gh issue create` para cada slice aprovada. Criar em ordem de dependência (blockers primeiro) para poder referenciar números reais.

Template da issue:
```markdown
## Parent PRD
#<prd-issue-number>

## What to build
Descrição concisa do vertical slice. Comportamento end-to-end, não layer-by-layer.
Referenciar seções do PRD pai em vez de duplicar conteúdo.

## Acceptance criteria
- [ ] Critério 1
- [ ] Critério 2

## Blocked by
- Blocked by #<issue-number>
(ou "None - can start immediately")

## User stories addressed
- User story 3
- User story 7
```

NÃO fechar ou modificar a issue do PRD pai.
