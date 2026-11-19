# Deploy

```
Navegador ──► Frontend estático (Vercel) ──► Backend FastAPI (Render) ──► API do Businessmap
              index.html + js/css             /api/*  (proxy, sem banco)
```

A API Key do Businessmap fica no navegador de cada usuário. O backend não tem banco de dados nem segredos, porque o histórico em SQLite foi removido na v3.

## 1. Backend (Render)

1. **New + → Web Service**, conectado ao repositório.
2. Configuração:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
3. Variáveis de ambiente (opcionais):
   - `BUSINESSMAP_BASE_URL`: padrão `https://lugardegente.businessmap.io/api/v2`.
   - `ALLOWED_ORIGINS`: por exemplo `https://seu-app.vercel.app`. O padrão `*` também funciona, porque o app não usa cookies.
4. Copie a URL gerada, por exemplo `https://apontamento-de-horas.onrender.com`.

## 2. Frontend (Vercel)

1. **Settings → Environment Variables:** `VITE_API_URL` = URL do backend.
2. **Settings → General → Root Directory:** `frontend`. O `vercel.json` gera o `js/config.js` no build.
3. Faça um redeploy.

### Desenvolvimento local

Rodando `python app.py` dentro de `backend`, o próprio backend serve o frontend em `http://localhost:8000`. O `js/config.js` (fora do git) detecta o ambiente local automaticamente.

## Observações

- **Cold start (Render gratuito):** o backend "dorme" após 15 minutos sem uso, e a primeira requisição pode levar cerca de 30 segundos. O frontend faz um ping a cada 10 minutos enquanto estiver aberto.
- **Limites do Businessmap:** 30 requisições por minuto e 600 por hora, por usuário. Um lançamento típico usa de 3 a 6 requisições.
