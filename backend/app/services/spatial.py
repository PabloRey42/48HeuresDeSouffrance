"""Jointure géospatiale par distance (Haversine) — stations pollution vs stations SYNOP."""

from __future__ import annotations

import math
from typing import Any

import pandas as pd


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlamb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlamb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def nearest_synop_station(
    pollution_lat: float,
    pollution_lon: float,
    synop_stations: pd.DataFrame,
) -> dict[str, Any]:
    """
    synop_stations doit contenir colonnes : numer_sta, latitude, longitude
    """
    if synop_stations.empty:
        return {}
    dists = synop_stations.apply(
        lambda r: haversine_km(pollution_lat, pollution_lon, float(r["latitude"]), float(r["longitude"])),
        axis=1,
    )
    j = int(dists.to_numpy().argmin())
    row = synop_stations.iloc[j]
    return {
        "numer_sta": str(row["numer_sta"]),
        "latitude": float(row["latitude"]),
        "longitude": float(row["longitude"]),
        "distance_km": float(dists.iloc[j]),
    }
