# Improve Codebase Architecture

Explora o codebase para encontrar oportunidades de melhoria arquitetural, focando em tornar o código mais testável aprofundando módulos rasos.

## Quando usar

Quando o humano quer melhorar a arquitetura, encontrar oportunidades de refatoração, consolidar módulos acoplados, ou tornar o codebase mais navegável (por humanos e IAs).

## Conceito chave: Deep Modules

Um **deep module** (John Ousterhout, "A Philosophy of Software Design") tem interface pequena escondendo implementação grande. São mais testáveis, mais navegáveis, e permitem testar na boundary em vez de dentro.

Oposto: **shallow module** — interface quase tão complexa quanto a implementação. Pouco valor de abstração.

## Processo

### 1. Explorar o codebase organicamente

Navegar e notar onde há fricção:
- Entender um conceito requer pular entre muitos arquivos pequenos?
- Módulos tão rasos que a interface é quase igual à implementação?
- Funções puras extraídas "para testabilidade" mas os bugs reais estão em como são chamadas?
- Módulos fortemente acoplados com risco de integração nas costuras?
- Partes não testadas ou difíceis de testar?

**A fricção que você encontra É o sinal.**

### 2. Apresentar candidatos

Para cada oportunidade de deepening:
- **Cluster**: Quais módulos/conceitos estão envolvidos
- **Por que estão acoplados**: Types compartilhados, call patterns, co-ownership
- **Categoria de dependência**: ver abaixo
- **Impacto em testes**: Quais testes existentes seriam substituídos por boundary tests

NÃO propor interfaces ainda. Perguntar qual o humano quer explorar.

### 3. Desenhar múltiplas interfaces

Para o candidato escolhido, propor 3+ interfaces **radicalmente diferentes**:

1. **Minimizar interface** — 1-3 entry points max
2. **Maximizar flexibilidade** — suportar muitos use cases
3. **Otimizar para o caller mais comum** — caso default trivial
4. **Ports & Adapters** (se aplicável) — para dependências cross-boundary

Cada proposta inclui: assinatura, exemplo de uso, complexidade escondida, estratégia de dependência, trade-offs.

Dar recomendação opinativa. Se elementos de designs diferentes combinam bem, propor híbrido.

### 4. Criar GitHub issue como RFC

Usar `gh issue create` com este template:

```markdown
## Problem
- Quais módulos são rasos e acoplados
- Que risco de integração existe nas costuras
- Por que dificulta manutenção

## Proposed Interface
- Assinatura (types, methods, params)
- Exemplo de uso pelos callers
- Complexidade escondida internamente

## Dependency Strategy
- In-process: merged diretamente
- Local-substitutable: testado com [stand-in específico]
- Ports & adapters: port, production adapter, test adapter
- Mock: boundary para serviços externos

## Testing Strategy
- Novos boundary tests a escrever
- Testes antigos para deletar (shallow module tests redundantes)
- Necessidades do ambiente de teste

## Implementation Recommendations
- O que o módulo deve possuir (responsabilidades)
- O que deve esconder (detalhes de implementação)
- O que deve expor (contrato da interface)
- Como callers devem migrar
```

## Categorias de dependência

| Categoria | Descrição | Estratégia |
|-----------|-----------|------------|
| **In-process** | Computação pura, estado em memória, sem I/O | Merge e teste direto |
| **Local-substitutable** | Tem stand-in local (PGLite, in-memory FS) | Testar com stand-in |
| **Remote but owned** | Seus serviços via rede (microservices) | Ports & adapters |
| **True external** | Terceiros (Stripe, Twilio) | Mock na boundary |

## Princípio de teste

**Replace, don't layer.** Testes unitários antigos em módulos rasos viram lixo quando boundary tests existem — deletar. Novos testes assertam em outcomes observáveis pela interface pública.
