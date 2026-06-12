import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

const API_KEY = process.env.REACT_APP_API_KEY;
const BASE = 'https://api.openweathermap.org/data/2.5';

const BG_MAP = {
  Clear:        'sky-clear',
  Clouds:       'sky-clouds',
  Rain:         'sky-rain',
  Drizzle:      'sky-drizzle',
  Thunderstorm: 'sky-storm',
  Snow:         'sky-snow',
  Mist:         'sky-mist',
  Fog:          'sky-mist',
  Haze:         'sky-mist',
};

const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
const windDir = (deg) => WIND_DIRS[Math.round(deg / 45) % 8];

const fmtTime = (unix, offset) => {
  const d = new Date((unix + offset) * 1000);
  return d.toUTCString().slice(17, 22);
};

const fmtLocalTime = (offset) => {
  const nowUtc = Math.floor(Date.now() / 1000);
  return fmtTime(nowUtc, offset);
};

const fmtDate = (offset) => {
  const nowUtc = Math.floor(Date.now() / 1000);
  const cityMs = (nowUtc + offset) * 1000;
  const d = new Date(cityMs);
  return d.toUTCString().slice(0, 16).replace(
    /(\w+), (\d+) (\w+) (\d+)/,
    (_, wd, day, mon) => `${wd}, ${day} ${mon}`
  );
};

const dayName = (dt) =>
  new Date(dt * 1000).toLocaleDateString('en-US', { weekday: 'short' });

const AQI_LABEL = ['', 'Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'];
const AQI_CLASS = ['', 'aqi-good', 'aqi-fair', 'aqi-moderate', 'aqi-poor', 'aqi-verypoor'];

export default function App() {
  const [query, setQuery]         = useState('');
  const [weather, setWeather]     = useState(null);
  const [forecast, setForecast]   = useState([]);
  const [hourly, setHourly]       = useState([]);
  const [aqi, setAqi]             = useState(null);
  const [unit, setUnit]           = useState('metric');
  const [sky, setSky]             = useState('sky-default');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [history, setHistory]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('wx-history') || '[]'); } catch { return []; }
  });
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wx-favs') || '[]'); } catch { return []; }
  });
  const [showDrop, setShowDrop]   = useState(false);
  const [tab, setTab]             = useState('today');
  const [offline, setOffline]     = useState(!navigator.onLine);
  const inputRef = useRef(null);
  const cacheRef = useRef({});

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const saveHistory = useCallback((city) => {
    setHistory(prev => {
      const next = [city, ...prev.filter(c => c.toLowerCase() !== city.toLowerCase())].slice(0, 6);
      localStorage.setItem('wx-history', JSON.stringify(next));
      return next;
    });
  }, []);

  const removeHistory = useCallback((city, e) => {
    e.stopPropagation();
    setHistory(prev => {
      const next = prev.filter(c => c !== city);
      localStorage.setItem('wx-history', JSON.stringify(next));
      return next;
    });
  }, []);

  const removeFav = useCallback((city, e) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.filter(f => f !== city);
      localStorage.setItem('wx-favs', JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchWeather = useCallback(async (cityName, u) => {
    const city  = cityName || query;
    const units = u || unit;
    if (!city.trim()) { inputRef.current?.focus(); return; }
    if (offline) { setError('You appear to be offline.'); return; }

    // ── Cache check (5 min TTL) ──
    const cacheKey = `${city.toLowerCase()}_${units}`;
    const cached   = cacheRef.current[cacheKey];
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      const { wData, fData, aqiVal } = cached;
      setWeather(wData);
      setSky(BG_MAP[wData.weather[0].main] || 'sky-default');
      setHourly(fData.list.slice(0, 8));
      setForecast(fData.list.filter(i => i.dt_txt.includes('12:00:00')).slice(0, 5));
      setAqi(aqiVal);
      setQuery(wData.name);
      setError('');
      setShowDrop(false);
      return;
    }

    setLoading(true);
    setError('');
    setShowDrop(false);

    try {
      const [wRes, fRes] = await Promise.all([
        fetch(`${BASE}/weather?q=${city}&appid=${API_KEY}&units=${units}`),
        fetch(`${BASE}/forecast?q=${city}&appid=${API_KEY}&units=${units}&cnt=40`),
      ]);
      const wData = await wRes.json();
      const fData = await fRes.json();

      if (wData.cod !== 200) {
        setError(wData.message || 'City not found. Check spelling and try again.');
        setWeather(null); setForecast([]); setHourly([]); setAqi(null);
        setSky('sky-default');
      } else {
        let aqiVal = null;
        try {
          const { coord } = wData;
          const aqiRes = await fetch(`${BASE}/air_pollution?lat=${coord.lat}&lon=${coord.lon}&appid=${API_KEY}`);
          const aqiData = await aqiRes.json();
          aqiVal = aqiData.list?.[0]?.main?.aqi ?? null;
        } catch {}

        // Store in cache
        cacheRef.current[cacheKey] = { wData, fData, aqiVal, ts: Date.now() };

        setWeather(wData);
        setSky(BG_MAP[wData.weather[0].main] || 'sky-default');
        saveHistory(wData.name);
        setHourly(fData.list.slice(0, 8));
        setForecast(fData.list.filter(i => i.dt_txt.includes('12:00:00')).slice(0, 5));
        setAqi(aqiVal);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  }, [query, unit, offline, saveHistory]);

  const toggleUnit = () => {
    const u = unit === 'metric' ? 'imperial' : 'metric';
    setUnit(u);
    if (weather) fetchWeather(weather.name, u);
  };

  const toggleFav = () => {
    if (!weather) return;
    const name = weather.name;
    setFavorites(prev => {
      const next = prev.includes(name) ? prev.filter(f => f !== name) : [name, ...prev];
      localStorage.setItem('wx-favs', JSON.stringify(next));
      return next;
    });
  };

  // ── FIX: Geolocation – pass name directly, no state dependency ──
  const geoLocate = () => {
    if (!navigator.geolocation) return;
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const r = await fetch(
            `${BASE}/weather?lat=${coords.latitude}&lon=${coords.longitude}&appid=${API_KEY}&units=${unit}`
          );
          const d = await r.json();
          if (d.name) {
            setQuery(d.name);
            fetchWeather(d.name, unit); // pass name directly — no race condition
          } else {
            setLoading(false);
          }
        } catch {
          setError('Could not get location weather.');
          setLoading(false);
        }
      },
      () => { setError('Location access denied.'); setLoading(false); }
    );
  };

  const tempUnit = unit === 'metric' ? '°C' : '°F';
  const windUnit = unit === 'metric' ? 'm/s' : 'mph';
  const isFav    = weather && favorites.includes(weather.name);
  const hasDrop  = showDrop && (history.length > 0 || favorites.length > 0);

  return (
    <div className={`app ${sky}`}>
      <div className="app-inner">

        {/* HEADER */}
        <header className="header">
          <span className="brand-name">Skycast</span>
          <div className="header-right">
            <button className="ctrl-btn" onClick={geoLocate} title="Use my location" aria-label="Use my location">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
            </button>
            {/* FIX: Unit button now shows active unit clearly */}
            <button className="unit-btn" onClick={toggleUnit} aria-label={`Switch to ${unit === 'metric' ? 'Fahrenheit' : 'Celsius'}`}>
              <span className="unit-active">{unit === 'metric' ? '°C' : '°F'}</span>
              <span className="unit-sep">·</span>
              <span className="unit-inactive">{unit === 'metric' ? '°F' : '°C'}</span>
            </button>
          </div>
        </header>

        {offline && (
          <div className="banner-warn" role="alert">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            You're offline
          </div>
        )}

        {/* SEARCH */}
        <div className="search-outer">
          <div className="search-box">
            <svg className="s-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={inputRef}
              className="s-input"
              type="text"
              placeholder="Search city…"
              value={query}
              autoComplete="off"
              aria-label="Search city"
              onChange={e => { setQuery(e.target.value); if (e.target.value === '') setShowDrop(true); }}
              onFocus={() => { if (query === '') setShowDrop(true); }}
              onBlur={() => setTimeout(() => setShowDrop(false), 160)}
              onKeyDown={e => {
                if (e.key === 'Enter') fetchWeather();
                if (e.key === 'Escape') setShowDrop(false);
              }}
            />
            {query && (
              <button className="s-clear" onClick={() => { setQuery(''); setShowDrop(true); inputRef.current?.focus(); }} aria-label="Clear search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
            <button className="s-btn" onClick={() => fetchWeather()} disabled={loading} aria-label="Search weather">
              {loading ? <span className="spin" role="status" aria-label="Loading"/> : 'Search'}
            </button>
          </div>

          {/* DROPDOWN with keyboard nav + delete buttons */}
          {hasDrop && (
            <div className="dropdown" role="listbox" aria-label="Search suggestions">
              {favorites.length > 0 && (
                <div className="drop-group">
                  <span className="drop-label">Favorites</span>
                  {favorites.map(c => (
                    <button key={c} className="drop-item" role="option"
                      onMouseDown={() => { setQuery(c); fetchWeather(c, unit); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="ico-fav" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      <span className="drop-name">{c}</span>
                      <span className="drop-del" onMouseDown={(e) => removeFav(c, e)} aria-label={`Remove ${c} from favorites`} role="button" tabIndex={0}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {history.length > 0 && (
                <div className="drop-group">
                  <span className="drop-label">Recent</span>
                  {history.map(c => (
                    <button key={c} className="drop-item" role="option"
                      onMouseDown={() => { setQuery(c); fetchWeather(c, unit); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span className="drop-name">{c}</span>
                      <span className="drop-del" onMouseDown={(e) => removeHistory(c, e)} aria-label={`Remove ${c} from history`} role="button" tabIndex={0}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ERROR */}
        {error && !loading && (
          <div className="banner-error" role="alert">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
            <button className="retry-btn" onClick={() => fetchWeather()}>Retry</button>
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div className="loading-wrap" role="status" aria-live="polite">
            <div className="loading-dots" aria-hidden="true"><span/><span/><span/></div>
            <p>Fetching weather…</p>
          </div>
        )}

        {/* WEATHER */}
        {weather && !loading && (
          <div className="content">

            <div className="hero">
              <div className="hero-head">
                <div>
                  <h1 className="hero-city">
                    {weather.name}
                    <span className="hero-country">{weather.sys.country}</span>
                  </h1>
                  <p className="hero-date">{fmtDate(weather.timezone)} · {fmtLocalTime(weather.timezone)}</p>
                </div>
                <button className={`fav-btn${isFav ? ' fav-on' : ''}`} onClick={toggleFav}
                  aria-label={isFav ? `Remove ${weather.name} from favorites` : `Add ${weather.name} to favorites`}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>
              </div>

              <div className="hero-body">
                <img src={`https://openweathermap.org/img/wn/${weather.weather[0].icon}@4x.png`}
                  alt={weather.weather[0].description} className="hero-wxicon"/>
                <div>
                  <div className="hero-temp">{Math.round(weather.main.temp)}{tempUnit}</div>
                  <div className="hero-cond">{weather.weather[0].description}</div>
                  <div className="hero-range">H {Math.round(weather.main.temp_max)}{tempUnit} · L {Math.round(weather.main.temp_min)}{tempUnit}</div>
                  <div className="hero-feels">Feels like {Math.round(weather.main.feels_like)}{tempUnit}</div>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 2v6M12 22v-4M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
                  <span className="stat-val">{weather.main.humidity}%</span>
                  <span className="stat-lbl">Humidity</span>
                </div>
                <div className="stat">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>
                  <span className="stat-val">{weather.wind.speed} {windUnit}</span>
                  <span className="stat-lbl">Wind · {windDir(weather.wind.deg)}</span>
                </div>
                <div className="stat">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span className="stat-val">{(weather.visibility / 1000).toFixed(1)} km</span>
                  <span className="stat-lbl">Visibility</span>
                </div>
                <div className="stat">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span className="stat-val">{weather.main.pressure} hPa</span>
                  <span className="stat-lbl">Pressure</span>
                </div>
                <div className="stat">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  <span className="stat-val">{weather.clouds?.all ?? '—'}%</span>
                  <span className="stat-lbl">Cloud Cover</span>
                </div>
                {aqi && (
                  <div className="stat">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 12h18M3 6l9-4 9 4M3 18l9 4 9-4"/></svg>
                    <span className={`stat-val ${AQI_CLASS[aqi]}`}>{AQI_LABEL[aqi]}</span>
                    <span className="stat-lbl">Air Quality</span>
                  </div>
                )}
                {weather.rain?.['1h'] != null && (
                  <div className="stat">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="8" y1="19" x2="8" y2="21"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="16" y1="19" x2="16" y2="21"/><line x1="16" y1="13" x2="16" y2="15"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="12" y1="15" x2="12" y2="17"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>
                    <span className="stat-val">{weather.rain['1h'].toFixed(1)} mm</span>
                    <span className="stat-lbl">Rain (1h)</span>
                  </div>
                )}
                {weather.snow?.['1h'] != null && (
                  <div className="stat">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 6-8 4-8-4m0 8 8 4 8-4"/></svg>
                    <span className="stat-val">{weather.snow['1h'].toFixed(1)} mm</span>
                    <span className="stat-lbl">Snow (1h)</span>
                  </div>
                )}
              </div>

              <div className="sun-bar">
                <div className="sun-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  <span>Sunrise</span>
                  <strong>{fmtTime(weather.sys.sunrise, weather.timezone)}</strong>
                </div>
                <div className="sun-line"/>
                <div className="sun-arc"><div className="sun-dot"/></div>
                <div className="sun-line"/>
                <div className="sun-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>
                  <span>Sunset</span>
                  <strong>{fmtTime(weather.sys.sunset, weather.timezone)}</strong>
                </div>
              </div>
            </div>

            <div className="tab-bar" role="tablist">
              {[['today','Today (24h)'],['forecast','5-Day Forecast']].map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key}
                  className={`tab-btn${tab === key ? ' tab-active' : ''}`}
                  onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>

            {tab === 'today' && (
              <div className="hourly-track" role="tabpanel" aria-label="Hourly forecast">
                {hourly.map((h, i) => (
                  <div className="hour-chip" key={i}>
                    <span className="hc-time">{h.dt_txt.slice(11, 16)}</span>
                    <img src={`https://openweathermap.org/img/wn/${h.weather[0].icon}@2x.png`}
                      alt={h.weather[0].description} className="hc-icon"/>
                    <span className="hc-temp">{Math.round(h.main.temp)}{tempUnit}</span>
                    {h.pop > 0 && <span className="hc-pop">{Math.round(h.pop * 100)}%</span>}
                  </div>
                ))}
              </div>
            )}

            {tab === 'forecast' && (
              <div className="fc-list" role="tabpanel" aria-label="5-day forecast">
                {forecast.map((d, i) => (
                  <div className="fc-row" key={i}>
                    <span className="fc-day">{dayName(d.dt)}</span>
                    <img src={`https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png`}
                      alt={d.weather[0].description} className="fc-icon"/>
                    <span className="fc-cond">{d.weather[0].main}</span>
                    {d.pop > 0 && <span className="fc-pop">{Math.round(d.pop * 100)}% rain</span>}
                    <div className="fc-temps">
                      <span className="fc-hi">{Math.round(d.main.temp_max)}{tempUnit}</span>
                      <span className="fc-lo">{Math.round(d.main.temp_min)}{tempUnit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!weather && !loading && !error && (
          <div className="empty-state" aria-label="No city searched yet">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <p className="es-title">Search any city</p>
            <p className="es-sub">Live weather · Hourly forecast · Air quality</p>
          </div>
        )}

      </div>
    </div>
  );
}