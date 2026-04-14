const map = L.map('map').setView([46.6033, 1.8883], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = L.markerClusterGroup();
map.addLayer(markers);

let allRows = [];

function getField(row, candidates) {
    const normalized = Object.fromEntries(
        Object.entries(row || {}).map(([k, v]) => [String(k).trim().toLowerCase(), v])
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

    const num = Number(String(value).replace(',', '.').trim());
    return Number.isFinite(num) ? num : NaN;
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function getCoordinates(row) {
    const lat = parseNumber(getField(row, ['lat', 'latitude', 'y', 'coord_y', 'y_wgs84']));
    const lon = parseNumber(getField(row, ['lon', 'lng', 'longitude', 'x', 'coord_x', 'x_wgs84']));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }

    return { lat, lon };
}

function getValue(row) {
    const value = parseNumber(getField(row, ['valeur', 'valeur brute', 'mesure', 'concentration']));
    return Number.isFinite(value) ? value : null;
}

function getDate(row) {
    const raw = String(getField(row, ['date de debut', 'date de fin', 'date']) || '').trim();
    if (!raw) {
        return null;
    }

    const date = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
}

function colorForValue(value) {
    if (value > 40) return '#e74c3c';
    if (value > 20) return '#f39c12';
    return '#27ae60';
}

function setStatus(message) {
    const status = document.getElementById('status');
    if (status) {
        status.innerHTML = message;
    }
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchRows() {
    try {
        const apiRows = await fetchJsonWithTimeout('http://127.0.0.1:8000/api/points');
        if (Array.isArray(apiRows)) {
            return { rows: apiRows, source: 'api' };
        }
    } catch (error) {
        console.warn('API Python indisponible, fallback local JSON.', error.message);
    }

    const payload = await fetchJsonWithTimeout('./data/latest.json');
    const rows = Array.isArray(payload) ? payload : (payload.rows || []);
    return { rows, source: 'local' };
}

function fillZones(rows) {
    const select = document.getElementById('zoneSelect');
    if (!select) {
        return;
    }

    select.innerHTML = '<option value="Toutes">-- Toutes les regions --</option>';

    const zones = new Set();
    for (const row of rows) {
        const zone = getField(row, ['zas']);
        if (zone) {
            zones.add(String(zone));
        }
    }

    Array.from(zones).sort((a, b) => a.localeCompare(b)).forEach((zone) => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        select.appendChild(option);
    });
}

function applyFilters(rows) {
    const site = normalizeText(document.getElementById('siteSearch')?.value);
    const start = document.getElementById('dateStart')?.value;
    const end = document.getElementById('dateEnd')?.value;
    const minVal = parseNumber(document.getElementById('minVal')?.value);
    const maxVal = parseNumber(document.getElementById('maxVal')?.value);
    const zone = document.getElementById('zoneSelect')?.value || 'Toutes';

    const startDate = start ? new Date(`${start}T00:00:00`) : null;
    const endDate = end ? new Date(`${end}T23:59:59`) : null;

    return rows.filter((row) => {
        const station = normalizeText(getField(row, ['nom site', 'station', 'site']) || '');
        const rowZone = String(getField(row, ['zas']) || '');
        const value = getValue(row);
        const rowDate = getDate(row);

        if (site && !station.includes(site)) return false;
        if (zone !== 'Toutes' && rowZone !== zone) return false;
        if (Number.isFinite(minVal) && value !== null && value < minVal) return false;
        if (Number.isFinite(maxVal) && value !== null && value > maxVal) return false;
        if (startDate && (!rowDate || rowDate < startDate)) return false;
        if (endDate && (!rowDate || rowDate > endDate)) return false;

        return true;
    });
}

function render(rows) {
    markers.clearLayers();

    const bounds = [];
    let count = 0;

    for (const row of rows) {
        const coords = getCoordinates(row);
        const value = getValue(row);

        if (!coords || value === null) {
            continue;
        }

        const color = colorForValue(value);
        const icon = L.divIcon({
            className: 'custom-div',
            html: `<div class="marker-index" style="background:${color};">${Math.round(value)}</div>`,
            iconSize: [35, 35],
            iconAnchor: [17, 17]
        });

        const marker = L.marker([coords.lat, coords.lon], { icon });
        marker.bindPopup(`
            <div style="font-family: sans-serif;">
                <h3 style="margin:0; color:#2c3e50;">${getField(row, ['nom site', 'station', 'site']) || 'Station inconnue'}</h3>
                <p style="margin:5px 0;"><b>Zone:</b> ${getField(row, ['zas']) || 'n/a'}</p>
                <p style="margin:5px 0;"><b>Valeur:</b> <span style="color:${color}; font-weight:bold;">${value} ug/m3</span></p>
                <p style="margin:5px 0; font-size:0.8em; color:gray;">Releve le: ${getField(row, ['date de debut', 'date']) || 'n/a'}</p>
            </div>
        `);

        markers.addLayer(marker);
        bounds.push([coords.lat, coords.lon]);
        count += 1;
    }

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [20, 20] });
    }

    setStatus(`<b>${count}</b> point(s) affiche(s)`);
}

async function loadData() {
    setStatus('Chargement...');

    try {
        const result = await fetchRows();
        allRows = result.rows;
        fillZones(allRows);
        render(applyFilters(allRows));

        const sourceLabel = result.source === 'api' ? 'API Python' : 'fichier local';
        setStatus(`${document.getElementById('status').innerHTML} - source: ${sourceLabel}`);
    } catch (error) {
        console.error(error);
        setStatus('<span style="color:#e74c3c">Erreur de chargement des donnees</span>');
    }
}

window.loadData = loadData;
loadData();
