export const AUTO_TIMEZONE = "";

const FALLBACK_ZONES = [
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Warsaw",
  "UTC",
];

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function listTimeZones(): string[] {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const zones = supported?.("timeZone");
    if (zones?.length) return zones;
  } catch {
    // Older WebViews do not expose supportedValuesOf.
  }
  return FALLBACK_ZONES;
}

export function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function zoneTime(zone: string, now = new Date()): string {
  let formatter = FORMATTERS.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("pl-PL", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return "";
    }
    FORMATTERS.set(zone, formatter);
  }
  return formatter.format(now);
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function filterTimeZones(zones: readonly string[], query: string): string[] {
  const needle = fold(query.trim());
  if (!needle) return [...zones];
  return zones.filter((zone) => `${fold(zone)} ${fold(zoneLabel(zone))}`.includes(needle));
}
