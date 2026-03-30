const statusElement = document.getElementById('status');

const map = L.map('map').setView([46.603354, 1.888334], 6);
const markersLayer = L.layerGroup().addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function getField(row, candidates) {
    const normalized = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value])
    );

    for (const candidate of candidates) {
        const value = normalized[candidate.toLowerCase()];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }

    return null;
}

function parseNumber(value) {
    if (value === null || value === undefined) {
        return NaN;
    }
    return Number(String(value).replace(',', '.').trim());
}

function extractCoordinates(row) {
    const lat = parseNumber(getField(row, ['latitude', 'lat', 'coord_y', 'y_wgs84', 'y']));
    const lon = parseNumber(getField(row, ['longitude', 'lon', 'lng', 'coord_x', 'x_wgs84', 'x']));

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
    }
    return null;
}

function buildPopup(row) {
    const station = getField(row, ['station', 'nom_station', 'site', 'id_station']) || 'Station inconnue';
    const value = getField(row, ['valeur', 'concentration', 'mesure']) || 'n/a';
    const unit = getField(row, ['unite', 'unit']) || '';
    const date = getField(row, ['date', 'date_mesure', 'datetime']) || 'date inconnue';

    return `
        <strong>${station}</strong><br>
        Valeur: ${value} ${unit}<br>
        Date: ${date}
    `;
}

async function loadData() {
    setStatus('Chargement des donnees...');

    try {
        const response = await fetch('./data/latest.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : (payload.rows || []);

        markersLayer.clearLayers();

        const bounds = [];
        let addedMarkers = 0;

        for (const row of rows) {
            const coords = extractCoordinates(row);
            if (!coords) {
                continue;
            }

            const marker = L.marker([coords.lat, coords.lon]).addTo(markersLayer);
            marker.bindPopup(buildPopup(row));
            bounds.push([coords.lat, coords.lon]);
            addedMarkers += 1;
        }

        if (addedMarkers > 0) {
            map.fitBounds(bounds, { padding: [30, 30] });
        }

        const updatedAt = payload && typeof payload === 'object' ? payload.updatedAt : null;
        const updatedSuffix = updatedAt ? ` (maj ${new Date(updatedAt).toLocaleString('fr-FR')})` : '';
        setStatus(`${addedMarkers} point(s) charge(s)${updatedSuffix}`);
    } catch (error) {
        setStatus('Impossible de charger data/latest.json. Lance d\'abord fetcher.js');
        console.error('Erreur de chargement de donnees:', error);
    }
}

loadData();