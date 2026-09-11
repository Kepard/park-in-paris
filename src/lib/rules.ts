import type { Bay } from "../types";
const parisFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function parisParts(date: Date) {
  const p = Object.fromEntries(
    parisFormatter.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
  };
}
export function parisInput(date: Date) {
  const p = parisParts(date);
  return `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
export function parseParis(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid date and time.");
  const target = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(target))
    throw new Error("Choose a valid date and time.");
  let timestamp = target;
  for (let i = 0; i < 3; i++) {
    const p = parisParts(new Date(timestamp));
    timestamp +=
      target -
      Date.parse(
        `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:00Z`,
      );
  }
  const result = new Date(timestamp);
  if (parisInput(result) !== value)
    throw new Error(
      "That time does not exist in Paris. Choose a time outside the daylight-saving clock change.",
    );
  return result;
}
function addDays(date: string, count: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function holidays(year: number): Set<string> {
  // Gregorian computus; metropolitan France's national public holidays.
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return new Set(
    ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"]
      .map((x) => `${year}-${x}`)
      .concat([addDays(easter, 1), addDays(easter, 39), addDays(easter, 50)]),
  );
}
export function sharedAllowed(start: Date, end: Date): boolean {
  if (
    !(end.getTime() > start.getTime()) ||
    end.getTime() - start.getTime() > 7 * 86400000
  )
    return false;
  const last = parisParts(end).date;
  for (let day = parisParts(start).date; day <= last; day = addDays(day, 1)) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow === 0 || holidays(Number(day.slice(0, 4))).has(day)) continue;
    const reservedStart = parseParis(`${day}T07:00`),
      reservedEnd = parseParis(`${day}T20:00`);
    if (start < reservedEnd && end > reservedStart) return false;
  }
  return true;
}
export function eligible(bay: Bay, start: Date, end: Date): boolean {
  if (bay.capacity <= 0 || bay.customHours || end <= start) return false;
  if (bay.kind === "shared") return sharedAllowed(start, end);
  if (bay.kind === "paid" && end.getTime() - start.getTime() > 6 * 3600000)
    return false;
  return true;
}
export function rushFactor(date: Date, enabled: boolean) {
  if (!enabled) return 1;
  const p = parisParts(date),
    dow = new Date(`${p.date}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6 || holidays(p.year).has(p.date)) return 1.1;
  return (p.hour >= 7 && p.hour < 10) || (p.hour >= 16 && p.hour < 20)
    ? 1.35
    : 1.1;
}
export function defaultTimes() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 15, 0, 0);
  const end = new Date(now.getTime() + 4 * 3600000);
  return { departure: parisInput(now), returnAt: parisInput(end) };
}
