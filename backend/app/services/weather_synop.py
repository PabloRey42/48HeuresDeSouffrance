"""Observations SYNOP via l'API Records Opendatasoft (dataset essentiel OMM)."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pandas as pd

from app.core.config import settings


def fetch_synop_nearest_time(numer_sta: str, target: datetime) -> dict:
    """
    Dernier relevé SYNOP avec `date <= target` pour la station.

    L'API Records v1 ignore souvent `where` sur `numer_sta` ; on utilise `refine.numer_sta`.
    Le tri `sort=date` renvoie les relevés les plus récents en premier sur ce jeu.
    """
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    target = target.astimezone(timezone.utc)

    select = ",".join(
        ["date", "numer_sta", "nom", "latitude", "longitude", "tc", "u", "ff", "dd", "pres", "rr3", "rr24"]
    )
    url = f"{settings.SYNOP_BASE_URL.rstrip('/')}/api/records/1.0/search/"
    params = {
        "dataset": settings.SYNOP_DATASET_ID,
        "refine.numer_sta": str(numer_sta).strip(),
        "select": select,
        "rows": 3000,
        "sort": "date",
        "timezone": "UTC",
    }
    with httpx.Client(timeout=90.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    records = data.get("records") or []
    chosen: dict | None = None
    for rec in records:
        fields = rec.get("fields") or {}
        if str(fields.get("numer_sta", "")).strip() != str(numer_sta).strip():
            continue
        ds = fields.get("date")
        if not ds:
            continue
        dt = pd.to_datetime(ds, utc=True).to_pydatetime()
        if dt <= target:
            chosen = fields
            break
    if chosen is None and records:
        # Cible très ancienne : retourner le plus ancien du lot
        chosen = records[-1].get("fields") or {}
    return chosen or {}


def fetch_synop_stations_near(lat: float, lon: float, radius_m: int = 150_000) -> pd.DataFrame:
    """
    Stations SYNOP dans un disque autour du point pollution (API `geofilter.distance`).
    Évite de charger tout le catalogue mondial.
    """
    url = f"{settings.SYNOP_BASE_URL.rstrip('/')}/api/records/1.0/search/"
    params = {
        "dataset": settings.SYNOP_DATASET_ID,
        "geofilter.distance": f"{lat},{lon},{radius_m}",
        "select": "numer_sta,latitude,longitude",
        "rows": 300,
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    out: list[dict] = []
    for rec in data.get("records") or []:
        f = rec.get("fields") or {}
        if "numer_sta" not in f or "latitude" not in f:
            continue
        out.append(
            {
                "numer_sta": str(f["numer_sta"]),
                "latitude": float(f["latitude"]),
                "longitude": float(f["longitude"]),
            }
        )
    if not out:
        return pd.DataFrame(columns=["numer_sta", "latitude", "longitude"])
    return pd.DataFrame(out).drop_duplicates(subset=["numer_sta"], keep="first").reset_index(drop=True)
