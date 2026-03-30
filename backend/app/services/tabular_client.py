"""Client HTTP pour l'API tabulaire data.gouv.fr (pagination JSON)."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings


def tabular_headers() -> dict[str, str]:
    h: dict[str, str] = {"Accept": "application/json"}
    if settings.DATA_GOUV_API_KEY:
        h["X-API-KEY"] = settings.DATA_GOUV_API_KEY
    return h


def fetch_all_pages(resource_id: str, *, page_size: int = 100) -> list[dict[str, Any]]:
    """Récupère toutes les pages `/data/` pour une ressource tabulaire."""
    base = f"{settings.TABULAR_API_BASE}/{resource_id}/data/"
    out: list[dict[str, Any]] = []
    page = 1
    with httpx.Client(timeout=120.0) as client:
        while True:
            r = client.get(
                base,
                params={"page": page, "page_size": page_size},
                headers=tabular_headers(),
            )
            r.raise_for_status()
            payload = r.json()
            rows = payload.get("data") or []
            out.extend(rows)
            links = payload.get("links") or {}
            if not links.get("next"):
                break
            page += 1
    return out


def try_download_parquet(resource_id: str) -> bytes | None:
    """Tente `?format=parquet` (certaines ressources hydra uniquement)."""
    url = f"{settings.TABULAR_API_BASE}/{resource_id}/data/"
    with httpx.Client(timeout=180.0) as client:
        r = client.get(url, params={"format": "parquet"}, headers=tabular_headers())
        if r.status_code != 200:
            return None
        return r.content
