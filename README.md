# 48HeuresDeSouffrance

Le projet recupere des donnees Geodair, les affiche sur la carte et les persiste en PostgreSQL dans la table `qualite_air`.

## Prerequis

- Node.js 18+
- PostgreSQL

## Installation

```bash
npm install
```

## Variables d'environnement

- `PGHOST` (defaut: `127.0.0.1`)
- `PGPORT` (defaut: `5432`)
- `PGDATABASE` (defaut: `postgres`)
- `PGUSER` (defaut: `postgres`)
- `PGPASSWORD` (defaut: vide)
- `PGSSL` (`true` ou `false`, defaut: `false`)
- `DB_ENABLED` (`false` pour desactiver l'insertion DB)
- `QUALITE_AIR_TABLE` (defaut: `qualite_air`)

## Restaurer ton dump

```bash
createdb challenge_db
psql -d challenge_db -f sauvegarde_challenge.sql
```

Puis configure l'app:

```bash
export PGDATABASE=challenge_db
export PGUSER=etienne
export PGPASSWORD=ton_mot_de_passe
```

## Recuperer les donnees Geodair

```bash
npm run fetch
```

Effets:

- met a jour `front/data/latest.json`
- insere les lignes dans `qualite_air`
- complete automatiquement les colonnes `Latitude`, `Longitude` et `fetched_at` si absentes

## Lancer l'application

```bash
npm run serve
```

Puis ouvrir `http://localhost:8080`.

Le front lit en priorite `GET /api/latest` (DB), avec fallback vers `front/data/latest.json`.
