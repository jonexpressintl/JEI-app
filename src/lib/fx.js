// Fetch live USD exchange rates from a free API (no key needed).
// Returns { usd_idr, usd_sgd, sgd_idr, timestamp }
// Falls back to stored rates on failure.

const CACHE_KEY = "jei_fx_cache";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchLiveRates() {
  // Check memory cache first
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error("API error");
    const json = await res.json();
    const rates = json.rates;
    const result = {
      usd_idr: Math.round(rates.IDR),
      usd_sgd: +(rates.SGD).toFixed(4),
      sgd_idr: Math.round(rates.IDR / rates.SGD),
      timestamp: json.time_last_update_utc || new Date().toISOString(),
      live: true,
    };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: result, ts: Date.now() })); } catch {}
    return result;
  } catch (err) {
    console.warn("FX fetch failed, using fallback:", err);
    return { usd_idr: 15850, usd_sgd: 1.34, sgd_idr: 11900, timestamp: null, live: false };
  }
}
