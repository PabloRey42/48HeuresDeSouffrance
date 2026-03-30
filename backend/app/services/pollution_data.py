"""Chargement des concentrations depuis le Parquet local (flux E2 / moyennes horaires)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from app.core.config import settings


def _default_parquet_path() -> Path:
    if settings.POLLUTION_PARQUET_PATH:
        return Path(settings.POLLUTION_PARQUET_PATH)
    # Repo layout: <racine>/data/polluants_idf_temps_reel.parquet
    here = Path(__file__).resolve()
    return here.parents[3] / "data" / "polluants_idf_temps_reel.parquet"


def load_pollution_dataframe() -> pd.DataFrame:
    path = _default_parquet_path()
    if not path.exists():
        raise FileNotFoundError(
            f"Fichier pollution introuvable : {path}. "
            "Lancez data/fetch_pollution.py ou définissez POLLUTION_PARQUET_PATH."
        )
    return pd.read_parquet(path)


def latest_snapshot_for_station(df: pd.DataFrame, code_site: str) -> tuple[datetime, list[dict[str, Any]]]:
    """Dernière heure disponible pour un code site, toutes colonnes polluants."""
    col_start = "Date de début"
    col_site = "code site"
    col_poll = "Polluant"
    col_val = "valeur"
    col_unit = "unité de mesure"

    sub = df[df[col_site].astype(str).str.strip() == code_site.strip()].copy()
    if sub.empty:
        raise ValueError(f"Aucune mesure pour le site {code_site!r}")

    sub["_dt"] = pd.to_datetime(sub[col_start], errors="coerce", utc=True)
    sub = sub.dropna(subset=["_dt"])
    last = sub["_dt"].max()
    snap = sub[sub["_dt"] == last]

    rows: list[dict[str, Any]] = []
    for _, r in snap.iterrows():
        rows.append(
            {
                "pollutant": str(r[col_poll]).strip(),
                "valeur": float(r[col_val]) if pd.notna(r[col_val]) else None,
                "unite": str(r[col_unit]) if pd.notna(r[col_unit]) else None,
            }
        )
    return last.to_pydatetime(), rows


def stations_in_radius(df: pd.DataFrame, lat: float, lon: float, radius_km: float) -> list[str]:
    """Filtre grossier : nécessite lat/lon par station (jointure avec métadonnées)."""
    raise NotImplementedError("Utilisez station_codes depuis stations_metadata + haversine côté API.")
