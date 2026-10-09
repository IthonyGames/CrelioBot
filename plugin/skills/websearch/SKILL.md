---
name: websearch
description: Grok-style parallel web research with persona agents, at three depths — fast (quick narrow answer), medium (nuanced answer, default) and deep (full picture of a big multi-question problem). Use for anything the KB and model knowledge do not cover, anything recent, prices, laws, trends.
---

> Vendored from [IthonyGames/websearch-skill](https://github.com/IthonyGames/websearch-skill) (MIT, © 2026 Anthony Massicotte) — see LICENSE in this folder.

## Depths in CrelioBot

| Depth | Use when | Run as |
|---|---|---|
| **fast** | One narrow fact, a definition, a version number, a quick check for another agent | `--fast` |
| **medium** | A question that needs nuance or a comparison (default) | default (3 personas) |
| **deep** | A big problem with several sub-questions, a decision with real stakes, legal or market landscapes | `--deep` (5 personas) or `--agents=7` |

Pick the smallest depth that answers the question. In CrelioBot, keep the research folder inside the KB (`research/`) unless the KB has its own research convention, and post the TL;DR plus the key sources in the Task thread with `post` — the full brief goes as an attached file when it is long.


# /websearch — Grok-style parallel agent research

**Usage:**
```
/websearch [query]                           # 3 agents, ~100-200 sources (~20-40s)
/websearch [query] --fast                    # 3 direct WebSearch, no agents (~5-10s, 30 sources)
/websearch [query] --deep                    # 5 agents, ~200-400 sources (~45-90s)
/websearch [query] --agents=7                # N agents (max 7)
/websearch [query] --domains=site1,site2     # restrict domains
/websearch [query] --recent=7d               # 24h|7d|30d|1y
/websearch [query] --lang=fr                 # bias to language
/websearch [query] --no-write                # chat-only (skip folder)
```

## Architecture: 3 persona agents (default)

Inspired by Grok's multi-agent research pattern. Each agent has a **cognitive angle**, not just a query variation.

```
User query
    |
    v
[Parse + generate sub-queries per persona]
    |
    +---> Agent 1: RESEARCHER (primary sources, official docs, technical depth)
    |         - 4-5 WebSearch (different angles)
    |         - 3 WebFetch (top results for full content)
    |         - Returns structured findings
    |
    +---> Agent 2: SYNTHESIZER (comparisons, community, practical takes)
    |         - 4-5 WebSearch (different angles)
    |         - 3 WebFetch (top results for full content)
    |         - Returns structured findings
    |
    +---> Agent 3: ANALYST (criticism, limitations, edge cases, fact-check)
    |         - 4-5 WebSearch (different angles)
    |         - 3 WebFetch (top results for full content)
    |         - Returns structured findings
    |
    v
[Synthesize all findings, dedupe, rank, cross-verify]
    |
    v
[Write report + output to chat]
```

## Workflow

### Step 1: Parse query + flags (instant)

Extract: query, flags, language. Auto-detect `--deep` triggers: "exhaustive", "deep dive", "comprehensive", "survey of", "tout ce qui existe sur".

### Step 2: Generate persona-specific sub-queries

For each persona, generate 4-5 targeted search queries that match their cognitive angle:

**RESEARCHER queries (depth + authority):**
- `[query]` — baseline definition/explanation
- `[query] official documentation guide` — authoritative sources
- `[query] technical details how it works` — mechanism/internals
- `[query] research paper study 2025 2026` — academic/recent findings
- `[query] site:github.com OR site:stackoverflow.com` — code/technical community

**SYNTHESIZER queries (breadth + practical):**
- `[query] best comparison vs alternatives 2026` — comparative analysis
- `[query] tutorial how to setup guide` — practical implementation
- `[query] reddit OR hackernews experience` — community experience
- `[query] use case real world example` — practical applications
- `[query] [language-specific variant]` — localized results if non-English

**ANALYST queries (criticism + verification):**
- `[query] limitations problems cons criticism` — negative signals
- `[query] common mistakes pitfalls avoid` — failure modes
- `[query] controversy debate opinion` — contested aspects
- `[query] security risk vulnerability concern` — risk assessment
- `[query] alternative better than` — competitive landscape

### Step 3: Dispatch 3 agents in ONE parallel tool block

**CRITICAL: All 3 Agent calls go in a SINGLE message.** Never sequential.

**MODEL — run persona agents on a fast/cheap model:** pass a smaller model in each agent call. Research fan-out is breadth work (WebSearch + WebFetch + summarize), not deep reasoning — a smaller model is faster and much cheaper, and the synthesis step (Step 4, in the main session) keeps the quality bar. Applies to `--deep` and `--agents=N` too: all dispatched persona agents use the smaller model.

Each agent gets this prompt template (adapt per persona):

```
You are the [PERSONA_NAME] agent for a web research task.

QUERY: [user query]
YOUR ANGLE: [persona description]
LANGUAGE: [query language — match it in your output]

INSTRUCTIONS:
1. Run these WebSearch calls IN PARALLEL (one tool block):
   [list of 4-5 search queries]

2. From ALL search results, pick the 3 most valuable URLs for your angle.
   Run WebFetch on those 3 URLs IN PARALLEL.

3. Analyze everything. Return a structured report:

## [PERSONA_NAME] Findings

### Key Discoveries
- [finding 1] — source: [url]
- [finding 2] — source: [url]
...

### Page Deep-Dives
For each fetched page:
- **[Title]** ([url]): [2-3 sentence summary of key content]

### All Sources Found
[numbered list of ALL unique URLs from search results with one-line descriptions]

### Confidence Assessment
- High confidence: [topics well-covered]
- Low confidence: [topics with conflicting/sparse info]
- Gaps: [what you couldn't find]

IMPORTANT:
- Run WebSearch calls in PARALLEL (single tool block)
- Run WebFetch calls in PARALLEL (single tool block)
- Never fabricate URLs
- Match the query language in your output
- Be thorough but concise
```

### Step 4: Synthesize all agent findings

Once all 3 agents return:

1. **Merge all sources** — dedupe by normalized URL (lowercase, strip trailing `/`, drop utm_*/fbclid/gclid)
2. **Cross-verify** — when agent findings conflict, note the disagreement and which sources support each side
3. **Rank by credibility — the hierarchy depends on the claim type:**
   - Primary source cited by multiple agents > single-agent source
   - **For factual claims** (how something works, what a rule says, what a number is):
     official/gov/org > established media/wiki > forums > unknown blogs
   - **For experience claims** (what it is like, what people do, how they react):
     **invert it.** A dated first-person account with a visible score and a comment
     thread outranks an article *about* those accounts. Journalism here is secondary
     reporting on the primary source you already have.
   - Never let a forum post outrank documentation on a factual question, and never let
     an article outrank a first-person account on an experience question.
4. **Identify consensus** — what all 3 agents agree on = high confidence
5. **Identify debates** — where agents disagree = nuance section
6. **Count unique sources** — report actual number

### Step 5: Write output

Write `research/YYYY-MM-DD_HHMM/_brief.md` (skip if `--no-write`) and output to chat.

## `--fast` mode (legacy: 3 direct WebSearch)

For quick lookups where full agent research is overkill:

1. Generate 3 sub-queries (baseline, comparison, criticism)
2. Fire 3 WebSearch in ONE parallel tool block (10 results each = 30 sources)
3. Synthesize directly — no agents, no WebFetch
4. Output brief

## `--deep` mode: 5 agents

Adds 2 more personas:

**HISTORIAN (timeline + evolution):**
- `[query] history evolution timeline`
- `[query] before after change 2024 2025 2026`
- `[query] deprecated old version migration`
- `[query] roadmap future plans upcoming`

**PRACTITIONER (implementation + real-world):**
- `[query] production experience lessons learned`
- `[query] case study company uses`
- `[query] benchmark performance comparison`
- `[query] cost pricing enterprise`
- `[query] integration with [related tools]`

Each does 4-5 WebSearch + 3 WebFetch = ~25 searches + ~15 page fetches total across 5 agents.

## `--agents=N` scales further (max 7)

N=6 adds: **LOCALE** (non-English sources, regional perspectives)
N=7 adds: **CONTRARIAN** (explicitly seeks opposing viewpoints, minority opinions)

## Agent persona specifications

| # | Persona | Cognitive Angle | Search Style | Fetch Priority |
|---|---------|----------------|-------------|----------------|
| 1 | RESEARCHER | Depth, authority, mechanism | Official docs, papers, technical | Documentation, specs |
| 2 | SYNTHESIZER | Breadth, practical, community | Tutorials, Reddit, comparisons | Guides, reviews |
| 3 | ANALYST | Critical, risks, edge cases | Limitations, debates, security | Critical analyses |
| 4 | HISTORIAN | Timeline, evolution, future | Changelogs, roadmaps, migrations | Release notes |
| 5 | PRACTITIONER | Real-world, production, cost | Case studies, benchmarks, pricing | Experience reports |
| 6 | LOCALE | Non-English, regional | Localized queries, regional forums | Local guides |
| 7 | CONTRARIAN | Opposition, minority views | Counter-arguments, failed attempts | Dissenting opinions |

## Strict rules

- **All agents dispatched in ONE parallel tool block** — never sequential agents.
- **Each agent runs its WebSearch calls in parallel** — never sequential searches within an agent.
- **Each agent runs its WebFetch calls in parallel** — never sequential fetches.
- **Default = 3 agents.** Only use `--fast` for trivial lookups.
- **Agent tool whitelist:** WebSearch, WebFetch, Read, Write. No MCP, no Bash, no Browser.
- **Dedupe by normalized URL** (lowercase, strip trailing `/`, drop utm_*/fbclid/gclid).
- **Cross-verification required** — when 2+ agents find conflicting info, flag it explicitly.
- **Never fabricate citations.** Every `[N]` = real URL from agent results.
- **Language match:** French query = French brief. English = English. Mixed = match dominant.
- **Rate limit:** retry failed search once per agent, then skip. Never block.
- Dispatch persona agents as general-purpose subagents with WebSearch + WebFetch available.

## Output format

```
# [query]
**Mode:** [default|fast|deep]  |  **Agents:** [N]  |  **Sources:** [count]  |  **Pages fetched:** [count]  |  **Time:** ~Xs
[**Folder:** research/YYYY-MM-DD_HHMM/ — unless --no-write]

## TL;DR
[2-3 sentences: direct answer with highest-confidence findings]

## Key Findings

### Consensus (all agents agree)
- Finding 1 [1][4][12]
- Finding 2 [3][7][15]

### Nuances (partial agreement)
- Topic A: Researcher says X [5], Analyst says Y [9] — [interpretation]
- Topic B: Mixed signals — [summary]

### Debates (agents disagree)
- Controversial point: [Agent1] found [X], [Agent3] found [opposite] — [sources]

## Deep Dives (from page fetches)
- **[Title]** ([domain]): [key insight from full page content] [N]
- **[Title]** ([domain]): [key insight] [N]
...

## All Sources
[1] [credibility] Title — url
[2] [credibility] Title — url
...
[N] [credibility] Title — url

Credibility: [P] primary/official  [E] established media  [C] community/forum  [B] blog/unknown

## Gaps & Low Confidence
- [topics where info was sparse or conflicting]

## Follow-ups
- Related question 1
- Related question 2
```

## Folder layout

**Default mode (3 agents):**
```
research/2026-04-17_1445/
+-- _brief.md              # Same as chat output
+-- _sources.json          # {url, title, credibility, agent, rank}
+-- agent-researcher.md    # Raw findings from Researcher
+-- agent-synthesizer.md   # Raw findings from Synthesizer
+-- agent-analyst.md       # Raw findings from Analyst
```

**--deep adds:**
```
+-- agent-historian.md
+-- agent-practitioner.md
```

## Performance targets

| Mode | Agents | Searches | Pages Fetched | Sources | Time |
|------|--------|----------|---------------|---------|------|
| `--fast` | 0 | 3 | 0 | ~30 | 5-10s |
| default | 3 | 12-15 | 9 | 100-200 | 20-40s |
| `--deep` | 5 | 20-25 | 15 | 200-400 | 45-90s |
| `--agents=7` | 7 | 28-35 | 21 | 300-500 | 60-120s |

## Notes

- Install as a global command (`~/.claude/commands/websearch.md`) to use it in every project.
- Auto-suggest `--deep` if query contains: "exhaustive", "deep dive", "comprehensive", "survey of", "tout ce qui existe".
- Output language matches query language.
- When a persona finds nothing useful for their angle, they say so explicitly rather than padding with weak results.
- The ANALYST persona is the quality gate — its job is to challenge the other agents' findings.
