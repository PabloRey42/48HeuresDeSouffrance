"""
Calcul de l'indice d'impact méteo-pollution (échelle 0–100).

Méthode (version documentée pour l'équipe data / devs) :
---------------------------------------------------------------------------
1) **Score pollution de base (0–1)**  
   Pour chaque polluant *p*, on normalise la concentration par rapport à un
   plafond de référence `cap_p` (ordre de grandeur des pics / seuils de
   gestion, pas des valeurs réglementaires exactes) :
      n_p = min(max(v_p, 0) / cap_p, 1)
   On agrège les polluants présents par moyenne pondérée :
   - poids plus fort sur **PM2.5** et **PM10** (particules fines),
   - poids modéré sur **NO2**, **O3**, **SO2**, **CO**.

2) **Facteur d'aggravation météorologique (≥ 1)**  
   L'idée est que la météo ne « crée » pas la pollution mais peut **aggraver
   l'exposition** ou la persistance des polluants :
   - **Stagnation (faible vent)** : vent faible = moins de dispersion → facteur
     `+ W_STAG * (1 - ff_norm)` où `ff_norm` est le vent normalisé (typ. / 10 m/s).
   - **Chaleur** : au-delà d'un seuil `T_REF_C`, on ajoute un terme lié au risque
     d'ozone / vieillissement photochimique : `+ W_HEAT * max(0, (T - T_REF) / ΔT)`.

   aggravation = 1 + terme_stagnation + terme_chaleur   (plafonné pour rester stable)

3) **Indice final 0–100**  
      score = min(P_base * aggravation, 1.0)
      impact_0_100 = 100 * score

Cette formulation est **pédagogique et paramétrable** (poids dans `Settings`) ;
elle doit être recalibrée avec des données métier (quantiles, AQI réglementaire,
etc.) en production.
---------------------------------------------------------------------------
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.core.config import settings

# Plafonds de normalisation (µg/m³ sauf CO en mg/m³)
_CAPS_UG3 = {
    "PM2.5": 40.0,
    "PM10": 70.0,
    "NO2": 200.0,
    "O3": 180.0,
    "SO2": 350.0,
    "NO": 200.0,
    "NOX as NO2": 200.0,
    "C6H6": 20.0,
}
_CAP_CO_MG3 = 10.0  # mg/m³

_WEIGHTS = {
    "PM2.5": 0.20,
    "PM10": 0.20,
    "NO2": 0.15,
    "O3": 0.15,
    "SO2": 0.10,
    "CO": 0.10,
    "NO": 0.05,
    "NOX as NO2": 0.05,
    "C6H6": 0.05,
}


def _norm_pollutant(name: str, value: float, unit: str | None) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return 0.0
    name = (name or "").strip()
    if name == "CO":
        # Souvent mg/m³ dans les flux E2 ; si µg/m³, ajuster manuellement.
        cap = _CAP_CO_MG3
        v = float(value)
        if unit and "µg" in unit.replace("μ", "µ"):
            v = v / 1000.0
        return min(max(v, 0.0) / cap, 1.0)
    cap = _CAPS_UG3.get(name)
    if cap is None:
        return 0.0
    return min(max(float(value), 0.0) / cap, 1.0)


def pollution_base_index(rows: list[dict[str, Any]]) -> tuple[float, dict[str, float]]:
    """
    rows : liste de {pollutant, valeur, unité}
    Retourne P_base dans [0,1] et le détail des normalisations.
    """
    details: dict[str, float] = {}
    num = 0.0
    den = 0.0
    for r in rows:
        name = str(r.get("pollutant", "")).strip()
        val = r.get("valeur")
        unit = r.get("unite")
        w = _WEIGHTS.get(name, 0.0)
        if w <= 0:
            continue
        n = _norm_pollutant(name, float(val), str(unit) if unit else None)
        details[f"norm_{name}"] = float(n)
        num += w * n
        den += w
    if den <= 0:
        return 0.0, details
    return float(num / den), details


def meteorological_aggravation(weather: dict[str, Any]) -> tuple[float, dict[str, float]]:
    """
    weather attend des champs optionnels : tc (°C), ff (m/s)
    """
    tc = float(weather.get("tc")) if weather.get("tc") is not None else None
    ff = float(weather.get("ff")) if weather.get("ff") is not None else None

    parts: dict[str, float] = {}

    # Vent : 0 m/s -> stagnation max ; >= 10 m/s -> pas de pénalité stagnation
    if ff is not None:
        ff_norm = min(max(ff, 0.0) / 10.0, 1.0)
        stag = 1.0 - ff_norm
        parts["ff_ms"] = ff
        parts["stagnation_term"] = settings.W_STAGNATION * stag
    else:
        parts["stagnation_term"] = 0.0

    # Chaleur : au-delà de T_REF_C
    if tc is not None:
        parts["tc_c"] = tc
        heat = max(0.0, (tc - settings.T_REF_C) / 15.0)
        heat = min(heat, 1.0)
        parts["heat_term"] = settings.W_HEAT * heat
    else:
        parts["heat_term"] = 0.0

    raw = 1.0 + parts.get("stagnation_term", 0.0) + parts.get("heat_term", 0.0)
    # Plafond pour éviter des explosions si paramètres mal réglés
    aggravation = float(min(raw, 1.8))
    parts["aggravation_factor"] = aggravation
    return aggravation, parts


def compute_impact_0_100(
    pollution_rows: list[dict[str, Any]],
    weather: dict[str, Any],
) -> dict[str, Any]:
    p_base, p_detail = pollution_base_index(pollution_rows)
    agg, w_detail = meteorological_aggravation(weather)
    combined = min(p_base * agg, 1.0)
    impact = 100.0 * combined
    return {
        "impact_index_0_100": round(impact, 2),
        "pollution_base_0_1": round(p_base, 4),
        "aggravation_factor": round(agg, 4),
        "components": {"pollution": p_detail, "meteo": w_detail},
    }
