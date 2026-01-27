# Deploy do Sistema de Apontamento de Horas

## Arquitetura Segura

```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │  ───►   │    Backend      │
│   (Vercel)      │   API   │   (Render)      │
│                 │         │                 │
│  Variável de    │         │   FastAPI       │
│  Ambiente       │         │   Python 3.11   │
└─────────────────┘         └─────────────────┘
```

---

## 1. Deploy do Backend (Render)

### Passo 1: Criar Web Service no Render

1. Acesse [render.com](https://render.com)
2. Clique em **"New +"** → **"Web Service"**
3. Conecte seu repositório GitHub
4. Configure:
   - **Name**: `apontamento-de-horas`
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`

5. Clique em **"Create Web Service"**

### Passo 2: Copiar a URL

Após o deploy, copie a URL (ex: `https://apontamento-de-horas.onrender.com`)

---

## 2. Deploy do Frontend (Vercel)

### Passo 1: Configurar Variável de Ambiente no Vercel

1. No painel do projeto Vercel, vá em **Settings** → **Environment Variables**
2. Adicione:
   - **Name**: `VITE_API_URL`
   - **Value**: `https://apontamento-de-horas.onrender.com` (sua URL do Render)
   - **Environment**: Production, Preview, Development

3. Clique em **Save**

### Passo 2: Configurar Build

1. Em **Settings** → **General**:
   - **Root Directory**: `frontend`
   - **Build Command**: deixe o padrão (será usado o vercel.json)

### Passo 3: Redeploy

Após configurar a variável, faça um redeploy para aplicar.

---

## 🔒 Segurança

### Arquivo config.js

- **NÃO é commitado** (está no .gitignore)
- É **gerado automaticamente** pelo Vercel durante o build
- Usa variável de ambiente `VITE_API_URL`

### Para desenvolvimento local

Crie manualmente o arquivo `frontend/js/config.js`:

```javascript
window.APP_CONFIG = {
  API_URL: "http://localhost:8000",
};
```

---

## ⚠️ Observações Importantes

### Cold Start do Render (Plano Gratuito)

- O backend "adormece" após 15 minutos de inatividade
- A primeira requisição pode demorar ~30 segundos
- Isso é normal e gratuito para sempre

---

## 📁 Estrutura Final

```
apontamento-horas/
├── backend/                # Deploy no Render
│   ├── app.py
│   ├── requirements.txt
│   ├── render.yaml
│   └── services/
│
├── frontend/               # Deploy no Vercel
│   ├── index.html
│   ├── vercel.json         # Gera config.js no build
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── config.js       # ⚠️ Ignorado pelo git
│       └── config.example.js
│
├── .gitignore              # Inclui config.js
└── README.md
```
