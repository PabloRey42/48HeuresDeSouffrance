# Pipeline météo-pollution + API

## Rôle

- **Pollution** : concentrations horaires via le Parquet généré depuis data.gouv (script `data/fetch_pollution.py`, API tabulaire avec en-tête `X-API-KEY`).
- **Météo** : observations SYNOP (jeu `donnees-synop-essentielles-omm` sur Opendatasoft, aligné sur l’archive SYNOP OMM).
- **Jointure spatiale** : chaque station de pollution (lat/lon issues du jeu « métadonnées stations » tabulaire) est reliée à la station SYNOP la plus proche (distance Haversine).
- **Indice** : score **0–100** combinant pollution normalisée et aggravation météo (stagnation / chaleur), voir `backend/app/services/impact_index.py`.

## Démarrage API (FastAPI)

```bash
cd backend
python -m pip install -r requirements.txt
set PYTHONPATH=.
set POLLUTION_PARQUET_PATH=..\data\polluants_idf_temps_reel.parquet
set DATA_GOUV_API_KEY=votre_cle
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Documentation interactive : **http://127.0.0.1:8000/docs**

### Endpoint principal

- `GET /impact?station_code=FR01011` — indice + sources pollution et météo + infos spatiales.
- `GET /impact?lat=48.85&lon=2.35&radius_km=80` — plusieurs stations dans le disque (limite interne).

## Mise à jour des données pollution

```bash
cd data
set DATA_GOUV_API_KEY=votre_cle
python fetch_pollution.py
```

Le script envoie la clé dans le header `X-API-KEY` (variable d’environnement `DATA_GOUV_API_KEY`).
