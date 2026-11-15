// Interprétation simplifiée du tag OSM opening_hours, suffisante pour les ascenseurs publics.
// Formats gérés : "24/7", "06:00-24:00", "Mo-Fr 07:00-21:00; Sa,Su 08:00-20:00",
// "Mo-Su 06:00-01:00" (plage qui passe minuit), "off"/"closed", plusieurs plages "07:00-12:00,14:00-19:00".
// Renvoie true (ouvert), false (fermé) ou null (format inconnu → à vérifier sur place).

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseDays(spec) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const p = part.trim();
    const range = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/);
    if (range) {
      let i = DAYS.indexOf(range[1]);
      const end = DAYS.indexOf(range[2]);
      for (let n = 0; n < 7; n++) {
        set.add(i);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else if (DAYS.includes(p)) set.add(DAYS.indexOf(p));
    else if (p === 'PH') continue; // jours fériés : ignorés dans cette version
    else return null;
  }
  return set;
}

function toMin(hhmm) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Liste des règles { days:Set|null, ranges:[[start,end]]|'off' } ou null si non reconnu. */
export function parseOpeningHours(value) {
  if (!value) return null;
  const v = value.trim();
  if (v === '24/7') return [{ days: null, ranges: [[0, 1440]] }];
  const rules = [];
  for (const raw of v.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?\s*(.*)$/);
    if (!m) return null;
    let days = null;
    if (m[1]) {
      days = parseDays(m[1].trim().replace(/,$/, ''));
      if (!days) return null;
    }
    const times = m[2].trim();
    if (/^(off|closed)$/i.test(times)) {
      rules.push({ days, ranges: 'off' });
      continue;
    }
    if (times === '24/7' || times === '00:00-24:00') {
      rules.push({ days, ranges: [[0, 1440]] });
      continue;
    }
    const ranges = [];
    for (const r of times.split(',')) {
      const mm = r.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!mm) return null;
      ranges.push([toMin(mm[1]), toMin(mm[2])]);
    }
    if (!ranges.length) return null;
    rules.push({ days, ranges });
  }
  return rules.length ? rules : null;
}

/** Ouvert à la date donnée ? true / false / null (inconnu). Sans tag : null. */
export function isOpen(value, date = new Date()) {
  const rules = parseOpeningHours(value);
  if (!rules) return null;
  const day = date.getDay();
  const prev = (day + 6) % 7;
  const min = date.getHours() * 60 + date.getMinutes();
  // Règle applicable : la dernière qui couvre le jour (sémantique OSM : les règles suivantes écrasent)
  const ruleFor = (d) => {
    let found;
    for (const r of rules) if (!r.days || r.days.has(d)) found = r;
    return found;
  };
  const today = ruleFor(day);
  if (today && today.ranges !== 'off') {
    for (const [s, e] of today.ranges) {
      if (e > s ? min >= s && min < e : min >= s) return true;
    }
  }
  // Plage de la veille qui déborde après minuit (ex. 06:00-01:00)
  const yesterday = ruleFor(prev);
  if (yesterday && yesterday.ranges !== 'off') {
    for (const [s, e] of yesterday.ranges) if (e <= s && min < e) return true;
  }
  return false;
}
