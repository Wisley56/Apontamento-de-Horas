"""
API Backend - Apontamento de Horas
FastAPI: feriados, exportação Excel e proxy para a API do Businessmap.

O navegador não chama o Businessmap diretamente (CORS). As chamadas passam por
aqui com a API Key do próprio usuário no header `X-Businessmap-Key`. A chave
não é gravada nem registrada em log.
"""

import io
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import openpyxl
from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from pydantic import BaseModel, Field

from services.businessmap_client import BusinessmapClient, BusinessmapError
from services.holidays_service import get_holidays_for_period, get_states_list

app = FastAPI(
    title="Apontamento de Horas",
    description="Cálculo de horas trabalhadas e lançamento no Businessmap",
    version="3.0.0",
)

# CORS: por padrão aceita qualquer origem (não há cookies nem credenciais de sessão;
# cada requisição carrega a chave do próprio usuário). Para restringir, defina
# ALLOWED_ORIGINS="https://seu-app.vercel.app,http://localhost:8000".
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Businessmap-Key"],
)


# ============ Utilitários ============

def bm_client(api_key: Optional[str]) -> BusinessmapClient:
    try:
        return BusinessmapClient(api_key or "")
    except BusinessmapError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


async def bm_call(api_key: Optional[str], fn):
    """Executa uma operação no Businessmap convertendo erros para HTTPException."""
    client = bm_client(api_key)
    try:
        async with client:
            return await fn(client)
    except BusinessmapError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# ============ Básico ============

@app.get("/api/health")
async def health_check():
    """Usado pelo frontend para manter o servidor gratuito acordado."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/api/states")
async def list_states():
    return get_states_list()


@app.get("/api/holidays/{year}/{state}")
async def list_holidays(year: int, state: str):
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Ano inválido")
    return {"holidays": get_holidays_for_period(date(year, 1, 1), date(year, 12, 31), state)}


# ============ Businessmap ============

@app.get("/api/bm/me")
async def bm_me(x_businessmap_key: Optional[str] = Header(None)):
    return await bm_call(x_businessmap_key, lambda c: c.me())


@app.get("/api/bm/boards")
async def bm_boards(x_businessmap_key: Optional[str] = Header(None)):
    return {"boards": await bm_call(x_businessmap_key, lambda c: c.boards())}


@app.get("/api/bm/cards")
async def bm_cards(
    scope: str = Query("mine", pattern="^(mine|board)$"),
    user_id: Optional[int] = Query(None),
    board_id: Optional[int] = Query(None),
    x_businessmap_key: Optional[str] = Header(None),
):
    if scope == "mine" and not user_id:
        raise HTTPException(status_code=400, detail="user_id é obrigatório para 'Meus cards'.")
    if scope == "board" and not board_id:
        raise HTTPException(status_code=400, detail="Selecione um quadro.")
    owner = user_id if scope == "mine" else None
    cards = await bm_call(x_businessmap_key, lambda c: c.cards(owner_user_id=owner, board_id=board_id))
    return {"cards": cards}


@app.get("/api/bm/cards/{card_id}/subtasks")
async def bm_subtasks(card_id: int, x_businessmap_key: Optional[str] = Header(None)):
    return {"subtasks": await bm_call(x_businessmap_key, lambda c: c.subtasks(card_id))}


@app.get("/api/bm/boards/{board_id}/categories")
async def bm_categories(board_id: int, x_businessmap_key: Optional[str] = Header(None)):
    return {"categories": await bm_call(x_businessmap_key, lambda c: c.board_categories(board_id))}


@app.get("/api/bm/logged-time")
async def bm_logged_time(
    user_id: int = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    x_businessmap_key: Optional[str] = Header(None),
):
    for value in (from_date, to_date):
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Data inválida: {value}")
    entries = await bm_call(x_businessmap_key, lambda c: c.logged_time(user_id, from_date, to_date))
    return {"entries": entries}


class LoggedTimeItem(BaseModel):
    card_id: int
    subtask_id: Optional[int] = None
    category_id: Optional[int] = None
    date: str            # YYYY-MM-DD
    minutes: int
    comment: Optional[str] = ""


class LoggedTimeBatch(BaseModel):
    user_id: Optional[int] = None
    items: List[LoggedTimeItem] = Field(default_factory=list)


@app.post("/api/bm/logged-time/batch")
async def bm_create_logged_time(batch: LoggedTimeBatch, x_businessmap_key: Optional[str] = Header(None)):
    """
    Cria todos os lançamentos numa única transação do Businessmap (createMany):
    ou todos são salvos, ou nenhum é.
    """
    items = [i.model_dump() for i in batch.items]
    created = await bm_call(x_businessmap_key, lambda c: c.create_logged_times(items, batch.user_id))
    return {"created": created, "count": len(created)}


# ============ Conferência ============

def _check_period(from_date: str, to_date: str):
    try:
        a, b = date.fromisoformat(from_date), date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Datas inválidas (use AAAA-MM-DD).")
    if b < a:
        raise HTTPException(status_code=400, detail="A data final deve ser igual ou posterior à inicial.")
    if (b - a).days > 366:
        raise HTTPException(status_code=400, detail="Escolha um período de até 1 ano.")


@app.get("/api/bm/conference")
async def bm_conference(
    user_id: int = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    x_businessmap_key: Optional[str] = Header(None),
):
    """Lançamentos do usuário no período com card, quadro, subtarefa e categoria."""
    _check_period(from_date, to_date)
    return await bm_call(x_businessmap_key, lambda c: c.conference(user_id, from_date, to_date))


class LoggedTimeUpdate(BaseModel):
    minutes: Optional[int] = None
    comment: Optional[str] = None
    date: Optional[str] = None          # YYYY-MM-DD
    category_id: Optional[int] = None   # a API não aceita remover a categoria via PATCH


@app.patch("/api/bm/logged-time/{logged_time_id}")
async def bm_update_logged_time(logged_time_id: int, body: LoggedTimeUpdate, x_businessmap_key: Optional[str] = Header(None)):
    """Edita tempo, comentário, data e/ou categoria de um lançamento."""
    return await bm_call(
        x_businessmap_key,
        lambda c: c.update_logged_time(
            logged_time_id, minutes=body.minutes, comment=body.comment, date=body.date, category_id=body.category_id
        ),
    )


@app.delete("/api/bm/logged-time/{logged_time_id}")
async def bm_delete_logged_time(logged_time_id: int, x_businessmap_key: Optional[str] = Header(None)):
    async def go(c):
        await c.delete_logged_time(logged_time_id)
        return {"deleted": True, "logged_time_id": logged_time_id}

    return await bm_call(x_businessmap_key, go)


class LoggedTimeRecreate(LoggedTimeItem):
    user_id: Optional[int] = None


@app.post("/api/bm/logged-time/{logged_time_id}/recreate")
async def bm_recreate_logged_time(logged_time_id: int, body: LoggedTimeRecreate, x_businessmap_key: Optional[str] = Header(None)):
    """
    Para o que o PATCH não cobre (ex.: remover a categoria) ou quando o Businessmap
    recusa a edição: cria um novo lançamento com os dados ajustados e exclui o antigo
    (nessa ordem).
    """
    item = body.model_dump()
    user_id = item.pop("user_id", None)
    return await bm_call(x_businessmap_key, lambda c: c.recreate_logged_time(logged_time_id, item, user_id))


# ============ Exportação Excel ============

class ExportDay(BaseModel):
    date: str = ""
    day_of_week: str = ""
    punches: str = ""
    total_hhmm: str = ""
    total_decimal: str = ""
    tipo: str = ""
    cards: str = ""
    status: str = ""
    ignored: bool = False


class ExportRequest(BaseModel):
    days: List[ExportDay]
    summary: Optional[Dict[str, Any]] = None


@app.post("/api/export")
async def export_to_excel(request: ExportRequest):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Apontamento de Horas"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F3A5F", end_color="1F3A5F", fill_type="solid")
    ignored_fill = PatternFill(start_color="EEF1F5", end_color="EEF1F5", fill_type="solid")
    done_fill = PatternFill(start_color="E3F4E8", end_color="E3F4E8", fill_type="solid")
    thin = Side(style="thin", color="C9D1DC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["Data", "Dia", "Marcações", "Total (HH:MM)", "Horas decimais", "Tipo", "Card(s)", "Status"]
    for col, title in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    for row, day in enumerate(request.days, 2):
        values = [day.date, day.day_of_week, day.punches, day.total_hhmm, day.total_decimal,
                  day.tipo, day.cards, day.status]
        fill = ignored_fill if day.ignored else (done_fill if day.status.lower().startswith("lan") else None)
        for col, value in enumerate(values, 1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=col in (3, 7))
            if fill:
                cell.fill = fill

    if request.summary:
        row = len(request.days) + 3
        ws.cell(row=row, column=3, value="Total do período").font = Font(bold=True)
        ws.cell(row=row, column=4, value=request.summary.get("total_hhmm", "")).font = Font(bold=True)
        ws.cell(row=row, column=5, value=request.summary.get("total_decimal", "")).font = Font(bold=True)

    for col, width in enumerate([12, 10, 34, 14, 14, 14, 40, 14], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width
    ws.freeze_panes = "A2"

    output = io.BytesIO()
    wb.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=apontamento_horas.xlsx"},
    )


# Servir o frontend na raiz (uso local: python app.py → http://localhost:8000)
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
