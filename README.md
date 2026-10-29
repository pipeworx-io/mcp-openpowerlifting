# @pipeworx/openpowerlifting

Powerlifting competition results from the OpenPowerlifting project -- a
lifter's meet-by-meet history, the full results of a meet, and all-time top
lifts by sex, equipment and weight class. About 4 million lifter entries
across about 64,000 meets, worldwide.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `opl_lifter_history(name, equipment?, limit?, offset?)` -- every meet a lifter
  entered (most recent first) with federation, division, bodyweight, weight
  class, best squat / bench / deadlift, total, place and Dots / Wilks /
  Goodlift points, plus career bests. Same-named lifters are numbered in the
  data ("John Smith #2"); an ambiguous name returns the candidates rather than
  mixing them.
- `opl_meet_results(meet_id | meet [+ federation, year], sex?, equipment?, weight_class?, division?, limit?, offset?)`
  -- the lifters of one meet ordered by sex, equipment, division, weight class
  and place. A name matching several meets returns the candidate list.
- `opl_records(sex, equipment?, lift?, weight_class?, federation?, age_class?, tested?, year?, event?, limit?)`
  -- top performances by total, squat, bench, deadlift or Dots, one row per
  lifter (their best qualifying entry). These are the best entries in the
  data under the filters given, not an official federation record list.

All weights are kilograms. Every response carries `source`, `licence` and
`data_as_of` (the release date of the loaded file).

## Auth

Keyless.

## Data sources

- OpenPowerlifting (openpowerlifting.org), powerlifting meet results database.

**Licence.** The project dedicates the data to the public domain and waives all
copyright and related rights in it; attribution is requested but not required.
The results are public competition records published by the project itself.

**What is in the copy, and what is not.**

- The best-of-three lifts, total, place, points and the meet/lifter descriptors
  are kept. The individual attempts (squat 1-4, bench 1-4, deadlift 1-4, with
  their made/missed marks) are not.
- The file is a snapshot: new meets appear on the next reload, and the project
  corrects old entries over time. `data_as_of` is the release date of the
  loaded file; `latest_meet_date` is the newest meet in it.
- *Same-name lifters.* The project numbers lifters it knows share a name
  ("John Smith #2"), but it cannot always tell two people apart; an
  un-numbered name can still mix more than one person's results, so check the
  federations and years in `career` before treating a history as one person.
- `place` is text: a number, or `DQ` (disqualified), `G` (guest), `NS`
  (no-show), `DD` (doping disqualification).
- Equipment categories are the federation's category, not necessarily what the
  lifter wore. `tested` is whether the federation drug-tests.
- Total is only populated when the lifter completed all the lifts of the event;
  `opl_records` ranks total over full three-lift (SBD) entries by default.
- Weight classes are strings as recorded (`83`, `84+`); a super-heavy class is
  the `+` form.

## Updating the data

OpenPowerlifting regenerates the file daily. Reload with (needs `wrangler`
logged in to the Pipeworx Cloudflare account):

```bash
node scripts/openpowerlifting/load-data.mjs
```

The loader DROPs and reloads the tables, verifies row counts against what it
generated and exits non-zero on a mismatch.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openpowerlifting": {
      "url": "https://gateway.pipeworx.io/openpowerlifting/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/openpowerlifting/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/opl_lifter_history \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ed Coan","limit":5}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/opl_lifter_history`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-openpowerlifting` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/openpowerlifting/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "openpowerlifting": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-openpowerlifting"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Openpowerlifting data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
