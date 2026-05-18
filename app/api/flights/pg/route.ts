// app/api/flights/route.ts
import { NextResponse } from 'next/server';

const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=pg';

// Mock podaci za fallback (prilagođeni novom formatu)
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

// Helper: Extract HHMM from ISO datetime string (e.g., "2026-05-18T09:30:00+02:00" → "0930")
function extractHHMM(isoString: string | null): string {
  if (!isoString) return '';
  const match = isoString.match(/T(\d{2}):(\d{2}):/);
  if (match) {
    return match[1] + match[2];
  }
  return '';
}

// Helper: Determine our status code
function mapStatus(flight: any): string {
  const statusId = flight.StatusID || '';
  const actualDateTime = flight.ActualDateTime;
  const flightType = flight.FlightType;
  const scheduled = flight.ScheduledDateTime;
  const estimated = flight.EstimatedDateTime;

  if (statusId.toLowerCase().includes('arrived')) {
    return 'A07ARR';
  }
  if (statusId.toLowerCase().includes('departed')) {
    return 'A09DEP';
  }
  // If we have actual time but status not set
  if (actualDateTime) {
    if (flightType === 'Arrival') return 'A07ARR';
    if (flightType === 'Departure') return 'A09DEP';
  }
  // Check for delay if estimated > scheduled
  if (scheduled && estimated) {
    const schMinutes = parseInt(extractHHMM(scheduled).slice(0,2)) * 60 + parseInt(extractHHMM(scheduled).slice(2));
    const estMinutes = parseInt(extractHHMM(estimated).slice(0,2)) * 60 + parseInt(extractHHMM(estimated).slice(2));
    if (estMinutes > schMinutes) {
      return 'A05DLY';
    }
  }
  return 'A03SCH';
}

// Helper: Map airline names to shorter versions for TTS
function mapAirlineName(original: string): string {
  if (!original) return '';
  if (original === 'Pegasus Hava Tasimaciligi A.S.') {
    return 'Pegasus';
  }
  // Add other mappings here if needed
  return original;
}

// Helper: Fix duplicated airline code in flight number (e.g., "FRFR4812" -> "FR4812", "LOLO586" -> "LO586", "FHFH9430" -> "FH9430")
function fixFlightNumber(flightNumber: string): string {
  if (!flightNumber || flightNumber.length < 4) return flightNumber;
  // Generic: if the first two characters equal the next two characters, remove the first two
  const firstTwo = flightNumber.substring(0, 2);
  const secondTwo = flightNumber.substring(2, 4);
  if (firstTwo === secondTwo) {
    return flightNumber.substring(2);
  }
  return flightNumber;
}

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
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function GET() {
  console.log('🔄 API route: Fetching flights from Podgorica airport...');
  
  try {
    const response = await fetchWithTimeout(FLIGHT_API_URL, 8000);
    
    if (response.ok) {
      const rawData = await response.json();
      let flightsArray = rawData.value || (Array.isArray(rawData) ? rawData : []);
      
      if (flightsArray.length > 0) {
        const transformedFlights = flightsArray.map((item: any) => {
          // Extract airline code from original flight number (first two letters)
          let airlineCode = '';
          const originalFlightNumber = item.FlightNumberIATA || '';
          const match = originalFlightNumber.match(/^([A-Z]{2})/);
          if (match) airlineCode = match[1];
          
          // Fix possible duplicated code (e.g., "FRFR4812" -> "FR4812")
          let flightNumber = fixFlightNumber(originalFlightNumber);
          
          // Map airline name (e.g., Pegasus)
          const airlineName = mapAirlineName(item.Airline || '');
          
          return {
            KompanijaNaziv: airlineName,
            Kompanija: airlineCode,
            BrojLeta: flightNumber,
            IATA: '',
            Grad: item.Airport || '',
            TipLeta: item.FlightType === 'Departure' ? 'O' : 'I',
            Status: mapStatus(item),
            Planirano: extractHHMM(item.ScheduledDateTime),
            Predvidjeno: extractHHMM(item.EstimatedDateTime),
            Aktuelno: extractHHMM(item.ActualDateTime),
            Gate: (item.Gates && item.Gates.length > 0) ? item.Gates[0] : '',
            CheckIn: (item.Checkins && item.Checkins.length > 0) ? item.Checkins.join(',') : '',
          };
        });
        
        console.log(`✅ API route: Fetched ${transformedFlights.length} flights`);
        return NextResponse.json(transformedFlights, {
          headers: {
            'Cache-Control': 'public, s-maxage=30',
            'X-Source': 'live'
          }
        });
      }
    }
  } catch (error) {
    console.error('❌ API route: Fetch failed:', error instanceof Error ? error.message : error);
  }
  
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