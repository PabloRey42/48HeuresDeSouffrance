"""Configuration centralisée (variables d'environnement)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Clé API data.gouv (API tabulaire) — NE PAS committer la valeur en dur en prod
    DATA_GOUV_API_KEY: str = ""

    RESOURCE_POLLUTION_ID: str = "157ceed4-ce03-4c7d-9cd7-ae60ea07417b"
    RESOURCE_STATIONS_META_ID: str = "eb87c56c-dea9-4377-a1e7-03ada59d3043"
    TABULAR_API_BASE: str = "https://tabular-api.data.gouv.fr/api/resources"

    # Météo SYNOP (Opendatasoft — jeu dérivé de l'archive SYNOP OMM)
    SYNOP_BASE_URL: str = "https://public.opendatasoft.com"
    SYNOP_DATASET_ID: str = "donnees-synop-essentielles-omm"

    # Fichier local optionnel (fallback rapide hors ligne)
    POLLUTION_PARQUET_PATH: str = ""

    # Seuils / pondération (voir impact_index.py pour la doc métier)
    T_REF_C: float = 25.0
    W_STAGNATION: float = 0.35
    W_HEAT: float = 0.25
    W_PM_WEIGHT: float = 0.45
    W_GAZ_WEIGHT: float = 0.55


settings = Settings()
