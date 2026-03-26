# PRD to Plan

Transforma um PRD em plano de implementação multi-fases usando vertical slices (tracer bullets). Output: arquivo Markdown em `./plans/`.

## Quando usar

Quando o humano tem um PRD pronto e precisa quebrá-lo em fases de implementação priorizadas.

## Processo

### 1. Confirmar que o PRD está no contexto
Se não estiver, peça para colar ou apontar o arquivo.

### 2. Explorar o codebase
Entender arquitetura atual, padrões existentes e pontos de integração.

### 3. Identificar decisões arquiteturais duráveis
Antes de fatiar, identificar decisões que não mudam entre fases:
- Estrutura de rotas / URL patterns
- Shape do schema do banco
- Key data models
- Approach de auth/permissões
- Boundaries de serviços externos

Estas vão no cabeçalho do plano para referência em todas as fases.

### 4. Fatiar em vertical slices

Cada fase é um **tracer bullet** — uma fatia fina que corta TODAS as camadas end-to-end.

Regras:
- Cada slice entrega um caminho COMPLETO por todas as camadas (schema, API, UI, testes)
- Um slice completo é demoável ou verificável sozinho
- Prefira muitas fatias finas a poucas fatias grossas
- NÃO inclua nomes de arquivos ou detalhes de implementação que mudam
- INCLUA decisões duráveis: paths de rotas, shapes de schema, nomes de models

### 5. Validar com o humano
Apresentar breakdown como lista numerada com título e user stories cobertas por fase. Perguntar se a granularidade está certa, se algo deve ser unido ou separado.

### 6. Escrever o arquivo do plano

Salvar em `./plans/<nome-da-feature>.md`:

```markdown
# Plan: <Feature Name>

> Source PRD: <referência>

## Architectural decisions
- **Routes**: ...
- **Schema**: ...
- **Key models**: ...

---

## Phase 1: <Title>
**User stories**: <list>

### What to build
Descrição concisa do vertical slice. Comportamento end-to-end, não layer-by-layer.

### Acceptance criteria
- [ ] Critério 1
- [ ] Critério 2

---

## Phase 2: <Title>
(repetir para cada fase)
```
