"""
Extraction automatisee des donnees de pollution atmospherique (format Parquet).

Source : data.gouv.fr - Donnees temps reel de mesure des concentrations
de polluants atmospheriques reglementes (LCSQA).

Strategie :
  1. Appel a l'API dataset pour identifier la ressource "Moyennes horaires temps reel".
  2. Tentative de telechargement via l'API tabulaire (format Parquet natif).
  3. Fallback : telechargement du CSV le plus recent depuis le stockage objet S3
     d'INERIS, puis conversion locale en Parquet via pandas + pyarrow.
"""

import io
import os
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

# Clé API tabulaire data.gouv — définir dans l'environnement (ne pas committer en clair en prod)
API_KEY = os.environ.get("DATA_GOUV_API_KEY", "")
RESOURCE_ID = "157ceed4-ce03-4c7d-9cd7-ae60ea07417b"
RESOURCE_API_URL = f"https://www.data.gouv.fr/api/1/datasets/r/{RESOURCE_ID}"
TABULAR_API_URL = (
    f"https://tabular-api.data.gouv.fr/api/resources/{RESOURCE_ID}/data/?format=parquet"
)
S3_BUCKET_URL = "https://object.files.data.gouv.fr/ineris-prod/"
S3_PREFIX = (
    "lcsqa/concentrations-de-polluants-atmospheriques-reglementes/temps-reel/"
)

OUTPUT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = OUTPUT_DIR / "polluants_idf_temps_reel.parquet"


def get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "fetch-pollution/1.0"})
    if API_KEY:
        session.headers.update({"X-API-KEY": API_KEY})
    return session


# ---------------------------------------------------------------------------
# Etape 1 : Decouverte de la ressource
# ---------------------------------------------------------------------------

def check_resource(session: requests.Session) -> str:
    """Verifie la ressource via l'API directe et retourne son titre."""
    print(f"[1/3] Verification de la ressource via {RESOURCE_API_URL}")
    resp = session.get(RESOURCE_API_URL, allow_redirects=False)
    print(f"  -> Resource ID : {RESOURCE_ID}")
    print(f"  -> HTTP {resp.status_code}")
    return RESOURCE_ID


# ---------------------------------------------------------------------------
# Etape 2 : Tentative via l'API tabulaire
# ---------------------------------------------------------------------------

def try_tabular_api(session: requests.Session) -> bool:
    """Tente le telechargement Parquet via l'API tabulaire. Retourne True si OK."""
    url = TABULAR_API_URL
    print(f"[2/3] Tentative via l'API tabulaire...\n  -> {url}")
    resp = session.get(url, stream=True, timeout=30)

    if resp.status_code == 200:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"  [OK] Parquet telecharge via API tabulaire -> {OUTPUT_FILE}")
        return True

    print(f"  [--] API tabulaire indisponible (HTTP {resp.status_code}), fallback S3...")
    return False


# ---------------------------------------------------------------------------
# Etape 3 (fallback) : Telechargement direct depuis le stockage objet S3
# ---------------------------------------------------------------------------

def list_csv_keys(session: requests.Session, year: int) -> list[str]:
    """Liste les cles CSV disponibles dans le bucket S3 pour une annee donnee."""
    prefix = f"{S3_PREFIX}{year}/"
    keys: list[str] = []
    continuation_token = None

    while True:
        params: dict = {
            "list-type": "2",
            "prefix": prefix,
            "max-keys": "1000",
        }
        if continuation_token:
            params["continuation-token"] = continuation_token

        resp = session.get(S3_BUCKET_URL, params=params, timeout=30)
        resp.raise_for_status()

        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        root = ET.fromstring(resp.text)

        for content in root.findall("s3:Contents", ns):
            key_el = content.find("s3:Key", ns)
            if key_el is not None and key_el.text and key_el.text.endswith(".csv"):
                keys.append(key_el.text)

        is_truncated = root.findtext("s3:IsTruncated", namespaces=ns)
        if is_truncated == "true":
            continuation_token = root.findtext(
                "s3:NextContinuationToken", namespaces=ns
            )
        else:
            break

    return sorted(keys)


def download_latest_csv(session: requests.Session) -> pd.DataFrame:
    """Telecharge le CSV le plus recent et le charge dans un DataFrame."""
    today = datetime.now()

    for year in [today.year, today.year - 1]:
        print(f"  Listing des CSV pour {year}...")
        keys = list_csv_keys(session, year)
        if not keys:
            continue

        latest_key = keys[-1]
        csv_url = f"{S3_BUCKET_URL}{latest_key}"
        print(f"  -> Fichier le plus recent : {latest_key.split('/')[-1]}")
        print("     Telechargement... ", end="", flush=True)

        resp = session.get(csv_url, timeout=120)
        resp.raise_for_status()
        print(f"({len(resp.content) / 1_048_576:.1f} Mo)")

        df = pd.read_csv(
            io.BytesIO(resp.content),
            sep=";",
            encoding="utf-8-sig",
            low_memory=False,
        )
        return df

    raise RuntimeError("Aucun fichier CSV trouve sur le stockage objet.")


def download_and_convert(session: requests.Session) -> None:
    """Telecharge le CSV depuis S3, convertit en Parquet et sauvegarde."""
    print("[3/3] Telechargement depuis le stockage objet S3...")
    df = download_latest_csv(session)

    print(f"\n  Apercu du DataFrame ({df.shape[0]} lignes x {df.shape[1]} colonnes) :")
    print(f"  Colonnes : {list(df.columns)}")
    print(df.head(3).to_string(index=False, max_colwidth=30))

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUTPUT_FILE, engine="pyarrow", index=False)
    size_mb = OUTPUT_FILE.stat().st_size / 1_048_576
    print(f"\n  [OK] Sauvegarde -> {OUTPUT_FILE}  ({size_mb:.1f} Mo)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 65)
    print("  Extraction des donnees de pollution atmospherique (Parquet)")
    print("=" * 65)

    session = get_session()
    check_resource(session)

    if not try_tabular_api(session):
        download_and_convert(session)

    df = pd.read_parquet(OUTPUT_FILE)
    print(f"\n  Verification : {df.shape[0]} lignes, {df.shape[1]} colonnes OK.")
    print("  Termine.")


if __name__ == "__main__":
    main()
