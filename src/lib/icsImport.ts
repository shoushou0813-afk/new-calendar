export interface ParsedIcsEvent {
  title: string;
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm */
  startsAt: string;
  /** HH:mm, only set when the event ends the same day it starts */
  endsAt: string | null;
  sourceUrl: string | null;
  note: string | null;
}

interface IcsLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Un-fold RFC 5545 line folding: a line starting with a space/tab continues the previous line. */
function unfoldLines(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseLine(line: string): IcsLine {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return { name: line.toUpperCase(), params: {}, value: '' };
  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const [k, v] = part.split('=');
    if (k && v) params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parses a DTSTART/DTEND value into a local date + time. A trailing "Z" (UTC) is converted to
 * the browser's local time zone via the JS Date object; a bare TZID or floating time is taken
 * at face value (treated as already-local) since resolving arbitrary IANA zones without a
 * timezone database is out of scope for a first pass.
 */
function parseDateTime(line: IcsLine): { date: string; time: string | null } {
  const raw = line.value;
  if (line.params.VALUE === 'DATE' || /^\d{8}$/.test(raw)) {
    return { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, time: null };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return { date: raw, time: null };
  const [, y, mo, d, h, mi, , z] = match;
  if (z === 'Z') {
    const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    return {
      date: `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}`,
      time: `${pad(utc.getHours())}:${pad(utc.getMinutes())}`,
    };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

function buildEvent(fields: Record<string, IcsLine>): ParsedIcsEvent | null {
  const dtstart = fields.DTSTART;
  if (!dtstart) return null;
  const start = parseDateTime(dtstart);
  if (!start.date) return null;

  let endsAt: string | null = null;
  if (fields.DTEND) {
    const end = parseDateTime(fields.DTEND);
    if (end.date === start.date && end.time) endsAt = end.time;
  }

  return {
    title: fields.SUMMARY ? unescapeText(fields.SUMMARY.value) : '(無題の予定)',
    date: start.date,
    startsAt: start.time ?? '00:00',
    endsAt,
    sourceUrl: fields.URL ? fields.URL.value : null,
    note: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION.value) : null,
  };
}

/** Parses the VEVENT blocks of an .ics (iCalendar) file into a flat list of events. */
export function parseIcs(text: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, IcsLine> | null = null;

  for (const raw of unfoldLines(text)) {
    if (raw === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (raw === 'END:VEVENT') {
      if (current) {
        const event = buildEvent(current);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(raw);
    current[parsed.name] = parsed;
  }
  return events;
}
