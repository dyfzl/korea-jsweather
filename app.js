// --- Constants & Global Variables ---
const API_ENDPOINT = '/api/weather'; // Vercel Function Endpoint
const CACHE_KEY_DATA = 'weather_data';
const CACHE_KEY_TIME = 'weather_timestamp';
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

const elements = {
    loadingScreen: document.getElementById('loading-screen'),
    cityName: document.getElementById('city-name'),
    date: document.getElementById('current-date'),
    temp: document.getElementById('temperature'),
    desc: document.getElementById('weather-description'),
    pop: document.getElementById('pop-value'),
    reh: document.getElementById('reh-value'),
    wsd: document.getElementById('wsd-value'),
    imageContainer: document.getElementById('weather-image-placeholder'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
    updateDate();
    
    // Check Cache
    const cachedData = getCachedWeather();
    if (cachedData) {
        console.log("Using cached data");
        updateUI(cachedData);
        hideLoading();
        return;
    }

    // If no cache, fetch location then data
    try {
        const position = await getCurrentPosition();
        const { latitude, longitude } = position.coords;
        
        // Convert to Grid
        const grid = dfs_xy_conv("toXY", latitude, longitude);
        console.log(`Grid Coordinates: X=${grid.x}, Y=${grid.y}`);

        // Fetch Weather Data via Proxy
        const weatherData = await fetchWeatherData(grid.x, grid.y, latitude, longitude);
        
        // Cache and Update
        saveToCache(weatherData);
        updateUI(weatherData);
    } catch (error) {
        console.error("Initialization Error:", error);
        elements.cityName.textContent = "위치 확인 실패";
        elements.desc.textContent = "날씨 정보를 가져올 수 없습니다.";
        alert(`오류 발생: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// --- Logic ---

function updateDate() {
    const now = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    elements.date.textContent = now.toLocaleDateString('ko-KR', options);
}

function getCachedWeather() {
    const cachedTime = localStorage.getItem(CACHE_KEY_TIME);
    const cachedData = localStorage.getItem(CACHE_KEY_DATA);

    if (!cachedTime || !cachedData) return null;

    const now = Date.now();
    if (now - parseInt(cachedTime) < CACHE_DURATION) {
        return JSON.parse(cachedData);
    } else {
        localStorage.removeItem(CACHE_KEY_DATA); // Clean up old cache
        localStorage.removeItem(CACHE_KEY_TIME);
        return null;
    }
}

function saveToCache(data) {
    localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(data));
    localStorage.setItem(CACHE_KEY_TIME, Date.now().toString());
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported by your browser"));
        } else {
            navigator.geolocation.getCurrentPosition(resolve, reject);
        }
    });
}

async function fetchWeatherData(nx, ny, lat, lon) {
    // We send lat/lon to proxy so it can handle reverse geocoding if needed, 
    // BUT primarily we need to send nx, ny for KMA. 
    // Let's send all to be safe and versatile.
    const url = `${API_ENDPOINT}?nx=${nx}&ny=${ny}&lat=${lat}&lon=${lon}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API Request Failed: ${response.status}`);
    }
    return await response.json();
}

function updateUI(data) {
    if (!data) return;

    // Location Name (from API reverse geocoding or fallback)
    elements.cityName.textContent = data.locationName || "내 위치";

    // Weather Data (Parsing based on KMA codes)
    // Structure expected from Proxy: { TMP, PTY, SKY, POP, REH, WSD, ... }
    const temp = data.TMP; // Temperature
    const sky = data.SKY; // Sky code
    const pty = data.PTY; // Precipitation type code
    
    elements.temp.textContent = temp;
    elements.pop.textContent = `${data.POP}%`;
    elements.reh.textContent = `${data.REH}%`;
    elements.wsd.textContent = `${data.WSD} m/s`;

    // Determine Logic for Text & Image
    const weatherState = determineWeatherState(sky, pty);
    elements.desc.textContent = weatherState.text;
    
    // Image Handling
    const img = document.createElement('img');
    img.src = weatherState.imageUrl || 'https://images.unsplash.com/photo-1592210454132-3286288f3eeb?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80'; // Default Fallback
    img.alt = weatherState.text;
    
    elements.imageContainer.innerHTML = ''; // Clear skeleton
    elements.imageContainer.appendChild(img);
}

function determineWeatherState(sky, pty) {
    // PTY: 0:None, 1:Rain, 2:Rain/Snow, 3:Snow, 4:Shower
    // SKY: 1:Clear, 3:Cloudy, 4:Overcast
    
    let text = "맑음";
    let imageUrl = "skyblue.jpg"; // Placeholder, user said they will provide images, using simple logical names or placeholders

    // Priority: Precipitation > Sky
    if (pty > 0) {
        switch(parseInt(pty)) {
            case 1: text = "비"; break;
            case 2: text = "비/눈"; break;
            case 3: text = "눈"; break;
            case 4: text = "소나기"; break;
        }
    } else {
        switch(parseInt(sky)) {
            case 1: text = "맑음"; break;
            case 3: text = "구름 많음"; break;
            case 4: text = "흐림"; break;
        }
    }

    return { text, imageUrl: `images/${text}.jpg` }; // Assuming user will put images in 'images/' folder with these names
}

function hideLoading() {
    elements.loadingScreen.classList.add('hidden');
    setTimeout(() => {
        elements.loadingScreen.style.display = 'none';
        elements.cityName.textContent === "위치 확인 중..." ? elements.cityName.textContent = "위치 데이터 없음" : null;
    }, 500);
}


// --- Helper: Coordinate Conversion (KMA Provided Logic) ---
// LCC DFS Coordinates Transformation (Standard KMA Algorithm)
function dfs_xy_conv(code, v1, v2) {
    var RE = 6371.00877; // Earth Radius (km)
    var GRID = 5.0; // Grid Size (km)
    var SLAT1 = 30.0;
    var SLAT2 = 60.0;
    var OLON = 126.0;
    var OLAT = 38.0;
    var XO = 43;
    var YO = 136;
    
    var DEGRAD = Math.PI / 180.0;
    var RADDEG = 180.0 / Math.PI;

    var re = RE / GRID;
    var slat1 = SLAT1 * DEGRAD;
    var slat2 = SLAT2 * DEGRAD;
    var olon = OLON * DEGRAD;
    var olat = OLAT * DEGRAD;

    var sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    var sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
    var ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = re * sf / Math.pow(ro, sn);
    var rs = {};
    if (code == "toXY") {
        rs['lat'] = v1;
        rs['lng'] = v2;
        var ra = Math.tan(Math.PI * 0.25 + (v1) * DEGRAD * 0.5);
        ra = re * sf / Math.pow(ra, sn);
        var theta = v2 * DEGRAD - olon;
        if (theta > Math.PI) theta -= 2.0 * Math.PI;
        if (theta < -Math.PI) theta += 2.0 * Math.PI;
        theta *= sn;
        rs['x'] = Math.floor(ra * Math.sin(theta) + XO + 0.5);
        rs['y'] = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
    }
    else {
        rs['x'] = v1;
        rs['y'] = v2;
        var xn = v1 - XO;
        var yn = ro - v2 + YO;
        var ra = Math.sqrt(xn * xn + yn * yn);
        if (sn < 0.0) - ra;
        var alat = Math.pow((re * sf / ra), (1.0 / sn));
        alat = 2.0 * Math.atan(alat) - Math.PI * 0.5;

        var theta = 0.0;
        if (Math.abs(xn) <= 0.0) {
            theta = 0.0;
        }
        else {
            if (Math.abs(yn) <= 0.0) {
                theta = Math.PI * 0.5;
                if (xn < 0.0) - theta;
            }
            else theta = Math.atan2(xn, yn);
        }
        var alon = theta / sn + olon;
        rs['lat'] = alat * RADDEG;
        rs['lng'] = alon * RADDEG;
    }
    return rs;
}
