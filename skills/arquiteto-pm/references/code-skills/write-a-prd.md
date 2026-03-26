# Write a PRD

Cria um PRD (Product Requirements Document) através de entrevista com o usuário, exploração do codebase e design de módulos.

## Quando usar

Quando o humano quer planejar uma feature nova do zero e precisa de um documento de requisitos antes de começar a implementar.

## Processo

### 1. Coleta inicial
Peça ao humano uma descrição longa e detalhada do problema que quer resolver e ideias de solução.

### 2. Explorar o codebase
Verifique o estado atual do código para validar as premissas do humano e entender o que já existe.

### 3. Entrevistar implacavelmente
Percorra cada ramo da árvore de decisões, resolvendo dependências entre decisões uma a uma. Não avance sem entendimento compartilhado.

### 4. Sketch de módulos
Identifique os módulos que precisam ser construídos ou modificados. Procure oportunidades de criar **deep modules** — muita funcionalidade atrás de uma interface simples e testável. Confirme com o humano.

### 5. Escrever o PRD

Use este template e submeta como GitHub issue:

```markdown
## Problem Statement
O problema do ponto de vista do usuário.

## Solution
A solução do ponto de vista do usuário.

## User Stories
Lista EXTENSA e numerada:
1. As an <ator>, I want <feature>, so that <benefício>

## Implementation Decisions
- Módulos que serão construídos/modificados
- Interfaces dos módulos
- Decisões arquiteturais
- Mudanças de schema
- Contratos de API
(NÃO incluir file paths ou code snippets — ficam desatualizados rápido)

## Testing Decisions
- Quais módulos serão testados
- O que faz um bom teste (testar comportamento externo, não implementação)
- Prior art no codebase

## Out of Scope
O que NÃO faz parte deste PRD.

## Further Notes
Notas adicionais.
```
