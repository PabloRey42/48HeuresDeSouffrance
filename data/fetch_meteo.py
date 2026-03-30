import requests
import pandas as pd
import io

SYNOP_URLS = {
    2026: "https://www.data.gouv.fr/api/1/datasets/r/a654bcef-8a31-4fa5-b903-68f64d6ec818",
    2025: "https://www.data.gouv.fr/api/1/datasets/r/7a2743fb-4ccc-4b95-b43d-79175f4f4ea6",
    2024: "https://www.data.gouv.fr/api/1/datasets/r/eb3535ba-7368-40aa-b07d-23ecde661a04",
    2023: "https://www.data.gouv.fr/api/1/datasets/r/53e244d8-a45b-417c-a1ee-16c085cccc13",
    2022: "https://www.data.gouv.fr/api/1/datasets/r/615eed9c-d08f-41ea-bd73-e71e459f7607",
    2021: "https://www.data.gouv.fr/api/1/datasets/r/55db9ca1-6e7e-406d-8cc8-76c06c50e2d6",
}


def fetch_synop(year: int) -> pd.DataFrame:
    if year not in SYNOP_URLS:
        raise ValueError(f"Année {year} non disponible. Choix possibles : {list(SYNOP_URLS)}")

    csv_url = SYNOP_URLS[year]
    r = requests.get(csv_url, timeout=30)
    r.raise_for_status()

    df = pd.read_csv(
        io.BytesIO(r.content),
        sep=";",
        encoding="utf-8",
        compression="gzip",
        na_values=["mq", ""],
        low_memory=False,
    )
    df.columns = df.columns.str.strip().str.lower()

    date_candidates = ["validity_time"]
    date_col = next((c for c in date_candidates if c in df.columns), None)
    if date_col is None:
        print(f"[WARN] Colonnes disponibles : {df.columns.tolist()}")
        raise KeyError(f"Aucune colonne date trouvée parmi {date_candidates}")

    rename = {
        # Ancien format
        "numer_sta": "station_id",
        "lat": "latitude",
        "lon": "longitude",
        "t": "temperature_k",  # Kelvin
        "u": "humidite",       # %
        "ff": "vent_ms",       # m/s
        "dd": "direction_du_vent", 
        "rr1": "pluie_mm",
        "pres": "pression_pa",
        "geo_id_wmo": "station_id",
        "n": "nebulosite",
        "vv": "visibilité_horizontale",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})

    if date_col == "validity_time" or date_col == "reference_time":
        df["date"] = pd.to_datetime(df[date_col], utc=True, errors="coerce")
    else:
        df["date"] = pd.to_datetime(df[date_col], format="%Y%m%d%H%M%S", errors="coerce")
    if date_col != "date":
        df = df.drop(columns=[date_col])

    if "temperature_k" in df.columns:
        df["temperature_c"] = df["temperature_k"] - 273.15

    return df.dropna(subset=["latitude", "longitude"])


def fetch_all_synop(years: list[int] | None = None) -> pd.DataFrame:
    """Charge et concatène les données SYNOP pour plusieurs années."""
    if years is None:
        years = list(SYNOP_URLS.keys())

    frames = []
    for year in years:
        print(f"Chargement {year}...")
        df = fetch_synop(year)
        df["annee"] = year
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


if __name__ == "__main__":
    df_all = fetch_all_synop([2021, 2022, 2023, 2024, 2025, 2026])
    df_all.to_parquet("data/raw/meteo_all.parquet", index=False)

    print(df_all.head(10))
