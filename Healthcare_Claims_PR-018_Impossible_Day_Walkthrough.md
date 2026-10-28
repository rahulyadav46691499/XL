# Provider PR-018 — The Day That Had 34 Hours

**Persona:** Casey, a compliance officer at a US health insurer. Unlike the
analysts, she can see all four of the insurer's businesses at once. Signs in as
`u-compliance`.
**Case:** Provider **PR-018**, Dr. Hugo S., a family doctor.
**Domain** (the industry knowledge pack the platform runs): Healthcare
Insurance (US Payer / MCO).

> **Who this is for.** Investors, managers and anyone without a medical or
> insurance background. It is a companion to
> `Healthcare_Claims_Analyst_Walkthrough.md` (provider PR-017), and uses the
> same glossary, so read that one's glossary first if a term is new. The few
> terms that are new here are explained below and again at the start of each
> step. Casey, Dana, Morgan, Max, Blair and Dr. Hugo S. are fictional demo
> characters, and all the data is synthetic.

**How this was checked.** Every number below was produced on 28 October 2026
by the same engine calls the screens use (Pillars, Chat, Audiences, Swarm,
Cases, Simulator, Actions and the ledger), against a fresh copy of the demo
data. It has **not** yet been clicked through on screen. The on-screen gotchas
from the PR-017 walkthrough (switch the domain first, keep the Data tab
closed, refresh after Actions) still apply.

---

## Read this first — the story in 60 seconds

**What the PR-017 case taught.** In the first walkthrough, Morgan, who sees only
Medicare Advantage, found a doctor and priced him at $116,796. When Casey
opened it at full scope, it was three times bigger. The point: *the officer is
the only one who sees the whole picture.*

**What this case adds.** This time **no analyst finds anything at all.** Dr.
Hugo S. (PR-018) is a family doctor who bills all four of the insurer's
businesses. For six days in a row, 4 to 9 May 2026, he billed **31.5 to 34.4
hours of treatment a day.** That is impossible: a day has 24 hours. But the
hours were split across the four businesses, and no one business ever saw more
than **17.5** of them. Each analyst saw a busy doctor. Only Casey, adding the
four together, sees a day that had 34 hours in it.

Almost all the extra hours are one code, **97110** (therapeutic exercise, a
code billed by time). He had never billed it before. In those six days he
billed it 54 times, 3.5 hours each. The fraud team had already flagged 54 of
the 60 bills from those days. The platform estimates **$33,548.88** paid for
those days.

**And then the platform stops her, correctly, in a way nobody planned for.**
Because Casey investigated and proposed the recovery, she cannot sign it. Dana
signs first. A second signature is needed, and **there is nobody left to give
it.** The action waits, unexecuted, with the attempt logged.

**The point for an investor.** The platform enforces separation of duties even
when it is inconvenient, and it makes a staffing gap visible instead of quietly
waving the action through. This demo shows the controls doing their job, and it
also shows why the approver roster needs a third officer.

---

## Who's who

| Who | Role in the story | What they can see and do |
|---|---|---|
| **Casey** (`u-compliance`) | Compliance officer. **The investigator in this story.** | All four businesses. Can triage cases. Can propose. **Cannot approve her own proposal.** |
| **Dana** (`u-compliance2`) | The second compliance officer | All four businesses. Approves. |
| **Morgan** (`u-ma`) | Medicare Advantage analyst | Medicare Advantage only. Sees part of Dr. Hugo S.'s week. |
| **Max** (`u-medicaid`) | Medicaid analyst | Medicaid only. Sees a different part. |
| **Blair** (`u-commercial`) | Commercial and ACA Exchange analyst | Commercial and ACA Exchange. Sees the rest. |
| **Dr. Hugo S.** (`PR-018`) | The doctor under review | — |
| **SIU** | The insurer's in-house fraud team | Investigates and decides whether the bills were genuine |

---

## New words in this case

Everything else is in the PR-017 walkthrough's glossary.

| Term | Plain English |
|---|---|
| **Impossible day / phantom hours** | A doctor billing more hours of treatment in one day than the day has. The bills describe time that cannot have happened. |
| **Service units** | How much of a service a bill claims. For a code billed by time, the units are time. In this demo's data, the platform reads one unit as one hour. |
| **Timed code** | A billing code paid by the amount of time spent, not by the visit. More time billed, more money paid. |
| **97110** | *Therapeutic exercise*: a physical-therapy code, billed by time. Unusual for a family doctor to bill at volume, and easy to inflate because nothing physical proves the minutes. |
| **Full scope** | Seeing all four businesses at once. Only compliance officers have it here. |
| **Third approver** | A person, other than the proposer and the first signer, who is allowed to give the second signature. This demo has none. |

---

## Before you start (5 minutes)

| # | Do this | Why |
|---|---|---|
| 1 | Context Brain ▸ **🧠 Context Brain — domains** ▸ **Healthcare Insurance (US Payer / MCO)** | The header must read **🧠 healthcare payer** |
| 2 | Have **three** browser windows ready: Casey (`u-compliance`), Morgan (`u-ma`), Max (`u-medicaid`). Password on the login screen. | Step 1 compares what each of them sees |
| 3 | Have Dr. Hugo S.'s provider record and the six-day table (Step 2) ready | Chat cannot add hours up by day |
| 4 | Audiences ▸ delete any audiences left over from a rehearsal | Otherwise the list shows duplicates |
| 5 | **Do not** use the Swarm question *"Is any provider billing more hours than there are in a day?"* | It does not wake the fraud department. See Step 5. |
| 6 | Collapse the 💰 FinOps widget and ask with **Enter**; refresh (⌘R) after leaving Actions | Same screen gotchas as the PR-017 walkthrough |

---

## The nine steps, at a glance

| # | Tab | What Casey does | Why this step exists |
|---|---|---|---|
| 1 | **Pillars** | Compare her alerts with each analyst's | The case exists only at full scope |
| 2 | **Chat** | Find out who the doctor is and what changed | "34 hours" is a number. She needs the story. |
| 3 | **Audiences** | Save his spike quarter as one group, split it by business, compare it with the quarter before | Proves the hours are spread across the businesses, and fixes the group SIU will work |
| 4 | **Ontology** + **Context Brain** | Show why bills are scoped but doctors are not, then read the rule | The analysts will ask if their data is broken; the room will ask how solid the rule is |
| 5 | **Swarm** | Ask the right question and get a case opened | A finding becomes work that someone owns |
| 6 | **Cases** | Triage it to SIU | Only an officer can, and here she is one |
| 7 | **Simulator** | Size it, and size the control | $33,548.88 is small. Is the control big? |
| 8 | **Actions** | Propose, and run into separation of duties from the other side | The lesson this case was built for |
| 9 | **Governance** | Show the blocked attempt in the ledger | For when audit asks why it is still open |

---
---

# Step 1 — Pillars. A case only one person can see.

> **💡 In plain English.** Pillars is the dashboard of rules that have already
> run. Each person sees the results for the businesses they are allowed to
> see. Casey opens it, then looks at the same screen as each analyst. She is the
> only one who sees Dr. Hugo S.
>
> **Words in this step:** **FWA**: fraud, waste and abuse. **impossible_day**:
> the rule for more than 24 billed hours in one day. **em_upcoding**: too many
> visits billed at the top price. **unbundling**: billing parts of a package
> separately.

**What she does:** opens Pillars as herself, then the same tab in Morgan's and
Max's windows.

### What each person sees under 🛰️ FWA & overpayment

| Who | Scope | FWA alerts | Is PR-018 there? |
|---|---|---|---|
| **Casey** | all four | **3**: PR-017 upcoding $351,997.58 · **PR-018 impossible day $33,548.88** · PR-019 unbundling $3,340.89 | **Yes** |
| Morgan | Medicare Advantage | 3: PR-017, PR-045, PR-019 | No |
| Max | Medicaid | 4: PR-017, PR-021, PR-038, PR-019 | No |
| Blair | Commercial + ACA | 3: PR-029, PR-017, PR-019 | No |

Casey's PR-018 row reads:

> impossible_day · PR-018 · **$33,548.88** · 6 day(s) exceeding 24.0h (peak
> 34.4h)

**Why the analysts can't see it.** The rule adds up a doctor's hours **per
day**, over the bills the viewer is allowed to see. Split by business, his
worst day is:

| Business | Most hours he billed it on any one day |
|---|---|
| Medicare Advantage | 17.5 |
| Medicaid | 14.0 |
| Commercial | 10.5 |
| ACA Exchange | 10.5 |

Blair sees Commercial and ACA Exchange together; his worst day is **14.9**
hours (6 May). None of those is impossible. A long day, not an impossible one. **Only the sum
is.** The access control that keeps Max out of Medicare Advantage is the same
control that hides the problem from him.

### Finding from Step 1

> **PR-018 billed more than 24 hours a day on six days, and the alert exists
> only for the one role that can see all four businesses.**

### What this makes her do next

"34.4 hours" sounds like a data error. Before she treats it as a billing
problem, she wants to know who this doctor is and whether something changed.

**→ Go to Chat.**

---
---

# Step 2 — Chat. Who is he, and what changed?

> **💡 In plain English.** Casey asks four questions in plain English. She
> learns that the fraud team already had him on their list, that his volume
> nearly tripled in one quarter, and that the analysts' own Chat showed them a
> spike too, just not an impossible one.
>
> **Words in this step:** **Fraud referral rate**: the share of his bills SIU
> flagged. **Claim count**: number of bills. **2026 Q2**: April to June 2026.
> **QoQ**: versus the previous quarter. **Outpatient**: treatment without a
> hospital stay.

### Question 1 — "has anyone else noticed?"

```
which providers have the highest fraud referral rate
```
**Trust 93%.** Dr. Ravi R. (PR-017) 42.1% · Dr. Anna T. 19.6% · **Dr. Hugo S.
11.6% on 559 claims, rank 3.**

He was on SIU's radar, but well below the doctor from the first case. Across
two years, 11.6% does not stand out.

### Question 2 — "how busy is he right now?"

```
claim count by provider in 2026 Q2
```
**Trust 93%.** Dr. Ravi R. 411 · Dr. Nina L. 157 · **Dr. Hugo S. 141, rank 3.**

### Question 3 — "was he always like this?"

```
claim count for PR-018
```
**Trust 93%.** Quarter by quarter, 2024Q3 to 2026Q2:
**70 · 70 · 54 · 52 · 52 · 67 · 53 · 141.**

> ⚠ Anomaly in 2026Q2: utilization jumped 166.0% QoQ (z=2.37). Driven
> primarily by claim type = Outpatient: +57 vs 2026Q1 (64.8% of the increase).

Steady for seven quarters, then nearly three times as many bills, mostly
outpatient.

### Question 4 — "and now?"

```
fraud referral rate by provider in 2026 Q2
```
**Trust 93%.** Dr. Ravi R. 83.0% · **Dr. Hugo S. 40.4% of 141, rank 2.**

From 11.6% over two years to 40.4% in one quarter. SIU had noticed the
quarter. They had no reason to add up his hours across businesses.

### What the analysts' Chat showed them

Ask Question 3 in Morgan's and Max's windows:

| Who | Their view of `claim count for PR-018` |
|---|---|
| Morgan | ⚠ utilization jumped **115.8%** QoQ (z=2.08), all of it Medicare Advantage |
| Max | ⚠ utilization jumped **113.0%** QoQ (z=2.12), all of it Medicaid |

**Each of them saw a spike.** Neither saw anything that breaks a rule. A doctor
who doubles his volume is a question. A doctor who bills 34 hours in a day is
a case. Only the full sum turns one into the other.

### The six days, from the record

Chat cannot add hours up by day, so present this as case evidence (claims
table, PR-018, 4 to 9 May 2026):

| Day | Hours billed | Medicare Adv. | Medicaid | Commercial | ACA | Paid |
|---|---|---|---|---|---|---|
| Mon 4 May | **34.4** | 17.5 | 6.4 | — | 10.5 | $18,853.37 |
| Tue 5 May | **32.1** | 7.0 | 11.1 | 3.5 | 10.5 | $6,577.26 |
| Wed 6 May | **32.4** | 3.5 | 14.0 | 4.4 | 10.5 | $1,017.62 |
| Thu 7 May | **32.8** | 14.0 | 14.0 | 4.8 | — | $1,015.15 |
| Fri 8 May | **31.5** | 10.5 | 10.5 | 10.5 | — | $1,133.96 |
| Sat 9 May | **32.3** | 10.5 | 7.0 | 7.8 | 7.0 | $4,951.52 |

Six days, 60 claims, **$33,548.88 paid**, which is exactly the Pillars figure.
**SIU had already flagged 54 of the 60.**

And what filled the hours:

| Code | What it is | Claims in those six days | Hours |
|---|---|---|---|
| **97110** | therapeutic exercise (timed) | **54** | **189.0** |
| 99284 | emergency-room visit | 3 | 4.2 |
| 99214 / 99213 | office visits | 3 | 2.4 |

**He had never billed 97110 before 2026Q2.** All 54 of those claims fall in
these six days, at 3.5 hours each.

### Who is he on paper?

| | |
|---|---|
| Provider | **PR-018**, Dr. Hugo S., NPI 1248532577 |
| Specialty / region | **Family Medicine**, **Northeast** |
| Network status | **In-Network**: he has a contract with us |

Note the contrast with PR-017, who was out-of-network. **This doctor is under
contract**, so the contract itself gives the insurer audit rights over his
records.

### Finding from Step 2

> **A contracted family doctor, steady for seven quarters, tripled his volume
> in 2026Q2, then spent six days billing a physical-therapy code he had never
> used, 3.5 hours a claim, until each day held 31 to 34 hours. SIU flagged 54
> of those 60 bills, but nobody added the hours up.**

### What this makes her do next

She has a pile of numbers from different questions. SIU will need **one fixed
set of bills**, and she needs to show the room that the bills really are
spread across the four businesses.

**→ Go to Audiences.**

---
---

# Step 3 — Audiences. One group of bills, split four ways.

> **💡 In plain English.** An *audience* is a group of bills that you describe
> in plain English, name and save. While it is switched on, every Chat question
> is about that group only. Casey saves Dr. Hugo S.'s spike quarter as one
> group, then splits it by business, and compares it with the quarter before.
>
> **Words in this step:** **Audience / risk pool**: a saved, named group of
> bills. **Active**: Chat answers about that group only. **Whole book**: back
> to everything she can see. **Compare**: two audiences side by side. **WHERE
> line**: the exact condition the platform used to pick the bills. **Lift /
> "×"**: how much more common something is in the group than in the whole
> company.

**What she does:** Audiences ▸ *Create a new audience* ▸ **Create +
auto-analyze**:

| Box | What she types |
|---|---|
| Audience name | `PR-018 spike quarter` |
| Plain English | `claims from PR-018 in 2026 Q2` |

Casey does **not** need to name a line of business. She is allowed to see all
four, so the audience correctly takes all four. (Contrast with Morgan in the
PR-017 walkthrough, who must always type "Medicare Advantage".)

### What happens

> Risk pool 'PR-018 spike quarter' saved (2 filters). It matches **141
> claims** — 0.4% of the book.

*Auto-detected patterns*:

| What it says | In plain English |
|---|---|
| 141 claims, **$514,474** allowed | everything we paid for his bills that quarter, all four businesses |
| ⚠ Fraud referral rate **40.4%** is **8.25×** the book rate | SIU flagged him eight times as often as the average |
| Claim Type 'Outpatient' **1.86×** over-represented (52% vs 28%) | the shift to outpatient bills from Question 3 |
| Denial rate 8.5% is 0.73× the book | we refuse **fewer** of his bills than average. They are being paid. |

WHERE line, for SIU to rebuild the same group:

```
c.service_quarter = '2026Q2' AND c.provider_id = 'PR-018'
```

The card shows trust **81%**, just under the 85% bar. The counts are exact.
The score is the card's own profiling confidence, not a doubt about the 141.

### Question 1 inside the audience — the split that makes the case

With the audience active, Casey asks, without typing the doctor or quarter:

```
claim count by lob
```
> **Trust 100%.** [Audience: PR-018 spike quarter]

| Business | Bills in 2026Q2 |
|---|---|
| Medicaid | **49** |
| Medicare Advantage | **41** |
| Commercial | **28** |
| ACA Exchange | **23** |

**No business holds even 35% of his quarter.** That is the shape of the
problem in one chart: the bills, and the hours behind them, are spread so that
no single business sees enough to trip a rule.

### Question 2 inside the audience — where SIU's flags are

```
fraud referral rate by claim type
```
> **Trust 93%.** [Audience: PR-018 spike quarter]

| Claim type | Bills | Flagged by SIU |
|---|---|---|
| **Outpatient** | 73 | **74.0%** |
| Lab | 14 | 14.3% |
| ER | 40 | 2.5% |
| Specialist Visit / Inpatient | 14 | 0% |

**Three in four of his outpatient bills are flagged.** The 97110 claims are
outpatient bills, and they are the flagged ones. His emergency-room bills,
which carry most of his dollars ($321,929 of the $514,474), are almost
untouched by SIU. Say this out loud, because it stops the room from claiming
the whole half-million.

### Compare it with the quarter before

She builds a second audience: `PR-018 quarter before`, text `claims from
PR-018 in 2026 Q1` (53 claims). Ticks both and clicks **Compare selected
(2/2)**:

| | Spike quarter (2026 Q2) | Quarter before (2026 Q1) |
|---|---|---|
| Bills | **141** | 53 |
| Allowed | **$514,474** | $197,989 |
| Average bill | $3,649 | $3,736 |
| Denial rate | 8.5% | 13.2% |
| **Flagged by SIU** | **40.4%** | **1.9%** |

> Fraud referral rate: 'PR-018 spike quarter' is **21.39×** 'PR-018 quarter
> before'.

**The same doctor, one quarter apart.** 2.7 times the bills at about the same
average size, fewer refused, and SIU flags up from about one in fifty to two
in five. The comparison card shows trust 83%, just under the bar, for the same
reason as in the PR-017 walkthrough: it treats two groups as only two data
points.

### What Max can see on his own

For contrast, Max can build `Medicaid claims from PR-018 in 2026 Q2`: **49
claims, $246,033, fraud referral rate 36.7% (7.5× the book).** His slice looks
suspicious. It does not look impossible. Max could open a conversation with
SIU. He could not open this case.

### Before you leave this step

Click **Whole book** in the strip at the top of Chat. While an audience is
active, every Chat question is limited to it.

### What to know before you type

- **`claim count by procedure code` is withheld** (trust 83%). The 97110 count comes from the record (Step 2), not from Chat.
- Type the words exactly as above. The builder only understands words from the rulebook's lists. It understands `PR-018` and `2026 Q2`. It does not understand "97110" or "therapeutic exercise".
- The *Claim volume* chart on the card shows a single point, because the group covers one quarter.

### Finding from Step 3

> **His spike quarter is now one named group: 141 bills, $514,474, 40.4% flagged
> by SIU against 1.9% the quarter before. It is spread 49 / 41 / 28 / 23 across
> the four businesses, so no single business holds enough of it to break a
> rule, and the flags sit on his outpatient bills, not his ER bills.**

### What this makes her do next

Two challenges are coming. The analysts will ask: **"why didn't our screens
show this — is our data incomplete?"** And the room will ask: **"how solid is
a 24-hour rule, and is a 'unit' really an hour?"** The Ontology answers the
first and the Context Brain answers the second. Take them together.

**→ Go to Ontology, then Context Brain.**

---
---

# Step 4 — Ontology + Context Brain. Why only she can see it, and the rule's limits.

> **💡 In plain English.** The *Ontology* is the platform's map of the
> business: what kinds of things exist (members, claims, doctors, fraud cases)
> and how they connect. Casey uses it to show why the case could only appear
> at her level. A bill belongs to one business. A doctor belongs to none of
> them. Then she reads the exact rule and its limits, so nobody in the room
> finds them first.
>
> **Words in this step:** **Object type**: a kind of thing the platform knows
> about, e.g. *Claim* or *Provider*. **Edge**: a declared connection between
> two object types, and the field that joins them. **Scope column**: the field
> that says which business a record belongs to; the access control filters
> on it. **CAPS**: the insurer's *core administrative processing system*, the
> claims platform the data comes from (Facets and QNXT are two well-known
> ones). **max_daily_hours**: the 24-hour line. **Citation**: where a rule's
> authority comes from. **Remediation**: what the rule says to do next.

## Part A — Ontology: why the case exists only at full scope

**What she does:** opens **Ontology**. Two controls:

| Control | What to enter | Example |
|---|---|---|
| **Search box** | an object type, edge or attribute | `Provider` |
| **CAPS vendor** dropdown | which claims platform to map against | `facets` |

The header reads **ontology 3.0.0 · healthcare_payer**, and validation reports
**12 object types, 13 edges, 4 CAPS vendors, 0 warnings.**

### Search `Provider`, and read the one edge the rule walks

```
Claim  -RENDERED_BY->  Provider   ON provider_id
Provider  -FLAGGED_IN->  FWACase  ON provider_id
```

`FWA-PHANTOM-HOURS` adds up hours along the first edge: every claim
**rendered by** the same provider on the same day. The second edge is where
its finding lands: a provider **flagged in** an FWA case.

### Now put the two object types side by side

| Object type | Source table | `scope_column` | What that means |
|---|---|---|---|
| **Claim** | `claims` | **`lob`** | every bill belongs to exactly one business, and each analyst sees only their business's bills |
| **Provider** | `providers` | **none** | a doctor belongs to no business. Dr. Hugo S. is the same object for Morgan, Max, Blair and Casey. |

**Read that row out loud. It is the whole case in the data model.** The
access control filters **claims**, by business. The rule adds up **claims**,
per **provider**, per day. So each analyst adds up only their share of the
same doctor's day: 17.5 hours, 14.0, 14.9. **Their data is not incomplete.
It is correctly scoped.** Only a viewer whose scope covers every business
adds up the whole day.

Nothing here is a bug or a blind spot that someone forgot. It is two correct
declarations meeting: *bills are scoped*, *doctors are shared*. That is what
the analysts need to hear before they ask whether their screens are broken.

### Search `service_units` — the attribute the rule sums

The **Claim** type declares it as:

| Attribute | Type | Pillar | Note in the spec |
|---|---|---|---|
| `service_units` | number | **fwa** | *"units/daily hours — phantom-hours detection"* |

Then switch **CAPS vendor** and see where it comes from in a real claims
system:

| CAPS | Claim view | `service_units` comes from | `provider_id` comes from |
|---|---|---|---|
| **facets** | `stg_facets.v_claim` | `CDML_UNIT` | `PRPR_ID` |
| **qnxt** | `stg_qnxt.v_claim` | `Units` | `ProvID` |

**This is the honest answer to "is a unit really an hour?"** In a real system,
`service_units` is mapped from the claim line's **unit count**, not from a
time field. The spec's own note calls it "units/daily hours". In this demo's
synthetic data, a unit is an hour, so the sum is hours. Against a real Facets
or QNXT feed, a 15-minute code like 97110 would be over-counted four times
unless the rule converts units to hours per code first. Say it here, from the
model, before someone says it from experience. (Part B comes back to this.)

### Search `FWACase` — the case is a declared object too

```
FWACase  -RECOMMENDS->  PrescriptiveAction  ON fwa_id
```

| Attribute | Declared values |
|---|---|
| `pattern` | unbundling · em_upcoding · **phantom_hours** · duplicate_billing · **impossible_day** |
| `status` | open · reviewing · **referred_siu** · closed |

Two things to notice:

- `referred_siu`, the status Casey sets in Step 6, is a declared state of the
  object, not a free-text label.
- **The pattern list carries both `phantom_hours` and `impossible_day`.** The
  rule is named `FWA-PHANTOM-HOURS` but runs the check `impossible_day`, and
  the case it opens is stamped `impossible_day`. They are the same pattern
  under two names. Expect the question, and answer that the case and the rule
  agree on `impossible_day`.

`PrescriptiveAction` declares `approval_state` and `approved_by`. That is
the object Step 8 will fill in, or, in this case, fail to.

### Finding from Part A

> **The case is not hidden by missing data. It is produced by the model: bills
> are scoped to a business, doctors are not, and the rule adds up bills per
> doctor. Only a full-scope viewer can add up the whole day. The same model
> shows, in the CAPS mapping, that a real feed would send units, not hours.**

## Part B — Context Brain: the rule itself

**What she does:** Context Brain ▸ **⚖️ Policy rulebook**, search
`FWA-PHANTOM-HOURS`.

| Setting | Value | In plain English |
|---|---|---|
| `check` | `impossible_day` | adds up each doctor's hours per day |
| `max_daily_hours` | **24** | more than a day holds |
| `citation` | **SIU billing-integrity heuristics** | the fraud team's own rule of thumb |
| `remediation` | *Surface provider/day with implied hours and contributing claims for SIU review.* | list the days and the bills, and send them to SIU |

### Be straight about three things

1. **The citation is internal.** PR-017's rule cited CMS documentation
   guidelines and the OIG work plan. This one cites the insurer's own fraud
   team. That does not make it wrong: 24 hours in a day is not a matter of
   opinion. It does mean nobody should present it as a government rule.
2. **A "unit" is read as an hour.** In this demo's data, one service unit is
   treated as one hour of treatment. In real US billing, 97110 is billed in
   15-minute units, and Part A showed that a real Facets or QNXT feed maps
   `service_units` from the unit count. The rule has no setting for unit
   length, so on a real system it needs one, declared per code in the Brain,
   before it adds anything up. That is a governed edit, not a code change.
3. **There is no peer comparison and no minimum volume.** Unlike PR-017's rule,
   this one does not compare him with other family doctors. It does not need
   to: one impossible day is enough. But it means the rule is blunt, and that
   is why its remediation sends the case to SIU instead of recovering
   automatically.

### Finding from Step 4

> **The data model explains why only Casey could see it: bills are scoped,
> doctors are shared. The rule is short, blunt and internal. Nobody can argue
> with it on its own terms, since a day has 24 hours, and it correctly sends
> the case to SIU rather than accusing anyone. Before it runs on a real feed,
> it needs a declared unit length per code.**

**→ Go to Swarm.**

---
---

# Step 5 — Swarm. Ask the question the platform understands.

> **💡 In plain English.** Casey asks the platform's specialist departments to
> look. The obvious question in plain English wakes the wrong departments. The
> standard question wakes the fraud department, which opens a tracked case for
> Dr. Hugo S. on its own.
>
> **Words in this step:** **Sentry**: the coordinator that decides which
> departments wake up. **Findings**: what each department reports. **Case**: a
> tracked work item.

### The trap first

The natural question is:

```
Is any provider billing more hours than there are in a day?
```

> Activated 5 of 10 · trust 90% · **0 cases**

Medical Economics, Pharmacy and Network wake up. **The fraud department does
not.** The Sentry routes by vocabulary, and "hours in a day" is not in the
fraud department's trigger words. Don't use this question live.

### The question that works

Use the box's pre-filled example (or type it):

```
Are there billing anomalies or upcoding from any provider?
```

> **Activated 6 of 10 · trust 92% · gate ✅ passed**

| Severity | Department | Finding |
|---|---|---|
| critical | FWA / SIU | Em Upcoding — provider PR-017 · $351,997.58 |
| **high** | **FWA / SIU** | **Impossible Day — provider PR-018 · $33,548.88** |
| high | FWA / SIU | Unbundling — provider PR-019 · $3,340.89 |

> 📁 3 case(s) opened: FWA-ee392224, **FWA-97418abb**, FWA-a0518e0b

### The trap she avoids, again

Medical Economics reports **"Allowed cost up 101.1% in 2026Q2"**, with
**claim type = ER** and **region = Southeast** each driving 100% of it. Dr.
Hugo S. does bill ER claims, and they are most of his dollars. **But they are
not what SIU flagged** (2.5% of them, Step 3), and his region is the
Northeast. The cost spike is a different story for a different department.

Network Management reports out-of-network spend at 18.4% of allowed. He is
in-network, so that is not about him either.

### Finding from Step 5

> **The fraud department, asked the right way, opens FWA-97418abb for PR-018 on
> its own, at 92% trust. The ER cost spike is real, and not his.**

**→ Go to Cases.**

---
---

# Step 6 — Cases. Triage is hers this time.

> **💡 In plain English.** The finding is now a numbered work item. In the
> PR-017 case, Morgan was refused when she tried to send the case to SIU. Casey
> is an officer, so she can.
>
> **Words in this step:** **Triage**: deciding what happens next.
> **referred_siu**: sent to the fraud team. **ALL**: the case covers every
> business.

| Case | Type | Subject | Pattern | Severity | Trust | Impact | Scope |
|---|---|---|---|---|---|---|---|
| **FWA-97418abb** | FWACase | **PR-018** | impossible day | high | 92% | **$33,548.88** | **ALL** |

**Who can see it.** The case is stamped **ALL**: it belongs to all four
businesses at once, so it appears **only** in Casey's and Dana's Cases tabs.
Open Max's Cases tab: it is empty. His own Swarm run on the same question
finds the cost spike and the pharmacy rejects, and opens nothing.

**Triage.** Casey sets the status to **`referred_siu`**. It is accepted, as the
rule's remediation asks. (Morgan, in the first walkthrough, was refused this
exact step.)

### Finding from Step 6

> **FWA-97418abb, $33,548.88, referred to SIU, and visible only to the two
> people who will have to approve anything done about it.** Remember that last
> part.

**→ Go to the Simulator.**

---
---

# Step 7 — Simulator. Small case, big control.

> **💡 In plain English.** Casey checks how much this matters. The case itself is
> small. The control behind it, adding hours up across businesses before
> paying, is worth much more.
>
> **Words in this step:** **Baseline**: the group the what-if applies to.
> **Lever / override**: the number you change. **MLR**: the cents of each
> premium dollar spent on care. **Basis point (bp)**: a hundredth of a
> percentage point.

### Run 1 — the case, as a what-if

| Field | Value |
|---|---|
| Baseline cohort | `claims from PR-018 in 2026 Q2` |
| Override | `metrics.medical_cost.stress_pct` · shift by % · `-0.0652` · *remove the six impossible days* |

`-0.0652` is $33,548.88 ÷ $514,474: the impossible days as a share of his
quarter.

> Net $ impact **$33,543.70** · trust 100%

That reproduces the case value to within rounding, which is the point: the
Simulator and the rule agree on the money.

### Run 2 — the control, across the company

| Field | Value |
|---|---|
| Baseline cohort | `all claims` |
| Override 1 | `metrics.medical_cost.stress_pct` · shift by % · `-0.01` · *cross-business daily-hours check before payment* |
| Override 2 | `metrics.mlr.stress_pct` · shift by % · `-0.01` · *the same 1%, on the loss ratio* |

> Net $ impact **$1,322,988.40** · MLR Δ **−130 bps** · trust 86%

**Every 1% of company-wide medical spend is $1.32 million.** Dr. Hugo S.'s
$33,548.88 is about 2.5% of that one point. He is not the prize. **The prize is
the control:** today each business checks its own bills; nobody checks a
doctor's day across all four.

**Do not quote $1,322,988.40 as PR-018's number.** It is the company-wide
lever.

As in the PR-017 walkthrough, the payer Brain declares no recovery-net formula
(no dispute rate, no collection cost), so Casey quotes $33,548.88 as gross and
says so.

### The governance beat

In Max's window, run any baseline naming Medicare Advantage:

> **'Medicare Advantage' is outside your authorized scope**

### Finding from Step 7

> **The case is $33,548.88. The missing control, a daily-hours check across
> businesses, is worth about $1.32 million for every 1% it saves.**

**→ Go to Actions.**

---
---

# Step 8 — Actions. Separation of duties, from the other side.

> **💡 In plain English.** Casey proposes to recover the money. She cannot
> approve her own proposal. Dana approves. A second approval is needed, and the
> only other officer is Casey. The action stops and waits. Nothing is paid back
> yet, and the attempt to run it is logged.
>
> **Words in this step:** **Overpayment recovery**: asking the doctor to repay.
> **Dual control**: two different approvers. **Proposer**: the person who
> raised the action. **PENDING_SECOND_APPROVAL**: one signature in, one to go.

**What she does:** Cases ▸ **propose ▸** on FWA-97418abb.

> overpayment recovery · PENDING_FIRST_APPROVAL · 👥 **dual control** · impact
> $33,548.88 · severity high · trust 92%

**▸ compliance logic tree** lists why it needs two approvers. Under
`ACT-DUAL-CONTROL`, any one of these is enough, and all three apply:

- the estimated impact, $33,548.88, is at least $10,000
- the severity, high, is a dual-control trigger
- `overpayment_recovery` is always dual control

### What happens next

| Who | What | What the screen says |
|---|---|---|
| **Casey** | ✍️ Approve | **refused:** separation of duties: the proposer may not approve this action |
| **Dana** | ✍️ Approve | approve ok → **PENDING_SECOND_APPROVAL** |
| **Casey** | ✍️ Approve (2nd) | **refused:** separation of duties: the proposer may not approve this action |
| **Casey** | 🚀 Execute | **refused:** action is PENDING_SECOND_APPROVAL, not APPROVED |

**And there it stops.** The second signature has to come from someone who is
a compliance officer, is not Casey (she proposed it), and is not Dana (she
already signed). **This demo has no such person.**

### Read this the right way

**This is not a bug.** It is the control working:

- In the PR-017 case, the analyst proposed and two officers signed. Three
  people.
- Here, the officer had to investigate, because she was the only one who could
  see the case. That made her the proposer, which used up one of the two
  available signers.
- **The platform refused to let her count twice**, even though she is senior,
  even though the evidence is strong, and even though it leaves the recovery
  stuck.

The real finding is about staffing, and the platform has made it visible:

> **A case that only an officer can see needs three officers to act on: one to
> propose, two to sign. Any company that runs this platform with two compliance
> officers has a class of case it can find but never act on.**

**What to recommend:** add a third approver to `ACT-APPROVER-ROLES` (a person,
not a lower bar). **Do not** recommend letting the proposer sign. That is the
one change that would make the stuck action go away and the control worthless.

Casey's case is already with SIU (Step 6), so the investigation is not
waiting on the signature. Only the money is.

### Finding from Step 8

> **The recovery is proposed, signed once, and blocked, because the only person
> who could see the case is the only person who could not sign it twice.**

---
---

# Step 9 — Governance. Proving it was blocked, not forgotten.

> **💡 In plain English.** Auditors will ask why a $33,548.88 overpayment is
> still open. The answer is in the tamper-evident log: proposed, one
> signature, two refusals, and a blocked execution, each with a name and a time.
>
> **Words in this step:** **Ledger / hash chain**: a log where tampering is
> detectable. **execute_blocked**: the logged attempt to run an unapproved
> action.

On the Actions tab, signed in as Casey or Dana, the banner reads **🔗 hash
chain intact**. In this run the chain verified end to end (22 entries checked).
The log holds the proposal, Dana's `approved` entry, the `status_changed`
entry for the SIU referral, and an **`execute_blocked`** entry for the attempt
to run the action early.

**FinOps:** $0.0000, 0 tokens. The whole case ran on approved queries and
fixed rules; the AI model was switched off.

### Finding from Step 9

> **The open recovery is not an oversight. The ledger shows who proposed it,
> who signed, who was refused and why, and that nobody ran it early.**

---
---

# What each person saw — the case in one table

| | Morgan (MA) | Max (Medicaid) | Blair (Comm. + ACA) | **Casey (all four)** |
|---|---|---|---|---|
| Pillars alert for PR-018 | — | — | — | **impossible day, $33,548.88** |
| His worst single day, in their data | 17.5 h | 14.0 h | 14.9 h | **34.4 h** |
| Chat spike in 2026Q2 | +115.8% | +113.0% | not checked | +166.0% |
| His 2026Q2 bills they can see | 41 | 49 | 51 | **141** |
| Case in their Cases tab | — | — | — | **FWA-97418abb** |
| Can they propose a recovery? | no case to propose from | no case to propose from | no case to propose from | yes, and then cannot sign |

**Everyone saw a busy doctor. One person saw an impossible one, and she is
the one person who cannot finish the job alone.**

---

# The whole thing on one page

| Step | Tab | What she finds | What it forces next |
|---|---|---|---|
| 1 | Pillars | **PR-018 impossible day, $33,548.88, only at full scope.** No analyst's worst day passes 17.5 h. | Who is he? |
| 2 | Chat | Rank 3 on SIU referrals; 70 → 141 bills; 40.4% flagged in Q2. Six days of **31.5–34.4 h**, 54 claims of a timed code he never used before. | One fixed group |
| 3 | Audiences | **141 bills, $514,474, 40.4% flagged** vs 1.9% the quarter before. Split **49 / 41 / 28 / 23** across businesses. Flags on outpatient (74%), not ER. | Defend the rule |
| 4 | Ontology + Context Brain | **Claim is scoped by `lob`, Provider is not**, and the rule sums claims per provider: that is why only full scope sees it. CAPS maps `service_units` from unit counts. Rule: `max_daily_hours 24`, internal citation, no peer group. Sends to SIU. | Make it work |
| 5 | Swarm | The obvious question opens 0 cases. The standard one opens **FWA-97418abb** at 92%. ER spike is not his. | Triage it |
| 6 | Cases | Scope **ALL**: only officers see it. Casey refers to SIU. | Size it |
| 7 | Simulator | Case = **$33,543.70**. Company-wide control = **$1.32M / −130 bps per 1%**. | Propose |
| 8 | Actions | Proposer can't sign. Dana signs. **No third officer. Blocked.** | Show the record |
| 9 | Governance | Chain intact; `execute_blocked` logged. | Close the demo |

**Nine steps. About twenty minutes. One doctor, four businesses, one missing
signer.**

The sentence the whole thing exists to produce:

> *"A contracted family doctor billed 31 to 34 hours a day for six days in May,
> mostly a timed therapy code he'd never used before. Each of our businesses
> saw at most 17.5 of those hours, so no analyst's rules fired. I can see all
> four, so I found it, referred it to SIU and proposed recovering $33,548.88.
> Dana signed. I can't sign my own proposal, and there's no one else, so it's
> blocked. We need a third approver, and we need a daily-hours check that
> looks across businesses before we pay."*

---

## If they push — answer honestly

| If they ask… | The honest answer |
|---|---|
| "Is this real data?" | No. Synthetic, deterministic demo data. The rules, scoping, trust gate, approvals and ledger are real mechanics. |
| "Did an AI find this?" | No. The AI model is switched off (mock, 0 tokens). A declared rule and approved queries found it. |
| "Isn't 97110 billed in 15-minute units?" | Yes, in real billing. This demo's data treats each unit as an hour, and the rule adds units directly. On a real system the rule needs each code's unit length first. The pattern (a code never used before, 54 times in six days, 54 of 60 flagged by SIU) stands either way. |
| "Why didn't the analysts catch it?" | Each of them saw only their business, and no business saw more than 17.5 hours in a day. That is the access control working, not the analysts failing. Show it in the Ontology: Claim carries a `lob` scope column, Provider does not (Step 4). |
| "Will this work on our Facets feed?" | Not yet as-is. The Ontology maps `service_units` from Facets `CDML_UNIT`, a unit count. The rule needs a declared unit length per code first (Step 4). |
| "Why not just let Casey approve it?" | Because the person who proposes a recovery must never approve it. Removing that rule would fix this case and break every other one. |
| "Why not have an analyst propose it?" | No analyst can see the case. It is scoped to all four businesses. |
| "Is $514,474 the overpayment?" | No. That is his whole quarter. The overpayment estimate is what we paid on the six impossible days: $33,548.88. Most of his dollars are ER claims SIU did not flag. |

---

## Presenter's notes

**Run Step 1 with three windows side by side.** The moment the room sees that
Casey has an alert the analysts don't is the whole premise. Spend time there.

**The two moments to slow down on.** The six-day table in Step 2, and the
block in Step 8. Do not rush past the block or apologise for it. It is the
product refusing to cut a corner.

**Live gotchas, from this run:**

1. **Use the pre-filled Swarm question.** *"Is any provider billing more hours than there are in a day?"* does not wake the fraud department and opens nothing.
2. **`claim count by procedure code` is withheld at 83%.** Present the 97110 figures from the record.
3. **The six-day hours table is not available in Chat.** Have it on a slide.
4. **Case IDs are content-hashed**, so `FWA-97418abb` (and `FWA-ee392224`, `FWA-a0518e0b`) repeat on a clean run. Action IDs do not.
5. **The stuck action stays in the queue.** Reject it with a reason after the demo, or the next rehearsal starts with a pending item.
6. The PR-017 walkthrough's screen gotchas apply here too: switch the domain first, keep the Data tab closed, refresh after leaving Actions.

**Running both healthcare cases back to back?** Do PR-017 first. It shows the
normal three-person flow (analyst proposes, two officers sign). Then PR-018
shows what happens when the case can only be found by an officer. Together
they make the argument for the approver roster.
