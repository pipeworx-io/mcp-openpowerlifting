interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * openpowerlifting -- powerlifting competition results from the
 * OpenPowerlifting project's public-domain results database.
 *
 * The project publishes a bulk file only (no query API); the results are held
 * in a D1 database the gateway hands this pack as `_d1`, loaded by
 * scripts/openpowerlifting/load-data.mjs (see src/store.ts). Individual
 * attempts are not kept: best-of-three lifts, total, place and points are.
 * Every response carries source, licence and data_as_of (the release date of
 * the loaded file).
 */
import {
  EQUIPMENT,
  findMeets,
  getMeta,
  LIFTS,
  lifterCandidates,
  lifterEntries,
  lifterSummary,
  meetById,
  meetEntries,
  meetEntryCount,
  requireDb,
  SEXES,
  SOURCE,
  topEntries,
  type EntryRow,
  type Lift,
} from './store.js';

const tools: McpToolExport['tools'] = [
  {
    name: 'opl_lifter_history',
    description:
      'Competition history of one powerlifter from the OpenPowerlifting results database: every meet entered (most recent first) with federation, event, equipment, division, bodyweight and weight class, best squat/bench/deadlift, total, place and Dots/Wilks/Goodlift points, plus career bests. Pass name as shown in results (e.g. "Ray Williams"; case-insensitive, exact name). Lifters who share a name are disambiguated in the data as "Name #1", "Name #2": a name that matches several lifters returns their candidates (name, country, entry count, years, best total) instead of mixing them -- pass the exact "Name #N". equipment (Raw, Wraps, Single-ply, Multi-ply, Unlimited, Straps) narrows the history and the bests. Rows page with limit/offset and report truncated/total_matching. An unknown name returns found:false with data_as_of, never an empty list. Weights are in kilograms.',
    summary: 'Meet-by-meet results and career bests for one powerlifter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Lifter name as in results, e.g. "Ray Williams" or "John Smith #2".' },
        equipment: { type: 'string', enum: [...EQUIPMENT], description: 'Only entries in this equipment category.' },
        limit: { type: 'number', description: 'Entries per page, 1-200 (default 50).' },
        offset: { type: 'number', description: 'Entries to skip (default 0).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'opl_meet_results',
    description:
      'Results of one powerlifting meet from the OpenPowerlifting database. Pass meet_id (from a previous call) or meet, a name search (every word must appear, e.g. "arnold classic"), optionally with federation (e.g. "USAPL", "IPF") and year to narrow it. If the search matches several meets the call returns the candidate list (meet_id, name, date, federation, town, country, entries) instead of guessing; with one match it returns the lifters ordered by sex, equipment, division, weight class and place, with bodyweight, best lifts, total, place and points. Optional filters sex (M/F/Mx), equipment, weight_class (e.g. "83", "84+") and division narrow the lifters. Rows page with limit/offset and report truncated/total_matching. No matching meet returns found:false with data_as_of. Weights are in kilograms.',
    summary: 'Lifter-by-lifter results of one powerlifting meet, or the meets matching a name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        meet_id: { type: 'number', description: 'Meet id from an earlier opl_meet_results / opl_lifter_history call.' },
        meet: { type: 'string', description: 'Meet name search, e.g. "world classic".' },
        federation: { type: 'string', description: 'Federation code, e.g. "IPF", "USAPL", "WRPF".' },
        year: { type: 'number', description: 'Meet year.' },
        sex: { type: 'string', enum: [...SEXES] },
        equipment: { type: 'string', enum: [...EQUIPMENT] },
        weight_class: { type: 'string', description: 'Weight class as recorded, e.g. "83" or "84+".' },
        division: { type: 'string', description: 'Division text, e.g. "Open", "Juniors 20-23".' },
        limit: { type: 'number', description: 'Lifters per page, 1-200 (default 50).' },
        offset: { type: 'number', description: 'Lifters to skip (default 0).' },
      },
    },
  },
  {
    name: 'opl_records',
    description:
      'All-time best powerlifting performances from the OpenPowerlifting database: the top lifters by total, squat, bench, deadlift or Dots points for a sex and equipment category, optionally narrowed by weight_class (e.g. "83", "84+"), federation, age_class (e.g. "24-34"), tested (drug-tested meets only) and year. One row per lifter (their best qualifying entry), with the meet and date. Lifts are in kilograms. total is only ranked over full three-lift (SBD) entries unless event is given. These are the best entries IN THE DATA, filtered as asked -- not an official federation record list (federations apply their own rules and equipment definitions). Nothing matching returns found:false with data_as_of.',
    summary: 'All-time top powerlifting lifts and totals by sex, equipment and weight class.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sex: { type: 'string', enum: [...SEXES], description: 'M, F or Mx.' },
        equipment: { type: 'string', enum: [...EQUIPMENT], description: 'Default Raw.' },
        lift: { type: 'string', enum: [...LIFTS], description: 'What to rank by (default total).' },
        weight_class: { type: 'string', description: 'e.g. "83", "93", "120+".' },
        federation: { type: 'string', description: 'Federation code, e.g. "IPF".' },
        age_class: { type: 'string', description: 'e.g. "24-34", "40-44".' },
        tested: { type: 'boolean', description: 'true = drug-tested meets only.' },
        year: { type: 'number', description: 'Only meets in this year.' },
        event: { type: 'string', description: 'SBD, B, D, BD, SB... Default SBD for lift=total; none otherwise.' },
        limit: { type: 'number', description: 'Lifters to return, 1-50 (default 10).' },
      },
      required: ['sex'],
    },
  },
];

function provenance(m: Awaited<ReturnType<typeof getMeta>>) {
  return {
    source: SOURCE.source,
    licence: SOURCE.licence,
    data_as_of: m.release || m.loaded_at.slice(0, 10),
    latest_meet_date: m.latest_meet_date,
    copy_refreshed_at: m.loaded_at.slice(0, 10),
  };
}

function shapeEntry(r: EntryRow, withLifter: boolean) {
  return {
    ...(withLifter ? { name: r.name } : {}),
    meet_id: r.meet_id,
    date: r.date,
    meet: r.meet_name,
    federation: r.federation,
    sex: r.sex,
    event: r.event,
    equipment: r.equipment,
    division: r.division,
    age: r.age,
    age_class: r.age_class,
    bodyweight_kg: r.bodyweight_kg,
    weight_class: r.weight_class,
    squat_kg: r.squat_kg,
    bench_kg: r.bench_kg,
    deadlift_kg: r.deadlift_kg,
    total_kg: r.total_kg,
    place: r.place,
    dots: r.dots,
    wilks: r.wilks,
    goodlift: r.goodlift,
    tested: !!r.tested,
  };
}

function enumArg<T extends string>(raw: unknown, allowed: readonly T[], label: string): T | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === s);
  if (!hit) throw new Error(`Invalid ${label} "${raw}". Use one of: ${allowed.join(', ')}.`);
  return hit;
}
function pageArgs(args: Record<string, unknown>, dflt: number, max: number) {
  return {
    limit: Math.min(max, Math.max(1, Math.trunc(Number(args.limit)) || dflt)),
    offset: Math.max(0, Math.trunc(Number(args.offset)) || 0),
  };
}

async function lifterHistory(args: Record<string, unknown>) {
  const db = requireDb(args._d1);
  const prov = provenance(await getMeta(db));
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) throw new Error('Pass name: the lifter name as it appears in results.');
  const equipment = enumArg(args.equipment, EQUIPMENT, 'equipment');
  const { limit, offset } = pageArgs(args, 50, 200);

  const cands = await lifterCandidates(db, name);
  if (!cands.length) return { found: false, reason: 'lifter_not_found', message: `No lifter named "${name}" in the results. Names are matched exactly (case-insensitive).`, ...prov };
  const exact = cands.find((c) => c.name.toLowerCase() === name.toLowerCase());
  let pick = exact ?? (cands.length === 1 ? cands[0] : null);
  if (!pick) {
    return {
      found: false,
      reason: 'ambiguous_name',
      message: `"${name}" matches ${cands.length} lifters (the database numbers same-named lifters "Name #N"). Pass the exact name of one.`,
      candidates: cands,
      ...prov,
    };
  }
  const summary = await lifterSummary(db, pick.name, equipment);
  if (!summary || !summary.entries) {
    return { found: false, reason: 'no_entries_for_equipment', lifter: pick.name, message: `${pick.name} has no ${equipment} entries.`, ...prov };
  }
  const rows = await lifterEntries(db, pick.name, equipment, limit, offset);
  const truncated = offset + rows.length < summary.entries;
  return {
    found: true,
    lifter: pick.name,
    sex: pick.sex,
    country: pick.country,
    career: {
      meets: summary.entries,
      first_meet: summary.first_date,
      last_meet: summary.last_date,
      federations: summary.federations ? summary.federations.split(',') : [],
      best_squat_kg: summary.best_squat_kg,
      best_bench_kg: summary.best_bench_kg,
      best_deadlift_kg: summary.best_deadlift_kg,
      best_total_kg: summary.best_total_kg,
      best_dots: summary.best_dots,
      ...(equipment ? { equipment } : {}),
    },
    total_matching: summary.entries,
    returned: rows.length,
    truncated,
    ...(truncated ? { hint: `Page on with offset=${offset + rows.length}, or narrow with equipment.` } : {}),
    results: rows.map((r) => shapeEntry(r, false)),
    ...prov,
  };
}

async function meetResults(args: Record<string, unknown>) {
  const db = requireDb(args._d1);
  const prov = provenance(await getMeta(db));
  const { limit, offset } = pageArgs(args, 50, 200);
  const filter = {
    sex: enumArg(args.sex, SEXES, 'sex'),
    equipment: enumArg(args.equipment, EQUIPMENT, 'equipment'),
    weightClass: typeof args.weight_class === 'string' && args.weight_class.trim() ? args.weight_class.trim() : null,
    division: typeof args.division === 'string' && args.division.trim() ? args.division.trim() : null,
  };
  let meetRow = null;
  const id = Math.trunc(Number(args.meet_id)) || 0;
  if (id) {
    meetRow = await meetById(db, id);
    if (!meetRow) return { found: false, reason: 'meet_id_not_found', meet_id: id, ...prov };
  } else {
    const text = typeof args.meet === 'string' ? args.meet : '';
    const fed = typeof args.federation === 'string' && args.federation.trim() ? args.federation.trim() : null;
    const year = Math.trunc(Number(args.year)) || null;
    if (!text.trim() && !fed && !year) throw new Error('Pass meet_id, or meet (a name search) optionally with federation and year.');
    const found = await findMeets(db, text, fed, year, 25);
    if (!found.length) return { found: false, reason: 'no_meet_match', message: 'No meet matches. Try fewer words, or drop federation/year.', ...prov };
    if (found.length > 1) {
      return {
        found: false,
        reason: 'multiple_meets',
        message: `${found.length === 25 ? '25+' : found.length} meets match. Pass the meet_id of one (most recent first).`,
        candidates: found.map((m) => ({ meet_id: m.id, name: m.name, date: m.date, federation: m.federation, town: m.town, country: m.country, entries: m.entries })),
        ...prov,
      };
    }
    meetRow = found[0];
  }
  const total = await meetEntryCount(db, meetRow.id, filter);
  if (!total) return { found: false, reason: 'no_entries_match_filters', meet_id: meetRow.id, meet: meetRow.name, date: meetRow.date, message: 'The meet exists but no lifters match the sex/equipment/weight_class/division filters.', ...prov };
  const rows = await meetEntries(db, meetRow.id, filter, limit, offset);
  const truncated = offset + rows.length < total;
  return {
    found: true,
    meet: {
      meet_id: meetRow.id,
      name: meetRow.name,
      date: meetRow.date,
      federation: meetRow.federation,
      parent_federation: meetRow.parent_federation,
      town: meetRow.town,
      state: meetRow.state,
      country: meetRow.country,
      sanctioned: meetRow.sanctioned == null ? null : !!meetRow.sanctioned,
    },
    total_matching: total,
    returned: rows.length,
    truncated,
    ...(truncated ? { hint: `Page on with offset=${offset + rows.length}, or narrow with sex, equipment, weight_class, division.` } : {}),
    results: rows.map((r) => {
      const { meet_id, date, meet, federation, ...rest } = shapeEntry(r, true);
      void meet_id; void date; void meet; void federation;
      return { ...rest, country: r.country };
    }),
    ...prov,
  };
}

async function records(args: Record<string, unknown>) {
  const db = requireDb(args._d1);
  const prov = provenance(await getMeta(db));
  const sex = enumArg(args.sex, SEXES, 'sex');
  if (!sex) throw new Error('Pass sex: M, F or Mx.');
  const equipment = enumArg(args.equipment, EQUIPMENT, 'equipment') ?? 'Raw';
  const lift = (enumArg(args.lift, LIFTS, 'lift') ?? 'total') as Lift;
  const event = typeof args.event === 'string' && args.event.trim() ? args.event.trim().toUpperCase() : lift === 'total' ? 'SBD' : null;
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(args.limit)) || 10));
  const FETCH = Math.min(400, limit * 8);
  const rows = await topEntries(
    db,
    {
      sex,
      equipment,
      lift,
      event,
      weightClass: typeof args.weight_class === 'string' && args.weight_class.trim() ? args.weight_class.trim() : null,
      federation: typeof args.federation === 'string' && args.federation.trim() ? args.federation.trim() : null,
      ageClass: typeof args.age_class === 'string' && args.age_class.trim() ? args.age_class.trim() : null,
      tested: typeof args.tested === 'boolean' ? args.tested : null,
      year: Math.trunc(Number(args.year)) || null,
    },
    FETCH,
  );
  if (!rows.length) return { found: false, reason: 'nothing_matches', message: 'No entries match these filters (check weight_class / age_class spelling, e.g. "83", "84+", "24-34").', ...prov };
  const seen = new Set<string>();
  const out: EntryRow[] = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push(r);
    if (out.length >= limit) break;
  }
  const incomplete = out.length < limit && rows.length >= FETCH;
  return {
    found: true,
    ranked_by: lift,
    sex,
    equipment,
    ...(event ? { event } : {}),
    returned: out.length,
    ...(incomplete ? { note: `Fewer than limit distinct lifters in the top ${FETCH} entries scanned; a few lifters hold many of the top entries. Raise nothing -- narrow the filters instead.` } : {}),
    rows: out.map((r, i) => ({ rank: i + 1, ...shapeEntry(r, true) })),
    ...prov,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'opl_lifter_history':
      return lifterHistory(args);
    case 'opl_meet_results':
      return meetResults(args);
    case 'opl_records':
      return records(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
