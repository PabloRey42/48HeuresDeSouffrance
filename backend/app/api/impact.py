"""Endpoint REST GET /impact — indice 0–100 + sources pollution et météo."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.services.impact_index import compute_impact_0_100
from app.services.pollution_data import latest_snapshot_for_station, load_pollution_dataframe
from app.services.spatial import haversine_km, nearest_synop_station
from app.services.stations_metadata import load_station_coordinates_df
from app.services.weather_synop import fetch_synop_nearest_time, fetch_synop_stations_near

router = APIRouter(tags=["impact"])

_stations_coords_cache: pd.DataFrame | None = None
def _get_stations_coords() -> pd.DataFrame:
    global _stations_coords_cache
    if _stations_coords_cache is None:
        _stations_coords_cache = load_station_coordinates_df()
    return _stations_coords_cache


def _build_response_for_station(code_site: str) -> dict[str, Any]:
    df = load_pollution_dataframe()
    dt, pollution_rows = latest_snapshot_for_station(df, code_site)

    coords = _get_stations_coords()
    row = coords[coords["code_site"] == code_site.strip()]
    if row.empty:
        raise HTTPException(
            status_code=404,
            detail=f"Pas de coordonnées GPS pour le site {code_site} (métadonnées tabulaires).",
        )
    lat = float(row.iloc[0]["latitude"])
    lon = float(row.iloc[0]["longitude"])

    syn = fetch_synop_stations_near(lat, lon, radius_m=150_000)
    if syn.empty:
        raise HTTPException(status_code=503, detail="Aucune station SYNOP trouvée à proximité.")

    nearest = nearest_synop_station(lat, lon, syn)
    if not nearest:
        raise HTTPException(status_code=503, detail="Impossible de trouver une station SYNOP proche.")

    weather = fetch_synop_nearest_time(nearest["numer_sta"], dt)
    if not weather:
        raise HTTPException(status_code=503, detail="Pas de donnée météo SYNOP pour la fenêtre demandée.")

    # Champs exploitables pour le calcul + réponse
    weather_out = {
        k: weather.get(k)
        for k in ("date", "numer_sta", "nom", "latitude", "longitude", "tc", "u", "ff", "dd", "pres", "rr3", "rr24")
        if k in weather
    }

    impact = compute_impact_0_100(
        pollution_rows=[
            {"pollutant": r["pollutant"], "valeur": r["valeur"], "unite": r.get("unite")}
            for r in pollution_rows
        ],
        weather=weather,
    )

    return {
        "station_code": code_site,
        "datetime": dt.isoformat(),
        "impact_index_0_100": impact["impact_index_0_100"],
        "pollution_base_0_1": impact["pollution_base_0_1"],
        "aggravation_factor": impact["aggravation_factor"],
        "weighting_explanation": (
            "Indice = 100 × min(1, score_pollution × aggravation_météo). "
            "La pollution est normalisée par des plafonds de référence par polluant ; "
            "l'aggravation augmente avec la stagnation (vent faible) et la chaleur (T > seuil)."
        ),
        "components": impact["components"],
        "sources": {
            "pollution": {
                "records": pollution_rows,
                "source": "Parquet local E2 / moyennes horaires (data.gouv)",
            },
            "weather": {
                "record": weather_out,
                "source": "Opendatasoft — dataset SYNOP essentiel (dérivé archive OMM)",
            },
        },
        "spatial": {
            "pollution_station": {"latitude": lat, "longitude": lon},
            "nearest_synop": nearest,
        },
    }


@router.get("/impact")
def get_impact(
    station_code: str | None = Query(None, description="Code site Geod'air (ex. FR01011)"),
    lat: float | None = Query(None, description="Latitude WGS84 (mode zone)"),
    lon: float | None = Query(None, description="Longitude WGS84 (mode zone)"),
    radius_km: float = Query(50.0, ge=1.0, le=300.0, description="Rayon km pour lat/lon"),
) -> Any:
    """
    Retourne l'indice 0–100 et les données sources (pollution + météo).

    - **Mode station** : fournir `station_code`.
    - **Mode zone** : fournir `lat` et `lon` (toutes les stations pollution dont le
      point est dans le disque `radius_km`).
    """
    if station_code:
        return _build_response_for_station(station_code)

    if lat is None or lon is None:
        raise HTTPException(
            status_code=400,
            detail="Fournir soit station_code, soit lat+lon (zone).",
        )

    coords = _get_stations_coords()
    out: list[dict[str, Any]] = []
    for _, r in coords.iterrows():
        d = haversine_km(lat, lon, float(r["latitude"]), float(r["longitude"]))
        if d <= radius_km:
            try:
                out.append(_build_response_for_station(str(r["code_site"])))
            except HTTPException:
                continue
            if len(out) >= 40:
                break

    if not out:
        raise HTTPException(status_code=404, detail="Aucune station pollution dans le rayon (ou données manquantes).")

    return {"zone": {"lat": lat, "lon": lon, "radius_km": radius_km}, "stations": out}
