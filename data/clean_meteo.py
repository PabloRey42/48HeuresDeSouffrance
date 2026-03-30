import pandas as pd

# Colonnes utiles pour l'analyse météo ↔ pollution
USEFUL_COLUMNS = [
    "latitude",
    "longitude",
    "station_id",
    "date",
    "temperature_c",
    "humidite",
    "pression_pa",
    "vent_ms",
    "direction_du_vent",  # direction du vent
    "pluie_mm",
    "nebulosite",
    "visibilité_horizontale",  # visibilité (optionnel mais utile)
    "raf10",  # rafales
    "annee",
]

def clean_synop(df: pd.DataFrame) -> pd.DataFrame:
    """
    Nettoie un DataFrame SYNOP pour ne garder que les variables utiles
    pour l'analyse de la pollution.
    """
    # Garder uniquement les colonnes présentes
    cols = [c for c in USEFUL_COLUMNS if c in df.columns]
    df = df[cols].copy()

    # Nettoyage des types
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)

    # Tri temporel
    df = df.sort_values("date")

    return df

if __name__ == "__main__":
    # Exemple d'utilisation
    import pandas as pd

    df = pd.read_parquet("data/raw/meteo_all.parquet")

    print("Nettoyage...")
    df_clean = clean_synop(df)

    df_clean.to_parquet("data/interim/meteo_clean_all.parquet", index=False)

    print("Fichier généré : data/interim/meteo_clean_all.parquet")
    print(df_clean.head())
