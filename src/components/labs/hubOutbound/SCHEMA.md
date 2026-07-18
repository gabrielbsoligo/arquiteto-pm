# Plataforma de Gestão de Outbound — Arquitetura

Documento de arquitetura do **Hub de Gestão de Outbound** (aba **Prospecção** do
clone SalesHub Labs). Rastreia a performance de 3 BDRs, a qualidade das listas e
a conversão de leads frios em reuniões e negócios fechados.

> **Protótipo (Labs):** hoje roda 100% no navegador (localStorage) porque o clone
> é read-only. Este documento descreve o **esquema de produção** (Supabase/Postgres)
> pra portar quando o Gabriel aprovar. As interfaces TS (`ProspLead`, `Touchpoint`)
> em `prospLib.ts` já espelham esse schema.

---

## 1. Esquema de Banco de Dados (SQL — Postgres/Supabase)

```sql
-- ============ USUÁRIO (BDR) ============
create table bdr (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,                    -- "BDR 1", "BDR 2", "BDR 3"
  email        text unique,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ============ EMPRESA (LEAD) ============
create type maturidade_nivel as enum ('Baixa', 'Média', 'Alta');
create type nicho_tipo       as enum ('SaaS / Tecnologia','Saúde e Beleza','Construtoras / Incorporadoras',
                                      'Varejo / E-commerce','Serviços B2B','Educação','Indústria','Outro');
create type pipeline_status  as enum ('inteligencia','enriquecimento','prospeccao_ativa','conectado',
                                      'qualificado','reuniao_agendada','reuniao_realizada','fechado','perdido');

create table empresa (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  cidade        text,                             -- foco: São José dos Campos e Vale do Paraíba
  estado        text,
  nicho         nicho_tipo,
  origem_lista  text,                             -- "Lemit", "Apollo", "Indicação", "Evento"...
  -- presença digital
  site          text, instagram text, facebook text, linkedin text, youtube text,
  maturidade_nivel  maturidade_nivel not null default 'Baixa',
  maturidade_score  int check (maturidade_score between 1 and 5),  -- sinal automático (proxy)
  -- pipeline
  status        pipeline_status not null default 'inteligencia',
  motivo_perda  text,                             -- OBRIGATÓRIO quando status = 'perdido'
  bdr_id        uuid references bdr(id),          -- dono/responsável
  -- agendamento (preenchido em reuniao_agendada+)
  data_reuniao  timestamptz,
  closer_id     uuid,                             -- FK team_member (SalesHub)
  canal         text,
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- REGRA: não agenda sem decisor + data (reforçada em trigger, ver §3)
  constraint chk_perda check (status <> 'perdido' or motivo_perda is not null)
);
create index on empresa (bdr_id);
create index on empresa (status);
create index on empresa (origem_lista);
create index on empresa (nicho, maturidade_nivel);

-- ============ CONTATO (DECISOR) ============
create table contato (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  nome        text not null,
  cargo       text,                               -- "CEO", "Diretor Comercial", "Sócia"...
  telefone    text,
  email       text,
  linkedin    text,
  is_decisor  boolean not null default true,      -- decisor principal do negócio
  created_at  timestamptz not null default now()
);
create index on contato (empresa_id);

-- ============ ATIVIDADE (TOUCHPOINT) ============
create type atividade_tipo      as enum ('cold_call','cold_mail','social_selling','whatsapp');
create type atividade_resultado as enum ('conectou','nao_atendeu','bounce','callback','gatekeeper','sem_interesse','outro');

create table atividade (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  bdr_id      uuid references bdr(id),
  tipo        atividade_tipo not null,
  resultado   atividade_resultado not null,
  nota        text,
  data_hora   timestamptz not null default now()
);
create index on atividade (empresa_id);
create index on atividade (bdr_id, data_hora);    -- p/ produtividade diária

-- ============ HISTÓRICO DE ETAPAS (p/ medir VELOCIDADE de conversão) ============
create table etapa_historico (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  de          pipeline_status,
  para        pipeline_status not null,
  bdr_id      uuid references bdr(id),
  at          timestamptz not null default now()
);
create index on etapa_historico (empresa_id, at);
```

**Relacionamentos:** `bdr 1—N empresa` · `empresa 1—N contato` · `empresa 1—N atividade` ·
`empresa 1—N etapa_historico`. `closer_id` referencia o time do SalesHub (integração).

---

## 2. Wireframe (telas do BDR no dia a dia)

### 2.1 Topo (persistente)
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ V4  Gestão de Outbound          [Kanban] [Tabela] [Gestão]   [Subir lista] [⇩] │
│     Pipeline · Decisores · Atividades — São José dos Campos & Vale do Paraíba   │
├───────────────────────────────────────────────────────────────────────────────┤
│ 👥 [Todos] [BDR 1] [BDR 2] [BDR 3]                          🔎 buscar…          │
│ ┌ Leads no funil ┐ ┌ Taxa agendamento ┐ ┌ Ganhos ┐ ┌ Perdidos ┐               │
│ │      42        │ │      21,4%        │ │   2    │ │    1     │               │
│ └────────────────┘ └───────────────────┘ └────────┘ └──────────┘               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 KANBAN (visão principal do BDR) — arrasta o card entre as 9 colunas
```
 INTELIGÊNCIA   ENRIQUEC.   PROSP.ATIVA   CONECTADO   QUALIF.   REUNIÃO AG.  ...
 (lista bruta)  (buscando)  (cadência)    (falou)     (dor/fit) (convite)
 ┌──────────┐   ┌────────┐  ┌─────────┐   ┌────────┐  ┌──────┐  ┌─────────┐
 │🏢 Empresa│   │ ...    │  │ ...     │   │ ...    │  │ ...  │  │📅 20/07 │
 │📍 Cidade │   │        │  │         │   │        │  │      │  │         │
 │👤 Decisor│   │        │  │         │   │        │  │      │  │         │
 │ BDR ★★★☆☆│   │        │  │         │   │        │  │      │  │         │
 └──────────┘   └────────┘  └─────────┘   └────────┘  └──────┘  └─────────┘
   ↑ arrastar p/ "Reunião Agendada" → abre modal exigindo Decisor + Data (regra)
   ↑ arrastar p/ "Perdido" → abre modal exigindo Motivo (regra)
```

### 2.3 PAINEL DO LEAD (abre ao clicar num card) — onde o BDR trabalha
```
┌ 🏢 Empresa · Cidade/UF · Nicho · dono BDR · origem ─────────────────── [X] ┐
│ ETAPA: [Inteligência][Enriquec.][Prosp.][Conectado][Qualif.][Reunião]...    │
│                                                                              │
│ 👤 DECISOR (CONTATO)   Nome | Cargo | Telefone | E-mail | LinkedIn (edit)   │
│ 📞 CLICK-TO-CALL       [tel:] [4COM] [WhatsApp]                              │
│ ⚡ ATIVIDADES          [Cold Call ▾] [Não atendeu ▾] [nota] [+ Registrar]   │
│                        histórico: Cold Call · Conectou · 14/07 16:20 …       │
│ 🔎 INVESTIGAÇÃO        [Site][Instagram][LinkedIn][YouTube][GMB][Google]     │
│ ⭐ MATURIDADE          ★★★☆☆   [Baixa][Média][Alta]                          │
│    [✨ Gerar Abordagem Inteligente] → copy pronta pra consultoria gratuita   │
│ ✅ CHECKLIST           SITE · LINKEDIN · INSTA · YOUTUBE (o que investigar)  │
│ 📝 NOTAS                                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.4 TABELA — visão de lista (busca, filtro por etapa, seleção/remoção em massa)
```
[☑] Empresa | Nicho | Cidade/UF | Decisor | Dono | Presença | Etapa | Abrir →
```

### 2.5 GESTÃO (painel do admin) — 3 dashboards (ver §3)
```
① Qualidade da Lista (barra origem × taxa de agend. + tabela dados ruins)
② Maturidade Digital × Conversão por nicho (matriz colorida Baixa/Média/Alta)
③ Produtividade dos BDRs (barras Ligações vs Conexões + tabela taxa de conexão)
```

---

## 3. Regras de negócio, automações e lógica de conversão

### 3.1 Bloqueio de etapa (produção: trigger + front)
```sql
-- Não permite entrar em 'reuniao_agendada' sem decisor E data.
create or replace function trg_valida_agendamento() returns trigger as $$
begin
  if NEW.status = 'reuniao_agendada' then
    if NEW.data_reuniao is null
       or not exists (select 1 from contato c where c.empresa_id = NEW.id and c.is_decisor) then
      raise exception 'Reunião Agendada exige Decisor e Data da Reunião preenchidos';
    end if;
  end if;
  return NEW;
end $$ language plpgsql;
create trigger valida_agendamento before update of status on empresa
  for each row execute function trg_valida_agendamento();
```
No front (`prospLib.ts`) a mesma regra vive em `canMoveTo(lead, to)`: ao arrastar o
card, se faltar decisor/data abre o **modal Agendar**; se for pra "Perdido" abre o
**modal Perda** com o **motivo obrigatório** (`Fora de Perfil`, `Lista Ruim`,
`Sem Orçamento`, `Usando Concorrente`…).

### 3.2 Lógica de conversão do funil (`funnelMetrics`)
Funil **cumulativo**: `reached(etapa)` = nº de leads cujo status atual está *naquela
etapa ou adiante* (progresso monotônico). Perdidos ficam à parte.

```
reached(e)      = COUNT(leads WHERE status<>'perdido' AND ordem(status) >= ordem(e))
conv_etapa(e)   = reached(e) / reached(e-1) × 100      -- conversão etapa→etapa
conv_topo(e)    = reached(e) / reached(inteligencia) × 100
taxa_agendamento= reached(reuniao_agendada) / total_leads × 100
taxa_ganho      = COUNT(status='fechado') / total_leads × 100
```
> Ex.: 100 em Prospecção → 40 Conectado → 20 Qualificado → 12 Reunião Agendada.
> Conexão 40%, Qualificação 50%, Agendamento 60%; taxa de agendamento (topo) 12%.

**Velocidade** (dias até agendar) usa `etapa_historico`:
`AVG(agendou.at − criou.at)` por nicho × maturidade.

### 3.3 Dashboards (agregações)
```sql
-- ① Qualidade da lista: origem × taxa de agendamento × perdas por dados ruins
select origem_lista,
       count(*) as leads,
       count(*) filter (where ordem(status) >= ordem('reuniao_agendada')) as agendadas,
       round(100.0*count(*) filter (where ordem(status)>=ordem('reuniao_agendada'))/count(*),1) as taxa_agend,
       count(*) filter (where status='perdido' and motivo_perda ilike '%lista ruim%') as dados_ruins
from empresa group by origem_lista order by leads desc;

-- ② Maturidade × conversão por nicho (matriz)
select nicho, maturidade_nivel,
       count(*) as leads,
       round(100.0*count(*) filter (where ordem(status)>=ordem('reuniao_agendada'))/count(*),0) as taxa
from empresa group by nicho, maturidade_nivel;

-- ③ Produtividade do BDR: ligações (cold_call) vs conexões (resultado='conectou')
select b.nome as bdr,
       count(a.*)                                  as atividades,
       count(*) filter (where a.tipo='cold_call')  as ligacoes,
       count(*) filter (where a.resultado='conectou') as conexoes,
       round(100.0*count(*) filter (where a.resultado='conectou')
             / nullif(count(*) filter (where a.tipo='cold_call'),0),1) as taxa_conexao
from bdr b left join atividade a on a.bdr_id=b.id
group by b.nome order by atividades desc;
```
No protótipo essas três consultas estão implementadas em JS puro em `prospLib.ts`:
`listQuality()`, `maturityConversion()`, `bdrProductivity()`.

---

## 4. Do protótipo → produção
1. Trocar `localStorage` (`loadLeads/saveLeads`) por queries Supabase nas tabelas acima.
2. Ativar os triggers de regra (§3.1) — hoje só no front.
3. Gravar `etapa_historico` a cada mudança de status (habilita métrica de velocidade).
4. Trocar `generateApproach()` (regras por nicho) por chamada OpenAI/Claude.
5. Integrar `data_reuniao`/`closer_id` com a agenda (Google Calendar) e a tela Reuniões do SalesHub.
6. Discagem nativa API4COM via HTTP API + token (hoje é link `tel:`/protocolo).
