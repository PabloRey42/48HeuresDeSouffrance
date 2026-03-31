require('dotenv').config();
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const API_KEY = process.env.GEODAIR_API_KEY;
const BASE_URL = 'https://www.geodair.fr/api-ext';
const POLLUANT = process.env.POLLUANT || '03';
const TYPE_DONNEE = process.env.TYPE_DONNEE || 'a1';
const OUTPUT_DIR = path.join(__dirname, 'front', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest.json');
const WATCH_INTERVAL_MS = Number(process.env.FETCH_INTERVAL_MS || 15 * 60 * 1000);
const WATCH_MODE = process.argv.includes('--watch');

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
    console.error('GEODAIR_API_KEY manquant.');
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        Readable
            .from(csvText)
            .pipe(csv({ separator: ';' }))
            .on('data', (row) => results.push(row))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

function saveData(rows) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const payload = {
        updatedAt: new Date().toISOString(),
        count: rows.length,
        rows
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

async function fetchOnce() {
    const now = new Date();
    const dateFin = formatGeodairDate(now);
    const dateDebut = formatGeodairDate(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    console.log('[fetch] Demande export Geodair...');

    const responseExport = await axios.get(`${BASE_URL}/statistique/export`, {
        params: {
            date_debut: dateDebut,
            date_fin: dateFin,
            type_donnee: TYPE_DONNEE,
            polluant: POLLUANT
        },
        headers: {
            apikey: API_KEY,
            accept: 'text/csv'
        }
    });

    const fileId = String(responseExport.data).trim();
    if (!fileId) {
        throw new Error('Aucun identifiant de fichier retourne par Geodair.');
    }

    console.log(`[fetch] Export genere: ${fileId}`);
    await sleep(3000);

    const responseDownload = await axios.get(`${BASE_URL}/download`, {
        params: { id: fileId },
        headers: { apikey: API_KEY },
        responseType: 'text'
    });

    const rows = await parseCsvText(responseDownload.data);
    saveData(rows);

    console.log(`[fetch] ${rows.length} ligne(s) enregistree(s) dans ${OUTPUT_FILE}`);
}

async function run() {
    try {
        await fetchOnce();
    } catch (error) {
        const message = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[fetch] Erreur:', message);
        if (!WATCH_MODE) {
            process.exitCode = 1;
            return;
        }
    }

    if (!WATCH_MODE) {
        return;
    }

    console.log(`[fetch] Mode watch actif (${WATCH_INTERVAL_MS} ms)`);
    setInterval(async () => {
        try {
            await fetchOnce();
        } catch (error) {
            const message = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error('[fetch] Erreur watch:', message);
        }
    }, WATCH_INTERVAL_MS);
}

run();
