# Sistema de Apontamento de Horas

Sistema web para controle e análise de apontamento de horas trabalhadas.

## 📋 Funcionalidades

- **Entrada por dia**: Lista de dias com campos de entrada/saída (manhã e tarde)
- **Cálculo automático**: O total de horas é calculado em tempo real
- **Conversão para Redmine**: Horas trabalhadas são convertidas para formato decimal
- **Detecção automática**: Feriados nacionais/estaduais e finais de semana
- **Status manual**: Marque cada dia como ✔ Confere, ✘ Divergente ou ⏳ Pendente
- **Exportação Excel**: Baixe os resultados em formato .xlsx

## 🚀 Como Executar

### 1. Instalar Dependências

```bash
cd backend
pip install -r requirements.txt
```

### 2. Iniciar o Servidor

```bash
cd backend
python app.py
```

### 3. Acessar a Aplicação

Abra o navegador em: **http://localhost:8000**

## 📖 Como Usar

1. Selecione **Período** ou **Dia Específico**
2. Informe as datas e escolha seu **estado (UF)**
3. Clique em **"Gerar Lista de Dias"**
4. Preencha os horários de entrada e saída:
   - Entrada 1: 08:00 | Saída 1: 12:00
   - Entrada 2: 13:00 | Saída 2: 17:00
5. O sistema calcula o **total automaticamente**
6. Clique em **"Analisar Horas"**
7. Marque o **status** de cada dia (Confere/Divergente)
8. **Exporte para Excel** se desejar

## 🔄 Conversão de Horas

O sistema converte automaticamente para o formato Redmine:

| Tempo Trabalhado | Valor Redmine |
| ---------------- | ------------- |
| 08:00            | 8.00          |
| 08:17            | 8.28          |
| 09:30            | 9.50          |

## 📁 Estrutura do Projeto

```
apontamento-horas/
├── backend/
│   ├── app.py                 # Servidor FastAPI
│   ├── requirements.txt       # Dependências Python
│   └── services/
│       ├── hours_service.py   # Lógica de processamento
│       └── holidays_service.py # Detecção de feriados
├── frontend/
│   ├── index.html             # Página principal
│   ├── css/
│   │   └── style.css          # Estilos (dark mode)
│   └── js/
│       └── app.js             # Lógica do frontend
└── README.md
```

## 🛠️ Tecnologias

- **Backend**: Python 3.10+, FastAPI, holidays, openpyxl
- **Frontend**: HTML5, CSS3, JavaScript Vanilla
