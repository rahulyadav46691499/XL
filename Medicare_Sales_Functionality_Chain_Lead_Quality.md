# The Chain, Second Case — The Lead Source That Flooded the Southwest

**Companion to `Medicare_Sales_Functionality_Chain.md`.** That document walks
the chain on an *agent* (AG-0027) and ends in a commission recovery. This one
walks the same seven tabs on a *lead source*, and ends somewhere different: a
vendor suspension. Same order, same logic — each tab exists because the
previous one left a question unanswered — but the evidence, the remedy and the
traps along the way are all new.

Persona: **Morgan**, Medicare Advantage sales analyst (`u-ma`).
Case: lead source **LS-TELE-03** (Telesales, vendor **VND-03**).
Market: **Southwest**, quarter **2026Q4**.
Domain: Healthcare Sales — Medicare Distribution.
Every figure was run against the live engine before this was written, on Mock,
at Morgan's scope.

---

## The chain in one sentence each

| # | Tab | Opened because… | Leaves you needing… |
|---|---|---|---|
| 1 | **Pillars** | it already ran, without being asked | to know whether the source is bad, or just had a bad quarter |
| 2 | **Chat** | only you can ask the sizing question | to explain why Chat's number looks *better* than Pillars' |
| 3 | **Ontology** + **Context Brain** | you are about to cut off a vendor's revenue | a second opinion you did not compute |
| 4 | **Swarm** | one analyst's reading is not evidence | the finding to become somebody's job |
| 5 | **Cases** | a screen is not work; a case has an owner | the number after the replacement leads are paid for |
| 6 | **Simulator** | "and what does that actually net us?" | someone authorised to act |
| 7 | **Actions** | proposing is where an analyst's job ends | — |

Read the last column down the page: every "leaves you needing" is the next
row's "opened because".

---
---

# 1 · Pillars — the flood nobody reported

### Why you start here

For the same reason as last time: Pillars is the only screen that has already
run every rule before you opened it. Nobody files a ticket saying "a vendor
sent us too many leads". Volume looks like success right up until somebody
tries to convert it.

### What to feed it

Nothing. Use the **search box** to filter by rule ID:

| Type this | To see |
|---|---|
| `LEAD-QUALITY-FLOOR` | lead sources below the 0.40 qualified-lead floor |
| `CAC-CEILING` | markets paying more than $100 per effectuated enrolment |
| `LEAD-SLA-FOLLOWUP` | outreach landing outside its follow-up SLA |

### What you get

The same **49 breaches across 12 rules** as the AG-0027 case — this is the
same book, read from a different angle. Last time you chose by *how many rules
one name appears in*. This time the move is different: **look for two rules
from different departments that name the same place.**

| Rule | Owner | Breach |
|---|---|---|
| `LEAD-QUALITY-FLOOR` | Marketing | **LS-TELE-03** — **0.2222** qualified-lead rate on **99** leads in **Southwest 2026Q4**, **$113.40** per qualified lead |
| `CAC-CEILING` | Finance | **Medicare Advantage / Southwest** — **$106.89** per effectuated enrolment on 450 leads, above the $100 ceiling |

One is a vendor-quality rule. The other is an acquisition-economics rule. Both
point at the Southwest, and only one lead source breaches the quality floor
anywhere in the book.

### The one you should *not* chase

`LEAD-SLA-FOLLOWUP` breaches **six times** — every outreach type, from Mail at
**0.0785** to Appointment at **0.1335** inside SLA against a 0.50 floor. It is
loud, and it is book-wide. A problem that is everywhere does not explain why
*one* market went over the cost ceiling. Note it, and move on. (Step 4 comes
back to this and shows you were right to.)

### Finding

> **One lead source delivered 99 leads into the Southwest in a single quarter,
> only 22 qualified, at $113.40 each — and the same market is the only one
> above the acquisition-cost ceiling.**

### → Why Chat next

You have a breach in one market and one quarter. The obvious challenge is:
*"Is LS-TELE-03 a bad source, or did it have one bad quarter?"* That decides
whether the remedy is "suspend the vendor" or "have a word with the vendor".
**Pillars only shows the rows that broke.** It cannot show you what normal
looks like for this source.

---
---

# 2 · Chat — sizing the source, and the trap in the average

### Why you come here

To see LS-TELE-03 next to every other lead source, across the whole book.

### What to feed it — the five questions

| # | Type exactly | Returns | Trust |
|---|---|---|---|
| 1 | `qualified lead rate by lead source` | 10 sources, rate | 100% |
| 2 | `cost per qualified lead by lead source` | 10 sources, dollars | 96% |
| 3 | `lead to enrollment rate by lead source` | 10 sources, rate | 100% |
| 4 | `campaign spend by lead source` | 10 sources, dollars | 100% |
| 5 | `qualified lead rate by market` | 5 markets | 96% |

> **Three questions that look right and are not.** Avoid these in a live demo:
>
> | You type | What happens |
> |---|---|
> | `cost per effectuated enrollment by market` | **70%**, under the 85% gate, SQL withheld |
> | `lead followup compliance by activity type` | **73%**, withheld, and the rows come back by quarter |
> | `qualified lead rate by lead quarter` | 93%, but it **silently returns by market** — the quarter dimension is dropped |
>
> The last one is the dangerous one: it passes the gate and answers a
> different question from the one you asked. Read the column header, not just
> the chart.

### Example — the number that makes Pillars look wrong

Ask #1. LS-TELE-03 is there, at:

| Question | LS-TELE-03 | Rank |
|---|---|---|
| `qualified lead rate by lead source` | **0.4286** | **8 of 10** |

**0.4286 is above the 0.40 floor.** Across its whole life, LS-TELE-03 is a
below-average source but not a breaching one. Someone in the room will say
exactly this: *"Chat says it's fine."*

That is not a contradiction. It is an average hiding a collapse. Chat's
question is "how good is this source, overall". The rule's question is "how
good was this source, in this market, in this quarter, on at least 30 leads".
Ask #2 and #3 and the overall picture holds up: mediocre, not broken:

| Question | LS-TELE-03 | Rank |
|---|---|---|
| `cost per qualified lead by lead source` | **$53.20** | 3rd most expensive |
| `campaign spend by lead source` | **$6,664** | 5th of 10 |

### Where the collapse actually is

Chat cannot filter to one source and split by quarter, so this comes from the
record. Take it back to the **Pillars** evidence panel on the
`LEAD-QUALITY-FLOOR` row, which carries the same figures:

| LS-TELE-03 in the Southwest | Leads | Qualified rate |
|---|---|---|
| 2025Q4 | 11 | 0.2727 |
| 2026Q1 | 5 | 0.80 |
| 2026Q2 | 8 | 0.50 |
| 2026Q3 | 11 | 0.4545 |
| **2026Q4** | **99** | **0.2222** |

**Eleven leads, five, eight, eleven — then ninety-nine.** In every other market
the source sends single digits to a dozen leads a quarter. In 2026Q4 it sent
the Southwest **nine times its normal volume**, and the quality collapsed in
the same quarter. Of those 99 leads, **59 never left funnel stage Lead**, and
only **12** became effectuated members.

Now ask #5 and watch it land:

| `qualified lead rate by market` | Southwest **0.5356** | **5 of 5** |

The Southwest is the worst market in the book on lead quality. The quarter
split tells you why: Southwest ran around 0.59–0.65 every quarter until
**2026Q4, when it fell to 0.4378** — the quarter LS-TELE-03 delivered almost
half its leads (99 of 201).

> **Demo note.** Questions 1–5 are live in the Ask box. The quarter table and
> the 59-stalled count are case evidence from the underlying record; present
> them as such rather than typing them into Chat.

### Finding

> **LS-TELE-03 is a mediocre source that, in one quarter, dumped nine times its
> usual volume into one market at a 22% qualified rate — and dragged the whole
> Southwest to last place in the book.**

### → Why Ontology next

You are about to recommend cutting off a vendor's revenue. The vendor's first
response will be: *"your attribution is wrong — those weren't our leads."*
**Chat shows you the answer. It does not show you how a lead is tied to a
source.**

---
---

# 3 · Ontology (+ Context Brain) — proving the attribution and the bar

### Why you come here

Two challenges are coming: **"how do you know those leads are ours"** and
**"who decided 0.40 is the bar"**. Ontology answers the first, Context Brain
the second.

### What to feed it

| Control | What to enter | Example |
|---|---|---|
| **Search box** | an object type, edge or attribute | `Lead` |
| **CAPS vendor** dropdown | core admin platform to map against | `facets` |

### Example — search `Lead`

The edges that put a lead in front of a source, a person and a campaign:

```
Lead           -sourced_by->       Campaign    ON leads.campaign_id = campaigns.campaign_id
Lead           -assigned_to->      SalesAgent  ON leads.assigned_agent_id = sales_agents.agent_id
LeadActivity   -worked_on->        Lead        ON lead_activities.lead_id = leads.lead_id
Application    -originated_from->  Lead        ON applications.lead_id = leads.lead_id
```

Now search `LeadQualityCase`:

```
LeadQualityCase  -adjudicated_as->  Campaign  ON cases.subject = campaigns.lead_source
```

**The case you are about to open is keyed on the lead source, and the lead
source is a column on the campaign the vendor itself is contracted under** —
LS-TELE-03 belongs to **CAMP-07, "Telesales 2026Q1 Acquisition", vendor
VND-03**. The vendor cannot say the attribution is ours. It is theirs.

`Application -originated_from-> Lead` matters too. It is why the 12
effectuated members can be traced back to the 99 leads. The rule is counting
the vendor's leads all the way through to members, not guessing at it.

### The other half — Context Brain

Open **Context Brain → `policy_rules.md`** and read `LEAD-QUALITY-FLOOR`:

| Setting | Value | In plain English |
|---|---|---|
| `min_leads` | **30** | under 30 leads in a quarter we do not judge a source at all |
| `qualified_rate_floor` | **0.40** | below 40% qualified, the source is buying volume nobody can convert |
| `breach_action` | **fail** | not a warning |
| `citation` | lead-vendor performance standard; marketing procurement policy | it is in the vendor contract, not just ours |

Three challenges, three answers:

- *"Is 0.40 arbitrary?"* — declared, visible, versioned, editable by the business.
- *"Are you judging them on a handful of leads?"* — the rule ignores anything under 30. This quarter was **99**.
- *"Why this quarter and not their history?"* — the rule is evaluated per market per quarter **on purpose**. That is exactly how it caught a collapse that the lifetime average of 0.4286 hides.

That last answer is the one that matters. **The grain of the rule is a design
decision, written down.** It is not the analyst choosing the window that makes
the vendor look worst.

Read the remediation aloud:

> *Pause the source, invoke the quality clause in the vendor agreement,
> reallocate the budget to sources holding the floor, and re-baseline the
> market's pace-to-goal for the reduced qualified-lead supply.*

Note the last clause. **The rulebook knows that suspending a source costs you
leads**, and tells you to re-plan the market rather than pretend the shortfall
won't happen. Step 6 prices that.

### Finding

> **The leads are the vendor's by a declared edge, and the bar they failed is a
> published number evaluated at a declared grain — not a window the analyst
> picked.**

### → Why Swarm next

Everything so far is Morgan's work. Before a vendor is suspended, she wants a
conclusion she did not steer.

---
---

# 4 · Swarm — a second opinion, and a useful silence

### What to feed it

```
Is lead quality collapsing at any lead source, and are qualified leads stalling in the funnel?
```

The second half of the question is deliberate. It wakes a second department
whose answer you need.

### What you get

Sentry wakes **Marketing & Growth** (`lead_quality`) and **Sales Operations**
(`funnel_ops`). Run trust **0.90** against a 0.85 gate.

> **CRITICAL · Marketing & Growth** — Lead source **LS-TELE-03** — **0.2222**
> qualified-lead rate in Southwest 2026Q4, **$113.40** per qualified lead
> against a **$43.65** peer rate

That peer rate is new. Pillars told you $113.40. The Swarm adds what every
*other* source cost in the **same market and the same quarter**: **$43.65**.
LS-TELE-03 was **2.6×** its neighbours under identical conditions — so this was
not a hard quarter for the Southwest, it was a bad quarter for this source.

### The finding that isn't there

`funnel_ops` woke up and **reported nothing**. That silence is evidence.

Funnel Ops flags a market when more than **30%** of its *qualified* leads never
leave the top of the funnel. The Southwest is at **27.39%** — in line with the
rest of the book (22.8% to 28.6%). So the sales floor is working the good
leads about as well as everywhere else.

Remember the six `LEAD-SLA-FOLLOWUP` breaches you set aside in Step 1? This is
why you were right to. The follow-up problem is real, but it is everywhere and
it does not explain the Southwest. **The leads were bad, not neglected.** That
moves the remedy firmly onto the vendor and off the sales team, before anyone
in the room tries to move it back.

### Finding

> **Marketing confirms the source is 2.6× its same-market peers; Sales
> Operations confirms the floor is not to blame. Two departments, one
> subject.**

### → Why Cases next

Agreement on a screen is not work. Nothing has an ID or an owner yet.

---
---

# 5 · Cases — turning it into somebody's job

### What you get

The Swarm opened one case automatically, because the run cleared the trust
gate:

| Case ID | Type | Subject | Value | Severity |
|---|---|---|---|---|
| **LEA-8deb00f2** | LeadQualityCase | **LS-TELE-03** | **$2,495.00** | critical |

$2,495.00 is the acquisition spend allocated to those 99 leads. Type
`LS-TELE-03` in the search box to bring it up; filter status to `open`.

### What `propose ▸` does

Click **`propose ▸`**. As with every case, the pattern picks the remedy:

| Case pattern | Action type raised |
|---|---|
| `lead_quality_collapse` | **`lead_source_suspension`** |

There is no dropdown. Morgan cannot turn a suspension into "ask the vendor to
do better".

Run the Swarm question a second time: still **one** case. It is
content-hashed, so re-asking while you prepare does not open a second
investigation.

### Finding

> **One case, $2,495.00, and the system has already decided the remedy is a
> lead-source suspension.**

### → Why Simulator next

Do not click yet. The obvious objection to suspending a source is: *"we still
need the leads — what does the replacement cost?"* $2,495.00 is gross spend,
not saving.

---
---

# 6 · Simulator — what suspension nets after you replace the members

### The assumption, from the Brain

Open **Context Brain → `simulation.md`**:

> **Net Saving from Suspending a Lead Source** = source spend − (source
> effectuated × peer cost per effectuated) × (1 − replacement gap)
> · replacement gap **0.20**

| | |
|---|---|
| Source spend (LS-TELE-03, Southwest 2026Q4) | **$2,495.00** |
| Members it still delivered | **12** |
| Cost per effectuated member, every other source, same market and quarter | **$102.89** |
| Cost to replace those 12 through compliant sources | 12 × $102.89 = $1,234.68 |
| × (1 − 0.20 replacement gap) | − $987.74 |
| **Net saving** | **$1,507.26** |

**60% of the headline.** The formula is honest about what you lose: the 12
members LS-TELE-03 did deliver have to come from somewhere, and the 0.20 gap
assumes you will not replace all of them. As before, the platform declares the
assumptions and Morgan does the arithmetic.

### What to feed the Simulator itself

The Simulator models a policy lever across a market, not a single source. Use
it for the follow-up question: *"if we tightened lead buying across the
Southwest, what's it worth?"*

| Field | Value |
|---|---|
| **Baseline audience** | `Medicare Advantage leads in the Southwest` |
| **Override 1** | `metrics.sim_acquisition_cost.stress_pct` · Op **% change** · value `-0.15` |
| Reason 1 | reallocate budget away from sources below the 0.40 floor |
| **Override 2** | `metrics.sim_lead_loss_ratio.stress_pct` · Op **% change** · value `-0.10` |
| Reason 2 | fewer unconvertible leads entering the funnel |

**Result: net $1,779.75 · -240 bps on lead loss ratio · trust 0.925.**

### Example — why two overrides, again

Each lever reports a different thing:

| Override alone | Net dollars | Basis points |
|---|---|---|
| `sim_acquisition_cost` `-0.15` | **$1,779.75** | +0 bps |
| `sim_lead_loss_ratio` `-0.10` | $0.00 | **-240 bps** |

And the same two levers in every market, so nobody asks "why only the
Southwest":

| Market | Net | Lead loss ratio |
|---|---|---|
| **Southwest** | **$1,779.75** | -240 bps |
| Northeast | $1,475.10 | -311 bps |
| Southeast | $1,429.35 | -270 bps |
| West | $1,316.55 | -287 bps |
| Midwest | $1,204.50 | -277 bps |

The Southwest has the most money in it because it has the most spend that
isn't converting. It has the *least* basis-point gain because its lead loss
ratio is not the problem — its leads aren't being lost, they are sitting
unworked at stage Lead. That matches what Funnel Ops told you in Step 4.

> **Same gotchas as the first case.** Those four `sim_*` parameters are the
> only ones this domain has, so anything else you type is ignored without an
> error. The baseline box only understands line of business and market. Type
> `LS-TELE-03` into it and the filter is silently dropped.

### Finding

> **Suspending LS-TELE-03 nets about $1,507.26 after replacing its members.
> Tightening lead buying across the Southwest is worth about $1,779.75 a
> period.**

**Do not add the two together.** The second already includes most of the
first, because LS-TELE-03 *is* most of the Southwest's unconverted spend.

### → Why Actions next

You have a source, a market, a quarter, a rule, a peer comparison, a
department that ruled out the alternative, a case ID and a net. Propose.

---
---

# 7 · Actions — a smaller amount, the same two signatures

### What happens

Morgan clicks **approve** on her own proposal and is refused:

> **"role 'ma_analyst' is not authorized to approve write-back actions"**

The action is **dual control**. `ACT-DUAL-CONTROL` puts the money threshold at
**$10,000**, and this is **$2,495.00** — even smaller than AG-0027's recovery.
It is still dual control, because `lead_source_suspension` is on the
always-dual list:

> *…each is externally visible to CMS, to an agent's livelihood or to a
> beneficiary.*

Here the external party is the vendor. Suspending a lead source stops a
contracted company's revenue, and that is not one person's call however small
the number.

| Who | Does | Result |
|---|---|---|
| **Morgan** | proposes | dual control, pending |
| **Morgan** | tries to approve | **refused — role not authorized** |
| **Casey** | signs | pending **second** approval |
| **Casey** | tries to sign again | **refused — separation of duties** (approver 2 must differ from approver 1) |
| **Dana** | signs | **approved** → executed (dry run) |

### Finding

> **The smallest case in the book still needs two officers, because what you
> are doing, not how much it costs, sets the control.**

---
---

# How this case differs from AG-0027

Same chain, different lessons at each tab. Use this table if you are running
both cases back to back:

| Tab | AG-0027 taught | LS-TELE-03 teaches |
|---|---|---|
| Pillars | pick the name that appears in the **most rules** | pick the **place** two departments' rules agree on, and ignore the loud book-wide breach |
| Chat | rank tells the story (#1 paid, #59 delivered) | the **average hides the collapse** — 0.4286 overall vs 0.2222 in the quarter |
| Ontology | the rule walks a declared join | the **subject** of the case is a declared key, so the vendor can't dispute attribution |
| Context Brain | the threshold is published | the **grain** (market × quarter) is also published |
| Swarm | three departments say yes | one says yes, **one says no**, and the "no" rules out the excuse |
| Simulator | net after dispute and recovery cost | net after **replacing the members** you lose |
| Actions | always-dual because of an agent's livelihood | always-dual because of a **vendor's** revenue |

---

## The chain, backwards

- Skip **Actions** → you have a recommendation no one can carry out.
- Skip **Simulator** → you're asked "what about the members we lose?" and can't answer.
- Skip **Cases** → the vendor keeps sending leads next quarter while the screen is closed.
- Skip **Swarm** → the room blames the sales floor's follow-up and the vendor walks.
- Skip **Ontology / Context Brain** → the vendor disputes attribution, or says you cherry-picked the quarter.
- Skip **Chat** → you never see that the lifetime average says "fine", so it ambushes you in the meeting.
- Skip **Pillars** → **you never find it.** A vendor sending nine times the usual volume looks like a great quarter until someone runs the floor rule.

---

## Presenter's notes

**Chat order.** 1 → 2 → 3 for the "it's mediocre, not broken" setup, then show
the quarter table from Pillars evidence, then 5 for the Southwest landing at
5th of 5. Keep 4 (`campaign spend by lead source`) in your pocket for "is this
a big vendor?" (5th of 10 by spend).

**Swarm wording matters.** `Is lead quality collapsing at any lead source?` on
its own wakes only Marketing. Add *"and are qualified leads stalling in the
funnel?"* to get Sales Operations' silence on screen.

**Stay on Mock.** Every figure here was verified under
`⬡ mock — no LLM · 🧠 medicare sales`.

**Case IDs are content-hashed**, so `LEA-8deb00f2` reproduces on a clean run.

**If asked "couldn't the vendor just lower the floor?"** The vendor has no
login. If someone internal tries, open **Context Brain** and the edit queue:
every change is versioned and lands in the hash-chained ledger, and a
threshold edit needs a proposer and a signer. Business owners can tune the
rule, but not without anyone seeing.
