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

// ─── Periodic Security Announcements ─────────────────────────────────────────
const SECURITY_MESSAGES = [
  "Security announcement. Please do not leave your baggage unattended at any time. Unattended baggage will be removed and may be destroyed. Thank you for your cooperation.",
  "Security announcement. For the safety of all passengers, please report any suspicious items or behaviour to airport security staff immediately. Thank you.",
  "Security announcement. Please keep your baggage with you at all times. Any unattended items will be removed by security personnel. Thank you.",
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

// ─── Natural number pronunciation ────────────────────────────────────────────
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

// ─── TTS Announcement Builders ────────────────────────────────────────────────
function buildArrivalAnnouncement(f: Flight): string {
  return `Attention please. ${f.KompanijaNaziv} flight ${spellOutFlightNumber(f.BrojLeta)} from ${f.Grad} has arrived...`;
}

function buildDepartureAnnouncement(f: Flight, type: string): string {
  const dest     = f.Grad;
  const airline  = f.KompanijaNaziv;
  const checkins = f.CheckIn ? `Check-in desks ${formatCheckInString(f.CheckIn)}.` : "";
  const gate     = f.Gate ? `Gate ${formatGateString(f.Gate)}` : "the designated gate";

  switch (type) {
    case "checkin_120":
      return `Attention please. ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest} is now open for check-in. ${checkins} Check-in will close 30 minutes before departure. Thank you.`;
    case "checkin_90":
      return `Attention please. This is a reminder that check-in is open for ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest}. ${checkins} Please ensure you have checked in before the desk closes. Thank you.`;
    case "checkin_60":
      return `Attention please. Last call for check-in. ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest}. ${checkins} Check-in closes in 15 minutes. Please proceed immediately. Thank you.`;
    case "boarding_30":
      return `Attention please. ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest} is now ready for boarding at ${gate}. Please have your boarding pass and identification ready. Thank you.`;
    case "boarding_20":
      return `Attention please. Boarding is in progress for ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest} at ${gate}. All passengers should now be at the gate. Thank you.`;
    case "final_15":
      return `Final call. Final call for ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest}. This is the final call for all remaining passengers. Please proceed immediately to ${gate}. Thank you.`;
    case "final_10":
      return `Last and final call. ${airline} flight ${spellOutFlightNumber(f.BrojLeta)} to ${dest}. The gate is about to close. Report immediately to ${gate} or you will be offloaded. Thank you.`;
    default:
      return "";
  }
}

function buildDelayAnnouncement(f: Flight): string {
  const minutes = computeDelayMinutes(f);
  const direction = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  const airline = f.KompanijaNaziv;
  const flightNumber = spellOutFlightNumber(f.BrojLeta);

  if (minutes !== null && minutes > 0) {
    const minutesWord = naturalNumberWord(minutes);
    return `Attention please. ${airline} flight ${flightNumber} ${direction} will be delayed approximately ${minutesWord} minutes. We apologize for the inconvenience. Thank you for your patience.`;
  }
  const newTime = f.Aktuelno || f.Predvidjeno || "a later time";
  return `Attention please. We regret to inform you that ${airline} flight ${flightNumber} ${direction} has been delayed. The new expected time is ${newTime}. We apologize for the inconvenience. Thank you for your patience.`;
}

function buildCancelledAnnouncement(f: Flight): string {
  const dir = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  return `Attention please. We regret to announce that ${f.KompanijaNaziv} flight ${spellOutFlightNumber(f.BrojLeta)} ${dir} has been cancelled. Please contact your airline representative or proceed to the information desk for assistance. We apologize for the inconvenience.`;
}

function buildDivertedAnnouncement(f: Flight): string {
  const dir = f.TipLeta === "O" ? `to ${f.Grad}` : `from ${f.Grad}`;
  return `Attention please. ${f.KompanijaNaziv} flight ${spellOutFlightNumber(f.BrojLeta)} ${dir} has been diverted. Please proceed to the information desk or contact your airline for further details. We apologize for any inconvenience caused.`;
}

// ─── Flight Row Component ─────────────────────────────────────────────────────
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

  const announcedRef  = useRef<Record<string, boolean>>({});
  const [announcedKeys, setAnnouncedKeys] = useState<Record<string, boolean>>({});

  const queueRef       = useRef<string[]>([]);
  const playingRef     = useRef(false);
  const isMountedRef   = useRef(true);
  const processQueueRef = useRef<() => void>(() => {});

  // Voice loading
  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis?.getVoices();
      if (v?.length > 0) setVoicesReady(true);
    }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // TTS Queue
  const processQueue = useCallback(() => {
    if (!isMountedRef.current) return;
    if (playingRef.current || queueRef.current.length === 0) return;

    playingRef.current = true;
    setSpeaking(true);

    const text = queueRef.current.shift()!;

    if (!("speechSynthesis" in window)) {
      playingRef.current = false;
      setSpeaking(false);
      setTimeout(() => processQueueRef.current(), 100);
      return;
    }

    const gong = new Audio("/gong.mp3");
    gong.volume = 1.0;

    const speakText = () => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang   = "en-GB";
      u.rate   = 0.88;
      u.pitch  = 1.0;
      u.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => /female|woman|zira|samantha|victoria|karen|moira|fiona/i.test(v.name)) ||
        voices.find(v => /en[-_]GB|en[-_]US/i.test(v.lang)) ||
        voices[0];
      if (preferred) u.voice = preferred;

      u.onend  = () => { playingRef.current = false; if (isMountedRef.current) setSpeaking(false); setTimeout(() => processQueueRef.current(), 1200); };
      u.onerror = () => { playingRef.current = false; if (isMountedRef.current) setSpeaking(false); setTimeout(() => processQueueRef.current(), 1200); };
      window.speechSynthesis.speak(u);
    };

    gong.onended = () => speakText();
    gong.onerror = () => speakText();
    gong.play().catch(() => speakText());
  }, []);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const enqueue = useCallback((text: string, key: string) => {
    if (!isMountedRef.current) return;
    if (announcedRef.current[key]) return;
    announcedRef.current[key] = true;

    setTimeout(() => { if (isMountedRef.current) setAnnouncedKeys(prev => ({ ...prev, [key]: true })); }, 0);

    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    setTimeout(() => { if (isMountedRef.current) setLog(prev => [{ time, text, key }, ...prev].slice(0, 100)); }, 0);

    queueRef.current.push(text);
    setTimeout(() => processQueue(), 0);
  }, [processQueue]);

  const enqueueSecurityMessage = useCallback((text: string) => {
    if (!isMountedRef.current) return;
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const key  = `security_${time}`;
    setTimeout(() => {
      if (isMountedRef.current)
        setLog(prev => [{ time, text, key }, ...prev].slice(0, 100));
    }, 0);
    queueRef.current.push(text);
    setTimeout(() => processQueue(), 0);
  }, [processQueue]);

  // Periodic Security Interval
  useEffect(() => {
    isMountedRef.current = true;

    function trySecurityAnnouncement() {
      const now    = nowMinutes();
      const hours  = getSecurityHours();
      if (now < hours.start || now >= hours.end) return;
      const msg = SECURITY_MESSAGES[securityMsgIndex % SECURITY_MESSAGES.length];
      securityMsgIndex++;
      enqueueSecurityMessage(msg);
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

  const evaluateFlight = useCallback((f: Flight) => {
    const now    = nowMinutes();
    const status = f.Status;

    if (status === "A07ARR" && f.TipLeta === "I") {
      if (shouldPlayAnnouncement(f, "arrived")) {
        enqueue(buildArrivalAnnouncement(f), getAnnouncementKey(f, "arrived"));
      }
    }

    if (status === "A06CNL") {
      enqueue(buildCancelledAnnouncement(f), getAnnouncementKey(f, "cancelled"));
    }

    if (status === "A08DIV") {
      enqueue(buildDivertedAnnouncement(f), getAnnouncementKey(f, "diverted"));
    }

    if (status === "A05DLY") {
      if (shouldPlayAnnouncement(f, "delayed")) {
        enqueue(buildDelayAnnouncement(f), getAnnouncementKey(f, "delayed"));
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
          enqueue(buildDepartureAnnouncement(f, w.type), getAnnouncementKey(f, w.type));
        }
      }
    }
  }, [enqueue]);

  const fetchFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const res = await fetch("/api/flights", {
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
                PASSENGER ANNOUNCEMENT SYSTEM · TIV
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
              <div style={{ fontFamily: "'Roboto', monospace", fontSize: 11, color: voicesReady ? "#00e676" : "#546e7a" }}>
                TTS {voicesReady ? "READY" : "INIT..."}
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

//zadni