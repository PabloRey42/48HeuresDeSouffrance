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


def stations_with_available_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Retourne une table légère des stations qui ont des mesures exploitables dans le Parquet.

    Colonnes retournées :
    - code_site (str)
    - name (str|None) : nom station si présent dans les données pollution
    - last_datetime (datetime, tz-aware UTC)
    - pollutants_count (int) : nombre de polluants distincts observés sur la dernière heure
    """
    col_start = "Date de début"
    col_site = "code site"
    col_name = "nom site"
    col_poll = "Polluant"
    col_val = "valeur"

    if col_site not in df.columns or col_start not in df.columns:
        raise ValueError(f"Colonnes attendues manquantes dans le Parquet: {col_site}, {col_start}")

    sub = df[[c for c in [col_site, col_start, col_name, col_poll, col_val] if c in df.columns]].copy()
    sub[col_site] = sub[col_site].astype(str).str.strip()
    sub["_dt"] = pd.to_datetime(sub[col_start], errors="coerce", utc=True)

    # garde uniquement les lignes avec timestamp valide et une valeur numérique
    if col_val in sub.columns:
        sub[col_val] = pd.to_numeric(sub[col_val], errors="coerce")
        sub = sub.dropna(subset=["_dt", col_val, col_site])
    else:
        sub = sub.dropna(subset=["_dt", col_site])

    if sub.empty:
        return pd.DataFrame(columns=["code_site", "name", "last_datetime", "pollutants_count"])

    # dernier timestamp par station
    last_per_station = sub.groupby(col_site, as_index=False)["_dt"].max().rename(columns={"_dt": "last_datetime"})

    # nom station (best-effort)
    if col_name in sub.columns:
        names = (
            sub.dropna(subset=[col_name])
            .groupby(col_site, as_index=False)[col_name]
            .first()
            .rename(columns={col_name: "name"})
        )
        out = last_per_station.merge(names, on=col_site, how="left")
    else:
        out = last_per_station.copy()
        out["name"] = None

    # nb polluants distincts à la dernière heure
    if col_poll in sub.columns:
        last_join = sub.merge(out[[col_site, "last_datetime"]], on=col_site, how="inner")
        last_join = last_join[last_join["_dt"] == last_join["last_datetime"]]
        poll_counts = (
            last_join.groupby(col_site, as_index=False)[col_poll]
            .nunique()
            .rename(columns={col_poll: "pollutants_count"})
        )
        out = out.merge(poll_counts, on=col_site, how="left")
        out["pollutants_count"] = out["pollutants_count"].fillna(0).astype(int)
    else:
        out["pollutants_count"] = 0

    out = out.rename(columns={col_site: "code_site"})
    return out[["code_site", "name", "last_datetime", "pollutants_count"]].sort_values("code_site")

def stations_in_radius(df: pd.DataFrame, lat: float, lon: float, radius_km: float) -> list[str]:
    """Filtre grossier : nécessite lat/lon par station (jointure avec métadonnées)."""
    raise NotImplementedError("Utilisez station_codes depuis stations_metadata + haversine côté API.")
