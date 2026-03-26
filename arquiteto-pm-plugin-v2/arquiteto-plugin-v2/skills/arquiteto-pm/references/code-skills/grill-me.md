# Grill Me

Stress-test de planos e decisões de design através de questionamento implacável.

## Quando usar

Quando o humano diz "grill me", quer testar uma decisão, validar um design, ou não tem certeza se o plano faz sentido.

## Como funciona

Entrevistar o humano implacavelmente sobre cada aspecto do plano até alcançar entendimento compartilhado. Percorrer cada ramo da árvore de decisões, resolvendo dependências entre decisões uma a uma.

**Para cada pergunta, fornecer sua resposta recomendada.** Isso ajuda o humano a decidir mais rápido.

Se uma pergunta pode ser respondida explorando o codebase, explorar o codebase em vez de perguntar.

## Exemplo de fluxo

```
Humano: "Quero adicionar notificações por email no sistema."

Grill:
1. Quem recebe notificação? (gestor, colaborador, admin, todos?)
   → Recomendo: gestor e colaborador envolvidos no PDI
2. Em quais eventos? (criação, prazo, conclusão, comentário?)
   → Recomendo: criação + prazo próximo (7 dias) + conclusão
3. Qual serviço de email? (Resend, SendGrid, SES?)
   → Recomendo: Resend — já estão usando no projeto
4. Templates HTML ou texto puro?
   → Recomendo: HTML com template simples — melhor UX
5. Fila ou síncrono?
   → Recomendo: síncrono para MVP, fila depois se volume crescer
6. O que acontece se o email falhar?
   → Recomendo: log do erro + retry 1x, não bloquear a operação
```
