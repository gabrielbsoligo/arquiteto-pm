# Arquiteto PM — Plugin para Claude Code

Suite completa de **arquiteto de software e gerente de projeto**. Traduz necessidades de negócio em prompts técnicos, mantém plano de ação, diagnostica bugs, e inclui skills de código para todo o ciclo de desenvolvimento.

## O que faz

**Core — Arquiteto PM:**
- Traduz necessidades de negócio em **prompts técnicos precisos** para IA de código
- Mantém **Plano de Ação** e **Base de Conhecimento** vivos
- **Diagnostica bugs** a partir de screenshots, erros e descrições
- Guia o humano nos **testes** e decisões técnicas

**Sub-skills de código incluídas:**

| Skill | O que faz |
|-------|-----------|
| **write-a-prd** | Cria PRD através de entrevista, exploração do codebase e design de módulos |
| **prd-to-plan** | Transforma PRD em plano multi-fases com vertical slices (tracer bullets) |
| **prd-to-issues** | Quebra PRD em GitHub issues independentes (AFK/HITL) |
| **grill-me** | Stress-test implacável de planos e decisões de design |
| **tdd** | Implementação com red-green-refactor e vertical slices |
| **improve-architecture** | Encontra oportunidades de deepening de módulos rasos |

## Fluxo recomendado

```
Feature nova → write-a-prd → prd-to-plan → prompts de implementação
Refactor grande → improve-architecture → prd-to-issues
Inseguro sobre decisão → grill-me
Implementação robusta → tdd
Bug reportado → diagnosticar → prompt de investigação/correção
```

## Instalação

### Via CLI (repositório local)

```bash
claude plugin add ./arquiteto-pm
```

### Via GitHub

```bash
claude plugin add github:seu-usuario/arquiteto-pm
```

### Via Marketplace

```bash
/plugin marketplace add seu-usuario/arquiteto-pm
/plugin install arquiteto-pm
```

## Comandos

| Comando | Descrição |
|---------|-----------|
| `/arquiteto-pm:novo-projeto` | Inicia projeto com template completo |
| `/arquiteto-pm:prompt` | Gera prompt técnico para a IA de código |
| `/arquiteto-pm:diagnosticar` | Diagnostica problema a partir de erros/prints |
| `/arquiteto-pm:plano` | Exibe ou atualiza o Plano de Ação |

## Estrutura

```
arquiteto-pm/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── arquiteto-pm/
│       ├── SKILL.md                          ← skill principal
│       └── references/
│           ├── diagnostico.md                ← tabela de diagnósticos
│           ├── fases.md                      ← guia por fase do projeto
│           ├── documentos-vivos.md           ← templates Plano de Ação + Base de Conhecimento
│           └── code-skills/
│               ├── write-a-prd.md            ← criar PRD do zero
│               ├── prd-to-plan.md            ← PRD → plano de fases
│               ├── prd-to-issues.md          ← PRD → GitHub issues
│               ├── grill-me.md               ← stress-test de decisões
│               ├── tdd.md                    ← red-green-refactor
│               └── improve-architecture.md   ← deepening de módulos
└── README.md
```

## Licença

MIT
