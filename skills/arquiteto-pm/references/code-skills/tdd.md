# TDD — Test-Driven Development

Implementação com loop red-green-refactor usando vertical slices.

## Quando usar

Quando o humano quer implementar uma feature ou corrigir um bug usando TDD, menciona "red-green-refactor", quer testes de integração, ou pede development test-first.

## Filosofia

**Princípio core:** Testes verificam comportamento através de interfaces públicas, não detalhes de implementação. O código pode mudar totalmente; os testes não devem quebrar.

**Bons testes** são integration-style: exercitam caminhos reais pela API pública. Descrevem O QUE o sistema faz, não COMO. Sobrevivem refactors.

**Maus testes** são acoplados à implementação: mockam colaboradores internos, testam métodos privados, quebram em refactor sem mudança de comportamento.

```typescript
// BOM: Testa comportamento observável
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});

// RUIM: Testa detalhes de implementação
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

## Anti-padrão: Fatias horizontais

**NÃO** escreva todos os testes primeiro, depois toda a implementação. Isso é "horizontal slicing" e produz testes ruins — testam comportamento imaginado, não real.

```
ERRADO (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

CERTO (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
```

## Workflow

### 1. Planning
- Confirmar com humano quais mudanças de interface são necessárias
- Confirmar quais comportamentos testar (priorizar)
- Identificar oportunidades de deep modules
- Listar comportamentos a testar (não steps de implementação)
- Aprovar plano com humano

### 2. Tracer Bullet
UM teste que confirma UMA coisa sobre o sistema:
```
RED:   Escrever teste para primeiro comportamento → teste falha
GREEN: Escrever código mínimo para passar → teste passa
```

### 3. Loop Incremental
Para cada comportamento restante:
```
RED:   Próximo teste → falha
GREEN: Código mínimo → passa
```
Regras: um teste por vez, só código suficiente para passar, não antecipar futuros testes.

### 4. Refactor
Após todos os testes passarem:
- Extrair duplicação
- Aprofundar módulos (complexidade atrás de interfaces simples)
- Aplicar SOLID onde natural
- Rodar testes após cada refactor

**Nunca refatorar enquanto RED.** Chegar em GREEN primeiro.

## Checklist por ciclo
```
[ ] Teste descreve comportamento, não implementação
[ ] Teste usa interface pública apenas
[ ] Teste sobreviveria refactor interno
[ ] Código é mínimo para este teste
[ ] Nenhuma feature especulativa adicionada
```

## Mocking
- Mockar apenas **boundaries externas** (APIs de terceiros, serviços que você não controla)
- Nunca mockar colaboradores internos
- Se precisa mockar para testar, o design provavelmente precisa melhorar
- Prefira local-substitutable (PGLite para Postgres, in-memory FS) a mocks
