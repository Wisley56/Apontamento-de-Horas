"""
Serviço de processamento de horas.
Responsável pela conversão de formatos e cálculos.
"""

from datetime import datetime
from typing import Optional


def time_to_decimal(time_str: str) -> float:
    """
    Converte tempo no formato HH:MM para decimal (formato Redmine).
    Exemplo: "08:17" -> 8.28
    """
    if not time_str or time_str in ["----", "erro", ""]:
        return 0.0
    
    try:
        # Remove sinal negativo se existir
        is_negative = time_str.strip().startswith('-')
        time_str = time_str.replace('-', '').strip()
        
        if ':' in time_str:
            parts = time_str.split(':')
            hours = int(parts[0])
            minutes = int(parts[1])
            decimal = hours + (minutes / 60)
            return -decimal if is_negative else decimal
        else:
            return float(time_str)
    except (ValueError, IndexError):
        return 0.0


def decimal_to_time(decimal_hours: float) -> str:
    """
    Converte decimal para formato HH:MM.
    Exemplo: 8.28 -> "08:17"
    """
    is_negative = decimal_hours < 0
    decimal_hours = abs(decimal_hours)
    
    hours = int(decimal_hours)
    minutes = round((decimal_hours - hours) * 60)
    
    # Ajuste para arredondamento que resulta em 60 minutos
    if minutes >= 60:
        hours += 1
        minutes = 0
    
    prefix = "-" if is_negative else ""
    return f"{prefix}{hours:02d}:{minutes:02d}"


def parse_worked_time(time_str: str) -> int:
    """
    Converte tempo trabalhado para minutos totais.
    Aceita formato HH:MM ou -HH:MM (saldo).
    """
    if not time_str or time_str in ["----", "erro", ""]:
        return 0
    
    try:
        is_negative = time_str.strip().startswith('-')
        time_str = time_str.replace('-', '').strip()
        
        parts = time_str.split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        total_minutes = hours * 60 + minutes
        
        return -total_minutes if is_negative else total_minutes
    except (ValueError, IndexError):
        return 0


def minutes_to_str(minutes: int) -> str:
    """
    Converte minutos para string no formato HH:MM.
    """
    is_negative = minutes < 0
    minutes = abs(minutes)
    
    hours = minutes // 60
    mins = minutes % 60
    
    prefix = "-" if is_negative else ""
    return f"{prefix}{hours:02d}:{mins:02d}"


def calculate_difference(worked_time: str, expected_hours: float = 8.0) -> dict:
    """
    Calcula a diferença entre tempo trabalhado e esperado.
    
    Args:
        worked_time: Tempo trabalhado no formato HH:MM
        expected_hours: Horas esperadas (padrão 8)
    
    Returns:
        dict com redmine_value, difference_minutes, difference_str
    """
    worked_decimal = time_to_decimal(worked_time)
    expected_decimal = expected_hours
    
    # Valor para lançar no Redmine
    redmine_value = round(worked_decimal, 2)
    
    # Diferença em minutos
    diff_hours = worked_decimal - expected_decimal
    diff_minutes = round(diff_hours * 60)
    
    return {
        "redmine_value": redmine_value,
        "redmine_display": f"{redmine_value:.2f}",
        "difference_minutes": diff_minutes,
        "difference_str": minutes_to_str(diff_minutes),
        "worked_decimal": worked_decimal
    }


def determine_status(difference_minutes: int, tolerance: int = 2) -> dict:
    """
    Determina o status baseado na diferença de minutos.
    
    Args:
        difference_minutes: Diferença em minutos
        tolerance: Tolerância em minutos (padrão 2)
    
    Returns:
        dict com status e descrição
    """
    if abs(difference_minutes) <= tolerance:
        return {
            "status": "confere",
            "icon": "✔",
            "description": "Confere",
            "css_class": "status-ok"
        }
    else:
        return {
            "status": "divergente",
            "icon": "✘",
            "description": f"Divergente ({abs(difference_minutes)} min)",
            "css_class": "status-divergent"
        }


def process_day(date_str: str, worked_time: str, day_type: Optional[str] = None) -> dict:
    """
    Processa um dia completo.
    
    Args:
        date_str: Data no formato dd/mm/yyyy
        worked_time: Tempo trabalhado no formato HH:MM
        day_type: Tipo do dia (feriado, final_semana, etc.) ou None para dia útil
    
    Returns:
        dict completo com todas as informações do dia
    """
    result = {
        "date": date_str,
        "worked_time": worked_time,
        "redmine_value": "----",
        "difference": "----",
        "status": None,
        "status_icon": "",
        "status_description": "",
        "css_class": "",
        "is_ignored": False,
        "day_type": day_type,
        "manual_status": None  # Permite marcação manual
    }
    
    if day_type:
        # Dia ignorado (feriado, final de semana, etc.)
        result["is_ignored"] = True
        result["worked_time"] = "----"
        result["difference"] = day_type
        result["status"] = "ignorado"
        result["status_icon"] = "📅"
        result["status_description"] = f"Ignorado ({day_type})"
        result["css_class"] = "status-ignored"
    else:
        # Dia útil - calcular
        calc = calculate_difference(worked_time)
        status_info = determine_status(calc["difference_minutes"])
        
        result["redmine_value"] = calc["redmine_display"]
        result["difference"] = calc["difference_str"]
        result["status"] = status_info["status"]
        result["status_icon"] = status_info["icon"]
        result["status_description"] = status_info["description"]
        result["css_class"] = status_info["css_class"]
    
    return result
