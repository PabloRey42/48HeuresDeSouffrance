"""Construction d'une table stations (code site Geod'air -> lat/lon) depuis l'API tabulaire."""

from __future__ import annotations

import re

import pandas as pd

from app.core.config import settings
from app.services.tabular_client import fetch_all_pages


def _broader_to_station_code(broader: str | None) -> str | None:
    if not broader or "STA-" not in broader:
        return None
    m = re.search(r"STA-([A-Z]{2}[0-9]{5})", broader)
    return m.group(1) if m else None


def load_station_coordinates_df() -> pd.DataFrame:
    """
    Dataset D simplifié (ressource tabulaire) : plusieurs lignes par station (points de prélèvement).
    On agrège par code station (FRxxxxx) en prenant la moyenne des coordonnées.
    """
    rows = fetch_all_pages(settings.RESOURCE_STATIONS_META_ID)
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["code_site", "latitude", "longitude"])

    df["code_site"] = df["Broader"].map(_broader_to_station_code)
    df = df.dropna(subset=["code_site", "Latitude", "Longitude"])
    agg = (
        df.groupby("code_site", as_index=False)
        .agg(latitude=("Latitude", "mean"), longitude=("Longitude", "mean"))
        .sort_values("code_site")
    )
    return agg
