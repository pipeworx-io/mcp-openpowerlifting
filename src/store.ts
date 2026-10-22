/**
 * D1 reads for openpowerlifting (fleet #2986).
 *
 * Data: the OpenPowerlifting project's bulk results database (public domain),
 * loaded into a D1 database the gateway hands this pack as `_d1`
 * (pack-manifest "d1Binding": "OPENPOWERLIFTING_DB") by
 * scripts/openpowerlifting/load-data.mjs -- never by a deploy. Plain
 * positional `?` placeholders only (the smoke shim mangles numbered ones).
 */

export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export class StoreUnavailableError extends Error {
  constructor() {
    super(
      'openpowerlifting: the results store is not bound in this runtime (no _d1). These tools only answer through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'StoreUnavailableError';
  }
}
export function requireDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new StoreUnavailableError();
  return d1 as D1Like;
}

export const SOURCE = {
  source: 'OpenPowerlifting (openpowerlifting.org), powerlifting meet results database',
  licence: 'Public domain -- the project waives all rights in the data (attribution requested, not required)',
};

export interface Meta {
  loaded_at: string;
  release: string;
  latest_meet_date: string;
  entries: number;
  meets: number;
}
export async function getMeta(db: D1Like): Promise<Meta> {
  const r = await db.prepare('SELECT key, value FROM opl_meta').all<{ key: string; value: string }>();
  const m = Object.fromEntries(r.results.map((x) => [x.key, x.value]));
  if (!m.loaded_at) throw new Error('openpowerlifting: opl_meta is empty -- the store has not been loaded.');
  return {
    loaded_at: m.loaded_at,
    release: m.release ?? '',
    latest_meet_date: m.latest_meet_date ?? '',
    entries: Number(m.entries ?? 0),
    meets: Number(m.meets ?? 0),
  };
}

export const EQUIPMENT = ['Raw', 'Wraps', 'Single-ply', 'Multi-ply', 'Unlimited', 'Straps'] as const;
export const SEXES = ['M', 'F', 'Mx'] as const;
export const LIFTS = ['total', 'squat', 'bench', 'deadlift', 'dots'] as const;
export type Lift = (typeof LIFTS)[number];

export interface EntryRow {
  meet_id: number;
  name: string;
  sex: string;
  event: string | null;
  equipment: string | null;
  age: number | null;
  age_class: string | null;
  division: string | null;
  bodyweight_kg: number | null;
  weight_class: string | null;
  squat_kg: number | null;
  bench_kg: number | null;
  deadlift_kg: number | null;
  total_kg: number | null;
  place: string | null;
  dots: number | null;
  wilks: number | null;
  goodlift: number | null;
  tested: number;
  country: string | null;
  // joined meet columns
  date: string;
  meet_name: string;
  federation: string;
  meet_country: string | null;
}

const ENTRY_COLS =
  'e.meet_id, e.name, e.sex, e.event, e.equipment, e.age, e.age_class, e.division, e.bodyweight_kg, e.weight_class, e.squat_kg, e.bench_kg, e.deadlift_kg, e.total_kg, e.place, e.dots, e.wilks, e.goodlift, e.tested, e.country, m.date, m.name AS meet_name, m.federation, m.country AS meet_country';

/** "John Doe" matches "john doe" and the disambiguated "john doe #1", "#2"...
 *  as a range scan on the name index ('#' is 0x23, '$' the next code point). */
export function nameRange(name: string): { eq: string; lo: string; hi: string } {
  const lc = name.trim().toLowerCase();
  return { eq: lc, lo: `${lc} #`, hi: `${lc} $` };
}

export interface LifterCandidate {
  name: string;
  sex: string;
  country: string | null;
  entries: number;
  first_date: string;
  last_date: string;
  best_total_kg: number | null;
}
export async function lifterCandidates(db: D1Like, name: string): Promise<LifterCandidate[]> {
  const r = nameRange(name);
  const res = await db
    .prepare(
      `SELECT e.name AS name, MAX(e.sex) AS sex, MAX(e.country) AS country, count(*) AS entries, MIN(m.date) AS first_date, MAX(m.date) AS last_date, MAX(e.total_kg) AS best_total_kg
       FROM opl_entry e JOIN opl_meet m ON m.id = e.meet_id
       WHERE (e.name_lc = ? OR (e.name_lc >= ? AND e.name_lc < ?))
       GROUP BY e.name ORDER BY entries DESC LIMIT 25`,
    )
    .bind(r.eq, r.lo, r.hi)
    .all<LifterCandidate>();
  return res.results;
}

export interface LifterSummary {
  entries: number;
  first_date: string;
  last_date: string;
  best_squat_kg: number | null;
  best_bench_kg: number | null;
  best_deadlift_kg: number | null;
  best_total_kg: number | null;
  best_dots: number | null;
  federations: string | null;
}
export async function lifterSummary(db: D1Like, exactName: string, equipment: string | null): Promise<LifterSummary | null> {
  return db
    .prepare(
      `SELECT count(*) AS entries, MIN(m.date) AS first_date, MAX(m.date) AS last_date, MAX(e.squat_kg) AS best_squat_kg, MAX(e.bench_kg) AS best_bench_kg, MAX(e.deadlift_kg) AS best_deadlift_kg, MAX(e.total_kg) AS best_total_kg, MAX(e.dots) AS best_dots, GROUP_CONCAT(DISTINCT m.federation) AS federations
       FROM opl_entry e JOIN opl_meet m ON m.id = e.meet_id WHERE e.name = ?${equipment ? ' AND e.equipment = ?' : ''}`,
    )
    .bind(...[exactName, ...(equipment ? [equipment] : [])])
    .first<LifterSummary>();
}
export async function lifterEntries(db: D1Like, exactName: string, equipment: string | null, limit: number, offset: number): Promise<EntryRow[]> {
  const r = await db
    .prepare(
      `SELECT ${ENTRY_COLS} FROM opl_entry e JOIN opl_meet m ON m.id = e.meet_id WHERE e.name = ?${equipment ? ' AND e.equipment = ?' : ''} ORDER BY m.date DESC, e.meet_id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...[exactName, ...(equipment ? [equipment] : []), limit, offset])
    .all<EntryRow>();
  return r.results;
}

export interface MeetRow {
  id: number;
  federation: string;
  parent_federation: string | null;
  date: string;
  name: string;
  country: string | null;
  state: string | null;
  town: string | null;
  sanctioned: number | null;
  entries?: number;
}
export async function meetById(db: D1Like, id: number): Promise<MeetRow | null> {
  return db.prepare('SELECT id, federation, parent_federation, date, name, country, state, town, sanctioned FROM opl_meet WHERE id = ?').bind(id).first<MeetRow>();
}
export async function findMeets(db: D1Like, text: string, federation: string | null, year: number | null, limit: number): Promise<MeetRow[]> {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const where = words.map(() => 'name_lc LIKE ?');
  const binds: unknown[] = words.map((w) => `%${w}%`);
  if (federation) {
    where.push('federation = ? COLLATE NOCASE');
    binds.push(federation);
  }
  if (year) {
    where.push('date >= ? AND date <= ?');
    binds.push(`${year}-01-01`, `${year}-12-31`);
  }
  if (!where.length) return [];
  const r = await db
    .prepare(
      `SELECT id, federation, parent_federation, date, name, country, state, town, sanctioned, (SELECT count(*) FROM opl_entry e WHERE e.meet_id = opl_meet.id) AS entries FROM opl_meet WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<MeetRow>();
  return r.results;
}

export interface MeetFilter {
  sex: string | null;
  equipment: string | null;
  weightClass: string | null;
  division: string | null;
}
function meetWhere(f: MeetFilter): { sql: string; binds: unknown[] } {
  const w = ['e.meet_id = ?'];
  const b: unknown[] = [];
  if (f.sex) { w.push('e.sex = ?'); b.push(f.sex); }
  if (f.equipment) { w.push('e.equipment = ?'); b.push(f.equipment); }
  if (f.weightClass) { w.push('e.weight_class = ?'); b.push(f.weightClass); }
  if (f.division) { w.push('e.division = ? COLLATE NOCASE'); b.push(f.division); }
  return { sql: w.join(' AND '), binds: b };
}
export async function meetEntryCount(db: D1Like, meetId: number, f: MeetFilter): Promise<number> {
  const { sql, binds } = meetWhere(f);
  const r = await db.prepare(`SELECT count(*) AS n FROM opl_entry e WHERE ${sql}`).bind(meetId, ...binds).first<{ n: number }>();
  return r?.n ?? 0;
}
export async function meetEntries(db: D1Like, meetId: number, f: MeetFilter, limit: number, offset: number): Promise<EntryRow[]> {
  const { sql, binds } = meetWhere(f);
  const r = await db
    .prepare(
      `SELECT ${ENTRY_COLS} FROM opl_entry e JOIN opl_meet m ON m.id = e.meet_id WHERE ${sql}
       ORDER BY e.sex, e.equipment, e.division, e.weight_class, CASE WHEN e.place GLOB '[0-9]*' THEN CAST(e.place AS INTEGER) ELSE 9999 END, e.name LIMIT ? OFFSET ?`,
    )
    .bind(meetId, ...binds, limit, offset)
    .all<EntryRow>();
  return r.results;
}

const LIFT_COL: Record<Lift, string> = {
  total: 'total_kg',
  squat: 'squat_kg',
  bench: 'bench_kg',
  deadlift: 'deadlift_kg',
  dots: 'dots',
};
export interface RecordFilter {
  sex: string;
  equipment: string;
  lift: Lift;
  event: string | null;
  weightClass: string | null;
  federation: string | null;
  ageClass: string | null;
  tested: boolean | null;
  year: number | null;
}
export async function topEntries(db: D1Like, f: RecordFilter, fetch: number): Promise<EntryRow[]> {
  const col = LIFT_COL[f.lift];
  const w = ['e.sex = ?', 'e.equipment = ?', `e.${col} IS NOT NULL`];
  const b: unknown[] = [f.sex, f.equipment];
  if (f.event) { w.push('e.event = ?'); b.push(f.event); }
  if (f.weightClass) { w.push('e.weight_class = ?'); b.push(f.weightClass); }
  if (f.ageClass) { w.push('e.age_class = ?'); b.push(f.ageClass); }
  if (f.tested != null) { w.push('e.tested = ?'); b.push(f.tested ? 1 : 0); }
  if (f.federation) { w.push('m.federation = ? COLLATE NOCASE'); b.push(f.federation); }
  if (f.year) { w.push('m.date >= ? AND m.date <= ?'); b.push(`${f.year}-01-01`, `${f.year}-12-31`); }
  const r = await db
    .prepare(`SELECT ${ENTRY_COLS} FROM opl_entry e JOIN opl_meet m ON m.id = e.meet_id WHERE ${w.join(' AND ')} ORDER BY e.${col} DESC LIMIT ?`)
    .bind(...b, fetch)
    .all<EntryRow>();
  return r.results;
}
