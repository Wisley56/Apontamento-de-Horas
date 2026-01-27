"""
Serviço de feriados.
Responsável pela detecção de feriados fixos, variáveis e finais de semana.
"""

from datetime import date, datetime, timedelta
from typing import List, Dict, Set
import holidays


# Estados brasileiros
BRAZILIAN_STATES = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
]


def get_holidays_for_period(start_date: date, end_date: date, state: str = "SP") -> Dict[str, str]:
    """
    Retorna feriados (nacionais e estaduais) para um período.
    
    Args:
        start_date: Data inicial
        end_date: Data final
        state: Sigla do estado (ex: SP, RJ, MG)
    
    Returns:
        Dict com data (dd/mm/yyyy) como chave e nome do feriado como valor
    """
    if state.upper() not in BRAZILIAN_STATES:
        state = "SP"
    
    # Anos envolvidos no período
    years = set()
    current = start_date
    while current <= end_date:
        years.add(current.year)
        current = date(current.year + 1, 1, 1) if current.month == 12 else current.replace(day=28) + timedelta(days=4)
    
    result = {}
    
    for year in years:
        brazil_holidays = holidays.country_holidays('BR', subdiv=state.upper(), years=[year])
        for holiday_date, holiday_name in brazil_holidays.items():
            if start_date <= holiday_date <= end_date:
                result[holiday_date.strftime("%d/%m/%Y")] = holiday_name
    
    return result


def is_weekend(date_obj: date) -> bool:
    """
    Verifica se uma data é final de semana.
    """
    return date_obj.weekday() >= 5  # 5 = Sábado, 6 = Domingo


def get_day_of_week_name(date_obj: date) -> str:
    """
    Retorna o nome do dia da semana em português.
    """
    days = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    return days[date_obj.weekday()]


def classify_date(date_str: str, holidays_dict: Dict[str, str], 
                  manual_exceptions: Dict[str, str] = None) -> Dict:
    """
    Classifica uma data.
    
    Args:
        date_str: Data no formato dd/mm/yyyy
        holidays_dict: Dicionário de feriados
        manual_exceptions: Exceções manuais (férias, atestado, etc.)
    
    Returns:
        Dict com classificação do dia
    """
    if manual_exceptions is None:
        manual_exceptions = {}
    
    try:
        date_obj = datetime.strptime(date_str, "%d/%m/%Y").date()
    except ValueError:
        return {"type": None, "description": None, "is_workday": True}
    
    # Verifica exceções manuais primeiro
    if date_str in manual_exceptions:
        return {
            "type": "manual",
            "description": manual_exceptions[date_str],
            "is_workday": False
        }
    
    # Verifica feriado
    if date_str in holidays_dict:
        return {
            "type": "feriado",
            "description": f"Feriado ({holidays_dict[date_str]})",
            "is_workday": False
        }
    
    # Verifica final de semana
    if is_weekend(date_obj):
        day_name = get_day_of_week_name(date_obj)
        return {
            "type": "final_semana",
            "description": f"Final de Semana ({day_name})",
            "is_workday": False
        }
    
    # Dia útil
    return {
        "type": None,
        "description": None,
        "is_workday": True
    }


def generate_date_range(start_date: date, end_date: date) -> List[str]:
    """
    Gera lista de datas entre start_date e end_date.
    """
    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current.strftime("%d/%m/%Y"))
        current += timedelta(days=1)
    return dates


def get_states_list() -> List[Dict[str, str]]:
    """
    Retorna lista de estados brasileiros com nome e sigla.
    """
    states_names = {
        "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas",
        "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal", "ES": "Espírito Santo",
        "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul",
        "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná",
        "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
        "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina",
        "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins"
    }
    
    return [{"code": code, "name": name} for code, name in states_names.items()]
