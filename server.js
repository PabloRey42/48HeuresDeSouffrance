const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 8080);
const tableName = process.env.QUALITE_AIR_TABLE || 'qualite_air';

function isSafeIdentifier(name) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

if (!isSafeIdentifier(tableName)) {
    throw new Error(`Nom de table invalide: ${tableName}`);
}

const pool = new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

async function tableExists() {
    const result = await pool.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
        ) AS exists
        `,
        [tableName]
    );

    return Boolean(result.rows[0] && result.rows[0].exists);
}

app.get('/api/health', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/api/latest', async (_req, res) => {
    const limit = Math.max(1, Math.min(5000, Number(_req.query.limit || 2000)));

    try {
        const exists = await tableExists();
        if (!exists) {
            return res.status(404).json({
                error: `Table ${tableName} introuvable. Lance fetcher.js pour la creer.`
            });
        }

        const result = await pool.query(
            `
            SELECT
                "Date de début" AS "Date de début",
                "Date de fin" AS "Date de fin",
                "Organisme" AS "Organisme",
                "code zas" AS "code zas",
                "Zas" AS "Zas",
                "code site" AS "code site",
                "nom site" AS "nom site",
                "type d'implantation" AS "type d'implantation",
                "Polluant" AS "Polluant",
                "type d'influence" AS "type d'influence",
                discriminant,
                "Réglementaire" AS "Réglementaire",
                "type d'evaluation" AS "type d'evaluation",
                "procédure de mesure" AS "procédure de mesure",
                "type de valeur" AS "type de valeur",
                valeur,
                "valeur brute" AS "valeur brute",
                "unité de mesure" AS "unité de mesure",
                "taux de saisie" AS "taux de saisie",
                "couverture temporelle" AS "couverture temporelle",
                "couverture de données" AS "couverture de données",
                "code qualité" AS "code qualité",
                "validité" AS "validité",
                "Latitude" AS "Latitude",
                "Longitude" AS "Longitude",
                fetched_at
            FROM ${tableName}
            ORDER BY fetched_at DESC NULLS LAST, "Date de début" DESC NULLS LAST
            LIMIT $1
            `,
            [limit]
        );

        const rows = result.rows.map((row) => ({
            'Date de début': row['Date de début'],
            'Date de fin': row['Date de fin'],
            'Organisme': row.Organisme,
            'code zas': row['code zas'],
            'Zas': row.Zas,
            'code site': row['code site'],
            'nom site': row['nom site'],
            "type d'implantation": row["type d'implantation"],
            'Polluant': row.Polluant,
            "type d'influence": row["type d'influence"],
            'discriminant': row.discriminant,
            'Réglementaire': row['Réglementaire'],
            "type d'evaluation": row["type d'evaluation"],
            'procédure de mesure': row['procédure de mesure'],
            'type de valeur': row['type de valeur'],
            'valeur': row.valeur,
            'valeur brute': row['valeur brute'],
            'unité de mesure': row['unité de mesure'],
            'taux de saisie': row['taux de saisie'],
            'couverture temporelle': row['couverture temporelle'],
            'couverture de données': row['couverture de données'],
            'code qualité': row['code qualité'],
            'validité': row['validité'],
            'Latitude': row.Latitude,
            'Longitude': row.Longitude
        }));
        const updatedAt = result.rows[0] ? result.rows[0].fetched_at : null;

        res.json({
            updatedAt,
            count: rows.length,
            rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use(express.static(path.join(__dirname, 'front')));

app.listen(port, () => {
    console.log(`Serveur en ecoute: http://localhost:${port}`);
});
