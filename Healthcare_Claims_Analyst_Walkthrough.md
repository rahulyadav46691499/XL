# Provider PR-017 — How an Analyst Works a Healthcare Claims Case

**Persona:** Morgan, Medicare Advantage claims analyst (payment integrity). Signs in as `u-ma`.
**Case:** Provider **PR-017**, Dr. Ravi R., Endocrinology.
**Domain:** Healthcare Insurance (US Payer / MCO), medical claims.

This is the same login as the Medicare Sales walkthrough (`u-ma`, shown on screen
as *Morgan Advantage*), in a different domain. Every number below was run against
the live engine on 1 October 2026, and every step was walked through in the
running app. Where a number is only true at Morgan's login, the text says so.

---

## First — can the HEDIS Stars case do this?

The manager's HEDIS document (*The Stars Measure Nobody Was Watching*) was checked
end to end, act by act, through the same screens a presenter uses. The details
are in the **Appendix**. The short version:

| What we need to show | HEDIS Stars case | This case (PR-017) |
|---|---|---|
| Chat, including a refusal at the trust gate | ✅ Its strongest part: refused at 57%, taught, then answered at 100% | ✅ |
| Pillars | ❌ Not used. No HEDIS rule exists in Pillars. | ✅ |
| Swarm | ⚠ Routes to Quality/Stars correctly, but **opens 0 cases** | ✅ Opens 3 cases |
| Cases | ❌ Stays empty, so there is nothing to work | ✅ |
| Simulator | ❌ Not in the HEDIS document, and no HEDIS lever exists | ✅ |
| Actions (propose → refused → two signatures → execute) | ❌ No path from the UI. `care_gap_outreach` is rejected by the server. | ✅ |
| Context Brain, Governance, SQL Log | ✅ | ✅ |

**Keep the HEDIS demo for what it does best:** a file the platform has never
seen, a refusal, a governed fix, then an answer. **Use this case to show the
operating loop.** If you run both, do the HEDIS one first (about 15 minutes),
then this one (about 20 minutes).

---

## Before you start (5 minutes)

| # | Do this | Why |
|---|---|---|
| 1 | Context Brain ▸ click **🧠 Context Brain — domains** ▸ **Healthcare Insurance (US Payer / MCO)** | The live pointer is on Medicare Sales. The header must read **🧠 healthcare payer**. |
| 2 | Sign in as **Morgan Advantage** (`u-ma`). The demo password is on the login screen. | She sees Medicare Advantage only, which is the point of the story |
| 3 | **Do not open the Data tab in front of the client** | It currently ignores scope. See *Presenter's notes*. |
| 4 | Have PR-017's provider record ready (Step 2) | Chat refuses to answer "network status for PR-017", correctly, because it has no governed metric for it |
| 5 | Collapse the 💰 FinOps widget and ask questions with **Enter** | The widget sits over the Ask button |
| 6 | After the Actions tab, **refresh the page (⌘R) before clicking another tab** | Leaving Actions currently blanks the app. You stay signed in. |

---

## What Morgan is and is not allowed to do

| | |
|---|---|
| Sees | **Medicare Advantage only**, one of four books |
| Can | ask anything, run every rule, run the swarm (which opens cases), run simulations, **propose** actions |
| Cannot | see Medicaid, Commercial or ACA Exchange · approve or execute any write-back · change a case's status · edit the Context Brain · simulate another book |
| Her job | turn a statistical outlier into a **priced, scoped, evidenced recommendation** that somebody else signs |

---

## The eight steps, at a glance

| # | Tab | What she does | Why this step exists |
|---|---|---|---|
| 1 | **Pillars** | Read 20 timeliness breaches and 3 FWA alerts, then pick one | Choosing is the job. The method is distance past the line. |
| 2 | **Chat** | Ask who this provider is and what changed | A z-score is not a story |
| 3 | **Context Brain** | Read the rule she is about to rely on | She will be asked to defend the threshold |
| 4 | **Swarm** | Ask in plain English and see what else is going on | A case appears automatically, plus context she did not ask for |
| 5 | **Cases** | Check what was opened and try to triage it | A screen becomes work with an owner |
| 6 | **Simulator** | Size it against the whole book | $116,796 is a headline. Is it material? |
| 7 | **Actions** | Propose the recovery, get refused, hand it over | The control is the product |
| 8 | **SQL Log / Governance** | Confirm nothing was written and the receipts hold | For when audit asks |

---
---

# Step 1 — Pillars. Choosing the case.

**What she does:** opens Pillars. It has already run. At her scope it shows:

| Pillar | What it found |
|---|---|
| ⚖️ Regulatory timeliness | **20 timeliness breaches**. CDAG_CD: 65 cases, 9 breaches, 86.2% compliant. ODAG_OD: 60 cases, 11 breaches, 81.7% compliant. |
| 🩺 PA / UM triage | 138 prior-auth cases: 27 auto-approve eligible, 93 pended, 18 denied. This is workflow, not breaches. |
| 🛰️ FWA & overpayment | **3 alerts** |

The three FWA alerts, exactly as the screen shows them:

| Pattern | Provider | z-score | Est. overpayment | Detail |
|---|---|---|---|---|
| em_upcoding | **PR-017** | **25.63** | **$116,796.16** | High-E/M share 43% vs Endocrinology peer mean 4% (z=25.6) |
| em_upcoding | PR-045 | 3.65 | $8,637.05 | High-E/M share 7% vs Psychiatry peer mean 4% (z=3.6) |
| unbundling | PR-019 | — | $1,113.77 | 21 NCCI component pairs billed separately |

**Why:** this is the only screen that found things without being asked.

**The problem:** 23 findings, and she will have to justify whichever one she
picks.

**The method, and this is the part worth teaching.** She does not sort by money
and she does not sort by count. She sorts by **how far past its own line** each
finding is, because distance past the line is what survives a challenge.

| Finding | Measured | The rule's line | How far past |
|---|---|---|---|
| **PR-017 upcoding** | z 25.63 | z 3.0 | **8.5×** |
| Worst timeliness breach (UC-00159) | 126.6 hours | 72 hours | 1.76× |
| PR-045 upcoding | z 3.65 | z 3.0 | 1.2× |
| PR-019 unbundling | 21 NCCI pairs | any pair | a claims-edit fix, $1,113.77 |

One finding is more than eight times past its line. Everything else is either
barely over it or is a process queue. The 20 timeliness breaches are 20
different member cases in the coverage-determination queues, which points at a
backlog rather than a person.

### Finding from Step 1

> **PR-017 is $116,796.16 of the $126,546.98 FWA exposure at her scope (92%),
> and it is the only finding that is not borderline.**

### What this makes her do next

A z-score is not a story. "Recover $116,796 from a provider" invites one
question she cannot answer yet: *who is this, and what actually happened?*

**→ Go to Chat.**

---
---

# Step 2 — Chat. Finding out who she is dealing with.

**What she does:** asks four plain-English questions, one at a time.

**Why:** Pillars told her a statistic broke. It did not tell her whether this
is a quirk of one coder or a change in behaviour.

### Question 1 — "has anyone else noticed?"

```
which providers have the highest fraud referral rate
```
**Trust 93%.** **Dr. Ravi R. — 38.7%, on 284 claims. Rank 1.** Next are Dr. Anna T.
at 20.3% and Dr. Hugo S. at 11.8%.

This is the **independent check**. *Fraud referral rate* is the share of claims
that SIU itself flagged. It is a certified metric owned by SIU, and the Pillars
detector never reads that flag. Two systems that share no input landed on the
same name.

Chat shows provider names and Pillars shows IDs. Question 3 ties them together:
Dr. Ravi R. *is* PR-017.

### Question 2 — "how busy is he right now?"

```
claim count by provider in 2026 Q2
```
**Trust 93%.** **Dr. Ravi R. — 129 claims. Rank 1 of 59.** The next provider,
Dr. Nina L., has 60. He billed more than twice anyone else in her book that
quarter.

### Question 3 — "was he always like this?"

```
claim count for PR-017
```
**Trust 93%.** Quarter by quarter, 2024Q3 to 2026Q2:
**14 · 18 · 22 · 24 · 27 · 21 · 29 · 129.**

The platform flags it without being asked, in its own words:

> ⚠ Anomaly in 2026Q2: utilization jumped 344.8% QoQ (z=2.42) … claim type =
> Specialist Visit: +96 vs 2026Q1 (96.0% of the increase) … diagnosis category =
> Cardiac: +93 vs 2026Q1 (93.0% of the increase).

**Read that last clause out loud.** For seven quarters he billed 14 to 29
claims a quarter. Then in one quarter he added 100 claims, and 93 of them are
coded to a **cardiac** diagnosis. *An endocrinologist whose new volume is coded
to the heart.*

The 129 also matches Question 2, which is how she knows Dr. Ravi R. and PR-017
are the same provider.

### Question 4 — "is he billing big claims?"

```
claim severity by provider in 2026 Q2
```
**Trust 93%.** **Dr. Ravi R. — $1,445 average. Rank 59 of 59.** The next lowest
is $2,624.

This one stops her overselling. He is **not** billing big claims. His average
claim is the cheapest in the book, at about half the next provider's. Upcoding
does not look like large claims. **It looks like a lot of small visits, each
coded one level too high.** An analyst who walks in saying "he bills huge
claims" loses the room when someone pulls up this row.

### Stop here. This is the sentence the whole case is built on.

> **First in the book on SIU referrals. First on volume. Last on claim size.**

Volume and claim size are for 2026Q2. SIU referrals cover all eight quarters.

### Optional fifth question, if the room wants it

```
fraud referral rate by provider in 2026 Q2
```
**Trust 93%.** **Dr. Ravi R. — 80.6% of his 129 claims. Rank 1.** The next
highest is 46.3%. In the spike quarter, SIU flagged four of every five of his
claims.

### And who is he on paper?

| | |
|---|---|
| Provider | **PR-017**, Dr. Ravi R., NPI 1726563708 |
| Specialty / region | **Endocrinology**, **Southeast** |
| Network status | **Out-of-Network**, with no network contract |

Have this record ready before the meeting (Data tab ▸ providers ▸ filter
PROVIDER_ID). Don't open the Data tab live. See *Before you start*.

### Finding from Step 2

Not "a provider broke a rule." It is now:

> **An out-of-network endocrinologist who billed 14 to 29 claims a quarter for
> seven quarters, then billed more claims than anyone in the book in one quarter,
> mostly cheap specialist visits coded to cardiac diagnoses, while SIU flagged a
> larger share of his claims than anyone else's.**

### What this makes her do next

She is about to rely on a z-score. The first question in the room will be
**"is 3.0 a fair line, and who is he being compared with?"**

**→ Go to Context Brain.**

---
---

# Step 3 — Context Brain. Reading the rule before using it.

**What she does:** opens Context Brain ▸ **⚖️ Policy rulebook**, or types
`FWA-EM-UPCODE` in the search box, which jumps to `policy_rules.md` line 97. The
file is **🔒 Read-only** for her: *"Your role can view the Context Brain but not
edit it."*

**Why:** "the system said so" is not a defence. This takes ninety seconds.

### What the rule actually declares

| Setting | Value | In plain English |
|---|---|---|
| `high_em_codes` | **99205, 99215** | The two highest office-visit levels count as "high" |
| `peer_group` | **specialty** | He is compared with other endocrinologists, not the whole book |
| `z_threshold` | **3.0** | How far from his peers counts as abnormal |
| `min_claims` | **30** | Under 30 coded visits, nobody is judged at all |
| `citation` | **CMS E/M documentation guidelines; OIG work plan (E/M upcoding)** | It is CMS and OIG, not an internal preference |

The detector is also **leave-one-out**: the provider under test is removed from
his own peer average, so he cannot inflate the benchmark he is measured against.

### The remediation is her to-do list, and it is careful

> *Surface an FWACase with peer-relative z-score and estimated overpayment;
> route to SIU when z >= threshold and volume material.*

**Read it closely.** It says *route to SIU*. It does not say *fraud*, and it does
not say *recover automatically*. A high share of top-level visits can be
legitimate for a complex endocrine panel. Only a documentation review decides
that, and the rulebook leaves that decision to SIU.

### The companion rules she will meet in Step 7

| Rule | What it says |
|---|---|
| `ACT-DUAL-CONTROL` | Two distinct approvers if the impact is **≥ $10,000**, **or** severity is critical/high, **or** the action type is on the always-dual list. **`overpayment_recovery` is on that list.** |
| `ACT-TRUST-GATE` | Nothing executes below **0.85** trust |
| `ACT-APPROVER-ROLES` | Only a **compliance_officer** may approve |

### Finding from Step 3

Four answers she now has ready:

- *"Is 3.0 arbitrary?"* — It is declared, visible and versioned. A compliance officer can tune it with one signature, and the edit is ledgered. Morgan cannot touch it.
- *"Small sample?"* — The rule won't judge anyone with fewer than 30 coded visits. He has 284 in her book, most of them coded visits.
- *"Compared with whom?"* — Other endocrinologists, with him excluded from their average.
- *"Is this us or CMS?"* — CMS E/M documentation guidelines and the OIG work plan.

### What this makes her do next

Everything so far is her own work: her pick, her questions, her reading. She
wants the platform to turn it into work that someone owns.

**→ Go to Swarm.**

---
---

# Step 4 — Swarm. What it adds, and what it doesn't.

**What she does:** types one sentence. The box is pre-filled with the domain's
example question, *"Are there billing anomalies or upcoding from any provider?"*,
which produces the same run. She types her own:

```
Is provider PR-017 upcoding and are we overpaying?
```

### What happens

> **Activated 6 of 10 · trust 92% · gate ✅ passed**
> 15 finding(s) from 6 department(s). Lead: Em Upcoding — provider PR-017.

The lead finding, from **FWA / SIU**, is critical: *High-E/M share 43% vs
Endocrinology peer mean 4% (z=25.6)*, est. impact **$116,796.16**. Under the
findings:

> 📁 3 case(s) opened/updated: FWA-3b14d1a6, FWA-bbeecfb5, FWA-80ef701d

### Be straight about one thing

The Swarm is **not** a second opinion on PR-017. The FWA/SIU agent runs the same
detector Pillars ran, so of course it agrees. The independent signal was SIU's
own referral flags in Step 2. If you claim the Swarm "confirmed" it, someone
technical will catch it.

### What the Swarm gives her that nothing else did

**1. A case, automatically, behind a gate.** Cases open only when the run's
trust clears the case-creation floor declared in `agents.md` (0.60). This run
scored 92%, which also clears the 85% gate shown on screen.

**2. Two things she was not looking for, and the discipline not to over-read them.**

*Medical Economics:* **"Allowed cost up 121.1% in 2026Q2"** ($10,228,649 vs
$4,625,690), and **"region = Southeast drove 100.0% of the movement."** That is
PR-017's region and PR-017's quarter. It is tempting to pin a $5.6 million
spike on him. **Don't.** One Chat question settles it:

```
why did medical cost jump in 2026 Q2
```
> ⚠ Anomaly in 2026Q2: medical cost jumped 121.1% QoQ (z=2.39) … region =
> Southeast: +5,684,149 … claim type = ER: +5,812,312 vs 2026Q1 (100.0% of the
> increase).

The spike is **ER claims**, while his are specialist visits. His whole 2026Q2 is
**$186,462** (`medical cost by provider in 2026 Q2`, rank 20 of 59). It is a
different claim type, a different case and a different department.

*Network Management:* **"Out-of-network spend is 17.6% of allowed"**
($8,534,418.62). PR-017 is out-of-network, so his contract status is Network's
conversation, not hers.

The three **PBM reject** findings (NCPDP 75/70/76) are a separate formulary
story. She leaves them alone and says so.

**3. A confidence number with its gate shown.** Trust 92% against an 85% gate,
printed on the screen. It is a measured score, not a feeling.

### Finding from Step 4

> **One case worth acting on, opened automatically. Plus one trap she avoided:
> the Southeast spike is real, but it is not his.**

**→ Go to Cases.**

---
---

# Step 5 — Cases. Turning screens into work someone owns.

**What she does:** opens Cases. She creates nothing; the swarm already did.

> 📁 Case Queue · **3 in your scope** · **$126,546.98 est. impact**

| Case | Type | Subject | Pattern | Severity | Trust | Impact |
|---|---|---|---|---|---|---|
| **FWA-3b14d1a6** | FWACase | **PR-017** | em upcoding | **critical** | 92% | **$116,796** |
| FWA-bbeecfb5 | FWACase | PR-045 | em upcoding | high | 92% | $8,637 |
| FWA-80ef701d | FWACase | PR-019 | unbundling | high | 92% | $1,114 |

**Two details worth showing.**

**De-duplication.** Run the same swarm question again and you get the same three
case IDs, now *updated* rather than *opened*. There are still 3, not 6. An
analyst who runs a query five times while preparing does not create five
investigations for someone else to untangle.

**Triage is not hers.** The case should go to SIU. That is what the rule's
remediation says. She sets the status select to `referred_siu`:

> **Role 'ma_analyst' is not permitted to perform 'review_resolve'**

Triage is an officer's decision. Casey will make it in Step 7.

### Finding from Step 5

**FWA-3b14d1a6 is the one to act on.** PR-045 is barely past its line, and
PR-019 is a claims-edit problem worth $1,113.77.

### What this makes her do next

She is one click from proposing a $116,796 recovery. Before she does, she wants
to know whether the number matters.

**→ Go to the Simulator.**

---
---

# Step 6 — Simulator. Is it material, and what is the fix worth?

**Why:** two questions are coming. *"Does $116,796 move our loss ratio?"* and
*"If we fixed the control rather than the provider, what is that worth?"* If she
has no answer, the recommendation stalls for a week.

### First, what the $116,796.16 is

It is the detector's estimate of the **excess**, not his total billing: his
top-level share (43%), minus his peers' (4%), times what Medicare Advantage paid
him on E/M claims. The case's detail line shows the two shares.

**Be straight about this.** Unlike the Medicare Sales Brain, which declares a
dispute rate and a recovery cost, **the payer Brain declares no recovery-net
formula.** So Morgan does not invent one, and she says so. If the business wants
a net figure, the right fix is for Compliance to declare it in `simulation.md`,
where it is governed and versioned like everything else, rather than a dispute
rate made up in a meeting.

### The Simulator run — exactly what to type

Baseline cohort, then two overrides. Leave the op as **shift by %** on both.

| Field | Value |
|---|---|
| Baseline cohort | `Medicare Advantage` |
| Override 1 | `metrics.medical_cost.stress_pct` · shift by % · `-0.01` · *prepayment E/M documentation review across the MA book* |
| Override 2 | `metrics.mlr.stress_pct` · shift by % · `-0.01` · *the same 1%, on the loss ratio* |

Click **▶ Run simulation**:

> **trust 100% ✓ gate cleared** · MLR Δ **−104 bps** (1.036 → 1.0256) ·
> Net $ impact **$484,560** · Affected members 1952

### How to read it

**Every 1% of Medicare Advantage medical spend is $484,560 and about 104 basis
points of loss ratio.** PR-017's $116,796.16 is roughly **0.24 of one of those
points**, which is about **25 basis points**.

So say it before someone else does: **this is a real recovery and a weak MLR
story.** It is a payment-integrity case, not a loss-ratio event. The stronger
argument for acting is the second reading: a prepayment E/M review that trimmed
just 1% across the book would be worth **four times this whole case.**

### The governance beat, ten seconds

Change the baseline to `Medicaid claims` and run it again:

> **'Medicaid' is outside your authorized scope**

She cannot even *simulate* a book she cannot see.

### What to know before you type

- **The simulator does not derive MLR from cost.** The two levers are independent, so she moves both by the same 1% on purpose. With only the cost lever, MLR Δ reads 0.
- **Only four levers exist:** `medical_cost` and `pharmacy_cost` move dollars, `mlr` moves basis points, and `reject_count` moves admin minutes. `pharmacy_cost` ignores the cohort and applies to the whole LOB.
- **Affected members counts members, not claims.** A baseline filtered by provider or claim type still reports the whole book (1952). Here the baseline *is* the whole book, so it is correct.
- The MLR card prints its delta as `Δ -0.0104 bps`. That is a labelling quirk. Read the summary line (**−104 bps**).

**Do not quote the $484,560 as PR-017's number.** It is the book-wide lever.
Mixing the two up is the easiest way to lose credibility in this demo.

She does **not** click *📤 Promote to Action Queue*. That is a policy decision for
the committee. If she did, it would land in the same dual-control queue
(impact $484,560 ≥ $10,000).

### Finding from Step 6

> **Recover $116,796.16 gross. It is about a quarter of a point of medical spend,
> so the case is about integrity, not MLR. The book-wide control is worth
> $484,560 for every 1% it saves, and that is a separate conversation.**

**→ Go to Actions.**

---
---

# Step 7 — Actions. She proposes. She gets refused. That is correct.

**What she does:** back in Cases, she clicks **propose ▸** on FWA-3b14d1a6:

> **Proposed ACT-… (dual control) — review it in the Actions tab**

Action IDs are random for each proposal, so yours will differ. On the Actions
tab, the card reads:

> **overpayment recovery** · PENDING_FIRST_APPROVAL · 👥 dual control ·
> impact $116,796 · severity critical · trust 92%
> Proposed: Remediate em upcoding for PR-017 → PR-017 on dry_run

The amount, severity and trust come **from the stored case, server-side.** Nobody
can type a smaller number into the request to avoid the second signature.

### Why dual control? Open the compliance logic tree.

Click **▸ compliance logic tree**. It lists the reasons:

> 1: estimated impact $116,796 ≥ threshold $10,000
> 2: regulatory severity 'critical' is a dual-control trigger
> 3: action type 'overpayment_recovery' always requires dual control

**Any one of the three would have forced the second signature.** In the AG-0027
case the amount was under the threshold. Here the money, the severity and the
nature of the action all agree.

### Then she tries to approve it herself

She clicks **✍️ Approve**:

> **Role 'ma_analyst' is not permitted to perform 'action_approve'**

**Read it carefully.** It does not say *you cannot approve your own*. It says an
MA analyst cannot approve **any** write-back. The refusal is also written to the
ledger as a `forbidden` event.

In business language: **the person who found the problem does not decide the
remedy against a provider.**

### What happens after she hands it over

| Who | What | What the screen says |
|---|---|---|
| **Morgan** (`u-ma`) | propose ▸ | created, dual control, PENDING_FIRST_APPROVAL |
| **Morgan** | ✍️ Approve | **refused:** Role 'ma_analyst' is not permitted to perform 'action_approve' |
| **Casey** (`u-compliance`) | case status → `referred_siu` | FWA-3b14d1a6 → referred_siu |
| **Casey** | ✍️ Approve | approve ok → PENDING_SECOND_APPROVAL |
| **Casey** | ✍️ Approve (2nd) | **refused:** separation of duties: approver_2 must differ from approver_1 |
| **Dana** (`u-compliance2`) | ✍️ Approve (2nd) | approve ok → APPROVED |
| **Dana** | 🚀 Execute write-back | execute ok → **EXECUTED**, with a payload hash |

**Three refusals, three different reasons:** wrong role to approve, wrong role
to triage, and the same person twice. If trust were below 85%, the execute
button would read **⛔ Below 85% gate**, which is a fourth.

The target is **dry_run**: it records the exact outbound payload and performs no
external write. After execution the card offers **↩ Compensate (void/credit)**.
A reversal is itself a new dual-control action and never an edit to the
original.

### Finding from Step 7

> **Morgan did the whole investigation and cannot touch the remedy. That is not
> a limit of her login. It is the product.**

---
---

# Step 8 — SQL Log and Governance. The receipts.

**What she does:** thirty seconds in two tabs, as an officer. Refresh first if
you are coming from Actions.

**SQL Log.** Every statement the platform ran during the investigation, in
full: Pillars' detectors, every Chat question and the simulator's aggregates.
**Every statement is a SELECT. Nothing was written to the warehouse.** Nothing
she did could have changed a number.

**Governance ▸ Answer provenance.** Every answer she got has a receipt: who
asked, the trust score, the Brain policy version (`sha256:…`), and *"model
(deterministic — no model invoked)"*. Click **check** on one and it returns
**✓ conditions unchanged — reproducible.**

**The ledger.** On the Actions tab, signed in as Casey or Dana, the banner reads
**🔗 hash chain intact**, with the number of blocks checked. Every proposal,
refusal, signature and execution is in it.

**FinOps:** $0.0000, 0 tokens. The whole investigation ran on governed SQL, not a
model.

### Finding from Step 8

> **The analysis could not have altered the data, every answer can be re-run,
> and the approvals cannot be rewritten after the fact.**

---
---

# The one thing Morgan must say when she hands it over

Her number is **$116,796.16**, and it is **correct for her book.**

When Casey opens **Pillars at full scope**, the same provider reads:

> em_upcoding · PR-017 · **26.83** · **$351,997.58** · High-E/M share 49% vs
> Endocrinology peer mean 5% (z=26.8)

That is **three times** Morgan's figure, because PR-017 bills Medicaid,
Commercial and ACA Exchange members the same way. Casey also sees an alert
Morgan never sees at all: **PR-018, impossible day, $33,548.88**. And PR-045,
the borderline alert Morgan passed over, **is not flagged at full scope at all**.
With every book included, his z-score falls to 1.11. That is the best evidence
that her method was right.

If Casey runs the same swarm question at her own scope, the platform opens
**a separate case, FWA-ee392224, for PR-017 at $351,997.58.** Morgan cannot see
it.

**One caution to say out loud.** The Medicare Advantage claims are *inside*
that $351,997.58. Recover once: the officer decides which case carries the
recovery, and rejects the other with a reason.

Morgan was not wrong. **She was complete for Medicare Advantage.** This is the
line to say in the demo:

> **The access control that correctly kept Morgan out of Medicaid is the same
> control that hid two thirds of the money. The platform does not fix that by
> loosening the control. It fixes it by requiring the one person who can see all
> four books to be in the workflow before anything happens.**

That is why the analyst proposes and the officer approves. It is not
bureaucracy. **The officer is the only one who can see the whole picture.**

---

# What Morgan does *not* do — worth stating

- She does **not** decide it is fraud. The rule routes it to SIU, and a high top-level share can be legitimate for a complex panel. The documentation review decides.
- She does **not** contact the provider, hold his payments, or touch a claim.
- She does **not** see three of the four books, and never learns her number is a third of the total until Casey tells her.
- She does **not** change the threshold. The Brain is read-only for her. A compliance officer could change `z_threshold` with one signature, ledgered. The controls that decide *who signs* (the $10,000 threshold, severity triggers, approver roles, trust gate) need two officers.
- She does **not** write anything to the warehouse. She could not if she tried.

---

# The whole thing on one page

| Step | Tab | What she finds | What it forces next |
|---|---|---|---|
| 1 | Pillars | 3 FWA alerts. **PR-017 is 8.5× past its line**; everything else is borderline or a queue. $116,796.16 of $126,546.98. | Needs to know who this is |
| 2 | Chat | **First on SIU referrals (38.7%), first on volume (129 in Q2), last on claim size ($1,445).** The spike is cardiac-coded specialist visits. | Needs to defend the rule |
| 3 | Context Brain | Line 3.0, minimum 30 coded visits, compared with endocrinologists, **CMS + OIG**. Remediation routes to SIU and does not accuse. | Needs it to become work |
| 4 | Swarm | 6 of 10 activated, **trust 92%**, 3 cases opened. The Southeast spike is ER claims, **not his**. | Needs to see the cases |
| 5 | Cases | **FWA-3b14d1a6, $116,796**, de-duplicated. Triage refused for her role. | Needs to know if it matters |
| 6 | Simulator | 1% of MA spend = **$484,560 / −104 bps**. His case is about 25 bps: integrity, not MLR. | Ready to propose |
| 7 | Actions | Proposes. **Refused by role.** Casey signs once and is refused a second signature; Dana countersigns; executed. | Hand-off complete |
| 8 | SQL Log / Governance | **Zero writes. Reproducible receipts. Chain intact.** | Close it |

**Eight steps. Roughly twenty minutes. One provider.**

And the sentence the whole thing exists to produce:

> *"An out-of-network endocrinologist billed more claims in 2026Q2 than anyone
> in our book, mostly cheap specialist visits coded to cardiac diagnoses. Pillars
> puts him 25 standard deviations from his peers, and SIU had already flagged 39%
> of his claims. The Medicare Advantage recovery estimate is $116,796.16, about a
> quarter of a point of medical spend, so this is payment integrity, not an MLR
> event. I've proposed the recovery. I can't approve it. It needs two compliance
> signatures, and when Casey opens it at full scope she'll see $351,997.58."*

---

## If they push — answer honestly

| If they ask… | The honest answer |
|---|---|
| "Is this real data?" | No. It is a deterministic synthetic payer book, and the PR-017 cluster is planted on purpose (`app/data/generate.py`). The mechanics are real: the detectors, RBAC, trust gate, dual control and hash chain. |
| "Did an LLM find this?" | No. The provider is `mock`, at 0 tokens. Every number came from governed SQL and deterministic detectors. |
| "Isn't a high E/M share sometimes legitimate?" | Yes. That is why he is compared with endocrinologists only, why the rule routes to SIU rather than recovering automatically, and why an officer signs. |
| "The rule text lists four codes but the parameter lists two." | The declared parameter (99205, 99215) is what runs. With all four codes he is still z 11.74 against his peers, computed against the same claims. Either definition flags him. |
| "Why $116,796 and not his whole billing?" | It is the excess: (his top-level share − his peers') × what we paid him on E/M claims. |
| "Could Morgan just change the rule?" | No. The Brain is read-only for her. Officers can tune business thresholds with one signature, versioned and ledgered. Changing who must sign needs two officers. |

---

## Presenter's notes

**Run it in this exact order.** Each step creates the question the next one
answers. If you start at the Swarm, Step 2's "first, first, last" lands flat.

**The two moments to slow down on.** Step 2, when the cardiac clause appears.
And Step 7, when the platform refuses the analyst who did all the work.

**Live gotchas, checked in the running app on 1 October 2026:**

1. **Switch the domain first.** The live pointer is on Medicare Sales. Any signed-in role can switch it, which is itself a gap worth fixing.
2. **Keep the Data tab closed in front of a client.** Its preview currently returns **every table unscoped**, to any role: other books' claims and members, and the `users` table with password hashes. Fix it before any client sees the platform.
3. **Leaving the Actions tab blanks the app.** Refresh (⌘R) and you are back, still signed in. Cause: `LedgerBanner` in `ActionQueueTab.jsx` passes a Promise-returning function to `useEffect`. The fix is one line.
4. **As Morgan, the Actions tab banner says "🚨 chain broken at seq undefined." It is false.** Her role is refused the ledger (`audit_read`) and the banner misreads the refusal. Show the chain as Casey: **🔗 hash chain intact**.
5. **Leftovers from earlier demo runs are visible.** The payer welcome screen suggests *"How is avg outreach attempts (hedis_measure_results) trending?"*, and Data Layer lists `evil_name_drop` and `hedis_measure_results`, `_2` and `_3`. Don't click them, and clean the Brain before a client demo.
6. **Case IDs are content-hashed** (FWA-3b14d1a6, FWA-bbeecfb5, FWA-80ef701d, and Casey's FWA-ee392224) and reproduce on a clean run. Action IDs and swarm timings do not.

---
---

# Appendix — The HEDIS Stars demo, checked act by act

Checked on 1 October 2026 through the same HTTP endpoints the UI calls, on a
copy of this machine's live state. The repository's own pre-flights also pass:
`hedis_demo_verify.py` 20/20, `hedis_alltabs_verify.py` 59/59 and
`e2e_case6_hedis_stars.py` 48/48. **But they call the engine directly**, which
is why several of the gaps below never surfaced.

| Act | The document says | What actually happens | Verdict |
|---|---|---|---|
| 1 | HEDIS gap rate by region: 96%. Northeast 55.0%, Midwest 54.8%, Southeast 54.2%. | Exactly that. | ✅ |
| 1 | RAF by region: 96%. Northeast 0.95, Southeast 0.929, West 0.921. | Exactly that. | ✅ |
| 2 | 9,110 rows import; the join to the member book is discovered | 9,110 rows; 6 joins suggested, including `member_id = members.member_id` | ✅ |
| 2 | 178 rows (1.95%) with no service date | 178 of 9,110 (1.95%) | ✅ |
| 2 | "A shape OpPal has never seen"; six candidate metrics, all UNCERTIFIED | **Not on this machine.** From earlier runs, the Brain already holds 176 drafted entity blocks for this file and the six metrics (`avg_gap_open` is `certified: true`). Data Layer lists `hedis_measure_results`, `_2` and `_3` before the import. | ⚠ Clean the Brain first |
| 3 | "What is the CBP gap rate?" refused at 57%, grounding 0% | 57%, grounding 0%, SQL withheld | ✅ |
| 4 | Paste three metrics plus vocabulary, single signature | Saves through 💾 Save & Reload (22 metrics · 87 vocabulary terms), with no dual control | ✅ |
| 5 | CBP gap rate: 100%. Southeast 58.7%, Northeast 24.7%, Midwest 22.4%, Southwest 21.5%, West 19.5%. | Matches, except that on screen Southwest reads 21.4% (0.2145, which the chart rounds down) | ✅ |
| 5 | Star measure gap rate by measure name: 93%. CBP 29.5%, TOC 19.8%, Colorectal 19.8%. | Exactly that. | ✅ |
| 5 | Outreach attempts per gap by region: **100% trust**. West 1.46 … Southeast 0.34. | Values exact, but **trust is 93%** | ⚠ Fix the number |
| 5 | Outreach per gap by measure name: 93% | Exactly that | ✅ |
| 5 | CBP gap rate by age band: 93%, 65+ 29.5% | Exactly that | ✅ |
| 6 | Audiences: 234 MA members, Southeast, open CBP gap | The Audiences tab cannot express "CBP". The clause is **silently dropped** and the audience saves as the whole Southeast MA book (2,747 claims). The 234 comes only from a Python script. | ❌ |
| 6 | Analysis: forecast with prediction intervals | Refused: *'cbp_gap_rate' declares no time_column*. Act 4 tells you to leave it empty. | ❌ |
| 6 | Swarm: the Quality/Stars agent activates | It does, but the run **opens 0 cases**, so the Cases tab is empty | ⚠ |
| 6 | Action Queue: propose the outreach campaign, dual control | No UI path. Cases' *propose* needs a case, and the server rejects `care_gap_outreach` (*unknown action_type*). The allowed `member_outreach` without a case gets trust 0, so it can never execute. | ❌ |
| 6 | Workspace, FinOps, Governance | Work as described (mock provider, 0 tokens; chain verifies) | ✅ |
| — | "RBAC-scoped" | A **Medicaid-only analyst** gets the CBP numbers from this Medicare Advantage file at 100% trust. The imported table has no `lob` column, so it is treated as cross-LOB reference data. | ⚠ Say it before they find it |
| — | "997 automated checks" | Out of date. `CLAUDE.md` quotes 1,643 phase checks. | ⚠ |

**One instruction to change.** The HEDIS document's first step is *"Run
`demo/hedis_demo_verify.py` before the meeting."* Run against the live install,
that script appends another copy of the drafted entity and vocabulary to the
live Brain every time. That is how this machine reached 176 entity blocks, and it
is what breaks Act 2's "never seen" moment. Run it against a copy of the backend,
or clean the Brain afterwards.
