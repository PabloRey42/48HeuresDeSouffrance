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
    "direction_du_vent",
    "pluie_mm",
    "nebulosite",
    "visibilité_horizontale",
    "raf10",
    "annee",
]


def clean_synop(df: pd.DataFrame) -> pd.DataFrame:
    """
    Nettoyage avancé type data engineer :
    - sélection des colonnes utiles
    - typage propre
    - gestion des valeurs aberrantes
    - gestion des missing values
    - features dérivées utiles pour la pollution
    """

    # 1. Sélection des colonnes
    cols = [c for c in USEFUL_COLUMNS if c in df.columns]
    df = df[cols].copy()

    # 2. Typage
    df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)

    numeric_cols = df.select_dtypes(include=["float", "int"]).columns
    df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors="coerce")

    # 3. Suppression lignes critiques
    df = df.dropna(subset=["date", "station_id", "latitude", "longitude"])

    # 4. Nettoyage valeurs aberrantes (domain knowledge météo)
    df = df[(df["temperature_c"] > -50) & (df["temperature_c"] < 50)]
    df = df[(df["humidite"] >= 0) & (df["humidite"] <= 100)]
    df = df[(df["vent_ms"] >= 0) & (df["vent_ms"] < 80)]
    df = df[(df["pression_pa"] > 80000) & (df["pression_pa"] < 110000)]
    df = df[(df["pluie_mm"] >= 0)]

    # 5. Feature engineering
    # Vent en km/h
    if "vent_ms" in df.columns:
        df["vent_kmh"] = df["vent_ms"] * 3.6

    # Indicateur de pluie
    df["is_rain"] = (df["pluie_mm"] > 0).astype(int)

    # Catégorisation vent (dispersion pollution)
    df["vent_faible"] = (df["vent_ms"] < 2).astype(int)
    df["vent_fort"] = (df["vent_ms"] > 8).astype(int)

    # Stagnation atmosphérique (clé pour pollution)
    df["stagnation"] = ((df["vent_ms"] < 2) & (df["pluie_mm"] == 0)).astype(int)

    # 6. Gestion des missing values (soft)
    df = df.sort_values(["station_id", "date"])
    df = df.groupby("station_id").apply(lambda g: g.ffill().bfill()).reset_index(drop=True)

    # 7. Déduplication
    df = df.drop_duplicates(subset=["station_id", "date"])

    # 8. Tri final
    df = df.sort_values("date")

    return df


if __name__ == "__main__":
    df = pd.read_parquet("data/raw/meteo_all.parquet")

    print("Nettoyage avancé...")
    df_clean = clean_synop(df)

    df_clean.to_parquet("data/interim/meteo_clean_all.parquet", index=False)

    print("Fichier généré : data/interim/meteo_clean_all.parquet")
    print(df_clean.head())