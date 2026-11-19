import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.businessmap_client import (  # noqa: E402
    BusinessmapClient,
    BusinessmapError,
    build_logged_time_entry,
)


def run(coro):
    return asyncio.run(coro)


async def no_sleep(_seconds):
    return None


def make_client(handler, **kwargs):
    return BusinessmapClient(
        "chave-teste",
        base_url="https://exemplo.businessmap.io/api/v2",
        transport=httpx.MockTransport(handler),
        sleep=no_sleep,
        **kwargs,
    )


# ---------- conversão de unidade ----------

def test_minutos_viram_segundos_exatos():
    assert build_logged_time_entry({"card_id": 1, "date": "2025-10-01", "minutes": 17}, 9)["time"] == 1020
    assert build_logged_time_entry({"card_id": 1, "date": "2025-10-01", "minutes": 497}, 9)["time"] == 29820


def test_divisao_do_dia_soma_igual_ao_total():
    parts = [165, 166, 166]  # 497 min divididos em 3
    total = sum(build_logged_time_entry({"card_id": i, "date": "2025-10-01", "minutes": m}, 9)["time"]
                for i, m in enumerate(parts, 1))
    assert total == 497 * 60


def test_campos_opcionais_e_validacoes():
    e = build_logged_time_entry(
        {"card_id": "10", "subtask_id": 5, "category_id": 3, "date": "2025-10-01", "minutes": 60, "comment": "  x  "}, 7
    )
    assert e == {"card_id": 10, "time": 3600, "date": "2025-10-01", "user_id": 7,
                 "subtask_id": 5, "category_id": 3, "comment": "x"}
    for bad in ({"minutes": 0}, {"minutes": 24 * 60 + 1}, {"date": "01/10/2025"}, {"card_id": None}):
        item = {"card_id": 1, "date": "2025-10-01", "minutes": 30, **bad}
        with pytest.raises(ValueError):
            build_logged_time_entry(item, 7)


# ---------- cliente ----------

def test_header_apikey_e_me():
    seen = {}

    def handler(request: httpx.Request):
        seen["apikey"] = request.headers.get("apikey")
        seen["path"] = request.url.path
        return httpx.Response(200, json={"data": {"user_id": 42, "username": "ws", "realname": "W S"}})

    async def go():
        async with make_client(handler) as c:
            return await c.me()

    me = run(go())
    assert me["user_id"] == 42 and me["realname"] == "W S"
    assert seen == {"apikey": "chave-teste", "path": "/api/v2/me"}


def test_create_many_envia_segundos_em_uma_requisicao():
    bodies = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        bodies.append((request.url.path, body))
        return httpx.Response(200, json={"data": [
            {"logged_time_id": i + 1, **e} for i, e in enumerate(body["logged_times"])
        ]})

    async def go():
        async with make_client(handler) as c:
            return await c.create_logged_times([
                {"card_id": 1, "date": "2025-10-01", "minutes": 300},
                {"card_id": 2, "date": "2025-10-01", "minutes": 197, "comment": "[Suporte]"},
            ], user_id=42)

    created = run(go())
    assert len(bodies) == 1
    path, body = bodies[0]
    assert path.endswith("/loggedTime/createMany")
    assert [e["time"] for e in body["logged_times"]] == [18000, 11820]
    assert [c["minutes"] for c in created] == [300, 197]


def test_item_invalido_nao_envia_nada():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": []})

    async def go():
        async with make_client(handler) as c:
            await c.create_logged_times([
                {"card_id": 1, "date": "2025-10-01", "minutes": 60},
                {"card_id": 2, "date": "2025-10-01", "minutes": 0},
            ], user_id=1)

    with pytest.raises(ValueError, match="Lançamento 2"):
        run(go())
    assert calls == []


def test_erro_401_vira_mensagem_amigavel():
    def handler(request):
        return httpx.Response(401, json={"error": {"code": "A001", "message": "Invalid"}})

    async def go():
        async with make_client(handler) as c:
            await c.me()

    with pytest.raises(BusinessmapError) as exc:
        run(go())
    assert exc.value.status == 401
    assert "API Key" in exc.value.message


def test_429_com_retry_after_curto_tenta_de_novo():
    responses = [
        httpx.Response(429, json={"error": {"code": "RL02", "details": {"retry_after": 2}}}),
        httpx.Response(200, json={"data": {"user_id": 1}}),
    ]
    waits = []

    async def record_sleep(s):
        waits.append(s)

    def handler(request):
        return responses.pop(0)

    async def go():
        client = BusinessmapClient("k", base_url="https://x/api/v2",
                                   transport=httpx.MockTransport(handler), sleep=record_sleep)
        async with client as c:
            return await c.me()

    assert run(go())["user_id"] == 1
    assert waits == [2.0]


def test_429_com_espera_longa_devolve_erro():
    def handler(request):
        return httpx.Response(429, json={"error": {"code": "RL01", "details": {"retry_after": 1800}}})

    async def go():
        async with make_client(handler) as c:
            await c.me()

    with pytest.raises(BusinessmapError) as exc:
        run(go())
    assert exc.value.status == 429


def test_paginacao_de_cards_e_filtros():
    seen = []

    def handler(request: httpx.Request):
        params = dict(request.url.params)
        seen.append(params)
        page = int(params["page"])
        return httpx.Response(200, json={"data": {
            "pagination": {"all_pages": 2, "current_page": page},
            "data": [{"card_id": page, "title": f"Card {page}", "board_id": 7}],
        }})

    async def go():
        async with make_client(handler) as c:
            return await c.cards(owner_user_id=42)

    cards = run(go())
    assert [c["card_id"] for c in cards] == [1, 2]
    assert seen[0]["owner_user_ids"] == "42"
    assert seen[0]["state"] == "active"


def test_subtarefas_sem_html():
    def handler(request):
        return httpx.Response(200, json={"data": [
            {"subtask_id": 1, "description": "<p>Reuniões Internas - Time direto &amp; Gerência</p>", "finished_at": None},
            {"subtask_id": 2, "description": "<p>Linha 1</p><p>Linha&nbsp;2</p>", "finished_at": "2025-01-01T00:00:00Z"},
            {"subtask_id": 3, "description": "", "finished_at": None},
        ]})

    async def go():
        async with make_client(handler) as c:
            return await c.subtasks(714)

    subs = run(go())
    assert subs[0]["description"] == "Reuniões Internas - Time direto & Gerência"
    assert subs[1]["description"] == "Linha 1 Linha 2" and subs[1]["finished"] is True
    assert subs[2]["description"] == "Subtarefa 3"


def test_conferencia_resolve_card_quadro_subtarefa_e_categoria():
    def handler(request: httpx.Request):
        p = request.url.path
        params = dict(request.url.params)
        if p.endswith("/loggedTime"):
            return httpx.Response(200, json={"pagination": {"all_pages": 1}, "data": [
                {"logged_time_id": 11, "card_id": 714, "subtask_id": 715, "category_id": 1,
                 "date": "2026-11-17", "time": 25260, "comment": "x", "logged_at": "2026-11-19 11:06:14"},
                {"logged_time_id": 12, "card_id": 469, "subtask_id": None, "category_id": None,
                 "date": "2026-11-16", "time": 1800, "comment": "", "logged_at": "2026-11-16 18:00:00"},
            ]})
        if p.endswith("/cards"):
            assert params["expand"] == "subtasks"
            if params.get("state"):
                return httpx.Response(200, json={"data": {"pagination": {"all_pages": 1}, "data": []}})
            return httpx.Response(200, json={"data": {"pagination": {"all_pages": 1}, "data": [
                {"card_id": 714, "title": "Itens não entregáveis", "board_id": 7,
                 "subtasks": [{"subtask_id": 715, "description": "<p>Suporte Interno</p>"}]},
                {"card_id": 469, "title": "Worker manager", "board_id": 7, "subtasks": []},
            ]}})
        if p.endswith("/boards"):
            return httpx.Response(200, json={"data": [{"board_id": 7, "name": "Auto Atendimento & Mobile"}]})
        if p.endswith("/loggedTimeCategories"):
            assert params["category_ids"] == "1"
            return httpx.Response(200, json={"data": [{"category_id": 1, "label": "Desenvolvimento"}]})
        raise AssertionError(f"chamada inesperada {p}")

    async def go():
        async with make_client(handler) as c:
            return await c.conference(42, "2026-11-01", "2026-11-30")

    entries = run(go())["entries"]
    assert [e["logged_time_id"] for e in entries] == [12, 11]  # ordenado por data
    sub = entries[1]
    assert sub["minutes"] == 421 and sub["card_title"] == "Itens não entregáveis"
    assert sub["board_name"] == "Auto Atendimento & Mobile"
    assert sub["subtask_description"] == "Suporte Interno"
    assert sub["category_label"] == "Desenvolvimento"
    assert entries[0]["subtask_description"] is None and entries[0]["category_label"] is None


def test_editar_envia_apenas_tempo_e_comentario_em_segundos():
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"data": {"logged_time_id": 11, "time": 5400, "comment": "novo"}})

    async def go():
        async with make_client(handler) as c:
            return await c.update_logged_time(11, minutes=90, comment=" novo ")

    r = run(go())
    assert seen == [("PATCH", "/api/v2/loggedTime/11", {"time": 5400, "comment": "novo"})]
    assert r["minutes"] == 90
    with pytest.raises(ValueError):
        run(make_client(handler).update_logged_time(11))


def test_editar_data_e_categoria_via_patch():
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append((request.method, body))
        return httpx.Response(200, json={"data": {"logged_time_id": 11, **body}})

    async def go():
        async with make_client(handler) as c:
            return await c.update_logged_time(11, date="2026-11-18", category_id=3)

    r = run(go())
    assert seen == [("PATCH", {"date": "2026-11-18", "category_id": 3})]
    assert r["date"] == "2026-11-18" and r["category_id"] == 3
    for bad in ({"date": "18/11/2026"}, {"category_id": 0}):
        with pytest.raises(ValueError):
            run(make_client(handler).update_logged_time(11, **bad))


def test_recriar_cria_antes_de_excluir():
    order = []

    def handler(request):
        order.append(request.method)
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["date"] == "2026-11-18" and body["time"] == 1800 and body["subtask_id"] == 715
            return httpx.Response(200, json={"data": {"logged_time_id": 99, **body}})
        return httpx.Response(200, json={})

    async def go():
        async with make_client(handler) as c:
            return await c.recreate_logged_time(11, {"card_id": 714, "subtask_id": 715, "category_id": 3,
                                                     "date": "2026-11-18", "minutes": 30, "comment": "c"}, 42)

    r = run(go())
    assert order == ["POST", "DELETE"]
    assert r["deleted"] is True and r["created"]["logged_time_id"] == 99


def test_recriar_avisa_quando_exclusao_falha():
    def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json={"data": {"logged_time_id": 99}})
        return httpx.Response(403, json={"error": {"code": "X"}})

    async def go():
        async with make_client(handler) as c:
            return await c.recreate_logged_time(11, {"card_id": 1, "date": "2026-11-18", "minutes": 30}, 42)

    r = run(go())
    assert r["deleted"] is False and "antigo não pôde ser excluído" in r["warning"]


def test_chave_vazia_e_rejeitada():
    with pytest.raises(BusinessmapError) as exc:
        BusinessmapClient("   ")
    assert exc.value.status == 401
