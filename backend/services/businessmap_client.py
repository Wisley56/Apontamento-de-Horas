"""
Cliente da API v2 do Businessmap.

Referência: docs/businessmap-openapi.json (Businessmap API v2). Pontos confirmados no spec:

- Base: https://lugardegente.businessmap.io/api/v2 (configurável por BUSINESSMAP_BASE_URL).
- Autenticação: header `apikey`. Não enviar `apikey` e `Authorization` juntos (erro A004).
- Limites padrão: 30 requisições/minuto e 600/hora. Ao estourar, a resposta é 429 com
  `error.details.retry_after` (segundos).
- Erros vêm no formato {"error": {"code", "message", "reference", "details"}}.
- Arrays em query string vão separados por vírgula (ex.: card_ids=1,2,3).
- GET /me                                  → data.user_id, realname, username, email
- GET /boards?is_archived=0&fields=...     → data[]
- GET /cards?owner_user_ids=&board_ids=&state=active&fields=&expand=&page=&per_page=
     → data.pagination + data.data[]. Não existe filtro de co-dono nem busca por texto;
       co-donos vêm via expand=co_owner_ids e a busca é feita no frontend.
- GET /cards/{card_id}/subtasks            → data[] (subtask_id, description, owner_user_id, finished_at)
- GET /boards/{board_id}/loggedTimeCategories → data[] (category_id)
- GET /loggedTimeCategories?category_ids=  → data[] (category_id, label, is_enabled)
- GET /loggedTime?user_ids=&from_date=&to_date=&include_logged_time_for_subtasks=1
- POST /loggedTime/createMany {"logged_times": [...]}  (até 500 itens, transação única:
       se um item for inválido, nenhum é salvo)
     Campos: card_id (obrigatório), time (obrigatório, EM SEGUNDOS, inteiro, máx. 6.000.000),
     subtask_id, user_id, category_id, date (YYYY-MM-DD), comment.

A API Key nunca é gravada nem registrada em log; ela só vive durante a requisição.
"""

from __future__ import annotations

import asyncio
import html
import os
import re
from datetime import date as date_cls
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx

DEFAULT_BASE_URL = "https://lugardegente.businessmap.io/api/v2"
MAX_MINUTES_PER_ENTRY = 24 * 60
MAX_ENTRIES_PER_BATCH = 500
MAX_RETRY_WAIT_SECONDS = 15
MAX_PAGES = 10

ERROR_MESSAGES = {
    400: "Requisição inválida para o Businessmap.",
    401: "API Key inválida ou expirada. Confira a chave em Configurações.",
    403: "Sua conta não tem permissão para esta ação no Businessmap.",
    404: "Recurso não encontrado no Businessmap.",
    409: "Conflito com o estado atual no Businessmap.",
    422: "O Businessmap não aceitou um dos valores enviados.",
    429: "Limite de requisições do Businessmap atingido. Aguarde um minuto e tente de novo.",
    500: "Erro interno no Businessmap. Tente novamente em instantes.",
    503: "Businessmap temporariamente indisponível. Tente novamente em instantes.",
}


class BusinessmapError(Exception):
    def __init__(self, status: int, message: str, code: Optional[str] = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.details = details


def get_base_url() -> str:
    return os.environ.get("BUSINESSMAP_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _csv(values) -> str:
    return ",".join(str(v) for v in values)


_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_RE = re.compile(r"</?(p|div|br|li|ul|ol|h[1-6])\b[^>]*>", re.IGNORECASE)


def plain_text(value: Any) -> str:
    """Descrições de subtarefa vêm em HTML ("<p>Texto</p>"); converte para texto simples."""
    if not value:
        return ""
    text = _BLOCK_RE.sub(" ", str(value))
    text = html.unescape(_TAG_RE.sub("", text))
    return re.sub(r"\s+", " ", text).strip()


def _unwrap_list(body: Any) -> Tuple[List[dict], Optional[dict]]:
    """A API usa dois formatos de lista paginada: {data: {pagination, data: []}} e {pagination, data: []}."""
    if not isinstance(body, dict):
        return [], None
    data = body.get("data")
    if isinstance(data, dict) and "data" in data:
        return data.get("data") or [], data.get("pagination")
    if isinstance(data, list):
        return data, body.get("pagination")
    return [], None


def build_logged_time_entry(item: Dict[str, Any], user_id: Optional[int]) -> Dict[str, Any]:
    """
    Converte um item interno {card_id, subtask_id?, category_id?, date, minutes, comment?}
    no formato da API. O tempo vai em SEGUNDOS (minutos × 60), sem arredondamento decimal.
    """
    try:
        minutes = int(item.get("minutes"))
    except (TypeError, ValueError):
        raise ValueError("Quantidade de minutos inválida.")
    if minutes <= 0:
        raise ValueError("O tempo do lançamento deve ser maior que zero.")
    if minutes > MAX_MINUTES_PER_ENTRY:
        raise ValueError("Um lançamento não pode passar de 24 horas.")

    try:
        card_id = int(item.get("card_id"))
    except (TypeError, ValueError):
        raise ValueError("Card inválido.")

    raw_date = str(item.get("date") or "")
    try:
        date_cls.fromisoformat(raw_date)
    except ValueError:
        raise ValueError(f"Data inválida: {raw_date!r} (use AAAA-MM-DD).")

    entry: Dict[str, Any] = {"card_id": card_id, "time": minutes * 60, "date": raw_date}
    if user_id:
        entry["user_id"] = int(user_id)
    if item.get("subtask_id"):
        entry["subtask_id"] = int(item["subtask_id"])
    if item.get("category_id"):
        entry["category_id"] = int(item["category_id"])
    comment = (item.get("comment") or "").strip()
    if comment:
        entry["comment"] = comment[:1000]
    return entry


class BusinessmapClient:
    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        max_retries: int = 2,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        timeout: float = 20.0,
    ):
        if not api_key or not api_key.strip():
            raise BusinessmapError(401, "Configure sua API Key do Businessmap.")
        self._client = httpx.AsyncClient(
            base_url=base_url or get_base_url(),
            headers={"apikey": api_key.strip(), "Accept": "application/json"},
            transport=transport,
            timeout=timeout,
        )
        self._max_retries = max_retries
        self._sleep = sleep

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    # ---------- infraestrutura ----------

    async def _request(self, method: str, path: str, params: Optional[dict] = None, json: Any = None) -> Any:
        attempt = 0
        while True:
            try:
                response = await self._client.request(method, path, params=params, json=json)
            except httpx.TimeoutException:
                raise BusinessmapError(504, "O Businessmap demorou demais para responder. Tente novamente.")
            except httpx.HTTPError:
                raise BusinessmapError(502, "Não foi possível conectar ao Businessmap.")

            if response.status_code < 400:
                if not response.content:
                    return {}
                try:
                    return response.json()
                except ValueError:
                    raise BusinessmapError(502, "Resposta inesperada do Businessmap.")

            error = self._parse_error(response)
            retryable = response.status_code in (429, 502, 503, 504)
            if retryable and attempt < self._max_retries:
                wait = self._retry_wait(response, error, attempt)
                if wait is not None:
                    attempt += 1
                    await self._sleep(wait)
                    continue
            raise error

    @staticmethod
    def _parse_error(response: httpx.Response) -> BusinessmapError:
        status = response.status_code
        code = None
        details = None
        api_message = None
        try:
            body = response.json()
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                code = err.get("code")
                api_message = err.get("message")
                details = err.get("details")
        except ValueError:
            pass
        message = ERROR_MESSAGES.get(status, f"Erro {status} no Businessmap.")
        if api_message and status in (400, 404, 409, 422):
            message = f"{message} Detalhe: {api_message}"
        return BusinessmapError(status, message, code, details)

    @staticmethod
    def _retry_wait(response: httpx.Response, error: BusinessmapError, attempt: int) -> Optional[float]:
        if response.status_code == 429:
            retry_after = None
            if isinstance(error.details, dict):
                retry_after = error.details.get("retry_after")
            if retry_after is None:
                retry_after = response.headers.get("Retry-After")
            try:
                retry_after = float(retry_after) if retry_after is not None else 2.0 * (attempt + 1)
            except (TypeError, ValueError):
                retry_after = 2.0 * (attempt + 1)
            # Espera longa demais (limite por hora): devolve o erro em vez de travar a requisição.
            return retry_after if retry_after <= MAX_RETRY_WAIT_SECONDS else None
        return 1.0 * (attempt + 1)

    async def _paginate(self, path: str, params: dict, per_page: int = 200) -> List[dict]:
        items: List[dict] = []
        page = 1
        while page <= MAX_PAGES:
            body = await self._request("GET", path, params={**params, "page": page, "per_page": per_page})
            data, pagination = _unwrap_list(body)
            items.extend(data)
            all_pages = int((pagination or {}).get("all_pages") or 1)
            if page >= all_pages:
                break
            page += 1
        return items

    # ---------- operações ----------

    async def me(self) -> dict:
        body = await self._request("GET", "/me")
        data = body.get("data") or {}
        return {
            "user_id": data.get("user_id"),
            "username": data.get("username"),
            "realname": data.get("realname") or data.get("username"),
            "email": data.get("email"),
        }

    async def boards(self) -> List[dict]:
        body = await self._request(
            "GET", "/boards", params={"is_archived": 0, "fields": "board_id,workspace_id,name"}
        )
        data, _ = _unwrap_list(body)
        return sorted(
            ({"board_id": b.get("board_id"), "workspace_id": b.get("workspace_id"), "name": b.get("name")} for b in data),
            key=lambda b: (b["name"] or "").lower(),
        )

    async def cards(self, owner_user_id: Optional[int] = None, board_id: Optional[int] = None) -> List[dict]:
        params: Dict[str, Any] = {
            "state": "active",
            "fields": "card_id,custom_id,title,board_id,owner_user_id,column_id,lane_id,unfinished_subtask_count",
            "expand": "co_owner_ids",
        }
        if owner_user_id:
            params["owner_user_ids"] = _csv([owner_user_id])
        if board_id:
            params["board_ids"] = _csv([board_id])
        raw = await self._paginate("/cards", params)
        return [
            {
                "card_id": c.get("card_id"),
                "custom_id": c.get("custom_id"),
                "title": c.get("title"),
                "board_id": c.get("board_id"),
                "owner_user_id": c.get("owner_user_id"),
                "co_owner_ids": c.get("co_owner_ids") or [],
                "column_id": c.get("column_id"),
                "lane_id": c.get("lane_id"),
                "unfinished_subtask_count": c.get("unfinished_subtask_count") or 0,
            }
            for c in raw
        ]

    async def subtasks(self, card_id: int) -> List[dict]:
        body = await self._request("GET", f"/cards/{int(card_id)}/subtasks")
        data, _ = _unwrap_list(body)
        return [
            {
                "subtask_id": s.get("subtask_id"),
                "description": plain_text(s.get("description")) or f"Subtarefa {s.get('subtask_id')}",
                "owner_user_id": s.get("owner_user_id"),
                "finished": bool(s.get("finished_at")),
            }
            for s in data
        ]

    async def board_categories(self, board_id: int) -> List[dict]:
        body = await self._request("GET", f"/boards/{int(board_id)}/loggedTimeCategories")
        refs, _ = _unwrap_list(body)
        ids = [r.get("category_id") for r in refs if r.get("category_id")]
        if not ids:
            return []
        body = await self._request(
            "GET",
            "/loggedTimeCategories",
            params={"category_ids": _csv(ids), "is_enabled": 1, "fields": "category_id,label,color,is_enabled"},
        )
        data, _ = _unwrap_list(body)
        return [{"category_id": c.get("category_id"), "label": c.get("label"), "color": c.get("color")} for c in data]

    async def logged_time(self, user_id: int, from_date: str, to_date: str) -> List[dict]:
        raw = await self._paginate(
            "/loggedTime",
            {
                "user_ids": _csv([user_id]),
                "from_date": from_date,
                "to_date": to_date,
                "include_logged_time_for_subtasks": 1,
                "fields": "logged_time_id,card_id,subtask_id,category_id,date,time,comment,logged_at",
            },
            per_page=500,
        )
        return [
            {
                "logged_time_id": e.get("logged_time_id"),
                "card_id": e.get("card_id"),
                "subtask_id": e.get("subtask_id"),
                "category_id": e.get("category_id"),
                "date": e.get("date"),
                "minutes": round((e.get("time") or 0) / 60),
                "comment": e.get("comment") or "",
                "logged_at": e.get("logged_at"),
            }
            for e in raw
        ]

    async def card_details(self, card_ids: List[int]) -> Dict[int, dict]:
        """Título, quadro e subtarefas de vários cards (inclui arquivados/descartados)."""
        wanted = sorted({int(c) for c in card_ids if c})
        found: Dict[int, dict] = {}
        for state in (None, "archived", "discarded"):
            missing = [c for c in wanted if c not in found]
            if not missing:
                break
            for i in range(0, len(missing), 100):
                params: Dict[str, Any] = {
                    "card_ids": _csv(missing[i:i + 100]),
                    "fields": "card_id,custom_id,title,board_id",
                    "expand": "subtasks",
                }
                if state:
                    params["state"] = state
                for c in await self._paginate("/cards", params):
                    cid = c.get("card_id")
                    if cid in found or cid not in wanted:
                        continue
                    found[cid] = {
                        "card_id": cid,
                        "custom_id": c.get("custom_id"),
                        "title": c.get("title"),
                        "board_id": c.get("board_id"),
                        "subtasks": {
                            s.get("subtask_id"): plain_text(s.get("description")) or f"Subtarefa {s.get('subtask_id')}"
                            for s in (c.get("subtasks") or [])
                            if isinstance(s, dict)
                        },
                    }
        return found

    async def categories_by_ids(self, category_ids: List[int]) -> Dict[int, dict]:
        ids = sorted({int(c) for c in category_ids if c})
        if not ids:
            return {}
        body = await self._request(
            "GET", "/loggedTimeCategories", params={"category_ids": _csv(ids), "fields": "category_id,label,color"}
        )
        data, _ = _unwrap_list(body)
        return {c.get("category_id"): {"category_id": c.get("category_id"), "label": c.get("label"), "color": c.get("color")} for c in data}

    async def conference(self, user_id: int, from_date: str, to_date: str) -> dict:
        """Lançamentos do usuário no período, com card, quadro, subtarefa e categoria resolvidos."""
        entries = await self.logged_time(user_id, from_date, to_date)
        cards = await self.card_details([e["card_id"] for e in entries])

        # Subtarefas que não vieram no expand (ex.: já concluídas e omitidas): busca no card, com limite.
        lookups = 0
        for e in entries:
            card = cards.get(e["card_id"])
            if e["subtask_id"] and card is not None and e["subtask_id"] not in card["subtasks"] and lookups < 10:
                lookups += 1
                try:
                    for s in await self.subtasks(e["card_id"]):
                        card["subtasks"][s["subtask_id"]] = s["description"]
                except BusinessmapError:
                    pass

        boards = {b["board_id"]: b for b in await self.boards()}
        categories = await self.categories_by_ids([e["category_id"] for e in entries])

        result = []
        for e in entries:
            card = cards.get(e["card_id"]) or {}
            board = boards.get(card.get("board_id")) or {}
            category = categories.get(e["category_id"]) or {}
            result.append({
                **e,
                "card_title": card.get("title") or f"Card {e['card_id']}",
                "custom_id": card.get("custom_id"),
                "board_id": card.get("board_id"),
                "board_name": board.get("name") or "",
                "subtask_description": card.get("subtasks", {}).get(e["subtask_id"]) if e["subtask_id"] else None,
                "category_label": category.get("label"),
            })
        result.sort(key=lambda r: (r["date"] or "", r.get("logged_at") or ""))
        return {"entries": result}

    async def update_logged_time(
        self,
        logged_time_id: int,
        minutes: Optional[int] = None,
        comment: Optional[str] = None,
        date: Optional[str] = None,
        category_id: Optional[int] = None,
    ) -> dict:
        """
        PATCH /loggedTime/{id}: altera tempo, comentário, data e/ou categoria.
        A API não aceita `category_id` nulo — para *remover* a categoria use recreate_logged_time.
        """
        body: Dict[str, Any] = {}
        if minutes is not None:
            minutes = int(minutes)
            if minutes <= 0 or minutes > MAX_MINUTES_PER_ENTRY:
                raise ValueError("O tempo deve ser maior que zero e no máximo 24 horas.")
            body["time"] = minutes * 60
        if comment is not None:
            body["comment"] = comment.strip()[:1000]
        if date is not None:
            try:
                date_cls.fromisoformat(str(date))
            except ValueError:
                raise ValueError("Data inválida (use AAAA-MM-DD).")
            body["date"] = str(date)
        if category_id is not None:
            category_id = int(category_id)
            if category_id <= 0:
                raise ValueError("Categoria inválida.")
            body["category_id"] = category_id
        if not body:
            raise ValueError("Nada para alterar.")
        resp = await self._request("PATCH", f"/loggedTime/{int(logged_time_id)}", json=body)
        data = resp.get("data") or {}
        return {
            "logged_time_id": data.get("logged_time_id", logged_time_id),
            "minutes": round((data.get("time") or body.get("time") or 0) / 60),
            "comment": data.get("comment", body.get("comment")),
            "date": data.get("date", body.get("date")),
            "category_id": data.get("category_id", body.get("category_id")),
        }

    async def delete_logged_time(self, logged_time_id: int) -> None:
        await self._request("DELETE", f"/loggedTime/{int(logged_time_id)}")

    async def recreate_logged_time(self, logged_time_id: int, item: Dict[str, Any], user_id: Optional[int]) -> dict:
        """
        Para mudar data/categoria: cria o novo lançamento PRIMEIRO e só então exclui o antigo.
        Se a exclusão falhar, o novo já existe e o antigo continua — o chamador é avisado.
        """
        entry = build_logged_time_entry(item, user_id)
        resp = await self._request("POST", "/loggedTime", json=entry)
        created = resp.get("data") or {}
        new_entry = {
            "logged_time_id": created.get("logged_time_id"),
            "date": created.get("date", entry["date"]),
            "minutes": round((created.get("time") or entry["time"]) / 60),
            "category_id": created.get("category_id", entry.get("category_id")),
            "comment": created.get("comment", entry.get("comment", "")),
        }
        try:
            await self.delete_logged_time(logged_time_id)
        except BusinessmapError as e:
            return {"created": new_entry, "deleted": False, "warning": f"O novo lançamento foi criado, mas o antigo não pôde ser excluído: {e.message}"}
        return {"created": new_entry, "deleted": True}

    async def create_logged_times(self, items: List[Dict[str, Any]], user_id: Optional[int]) -> List[dict]:
        if not items:
            raise ValueError("Nenhum lançamento para enviar.")
        if len(items) > MAX_ENTRIES_PER_BATCH:
            raise ValueError(f"No máximo {MAX_ENTRIES_PER_BATCH} lançamentos por envio.")
        entries = []
        for idx, item in enumerate(items, 1):
            try:
                entries.append(build_logged_time_entry(item, user_id))
            except ValueError as e:
                raise ValueError(f"Lançamento {idx}: {e}")
        body = await self._request("POST", "/loggedTime/createMany", json={"logged_times": entries})
        created, _ = _unwrap_list(body)
        return [
            {
                "logged_time_id": e.get("logged_time_id"),
                "card_id": e.get("card_id"),
                "subtask_id": e.get("subtask_id"),
                "date": e.get("date"),
                "minutes": round((e.get("time") or 0) / 60),
            }
            for e in created
        ]
