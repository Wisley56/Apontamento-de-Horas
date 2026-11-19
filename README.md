# Apontamento de Horas

Aplicação web para calcular as horas trabalhadas a partir das batidas de ponto e lançá-las no **Businessmap**.

## Funcionalidades

- **Período e feriados:** atalhos (hoje, semana, mês) e detecção de fins de semana e feriados nacionais e estaduais da UF, inclusive em períodos que atravessam o ano.
- **Colar do ponto:** cole o espelho de ponto (Ctrl+V) e as batidas são preenchidas. O leitor aceita:
  - rótulos em linhas separadas (`Entrada` / `08:00` / `Saída` / `12:00`);
  - rótulo e horário na mesma linha (`Entrada 08:00`);
  - várias batidas na mesma linha, separadas por espaço ou tabulação;
  - `Horas extras` e `Ausências`.
- **Cálculo robusto** (em minutos inteiros):
  - avisa sobre batida sem par, intervalos sobrepostos, virada da meia-noite e jornada acima de 12h;
  - quando as batidas diferem de *jornada + HE − AUS* do ponto, mostra um alerta e você escolhe qual valor vale.
- **Lançamento no Businessmap:**
  - clique nas horas de um dia, ou em "Lançar dias pendentes";
  - escolha entre **uma atividade** ou **dividir** entre várias (em horas ou %, com a soma sempre fechando no total);
  - opção de aplicar a mesma divisão aos outros dias;
  - revisão antes do envio, com aviso se o dia já tem horas lançadas no Businessmap.
- **Categoria** do tempo (Desenvolvimento, Produto, Reunião Interna…), escolhida por atividade. O app lembra a última categoria usada em cada quadro.
- **Tipo de atividade** (Melhoria, Correção, Suporte): quando a atividade não tem categoria, o tipo vai no início do comentário.
- **Conferência** (aba no topo): lista os seus lançamentos do Businessmap em um período, com dia, quadro, card, subtarefa, categoria e comentário.
  - filtros por quadro e categoria, e busca por card, ID, subtarefa ou comentário;
  - agrupamento por dia (com comparação ao total trabalhado, quando o dia está no período em apuração) ou por card;
  - **editar** tempo, comentário, data e categoria direto no Businessmap (`PATCH`);
  - **remover a categoria**: a API não aceita categoria vazia na edição, então o app cadastra um novo lançamento sem categoria e exclui o antigo (nessa ordem, para nada se perder; se a exclusão falhar, o app avisa). O mesmo recurso é oferecido, com confirmação, se o Businessmap recusar uma mudança de data ou categoria;
  - **excluir** um lançamento, com confirmação.
- **Exportação Excel** com batidas, totais, tipo, cards lançados e status.
- **Interface responsiva** (celular, tablet e desktop), com tema claro e escuro.

## API Key do Businessmap

1. No Businessmap, clique no canto superior direito → **My Account** → **API** → **Show API key**.
2. No app, abra **Configurações**, cole a chave e clique em **Salvar e testar**.

A chave fica salva **apenas no seu navegador** (localStorage) e vai para o backend em cada chamada pelo header `X-Businessmap-Key`. O backend só repassa a chave ao Businessmap: não grava nem registra em log.

## Como executar localmente

```bash
cd backend
pip install -r requirements.txt
python app.py
```

No Windows, se `python` não for encontrado, use `py app.py`. Depois abra **http://localhost:8000**: o backend também serve o frontend.

## Testes

```bash
# Núcleo de cálculo e leitor do ponto (Node 18+)
node --test frontend/tests/hours.test.mjs

# Cliente/proxy do Businessmap (respostas simuladas, sem chamar a API real)
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

## Variáveis de ambiente (backend)

| Variável | Padrão | Uso |
| --- | --- | --- |
| `BUSINESSMAP_BASE_URL` | `https://lugardegente.businessmap.io/api/v2` | Endereço da API v2 |
| `ALLOWED_ORIGINS` | `*` | Origens permitidas no CORS, separadas por vírgula |
| `PORT` | `8000` | Porta (apenas `python app.py`) |

## Estrutura

```
apontamento-horas/
├── backend/
│   ├── app.py                       # FastAPI: feriados, Excel e proxy /api/bm/*
│   ├── services/
│   │   ├── businessmap_client.py    # Cliente da API v2 do Businessmap
│   │   └── holidays_service.py      # Feriados por UF
│   └── tests/test_businessmap.py
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── hours.js     # Cálculo, divisão e leitor do ponto (puro, testável)
│   │   ├── api.js       # Backend + Businessmap (chave no navegador)
│   │   ├── launch.js    # Fluxo de lançamento
│   │   ├── conference.js # Conferência: listar, filtrar, editar e excluir lançamentos
│   │   ├── ui.js        # Helpers de interface
│   │   └── app.js       # Orquestração dos 3 passos
│   └── tests/hours.test.mjs
└── docs/businessmap-openapi.json    # Spec da API usada como referência
```

## Detalhes da integração

- O tempo é enviado em **segundos** (`minutos × 60`), que é o formato do campo `time` da API, então não há perda por arredondamento.
- A conferência usa `GET /loggedTime` e completa card, quadro, subtarefa e categoria. A edição usa `PATCH /loggedTime/{id}` (tempo, comentário, data e categoria), e a exclusão usa `DELETE /loggedTime/{id}`.
- Todos os lançamentos de um envio vão em um único `POST /loggedTime/createMany`. Se um item for recusado, nenhum é salvo.
- Limites padrão da API: 30 requisições por minuto e 600 por hora. Ao receber 429 com espera curta, o backend tenta de novo automaticamente.
