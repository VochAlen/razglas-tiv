'use client';

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface StatusMeta {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

interface Flight {
  BrojLeta: string;
  IATA: string;
  KompanijaNaziv: string;
  Kompanija: string;
  Grad: string;
  TipLeta: string;
  Status: string;
  Planirano: string;
  Predvidjeno: string;
  Aktuelno: string;
  Gate?: string;
  CheckIn?: string;
}

interface LogEntryType {
  time: string;
  text: string;
  key: string;
}

interface QueueItem {
  text: string;
  voiceURI: string | null;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  A07ARR: { label: "Arrived",   color: "#00e676", bg: "rgba(0,230,118,0.12)",  icon: "▼" },
  A09DEP: { label: "Departed",  color: "#90caf9", bg: "rgba(144,202,249,0.12)", icon: "▲" },
  A03SCH: { label: "Scheduled", color: "#b0bec5", bg: "rgba(176,190,197,0.10)", icon: "○" },
  A04EXP: { label: "Expected",  color: "#fff176", bg: "rgba(255,241,118,0.10)", icon: "◔" },
  A05DLY: { label: "Delayed",   color: "#ff7043", bg: "rgba(255,112,67,0.13)",  icon: "!" },
  A06CNL: { label: "Cancelled", color: "#ef5350", bg: "rgba(239,83,80,0.13)",   icon: "✕" },
  A08DIV: { label: "Diverted",  color: "#ce93d8", bg: "rgba(206,147,216,0.13)", icon: "↩" },
  "-":    { label: "Scheduled", color: "#b0bec5", bg: "rgba(176,190,197,0.10)", icon: "○" },
  "":     { label: "Scheduled", color: "#b0bec5", bg: "rgba(176,190,197,0.10)", icon: "○" },
};

// ─── Konstante ────────────────────────────────────────────────────────────────
const HIDE_DEPARTED_AFTER_MINUTES = 15;
const HIDE_ARRIVED_AFTER_MINUTES  = 15;

// ─── Periodic Security Announcements (EN + HR) ────────────────────────────────
const SECURITY_MESSAGES_EN = [
  "Security announcement. Please do not leave your baggage unattended at any time. Unattended baggage will be removed and may be destroyed. Thank you for your cooperation.",
  "Security announcement. For the safety of all passengers, please report any suspicious items or behaviour to airport security staff immediately. Thank you.",
  "Security announcement. Please keep your baggage with you at all times. Any unattended items will be removed by security personnel. Thank you.",
];

const SECURITY_MESSAGES_HR = [
  "Bezbjedonosno obavještenje. Molimo vas da nikada ne ostavljate svoj prtljag bez nadzora. Prtljag bez nadzora bit će uklonjen i može biti uništen. Hvala na saradnji.",
  "Bezbjedonosno obavještenje. Radi sigurnosti svih putnika, molimo prijavite sumnjive predmete ili ponašanje odmah osoblju aerodroma. Hvala.",
  "Bezbjedonosno obavještenje. Molimo čuvajte svoj prtljag uz sebe u svakom trenutku. Ostavljene predmete bez nadzora uklonit će zaštitarska služba. Hvala.",
];

let securityMsgIndex = 0;

function getSecurityHours(): { start: number; end: number } {
  const now = new Date();
  const year = now.getFullYear();
  const lastSundayMarch = new Date(year, 3, 0);
  while (lastSundayMarch.getDay() !== 0) lastSundayMarch.setDate(lastSundayMarch.getDate() - 1);
  const lastSundayOctober = new Date(year, 10, 0);
  while (lastSundayOctober.getDay() !== 0) lastSundayOctober.setDate(lastSundayOctober.getDate() - 1);
  const isSummer = now >= lastSundayMarch && now < lastSundayOctober;
  return isSummer
    ? { start: 7 * 60, end: 18 * 60 }
    : { start: 7 * 60, end: 15 * 60 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function spellOutFlightNumber(flightNum: string): string {
  const numWords: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  };
  return String(flightNum).split('').map(ch => numWords[ch] ?? ch).join(' ');
}

// English: special handling for easyJet – remove airline code prefix
function getSpokenFlightNumber(flight: Flight): string {
  let flightNum = flight.BrojLeta;
  const isEasyJet = flight.Kompanija === "EZY" || flight.KompanijaNaziv?.toLowerCase() === "easyjet";
  if (isEasyJet) {
    const match = flightNum.match(/[A-Z]+(\d+)/);
    if (match) {
      flightNum = match[1];
    }
  }
  return spellOutFlightNumber(flightNum);
}

// Croatian: spell flight number digits in Croatian
function spellOutFlightNumberHR(flightNum: string): string {
  const numWordsHR: Record<string, string> = {
    '0': 'nula', '1': 'jedan', '2': 'dva', '3': 'tri', '4': 'četiri',
    '5': 'pet', '6': 'šest', '7': 'sedam', '8': 'osam', '9': 'devet',
  };
  return String(flightNum).split('').map(ch => numWordsHR[ch] ?? ch).join(' ');
}

function getSpokenFlightNumberHR(flight: Flight): string {
  let flightNum = flight.BrojLeta;
  const isEasyJet = flight.Kompanija === "EZY" || flight.KompanijaNaziv?.toLowerCase() === "easyjet";
  if (isEasyJet) {
    const match = flightNum.match(/[A-Z]+(\d+)/);
    if (match) {
      flightNum = match[1];
    }
  }
  return spellOutFlightNumberHR(flightNum);
}

// ─── Croatian pronunciation of airline names ─────────────────────────────────
const airlineNameHR: Record<string, string> = {
  "Jet2.com": "Džet Tu",
  "easyJet": "Izi Džet",
  "Norwegian Air Sweden AOC AB": "Norvidžian",
  "Arkia Israeli Air-Lines":"Arkia",
  "El-Al Israel Airlines Ltd Sundor":"El Al Sandor",
  "EasyJet Europe":"Izi Džet",
  "British Airways":"Britiš Ervejz",
  "Air Serbia":"Er Srbija",
  "Luxair":"Luks Er",
  "Ryanair": "Rajner",
  "Wizz Air": "Viz Er",
  "Wizz Air UK": "Viz Er UK",
  "Wizz Air Malta": "Viz Er Malta",
  "Lufthansa": "Lufthansa",
  "Eurowings": "Evrovings",
  "Austrian Airlines": "Austrian Erlajns",
  "Swiss International Air Lines": "Švajc Erlajns",
  "KLM Royal Dutch Airlines": "KLM",
  "Air France": "Er Frans",
  "Turkish Airlines": "Turkiš Erlajns",
  "Pegasus Airlines": "Pegasus",
  "Transavia France": "Transavija Frans",
  "Transavia Airlines": "Transavija",
  "Vueling Airlines": "Vueling",
  "Iberia": "Iberia",
  "SAS Scandinavian Airlines": "SAS",
  "Finnair": "Finer",
  "Aegean Airlines": "Edžin Erlajns",
  "Air Baltic": "Er Baltik",
  "LOT Polish Airlines": "Lot",
  "Czech Airlines": "Češka Erlajns",
  "Croatia Airlines": "Kroacija Erlajns",
  "Air Montenegro": "Er Montenegro",
  "Bulgaria Air": "Bugarski Er",
  "TAROM": "Tarom",
  "Blue Air": "Ble Er",
  "Sky Express": "Skaj Ekspres",
  "Volotea": "Volotea",
  "TUI Airways": "TUI Ervejz",
  "TUI fly Belgium": "TUI flaj Belgija",
  "Corendon Airlines": "Korendon Erlajns",
  "Freebird Airlines": "Fribird Erlajns",
  "Pegasus Hava Tasimaciligi A.S.": "Pegasus",  // već mapirano u API-ju
  "SunExpress": "San Ekspres",
  "SmartLynx Airlines": "Smart Links",
  "Enter Air": "Enter Er",
  "Air Cairo": "Er Kairo",
  "Air Europa": "Er Europa",
  "Air Malta": "Er Malta",
  "Alitalia": "Alitalija",
  "Brussels Airlines": "Brisel Erlajns",
  "Condor": "Kondor",
  "Norwegian Air Shuttle": "Norvidžian er šatl",
  "Olympic Air": "Olimpik er",
  "TAP Air Portugal": "Tap er Portugal",
  "Edelweiss Air": "Edelvajs er",
  "Helvetic Airways": "Helvetik ervejz",
  "Air Dolomiti": "Er Dolomiti",
  "Air Nostrum": "Er Nostrum",
  "Albawings": "Alba vings",
  "AnadoluJet": "Anadolu džet",
  "Binter Canarias": "Binter Kanarias",
  "Blue Panorama": "Blu Panorama",
  "Dan Air": "Den er",
  "FlyOne": "Flaj Van",
  "HiSky": "Hai Skaj",
  "Israir": "Izra er",
  "Jazeera Airways": "Džazira ervejz",
  "Luxwing": "Luks ving",
  "Mavi Gök Airlines": "Mavi Gok",
  "Neos": "Neos",
  "Norse Atlantic Airways": "Nors Atlantik",
  "Play": "Plej",
  "Red Wings": "Red vings",
  "Rossiya Airlines": "Rosija",
  "S7 Airlines": "S Sedam",
  "Smartwings": "Smart vings",
  "Trade Air": "Trejd er",
  "Tus Airways": "Tus er",
  "Ural Airlines": "Ural erlajns",
  "Utair": "Ju er",
  "VLM Airlines": "VLM",
  "White Airways": "Vajt ervejz",
  "Widerøe": "Videroe",
    "FlyDubai": "Flaj Dubai",
    "Fly Dubai": "Flaj Dubai",

};

function getCroatianAirlineName(original: string): string {
  const lower = original.toLowerCase();
  for (const [key, value] of Object.entries(airlineNameHR)) {
    if (lower === key.toLowerCase()) {
      return value;
    }
  }
  return original;
}

// ─── Croatian city name mapping (English → Croatian) ─────────────────────────
const cityNameHR: Record<string, string> = {
  "Belgrade": "Beograd",
 
  "Vienna": "Beč",
  "Rome": "Rim",
  "Munich": "Minhen",
  "Stockholm": "Štokholm",
  "Manchester": "Mančester",
  "Paris": "Pariz",
  "Athens": "Atina",
  "Budapest": "Budimpešta",
  // Add more as needed:
  "London STN": "London Stansted",   // stays same
  "London LTN": "London Luton",
  "London LHR": "London Hitrou",
  "London LGW": "London Getvik",
  "Paris Charles de Gaulle":"Pariz",
   "Paris Charles de Gaull":"Pariz",
   "Paris ORY":"Pariz Orli",
  "Frankfurt": "Frankfurt",
  "Berlin": "Berlin",
  "Milan": "Milano",
  "Warsaw": "Varšava",
  "Prague": "Prag",
  "Brussels": "Brisel",
  "Copenhagen": "Kopenhagen",
  "Oslo": "Oslo",
  "Helsinki": "Helsinki",
  "Dublin": "Dublin",
  "Amsterdam": "Amsterdam",
  "Zurich": "Cirih",
  "Lisbon": "Lisabon",
    "Wroclaw": "Vroclav",
      "Katowitze": "Kaotovice",
  "Madrid": "Madrid",
  "Barcelona": "Barcelona",
  "Istanbul": "Istanbul",
  "Moscow": "Moskva",
  "Dubai": "Dubai",
  "Doha": "Doha",
};

function getCroatianCityName(original: string): string {
  if (!original) return '';
  return cityNameHR[original] || original;
}

function getStatusMeta(code: string): StatusMeta {
  return STATUS_MAP[code] || { label: code, color: "#b0bec5", bg: "rgba(176,190,197,0.10)", icon: "•" };
}

function parseHHMM(str?: string): number | null {
  if (!str || str.length < 4) return null;
  const h = parseInt(str.slice(0, 2), 10);
  const m = parseInt(str.slice(2, 4), 10);
  return h * 60 + m;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function formatTime(str?: string): string {
  if (!str || str.length < 4) return "--:--";
  return `${str.slice(0, 2)}:${str.slice(2, 4)}`;
}

function isFlightStillRelevant(flight: Flight): boolean {
  const now    = nowMinutes();
  const status = flight.Status;
  const actualTimeStr = flight.Aktuelno;

  if (status === "A09DEP") {
    if (!actualTimeStr || actualTimeStr.length < 4) return true;
    const actualTime = parseHHMM(actualTimeStr);
    if (actualTime === null) return true;
    let minutesSince = now - actualTime;
    if (minutesSince < 0) minutesSince += 1440;
    return minutesSince <= HIDE_DEPARTED_AFTER_MINUTES;
  }

  if (status === "A07ARR") {
    if (!actualTimeStr || actualTimeStr.length < 4) return true;
    const actualTime = parseHHMM(actualTimeStr);
    if (actualTime === null) return true;
    let minutesSince = now - actualTime;
    if (minutesSince < 0) minutesSince += 1440;
    return minutesSince <= HIDE_ARRIVED_AFTER_MINUTES;
  }

  return true;
}

function shouldPlayAnnouncement(flight: Flight, type: string): boolean {
  const now = nowMinutes();
  const std = parseHHMM(flight.Planirano);
  if (std === null) return false;

  if (type === "arrived") {
    const actualTime = parseHHMM(flight.Aktuelno);
    if (actualTime !== null) {
      let minutesSince = now - actualTime;
      if (minutesSince < 0) minutesSince += 1440;
      return minutesSince <= 10;
    }
    return true;
  }

  const minTime = std - 120;
  const maxTime = std + 30;

  if (minTime < 0) {
    if (now >= 0 && now <= maxTime) return true;
    if (now >= minTime + 1440 && now <= 1439) return true;
    return false;
  }

  return now >= minTime && now <= maxTime;
}

function getAnnouncementKey(flight: Flight, type: string): string {
  return `${flight.BrojLeta}_${flight.IATA}_${type}`;
}

// ─── Natural number pronunciation (English) ───────────────────────────────────
function naturalNumberWord(num: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (num === 0) return 'zero';
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  const ten = Math.floor(num / 10);
  const unit = num % 10;
  if (unit === 0) return tens[ten];
  return `${tens[ten]}-${ones[unit]}`;
}

function formatCheckInString(checkIn: string): string {
  if (!checkIn) return '';
  const parts = checkIn.split(',').map(p => p.trim());
  const converted = parts.map(part => {
    if (part.includes('-')) {
      const range = part.split('-').map(x => parseInt(x.trim(), 10));
      if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
        return `${naturalNumberWord(range[0])} to ${naturalNumberWord(range[1])}`;
      }
      return part;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num)) return naturalNumberWord(num);
    return part;
  });
  return converted.join(', ');
}

function formatGateString(gate: string): string {
  if (!gate) return '';
  return gate.replace(/\d+/g, (match) => naturalNumberWord(parseInt(match, 10)));
}

// ─── Compute delay in minutes ────────────────────────────────────────────────
function computeDelayMinutes(flight: Flight): number | null {
  const plan = parseHHMM(flight.Planirano);
  const est = parseHHMM(flight.Predvidjeno);
  if (plan === null || est === null) return null;
  let diff = est - plan;
  if (diff < 0) diff += 1440;
  if (diff > 720) return null;
  return diff > 0 ? diff : null;
}

// ─── ENGLISH ANNOUNCEMENT BUILDERS ────────────────────────────────────────────
function buildArrivalAnnouncementEN(f: Flight): string {
  return `Attention please. ${f.KompanijaNaziv} flight ${getSpokenFlightNumber(f)} from ${f.Grad} has arrived. Thank you.`;
}

function buildDepartureAnnouncementEN(f: Flight, type: string): string {
  const dest     = f.Grad;
  const airline  = f.KompanijaNaziv;
  const checkins = f.CheckIn ? `Check-in desks ${formatCheckInString(f.CheckIn)}.` : "";
  const gate     = f.Gate ? `Gate ${formatGateString(f.Gate)}` : "the designated gate";

  switch (type) {
    case "checkin_120":
      return `Attention please. ${airline} flight ${getSpokenFlightNumber(f)} to ${dest} is now open for check-in. ${checkins} Check-in will close 30 minutes before departure. Thank you.`;
    case "checkin_90":
      return `Attention please. This is a reminder that check-in is open for ${airline} flight ${getSpokenFlightNumber(f)} to ${dest}. ${checkins} Please ensure you have checked in before the desk closes. Thank you.`;
    case "checkin_60":
      return `Attention please. Last call for check-in. ${airline} flight ${getSpokenFlightNumber(f)} to ${dest}. ${checkins} Check-in closes in 15 minutes. Please proceed immediately. Thank you.`;
    case "boarding_30":
      return `Attention please. ${airline} flight ${getSpokenFlightNumber(f)} to ${dest} is now ready for boarding at ${gate}. Please have your boarding pass and identification ready. Thank you.`;
    case "boarding_20":
      return `Attention please. Boarding is in progress for ${airline} flight ${getSpokenFlightNumber(f)} to ${dest} at ${gate}. All passengers should now be at the gate. Thank you.`;
    case "final_15":
      return `Final call. Final call for ${airline} flight ${getSpokenFlightNumber(f)} to ${dest}. This is the final call for all remaining passengers. Please proceed immediately to ${gate}. Thank you.`;
    case "final_10":
      return `Last and final call. ${airline} flight ${getSpokenFlightNumber(f)} to ${dest}. The gate is about to close. Report immediately to ${gate} or you will be offloaded. Thank you.`;
    default:
      return "";
  }
}

function buildDelayAnnouncementEN(f: Flight): string {
  const minutes = computeDelayMinutes(f);
  const direction = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  const airline = f.KompanijaNaziv;
  const flightNumber = getSpokenFlightNumber(f);

  if (minutes !== null && minutes > 0) {
    const minutesWord = naturalNumberWord(minutes);
    return `Attention please. ${airline} flight ${flightNumber} ${direction} will be delayed approximately ${minutesWord} minutes. We apologize for the inconvenience. Thank you for your patience.`;
  }
  const newTime = f.Aktuelno || f.Predvidjeno || "a later time";
  return `Attention please. We regret to inform you that ${airline} flight ${flightNumber} ${direction} has been delayed. The new expected time is ${formatTime(newTime)}. We apologize for the inconvenience. Thank you for your patience.`;
}

function buildCancelledAnnouncementEN(f: Flight): string {
  const dir = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  return `Attention please. We regret to announce that ${f.KompanijaNaziv} flight ${getSpokenFlightNumber(f)} ${dir} has been cancelled. Please contact your airline representative or proceed to the information desk for assistance. We apologize for the inconvenience.`;
}

function buildDivertedAnnouncementEN(f: Flight): string {
  const dir = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  return `Attention please. ${f.KompanijaNaziv} flight ${getSpokenFlightNumber(f)} ${dir} has been diverted. Please proceed to the information desk or contact your airline for further details. We apologize for any inconvenience caused.`;
}

// ─── CROATIAN ANNOUNCEMENT BUILDERS ───────────────────────────────────────────
// Numbers in Croatian (for minutes, gates, check-in desks)
function brojRiječima(num: number): string {
  const ones = ['', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const teens = ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
  const tens = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
  if (num === 0) return 'nula';
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  const ten = Math.floor(num / 10);
  const unit = num % 10;
  if (unit === 0) return tens[ten];
  return `${tens[ten]}${ones[unit] === 'jedan' ? ' i jedan' : ` ${ones[unit]}`}`;
}

function formatCheckInStringHR(checkIn: string): string {
  if (!checkIn) return '';
  const parts = checkIn.split(',').map(p => p.trim());
  const converted = parts.map(part => {
    if (part.includes('-')) {
      const range = part.split('-').map(x => parseInt(x.trim(), 10));
      if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
        return `${brojRiječima(range[0])} do ${brojRiječima(range[1])}`;
      }
      return part;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num)) return brojRiječima(num);
    return part;
  });
  return converted.join(', ');
}

function formatGateStringHR(gate: string): string {
  if (!gate) return '';
  return gate.replace(/\d+/g, (match) => brojRiječima(parseInt(match, 10)));
}

function buildArrivalAnnouncementHR(f: Flight): string {
  const airline = getCroatianAirlineName(f.KompanijaNaziv);
  const city = getCroatianCityName(f.Grad);
  return `Pažnja molim. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} iz ${city} je sletio. Hvala.`;
}

function buildDepartureAnnouncementHR(f: Flight, type: string): string {
  const dest     = getCroatianCityName(f.Grad);
  const airline  = getCroatianAirlineName(f.KompanijaNaziv);
  const checkins = f.CheckIn ? `Šalteri za registraciju ${formatCheckInStringHR(f.CheckIn)}.` : "";
  const gate     = f.Gate ? `izlaz ${formatGateStringHR(f.Gate)}` : "određeni izlaz";

  switch (type) {
    case "checkin_120":
      return `Pažnja molim. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest} je otvoren za registraciju putnika. ${checkins} Prijava se zatvara 30 minuta prije polijetanja. Hvala.`;
    case "checkin_90":
      return `Pažnja molim. Podsjetnik – registracija putnika je otvorena za let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest}. ${checkins} Molimo prijavite se na vrijeme. Hvala.`;
    case "checkin_60":
      return `Pažnja molim. Posljednji poziv za registraciju putnika. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest}. ${checkins} Registracija se zatvara za 15 minuta. Molimo odmah pristupite šalteru. Hvala.`;
    case "boarding_30":
      return `Pažnja molim. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest} spreman je za ukrcavanje na ${gate}. Molimo pripremite Vašu putnu ispravu i kartu za ukrcavanje. Hvala.`;
    case "boarding_20":
      return `Pažnja molim. Ukrcavanje je u toku za let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest} na ${gate}. Svi putnici trebaju biti na izlazu. Hvala.`;
    case "final_15":
      return `Posljednji poziv. Posljednji poziv za putnike leta kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest}. Molimo sve preostale putnike da odmah pristupe ${gate}. Hvala.`;
    case "final_10":
      return `Poslednji poziv. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} za ${dest}. Izlaz se zatvara. Odmah pristupite ${gate} ili ćete biti odjavljeni. Hvala.`;
    default:
      return "";
  }
}

function buildDelayAnnouncementHR(f: Flight): string {
  const minutes = computeDelayMinutes(f);
  const direction = f.TipLeta === "O" ? `za ${getCroatianCityName(f.Grad)}` : `iz ${getCroatianCityName(f.Grad)}`;
  const airline = getCroatianAirlineName(f.KompanijaNaziv);
  const flightNumber = getSpokenFlightNumberHR(f);

  if (minutes !== null && minutes > 0) {
    const minutesWord = brojRiječima(minutes);
    return `Pažnja molim. Let kompanije ${airline} broj ${flightNumber} ${direction} kasnit će otprilike ${minutesWord} minuta. Ispričavamo se na neugodnosti. Hvala na strpljenju.`;
  }
  const newTime = f.Aktuelno || f.Predvidjeno || "kasnijeg vremena";
  return `Pažnja molim. Žalimo što moramo obavijestiti da let kompanije ${airline} broj ${flightNumber} ${direction} kasni. Novo očekivano vrijeme je ${formatTime(newTime)}. Izvinjavamo se na neugodnosti. Hvala na strpljenju.`;
}

function buildCancelledAnnouncementHR(f: Flight): string {
  const dir = f.TipLeta === "O" ? `za ${getCroatianCityName(f.Grad)}` : `iz ${getCroatianCityName(f.Grad)}`;
  const airline = getCroatianAirlineName(f.KompanijaNaziv);
  return `Pažnja molim. Žalimo što moramo obavijestiti da je let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} ${dir} otkazan. Molimo kontaktirajte predstavnika avio kompanije ili se obratite šalteru informacija. Izvinjavamo se na neugodnosti.`;
}

function buildDivertedAnnouncementHR(f: Flight): string {
  const dir = f.TipLeta === "O" ? `za ${getCroatianCityName(f.Grad)}` : `iz ${getCroatianCityName(f.Grad)}`;
  const airline = getCroatianAirlineName(f.KompanijaNaziv);
  return `Pažnja molim. Let kompanije ${airline} broj ${getSpokenFlightNumberHR(f)} ${dir} preusmjeren je na drugi aerodrom. Molimo obratite se informacijama ili vašoj avio kompaniji. Izvinjavamo se na neugodnosti.`;
}

// ─── Flight Row Component (unchanged) ─────────────────────────────────────────
function FlightRow({ flight, announcedKeys }: { flight: Flight; announcedKeys: Record<string, boolean> }) {
  const meta  = getStatusMeta(flight.Status);
  const isDep = flight.TipLeta === "O";
  const keys  = Object.keys(announcedKeys).filter(k => k.startsWith(`${flight.BrojLeta}_${flight.IATA}_`));
  const hasAnnounced = keys.length > 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "70px 1fr 90px 70px 70px 70px 120px 30px",
      alignItems: "center",
      padding: "10px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      backgroundColor: hasAnnounced ? "rgba(255,255,255,0.02)" : "transparent",
      transition: "background 0.3s",
      fontFamily: "'Roboto', monospace",
    }}>
      <div style={{ color: isDep ? "#90caf9" : "#00e676", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
        {isDep ? "DEP" : "ARR"}
      </div>
      <div>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
          {flight.KompanijaNaziv}
        </div>
        <div style={{ color: "#78909c", fontSize: 11, marginTop: 2 }}>
          {flight.Kompanija}{flight.BrojLeta} · {flight.IATA} {flight.Grad}
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#b0bec5", fontSize: 11 }}>Planned</div>
        <div style={{ color: "#fff", fontSize: 13 }}>{formatTime(flight.Planirano)}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#b0bec5", fontSize: 11 }}>Est.</div>
        <div style={{ color: "#fff176", fontSize: 13 }}>{formatTime(flight.Predvidjeno)}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#b0bec5", fontSize: 11 }}>Act.</div>
        <div style={{ color: "#a5d6a7", fontSize: 13 }}>{formatTime(flight.Aktuelno)}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#b0bec5", fontSize: 11 }}>Gate</div>
        <div style={{ color: "#fff", fontSize: 13 }}>{flight.Gate || "—"}</div>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: meta.bg, borderRadius: 6,
        padding: "3px 8px",
      }}>
        <span style={{ color: meta.color, fontSize: 12 }}>{meta.icon}</span>
        <span style={{ color: meta.color, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{meta.label}</span>
      </div>
      <div style={{ textAlign: "center", fontSize: 14 }}>
        {hasAnnounced ? "🔊" : ""}
      </div>
    </div>
  );
}

// ─── Log Entry ────────────────────────────────────────────────────────────────
function LogEntry({ entry }: { entry: LogEntryType }) {
  return (
    <div style={{
      padding: "8px 14px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <span style={{ color: "#546e7a", fontSize: 11, fontFamily: "'Roboto', monospace", minWidth: 48 }}>
        {entry.time}
      </span>
      <span style={{ color: "#90caf9", fontSize: 11, minWidth: 24, textAlign: "center" }}>🔊</span>
      <span style={{ color: "#cfd8dc", fontSize: 12, lineHeight: 1.5 }}>{entry.text}</span>
    </div>
  );
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function Clock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: 2 }}>
      {time}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AirportPA() {
  const [flights, setFlights]           = useState<Flight[]>([]);
  const [log, setLog]                   = useState<LogEntryType[]>([]);
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [filter, setFilter]             = useState("ALL");
  const [activeTab, setActiveTab]       = useState("board");
  const [speaking, setSpeaking]         = useState(false);
  const [voicesReady, setVoicesReady]   = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>("");
  const [croatianVoiceURI, setCroatianVoiceURI] = useState<string | null>(null);

  const announcedRef  = useRef<Record<string, boolean>>({});
  const [announcedKeys, setAnnouncedKeys] = useState<Record<string, boolean>>({});

  const queueRef       = useRef<QueueItem[]>([]);
  const playingRef     = useRef(false);
  const isMountedRef   = useRef(true);
  const processQueueRef = useRef<() => void>(() => {});

  // ── Voice loading and selector ──
  useEffect(() => {
    function loadVoices() {
      const voices = window.speechSynthesis?.getVoices() || [];
      if (voices.length > 0) {
        setAvailableVoices(voices);
        setVoicesReady(true);
        // Restore saved English voice from localStorage
        const savedURI = localStorage.getItem("tts_voice_uri");
        if (savedURI && voices.some(v => v.voiceURI === savedURI)) {
          setSelectedVoiceURI(savedURI);
        } else if (voices.length > 0) {
          // Default: prefer female English voice
          const defaultVoice = voices.find(v => /female|woman|zira|samantha|victoria|karen|moira|fiona/i.test(v.name)) ||
                               voices.find(v => /en[-_]GB|en[-_]US/i.test(v.lang)) ||
                               voices[0];
          if (defaultVoice) setSelectedVoiceURI(defaultVoice.voiceURI);
        }
        // Detect Croatian/Serbian voice (lang starts with 'hr' or 'sr', or name contains "Matej", "Croatian", "Serbian")
        const croatianVoice = voices.find(v => 
          v.lang.startsWith('hr') || v.lang.startsWith('sr') ||
          /matej|croatian|serbian/i.test(v.name)
        );
        if (croatianVoice) {
          setCroatianVoiceURI(croatianVoice.voiceURI);
          console.log("Croatian voice detected:", croatianVoice.name);
        } else {
          setCroatianVoiceURI(null);
        }
      }
    }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // Save selected English voice to localStorage
  useEffect(() => {
    if (selectedVoiceURI) {
      localStorage.setItem("tts_voice_uri", selectedVoiceURI);
    }
  }, [selectedVoiceURI]);

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVoiceURI(e.target.value);
  };

  // ── TTS Queue (sequential, no cancel) ──
  const processQueue = useCallback(() => {
    if (!isMountedRef.current) return;
    if (playingRef.current || queueRef.current.length === 0) return;

    playingRef.current = true;
    setSpeaking(true);

    const item = queueRef.current.shift()!;
    const { text, voiceURI } = item;

    if (!("speechSynthesis" in window)) {
      playingRef.current = false;
      setSpeaking(false);
      setTimeout(() => processQueueRef.current(), 100);
      return;
    }

    const gong = new Audio("/gong.mp3");
    gong.volume = 1.0;

    const speakText = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang   = voiceURI && availableVoices.find(v => v.voiceURI === voiceURI)?.lang || "en-GB";
      u.rate   = 0.88;
      u.pitch  = 1.0;
      u.volume = 1.0;

      if (voiceURI) {
        const selectedVoice = availableVoices.find(v => v.voiceURI === voiceURI);
        if (selectedVoice) u.voice = selectedVoice;
      } else {
        // Fallback – should not happen
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => /female|woman|zira|samantha|victoria|karen|moira|fiona/i.test(v.name)) ||
                          voices.find(v => /en[-_]GB|en[-_]US/i.test(v.lang)) ||
                          voices[0];
        if (preferred) u.voice = preferred;
      }

      u.onend  = () => { playingRef.current = false; if (isMountedRef.current) setSpeaking(false); setTimeout(() => processQueueRef.current(), 1200); };
      u.onerror = () => { playingRef.current = false; if (isMountedRef.current) setSpeaking(false); setTimeout(() => processQueueRef.current(), 1200); };
      window.speechSynthesis.speak(u);
    };

    gong.onended = () => speakText();
    gong.onerror = () => speakText();
    gong.play().catch(() => speakText());
  }, [availableVoices]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  // Core enqueue function that accepts voice URI
  const enqueueWithVoice = useCallback((text: string, voiceURI: string | null, key: string) => {
    if (!isMountedRef.current) return;
    if (announcedRef.current[key]) return;
    announcedRef.current[key] = true;

    setTimeout(() => { if (isMountedRef.current) setAnnouncedKeys(prev => ({ ...prev, [key]: true })); }, 0);

    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    setTimeout(() => { if (isMountedRef.current) setLog(prev => [{ time, text, key }, ...prev].slice(0, 100)); }, 0);

    queueRef.current.push({ text, voiceURI });
    setTimeout(() => processQueue(), 0);
  }, [processQueue]);

  // Bilingual enqueue: English (using selected voice) then Croatian (if voice exists)
  const enqueueBilingual = useCallback((textEN: string, textHR: string, keyBase: string) => {
    // English
    enqueueWithVoice(textEN, selectedVoiceURI, keyBase + "_en");
    // Croatian (only if a Croatian voice is available)
    if (croatianVoiceURI) {
      enqueueWithVoice(textHR, croatianVoiceURI, keyBase + "_hr");
    }
  }, [enqueueWithVoice, selectedVoiceURI, croatianVoiceURI]);

  // Security message enqueue (bilingual)
  const enqueueSecurityMessage = useCallback((textEN: string, textHR: string) => {
    if (!isMountedRef.current) return;
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const keyEN = `security_en_${time}`;
    const keyHR = `security_hr_${time}`;

    enqueueWithVoice(textEN, selectedVoiceURI, keyEN);
    if (croatianVoiceURI) {
      enqueueWithVoice(textHR, croatianVoiceURI, keyHR);
    }
  }, [enqueueWithVoice, selectedVoiceURI, croatianVoiceURI]);

  // Periodic Security Interval (using bilingual)
  useEffect(() => {
    isMountedRef.current = true;

    function trySecurityAnnouncement() {
      const now    = nowMinutes();
      const hours  = getSecurityHours();
      if (now < hours.start || now >= hours.end) return;
      const idx = securityMsgIndex % SECURITY_MESSAGES_EN.length;
      securityMsgIndex++;
      enqueueSecurityMessage(SECURITY_MESSAGES_EN[idx], SECURITY_MESSAGES_HR[idx]);
    }

    function msToNextHalfHour(): number {
      const now    = new Date();
      const mins   = now.getMinutes();
      const secs   = now.getSeconds();
      const ms     = now.getMilliseconds();
      const nextHalf = mins < 30 ? 30 : 60;
      return ((nextHalf - mins) * 60 - secs) * 1000 - ms;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      trySecurityAnnouncement();
      intervalId = setInterval(trySecurityAnnouncement, 30 * 60 * 1000);
    }, msToNextHalfHour());

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [enqueueSecurityMessage]);

  // Flight evaluation (now uses bilingual)
  const evaluateFlight = useCallback((f: Flight) => {
    const now    = nowMinutes();
    const status = f.Status;

    if (status === "A07ARR" && f.TipLeta === "I") {
      if (shouldPlayAnnouncement(f, "arrived")) {
        enqueueBilingual(
          buildArrivalAnnouncementEN(f),
          buildArrivalAnnouncementHR(f),
          getAnnouncementKey(f, "arrived"),
        );
      }
    }

    if (status === "A06CNL") {
      enqueueBilingual(
        buildCancelledAnnouncementEN(f),
        buildCancelledAnnouncementHR(f),
        getAnnouncementKey(f, "cancelled"),
      );
    }

    if (status === "A08DIV") {
      enqueueBilingual(
        buildDivertedAnnouncementEN(f),
        buildDivertedAnnouncementHR(f),
        getAnnouncementKey(f, "diverted"),
      );
    }

    if (status === "A05DLY") {
      if (shouldPlayAnnouncement(f, "delayed")) {
        enqueueBilingual(
          buildDelayAnnouncementEN(f),
          buildDelayAnnouncementHR(f),
          getAnnouncementKey(f, "delayed"),
        );
      }
    }

    if (f.TipLeta === "O" && ["A03SCH","A04EXP","A05DLY","-",""].includes(status)) {
      const std = parseHHMM(f.Planirano);
      if (std === null) return;

      const windows = [
        { type: "checkin_120", trigger: std - 120, window: 10 },
        { type: "checkin_90",  trigger: std - 90,  window: 10 },
        { type: "checkin_60",  trigger: std - 60,  window: 10 },
        { type: "boarding_30", trigger: std - 30,  window: 10 },
        { type: "boarding_20", trigger: std - 20,  window: 10 },
        { type: "final_15",    trigger: std - 15,  window: 7  },
        { type: "final_10",    trigger: std - 10,  window: 7  },
      ];

      for (const w of windows) {
        let t = w.trigger;
        if (t < 0) t += 1440;
        if (now >= t && now < t + w.window && shouldPlayAnnouncement(f, w.type)) {
          enqueueBilingual(
            buildDepartureAnnouncementEN(f, w.type),
            buildDepartureAnnouncementHR(f, w.type),
            getAnnouncementKey(f, w.type),
          );
        }
      }
    }
  }, [enqueueBilingual]);

  // Fetch flights (unchanged)
  const fetchFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const res = await fetch("/api/flights/tv/", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const arr: Flight[] = Array.isArray(data) ? data : [];

      setTimeout(() => {
        if (isMountedRef.current) {
          setFlights(arr);
          setLastRefresh(new Date());
          setError(null);
          setLoading(false);
        }
      }, 0);

      setTimeout(() => {
        if (isMountedRef.current && arr.length > 0) arr.forEach(evaluateFlight);
      }, 100);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setTimeout(() => {
        if (isMountedRef.current) { setError(msg); setLoading(false); }
      }, 0);
    }
  }, [evaluateFlight]);

  useEffect(() => {
    fetchFlights();
    const interval = setInterval(() => fetchFlights(), 60000);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      window.speechSynthesis?.cancel();
    };
  }, [fetchFlights]);

  const activeFlights = flights.filter(isFlightStillRelevant);
  const displayed = activeFlights.filter(f => {
    if (filter === "ARR") return f.TipLeta === "I";
    if (filter === "DEP") return f.TipLeta === "O";
    return true;
  });
  const arrivals   = activeFlights.filter(f => f.TipLeta === "I");
  const departures = activeFlights.filter(f => f.TipLeta === "O");

  // ─── Render (unchanged) ──────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@600;800&family=Roboto:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060c14; color: #cfd8dc; font-family: 'Roboto', sans-serif; min-height: 100vh; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e2d3d; border-radius: 2px; }
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #00e676; }
          50% { opacity: 0.5; box-shadow: 0 0 2px #00e676; }
        }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .row-fade { animation: fadeIn 0.3s ease forwards; }
        select {
          background: rgba(0,230,118,0.1);
          border: 1px solid rgba(0,230,118,0.3);
          color: #00e676;
          border-radius: 6px;
          padding: 5px 12px;
          font-family: 'Roboto', monospace;
          font-size: 11px;
          cursor: pointer;
          letter-spacing: 1px;
        }
        select option {
          background: #060c14;
          color: #cfd8dc;
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#060c14", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "2px",
          background: "linear-gradient(transparent, rgba(0,230,118,0.08), transparent)",
          animation: "scanline 8s linear infinite", pointerEvents: "none", zIndex: 999,
        }} />
        <div style={{
          position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(rgba(0,230,118,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,230,118,0.02) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "0 16px" }}>
          <header style={{
            padding: "20px 0 16px",
            borderBottom: "1px solid rgba(0,230,118,0.15)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 12,
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#00e676",
                  animation: "pulse-glow 2s ease-in-out infinite",
                }} />
                <h1 style={{
                  fontFamily: "'Orbitron', monospace", fontSize: 20,
                  fontWeight: 800, letterSpacing: 3, color: "#fff", textTransform: "uppercase",
                }}>
                  Tivat Airport <span style={{ color: "#00e676" }}>PA</span>
                </h1>
              </div>
              <div style={{ fontFamily: "'Roboto', monospace", fontSize: 11, color: "#546e7a", marginTop: 4, paddingLeft: 20 }}>
                PASSENGER ANNOUNCEMENT SYSTEM · TIV · EN / HR
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              {speaking && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", background: "#ff7043",
                    animation: "pulse-glow 0.6s ease-in-out infinite",
                  }} />
                  <span style={{ fontFamily: "'Roboto', monospace", fontSize: 11, color: "#ff7043" }}>
                    ANNOUNCING
                  </span>
                </div>
              )}
              
              {/* Voice selector for English only */}
              {voicesReady && availableVoices.length > 0 && (
                <select value={selectedVoiceURI} onChange={handleVoiceChange} style={{ fontFamily: "'Roboto', monospace", fontSize: 11 }}>
                  {availableVoices.map(voice => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              )}

              <div style={{ fontFamily: "'Roboto', monospace", fontSize: 11, color: voicesReady ? "#00e676" : "#546e7a" }}>
                TTS {voicesReady ? "READY" : "INIT..."}
                {croatianVoiceURI && <span style={{ marginLeft: 8, color: "#ff7043" }}>🇭🇷 HR</span>}
              </div>
              <Clock />
              <div style={{ fontFamily: "'Roboto', monospace", fontSize: 11, color: "#546e7a" }}>
                {lastRefresh
                  ? `UPD ${lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "—"}
              </div>
              <button
                onClick={fetchFlights}
                style={{
                  background: "rgba(0,230,118,0.1)", border: "1px solid rgba(0,230,118,0.3)",
                  color: "#00e676", borderRadius: 6, padding: "5px 12px",
                  fontFamily: "'Roboto', monospace", fontSize: 11, cursor: "pointer", letterSpacing: 1,
                }}
              >
                ↺ REFRESH
              </button>
            </div>
          </header>

          <div style={{ display: "flex", gap: 12, padding: "14px 0", flexWrap: "wrap" }}>
            {[
              { label: "Total",      value: activeFlights.length,          color: "#b0bec5" },
              { label: "Arrivals",   value: arrivals.length,               color: "#00e676" },
              { label: "Departures", value: departures.length,             color: "#90caf9" },
              { label: "Announced",  value: Object.keys(announcedKeys).length, color: "#ff7043" },
            ].map(s => (
              <div key={s.label} style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 8, padding: "8px 16px", minWidth: 90,
              }}>
                <div style={{ fontSize: 11, color: "#546e7a", fontFamily: "'Roboto', monospace" }}>{s.label}</div>
                <div style={{ fontSize: 22, fontFamily: "'Orbitron', monospace", color: s.color, fontWeight: 800 }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.07)", marginBottom: 0 }}>
            {[
              { id: "board", label: "FLIGHT BOARD" },
              { id: "log",   label: `ANNOUNCEMENT LOG (${log.length})` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "10px 18px",
                  fontFamily: "'Roboto', monospace", fontSize: 11, letterSpacing: 1,
                  color: activeTab === t.id ? "#00e676" : "#546e7a",
                  borderBottom: activeTab === t.id ? "2px solid #00e676" : "2px solid transparent",
                  transition: "color 0.2s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "board" && (
            <div>
              <div style={{ display: "flex", gap: 8, padding: "12px 0" }}>
                {["ALL","ARR","DEP"].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      background: filter === f ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${filter === f ? "rgba(0,230,118,0.4)" : "rgba(255,255,255,0.07)"}`,
                      color: filter === f ? "#00e676" : "#78909c",
                      borderRadius: 6, padding: "4px 14px",
                      fontFamily: "'Roboto', monospace", fontSize: 11, cursor: "pointer", letterSpacing: 1,
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 90px 70px 70px 70px 120px 30px",
                padding: "6px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.02)",
              }}>
                {["TYPE","FLIGHT","PLANNED","EST","ACT","GATE","STATUS",""].map(h => (
                  <div key={h} style={{ fontFamily: "'Roboto', monospace", fontSize: 12, color: "#546e7a", letterSpacing: 1 }}>{h}</div>
                ))}
              </div>

              {loading && (
                <div style={{ padding: 40, textAlign: "center", fontFamily: "'Roboto', monospace", color: "#546e7a" }}>
                  LOADING FLIGHT DATA...
                </div>
              )}
              {error && (
                <div style={{ padding: 20, color: "#ef5350", fontFamily: "'Roboto', monospace", fontSize: 14, textAlign: "center" }}>
                  ⚠ {error}
                </div>
              )}
              {!loading && !error && displayed.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", fontFamily: "'Roboto', monospace", color: "#546e7a" }}>
                  NO FLIGHTS
                </div>
              )}
              <div style={{ maxHeight: "calc(100vh - 340px)", overflowY: "auto" }}>
                {displayed.map((f, i) => (
                  <div key={`${f.BrojLeta}_${f.IATA}_${i}`} className="row-fade" style={{ animationDelay: `${i * 0.02}s` }}>
                    <FlightRow flight={f} announcedKeys={announcedKeys} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "log" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                <span style={{ fontFamily: "'Roboto', monospace", fontSize: 12, color: "#546e7a" }}>
                  ANNOUNCEMENT HISTORY
                </span>
                <button
                  onClick={() => { setLog([]); announcedRef.current = {}; setAnnouncedKeys({}); }}
                  style={{
                    background: "rgba(239,83,80,0.1)", border: "1px solid rgba(239,83,80,0.3)",
                    color: "#ef5350", borderRadius: 6, padding: "4px 12px",
                    fontFamily: "'Roboto', monospace", fontSize: 11, cursor: "pointer",
                  }}
                >
                  CLEAR LOG
                </button>
              </div>
              <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
                {log.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", fontFamily: "'Roboto', monospace", color: "#546e7a" }}>
                    NO ANNOUNCEMENTS YET
                  </div>
                ) : log.map((entry, i) => (
                  <LogEntry key={entry.key || String(i)} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}