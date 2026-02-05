export default async function handler(req, res) {
    const { nx, ny, lat, lon } = req.query;

    if (!nx || !ny) {
        return res.status(400).json({ error: 'Missing coordinates (nx, ny)' });
    }

    const API_KEY = process.env.KMA_API_KEY; // Managed in Vercel Dashboard
    
    // Debug Logging
    console.log("Loaded Env Keys:", Object.keys(process.env));

    if (!API_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: KMA_API_KEY is missing." });
    }
    
    // 1. Calculate Base Date & Time
    const now = new Date();
    // KMA API provides data based on: 02, 05, 08, 11, 14, 17, 20, 23
    // We need to look back to the nearest past base_time.
    // However, data is available 10 mins after base_time.
    
    // Adjust for KST (Korea Standard Time) if server is UTC
    // Vercel server might be UTC. Let's force KST conversion.
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset); // Basic offset handling for calculation
    
    // Logic to find nearest base_time
    // 02:10, 05:10, 08:10, 11:10, 14:10, 17:10, 20:10, 23:10 are API ready times.
    
    let baseDate = getFormatDate(kstDate);
    let baseTime = getBaseTime(kstDate);

    // If calculation pushed us back to previous day (e.g., 00:30 requesting 23:00 of prev day)
    if (baseTime === '2300' && kstDate.getHours() < 2) {
         const yesterday = new Date(kstDate);
         yesterday.setDate(yesterday.getDate() - 1);
         baseDate = getFormatDate(yesterday);
    }

    const type = 'json';
    const apiUrl = `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst`;
    
    // KMA API needs ServiceKey (decoded usually works best in URL params for public data portal)
    // IMPORTANT: In Vercel, usage of encoded key often safer, or decoding it.
    // Try sending with `serviceKey` query param.
    
    // KMA API needs ServiceKey.
    // Smart Handling: Check if user provided Encoded or Decoded key.
    let serviceKey = API_KEY;
    if (API_KEY.indexOf('%') === -1) {
        // No % found, likely Decoded key. We must encode it.
        serviceKey = encodeURIComponent(API_KEY);
    }
    // If % found, assume it is already Encoded (common from portal), usage is safe.

    const queryParams = new URLSearchParams({
        pageNo: '1',
        numOfRows: '1000',
        dataType: type,
        base_date: baseDate,
        base_time: baseTime,
        nx: nx,
        ny: ny
    }).toString();

    // Append serviceKey manually
    const requestUrl = `${apiUrl}?serviceKey=${serviceKey}&${queryParams}`;
    console.log(`Requesting KMA API: ${baseDate} ${baseTime} (${nx}, ${ny})`);

    try {
        const apiRes = await fetch(requestUrl);
        const data = await apiRes.json();

        if (data.response.header.resultCode !== '00') {
            throw new Error(`KMA API Error: ${data.response.header.resultMsg}`);
        }

        const items = data.response.body.items.item;
        const processedData = parseForecastData(items, kstDate);

        // 2. Get Location Name (Reverse Geocoding)
        // KMA doesn't provide city name. We use OpenStreetMap (Nominatim) as a free fallback.
        try {
             if (lat && lon) {
                 const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=ko`);
                 const geoData = await geoRes.json();
                 // prioritizing city > county > district
                 processedData.locationName = geoData.address.city || geoData.address.county || geoData.address.borough || "알 수 없는 위치";
             }
        } catch (geoError) {
            console.error("Geo Error:", geoError);
            processedData.locationName = "위치 정보 없음";
        }

        res.status(200).json(processedData);

    } catch (error) {
        console.error("Vercel Function Error Details:", error);
        res.status(500).json({ 
            error: "Internal Server Error", 
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
        });
    }
}

// --- Helpers ---

function getFormatDate(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function getBaseTime(date) {
    // Base times: 02, 05, 08, 11, 14, 17, 20, 23
    // API available ~10 mins after.
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    
    // If it's 02:05, we can't use 02:00 data yet (available 02:10). We must go back to 23:00 of prev day.
    // Safe margin: 15 mins.
    
    const currentTotalMinutes = hour * 60 + minute;
    
    const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
    let selectedBaseHour = 23; // Default to prev day last base time

    for (let i = baseTimes.length - 1; i >= 0; i--) {
        const baseH = baseTimes[i];
        const baseTotalMinutes = baseH * 60 + 10; // Available at base_time + 10m
        
        if (currentTotalMinutes >= baseTotalMinutes) {
            selectedBaseHour = baseH;
            break;
        }
    }
    
    return String(selectedBaseHour).padStart(2, '0') + '00';
}

function parseForecastData(items, contextDate) {
    // We want the NEAREST future prediction. 
    // Usually items contains data starting from base_time + 4hrs? Or +1hr for Short Term?
    // VilageFcst (Short Term Forecast) provides +4~ hours usually?
    // Actually VilageFcst gives hourly data starting from +1hr usually.
    // Let's find the item closest to "current time".
    
    // We just want "current weather" effectively.
    // KMA "Ultra Short Term Live" (getUltraSrtNcst) might be better for "Current Weather", 
    // but user asked for "Short Term Forecast Codes" (SKY, PTY etc). 
    // Let's pick the earliest forecast time available in the list.
    
    // Sort logic not strictly needed if we assume list is ordered, but let's grab the first set of keys sharing the same fcstTime
    // Typically the first fcstDate/fcstTime appearing is the earliest prediction.
    
    if (!items || items.length === 0) return {};

    const targetTime = items[0].fcstTime;
    const targetDate = items[0].fcstDate;
    
    const result = {
        fcstDate: targetDate,
        fcstTime: targetTime
    };

    // Aggregate all categories for this specific time
    items.forEach(item => {
        if (item.fcstDate === targetDate && item.fcstTime === targetTime) {
            result[item.category] = item.fcstValue;
        }
    });

    return result;
}
