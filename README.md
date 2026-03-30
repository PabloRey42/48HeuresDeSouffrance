# 48HeuresDeSouffrance

## Prerequis

- Node.js 18+
- Python 3.10+ (option Python+frontend)

## Installation

```bash
npm install
```

## Recup des donnees Geodair (Node)

One-shot:

```bash
npm run fetch
```

Mode continu (toutes les 15 min par defaut):

```bash
npm run fetch:watch
```

Variables utiles:

- `GEODAIR_API_KEY`
- `FETCH_INTERVAL_MS`
- `POLLUANT`
- `TYPE_DONNEE`

## Run unifie

### Option A: Node seul (recommande)

Cette option:

1. recupere les donnees Geodair dans `front/data/latest.json`
2. sert le front sur `http://localhost:8080`

```bash
npm run run:node
```

### Option B: Python + frontend

Cette option lance:

1. API FastAPI sur `http://127.0.0.1:8000`
2. front statique sur `http://localhost:8080`

```bash
npm run run:python
```

Le front essaye d'abord l'API Python. Si indisponible, fallback automatique vers `front/data/latest.json`.

## API Python

`app.py` utilise:

- `fastapi`
- `sqlalchemy`
- `pandas`
- `uvicorn`

Installer les dependances Python si necessaire:

```bash
sudo apt-get update && sudo apt-get install -y python3-pip
python3 -m pip install fastapi sqlalchemy pandas uvicorn psycopg2-binary
```
