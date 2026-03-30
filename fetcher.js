const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// --- CONFIGURATION ---
const API_KEY = "4yCMoCEuAAI92GKryWthZ781eXAbc7u4";
const BASE_URL = 'https://www.geodair.fr/api-ext';
const POLLUANT = '03';
const TYPE_DONNEE = 'a1';
const OUTPUT_DIR = path.join(__dirname, 'front', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest.json');

const DB_ENABLED = process.env.DB_ENABLED !== 'false';
const QUALITE_AIR_TABLE = process.env.QUALITE_AIR_TABLE || 'qualite_air';

function isSafeIdentifier(name) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

if (DB_ENABLED && !isSafeIdentifier(QUALITE_AIR_TABLE)) {
    throw new Error(`Nom de table invalide: ${QUALITE_AIR_TABLE}`);
}

const pool = DB_ENABLED
    ? new Pool({
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'postgres',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    })
    : null;

if (!API_KEY) {
    console.error('Variable manquante: GEODAIR_API_KEY');
    console.error('Exemple: GEODAIR_API_KEY=ta_cle node fetcher.js');
    process.exit(1);
}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatGeodairDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function parseCsvText(csvText) {
    return new Promise((resolve, reject) => {
        const results = [];
        const stream = Readable.from(csvText);

        stream
            .pipe(csv({ separator: ';' }))
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

function saveData(results) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const payload = {
        updatedAt: new Date().toISOString(),
        count: results.length,
        rows: results
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

function getRawField(row, candidates) {
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
            return row[key];
        }
    }
    return null;
}

function parseNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).replace(',', '.').trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isInteger(parsed) ? parsed : null;
}

function parseNullableTimestamp(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeKeyPart(value) {
    return String(value || '').trim().toLowerCase();
}

function buildDedupeKey(row) {
    const parts = [
        normalizeKeyPart(row.dateDebut),
        normalizeKeyPart(row.codeSite),
        normalizeKeyPart(row.polluant),
        normalizeKeyPart(row.typeValeur),
        normalizeKeyPart(row.typeInfluence)
    ];

    return parts.join('|');
}

function normalizeQualiteAirRow(row, fetchedAt) {
    const normalized = {
        dateDebut: parseNullableTimestamp(getRawField(row, ['Date de début'])),
        dateFin: parseNullableTimestamp(getRawField(row, ['Date de fin'])),
        organisme: getRawField(row, ['Organisme']) || null,
        codeZas: getRawField(row, ['code zas']) || null,
        zas: getRawField(row, ['Zas']) || null,
        codeSite: getRawField(row, ['code site']) || null,
        nomSite: getRawField(row, ['nom site']) || null,
        typeImplantation: getRawField(row, ["type d'implantation"]) || null,
        polluant: getRawField(row, ['Polluant']) || null,
        typeInfluence: getRawField(row, ["type d'influence"]) || null,
        discriminant: getRawField(row, ['discriminant']) || null,
        reglementaire: getRawField(row, ['Réglementaire']) || null,
        typeEvaluation: getRawField(row, ["type d'évaluation", "type d'evaluation"]) || null,
        procedureMesure: getRawField(row, ['procédure de mesure']) || null,
        typeValeur: getRawField(row, ['type de valeur']) || null,
        valeur: parseNullableNumber(getRawField(row, ['valeur'])),
        valeurBrute: parseNullableNumber(getRawField(row, ['valeur brute'])),
        uniteMesure: getRawField(row, ['unité de mesure']) || null,
        tauxSaisie: parseNullableNumber(getRawField(row, ['taux de saisie'])),
        couvertureTemporelle: parseNullableNumber(getRawField(row, ['couverture temporelle'])),
        couvertureDonnees: parseNullableNumber(getRawField(row, ['couverture de données'])),
        codeQualite: getRawField(row, ['code qualité']) || null,
        validite: parseNullableInteger(getRawField(row, ['validité'])),
        latitude: parseNullableNumber(getRawField(row, ['Latitude', 'latitude'])),
        longitude: parseNullableNumber(getRawField(row, ['Longitude', 'longitude'])),
        fetchedAt
    };

    normalized.dedupeKey = buildDedupeKey(normalized);
    return normalized;
}

async function ensureDbSchema() {
    if (!pool) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${QUALITE_AIR_TABLE} (
            "Date de début" timestamp without time zone,
            "Date de fin" timestamp without time zone,
            "Organisme" text,
            "code zas" text,
            "Zas" text,
            "code site" text,
            "nom site" text,
            "type d'implantation" text,
            "Polluant" text,
            "type d'influence" text,
            discriminant text,
            "Réglementaire" text,
            "type d'evaluation" text,
            "procédure de mesure" text,
            "type de valeur" text,
            valeur double precision,
            "valeur brute" double precision,
            "unité de mesure" text,
            "taux de saisie" double precision,
            "couverture temporelle" double precision,
            "couverture de données" double precision,
            "code qualité" text,
            "validité" bigint,
            "Latitude" double precision,
            "Longitude" double precision,
            dedupe_key text,
            fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE ${QUALITE_AIR_TABLE} ADD COLUMN IF NOT EXISTS "Latitude" double precision`);
    await pool.query(`ALTER TABLE ${QUALITE_AIR_TABLE} ADD COLUMN IF NOT EXISTS "Longitude" double precision`);
    await pool.query(`ALTER TABLE ${QUALITE_AIR_TABLE} ADD COLUMN IF NOT EXISTS dedupe_key text`);
    await pool.query(`ALTER TABLE ${QUALITE_AIR_TABLE} ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${QUALITE_AIR_TABLE}_fetched_at ON ${QUALITE_AIR_TABLE} (fetched_at DESC)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${QUALITE_AIR_TABLE}_dedupe_key ON ${QUALITE_AIR_TABLE} (dedupe_key)`);
}

async function saveRowsInDb(rows) {
    if (!pool || !Array.isArray(rows) || rows.length === 0) {
        return;
    }

    await ensureDbSchema();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO ${QUALITE_AIR_TABLE} (
                "Date de début",
                "Date de fin",
                "Organisme",
                "code zas",
                "Zas",
                "code site",
                "nom site",
                "type d'implantation",
                "Polluant",
                "type d'influence",
                discriminant,
                "Réglementaire",
                "type d'evaluation",
                "procédure de mesure",
                "type de valeur",
                valeur,
                "valeur brute",
                "unité de mesure",
                "taux de saisie",
                "couverture temporelle",
                "couverture de données",
                "code qualité",
                "validité",
                "Latitude",
                "Longitude",
                dedupe_key,
                fetched_at
            )
            VALUES (
                $1::timestamp,
                $2::timestamp,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                $15,
                $16,
                $17,
                $18,
                $19,
                $20,
                $21,
                $22,
                $23,
                $24,
                $25,
                $26,
                $27
            )
            ON CONFLICT (dedupe_key) DO UPDATE SET
                "Date de fin" = EXCLUDED."Date de fin",
                "Organisme" = EXCLUDED."Organisme",
                "code zas" = EXCLUDED."code zas",
                "Zas" = EXCLUDED."Zas",
                "nom site" = EXCLUDED."nom site",
                "type d'implantation" = EXCLUDED."type d'implantation",
                "type d'influence" = EXCLUDED."type d'influence",
                discriminant = EXCLUDED.discriminant,
                "Réglementaire" = EXCLUDED."Réglementaire",
                "type d'evaluation" = EXCLUDED."type d'evaluation",
                "procédure de mesure" = EXCLUDED."procédure de mesure",
                "type de valeur" = EXCLUDED."type de valeur",
                valeur = EXCLUDED.valeur,
                "valeur brute" = EXCLUDED."valeur brute",
                "unité de mesure" = EXCLUDED."unité de mesure",
                "taux de saisie" = EXCLUDED."taux de saisie",
                "couverture temporelle" = EXCLUDED."couverture temporelle",
                "couverture de données" = EXCLUDED."couverture de données",
                "code qualité" = EXCLUDED."code qualité",
                "validité" = EXCLUDED."validité",
                "Latitude" = EXCLUDED."Latitude",
                "Longitude" = EXCLUDED."Longitude",
                fetched_at = EXCLUDED.fetched_at
        `;

        const fetchedAt = new Date();
        for (const row of rows) {
            const normalized = normalizeQualiteAirRow(row, fetchedAt);
            await client.query(insertQuery, [
                normalized.dateDebut,
                normalized.dateFin,
                normalized.organisme,
                normalized.codeZas,
                normalized.zas,
                normalized.codeSite,
                normalized.nomSite,
                normalized.typeImplantation,
                normalized.polluant,
                normalized.typeInfluence,
                normalized.discriminant,
                normalized.reglementaire,
                normalized.typeEvaluation,
                normalized.procedureMesure,
                normalized.typeValeur,
                normalized.valeur,
                normalized.valeurBrute,
                normalized.uniteMesure,
                normalized.tauxSaisie,
                normalized.couvertureTemporelle,
                normalized.couvertureDonnees,
                normalized.codeQualite,
                normalized.validite,
                normalized.latitude,
                normalized.longitude,
                normalized.dedupeKey,
                normalized.fetchedAt
            ]);
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getGeodairData() {
    try {
        console.log("1. Demande de génération du fichier...");
        
        const dateFin = formatGeodairDate(new Date());
        const dateDebut = formatGeodairDate(new Date(Date.now() - 3 * 60 * 60 * 1000));

        const responseExport = await axios.get(`${BASE_URL}/statistique/export`, {
            params: {
                date_debut: dateDebut,
                date_fin: dateFin,
                type_donnee: TYPE_DONNEE,
                polluant: POLLUANT
            },
            headers: { 'apikey': API_KEY, 'accept': 'text/csv' }
        });

        const fileId = responseExport.data;
        console.log(`Fichier généré ! ID: ${fileId}`);

        console.log("2. Attente de 3 secondes pour la préparation...");
        await sleep(3000);

        const responseDownload = await axios.get(`${BASE_URL}/download`, {
            params: { id: fileId },
            headers: { 'apikey': API_KEY },
            responseType: 'text'
        });

        console.log("3. Analyse du CSV et enregistrement...");

        const results = await parseCsvText(responseDownload.data);
        saveData(results);
        await saveRowsInDb(results);

        console.log(`${results.length} lignes récupérées.`);
        console.log(`Données sauvegardées dans: ${OUTPUT_FILE}`);
        if (DB_ENABLED) {
            console.log(`Données insérées en base (table ${QUALITE_AIR_TABLE}).`);
        }
        console.log("Exemple de ligne :", results[0]);

    } catch (error) {
        console.error("Erreur lors de la récupération :", error.response ? error.response.data : error.message);
    }
}

setInterval(getGeodairData, 900000);

getGeodairData();