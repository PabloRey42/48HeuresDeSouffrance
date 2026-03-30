const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const API_KEY = "4yCMoCEuAAI92GKryWthZ781eXAbc7u4";
const BASE_URL = 'https://www.geodair.fr/api-ext';
const POLLUANT = '03';
const TYPE_DONNEE = 'a1';
const OUTPUT_DIR = path.join(__dirname, 'front', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest.json');

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

        console.log(`${results.length} lignes récupérées.`);
        console.log(`Données sauvegardées dans: ${OUTPUT_FILE}`);
        console.log("Exemple de ligne :", results[0]);

    } catch (error) {
        console.error("Erreur lors de la récupération :", error.response ? error.response.data : error.message);
    }
}

setInterval(getGeodairData, 900000);

getGeodairData();