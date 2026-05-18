// app/api/flights/route.ts
import { NextResponse } from 'next/server';

const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';

// Mock podaci za fallback (nekoliko primjera)
const MOCK_FLIGHTS = [
  {
    KompanijaNaziv: "Air Serbia",
    Kompanija: "JU",
    BrojLeta: "112",
    IATA: "BEG",
    Grad: "Belgrade",
    TipLeta: "O",
    Status: "A03SCH",
    Planirano: "0930",
    Predvidjeno: "0930",
    Aktuelno: "",
    Gate: "2",
    CheckIn: "1-4"
  },
  {
    KompanijaNaziv: "Ryanair",
    Kompanija: "FR",
    BrojLeta: "1234",
    IATA: "STN",
    Grad: "London Stansted",
    TipLeta: "O",
    Status: "A03SCH",
    Planirano: "1045",
    Predvidjeno: "1045",
    Aktuelno: "",
    Gate: "3",
    CheckIn: "5-8"
  },
  {
    KompanijaNaziv: "Turkish Airlines",
    Kompanija: "TK",
    BrojLeta: "733",
    IATA: "IST",
    Grad: "Istanbul",
    TipLeta: "I",
    Status: "A04EXP",
    Planirano: "1120",
    Predvidjeno: "1140",
    Aktuelno: "",
    Gate: "1"
  }
];

async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      // Važno: nemoj slati Origin header
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function GET() {
  console.log('🔄 API route: Fetching flights...');
  
  // Pokušaj 1: Direktan fetch
  try {
    const response = await fetchWithTimeout(FLIGHT_API_URL, 8000);
    
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        console.log(`✅ API route: Fetched ${data.length} flights`);
        return NextResponse.json(data, {
          headers: {
            'Cache-Control': 'public, s-maxage=30',
            'X-Source': 'live'
          }
        });
      }
    }
  } catch (error) {
    console.error('❌ API route: Direct fetch failed:', error instanceof Error ? error.message : error);
  }
  
  // Pokušaj 2: Pokušaj sa drugim user-agent-om
  try {
    const response = await fetch(FLIGHT_API_URL, {
      headers: {
        'User-Agent': 'curl/7.68.0',
        'Accept': 'application/json',
      },
      next: { revalidate: 30 }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        console.log(`✅ API route: Fetched with curl UA: ${data.length} flights`);
        return NextResponse.json(data, {
          headers: { 'X-Source': 'live-curl' }
        });
      }
    }
  } catch (error) {
    console.error('❌ API route: Curl UA fetch failed:', error instanceof Error ? error.message : error);
  }
  
  // Pokušaj 3: Vrati mock podatke umjesto praznog niza
  console.log('⚠️ API route: Using mock flight data');
  return NextResponse.json(MOCK_FLIGHTS, {
    headers: {
      'Cache-Control': 'no-cache',
      'X-Source': 'mock',
      'X-Warning': 'Using mock data - live API unavailable'
    }
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 30;