# Provider PR-017 — How an Analyst Works a Healthcare Claims Case

**Persona:** Morgan, a claims analyst at a US health insurer (claims are the
bills doctors send to an insurer). Her job is *payment integrity*: making sure
the company pays doctors' bills correctly. She covers the insurer's Medicare
Advantage plans (government-funded health plans for people aged 65+, run by
private insurers). Signs in as `u-ma`.
**Case:** Provider **PR-017**, Dr. Ravi R., an endocrinologist (a hormone and
diabetes specialist).
**Domain** (the industry knowledge pack the platform runs): Healthcare
Insurance (US Payer / MCO). *Payer* and *MCO* (Managed Care Organization) are
industry words for a health insurer.

> **Who this is for.** Investors, managers and anyone without a medical or
> insurance background. Every specialist term is explained in plain English
> **before** it is used: once in the glossary below, and again in a short box at
> the start of each step. Morgan, Casey, Dana and Dr. Ravi R. are fictional demo
> characters, and all the data is synthetic.

This is the same login as the Medicare Sales walkthrough (`u-ma`, shown on
screen as *Morgan Advantage*), running a different industry knowledge pack (the
platform calls this a *domain*). Every number below was checked against the
running platform on 1 October 2026, and every step was walked through on screen.
Where a number is only true for Morgan's login, the text says so.

---

## Read this first — the story in 60 seconds

**How health insurance pays doctors.** A health insurer collects a monthly fee
(a *premium*) for each person it covers (its *members*). When a member sees a
doctor, the doctor sends the insurer a bill, called a *claim*, and the insurer
pays it. A large insurer pays millions of claims, mostly automatically. Some of
those bills are wrong, by mistake or on purpose. The team that catches them is
called *payment integrity*.

The insurer in this demo runs four separate *lines of business*, each with its
own members and its own data: **Medicare Advantage** (plans for people aged 65+),
**Medicaid** (government coverage for people on low incomes), **Commercial**
(insurance provided by employers) and **ACA Exchange** (individual plans bought
on the government marketplace). Staff usually see only the line they work on.

**What happened here.** One doctor, Dr. Ravi R. (provider ID PR-017), is a
hormone and diabetes specialist. In one quarter he suddenly billed far more
visits than usual. Most were billed at the most expensive complexity level, and
many were for heart problems, outside his specialty. Billing a visit at a
higher level than it deserves is called *upcoding*. Each visit is small money,
but together they add up to an estimated **$116,796.16** overpaid in one line of
business, and about three times that across the whole company.

**What the platform did.** OpPal's always-on rules flagged him before anyone
asked. Morgan confirmed it with plain-English questions, saved his suspicious
bills as one named group, read the rule, let the platform open a tracked case,
sized the money and proposed to recover it. She
was then **refused** permission to approve her own recommendation, by design.
Two different *compliance officers* (the senior staff responsible for following
the rules, who can see all four lines of business) had to approve it, and every
step was written to a tamper-proof log.

**The point for an investor.** The product doesn't stop at finding problems. It
turns a finding into a priced, evidenced recommendation. And it guarantees that
the person who found the problem can't also decide the outcome, which is the
control regulators and auditors look for.

---

## Who's who

| Who | Role in the story | What they can do |
|---|---|---|
| **Morgan** (`u-ma`) | Analyst for the Medicare Advantage business | Sees Medicare Advantage data only. Investigates and proposes actions. **Cannot approve anything.** |
| **Casey** (`u-compliance`) | Compliance officer | Sees all four businesses. Approves or rejects actions. Sends cases to the fraud team. |
| **Dana** (`u-compliance2`) | A second compliance officer | Provides the second, independent signature |
| **Dr. Ravi R.** (`PR-017`) | The doctor under review | — |
| **SIU** | The insurer's in-house fraud team (*Special Investigations Unit*) | Investigates suspected fraud and decides whether the bills were genuine |

---

## Glossary — every term in this document, in plain English

### Health insurance basics

| Term | Plain English |
|---|---|
| **Payer / MCO** | The health insurance company. *MCO* = Managed Care Organization, an insurer that also manages how care is delivered. |
| **Member** | A person covered by the insurer: the patient. |
| **Premium** | The monthly price paid for each member's coverage. |
| **Claim** | The bill a doctor sends the insurer after treating a member. |
| **Provider** | Anyone who treats members and bills for it: a doctor, clinic or hospital. The **provider ID** (e.g. PR-017) is the insurer's internal code for them; the **NPI** (National Provider Identifier) is their national ID number. |
| **Specialty** | A doctor's field. **Endocrinology**: hormones and glands, e.g. diabetes and thyroid. **Cardiology / cardiac**: the heart. **Psychiatry**: mental health. **Oncology**: cancer. **Family medicine**: general practice. |
| **In-network / out-of-network** | In-network doctors have signed a contract with the insurer, with agreed prices and rules. Out-of-network doctors have not. |
| **Line of business / book (LOB)** | The insurer's separate product lines. Here there are four: **Medicare Advantage** (**MA**: government-funded plans for people 65+, run by private insurers), **Medicaid** (government coverage for people on low incomes), **Commercial** (insurance provided by employers) and **ACA Exchange** (individual plans bought on the government marketplace). Each one is a "book" of members. |
| **Allowed amount / paid amount** | *Allowed* is the price the insurer accepts for a service. *Paid* is what it actually pays after the member's own share (co-pays). |
| **Medical cost / claim severity / claim count** | Total allowed spending, average cost per claim, and number of claims. The platform also calls the claim count *utilization*. |
| **Specialist visit / ER** | An office visit with a specialist doctor; an Emergency Room visit. |
| **Diagnosis category** | The medical condition a claim is for, e.g. cardiac or respiratory. |
| **Payment integrity** | The team that makes sure claims are paid correctly, no more and no less. |

### How doctors bill an office visit

| Term | Plain English |
|---|---|
| **E/M code** | *Evaluation and Management*: the billing code for an office visit. Visits are graded into levels by complexity, and a higher level pays more. |
| **99205 / 99215** | The top level, i.e. the most complex and most expensive visit: 99205 for a new patient, 99215 for an existing one. **99204 / 99214** are one level below. |
| **High-E/M share** | The percentage of a doctor's office visits billed at the top level. |
| **Upcoding** | Billing a visit at a higher level than what actually happened, e.g. billing a short routine check as a long, complex visit. |
| **Unbundling** | Billing separately for parts of a service that the rules say must be billed as one package, which pays more in total. |
| **NCCI** | *National Correct Coding Initiative*: the government's list of procedure pairs that must not be billed separately. |
| **Impossible day** | A provider billing more than 24 hours of services in a single day. |
| **Documentation review** | Checking the doctor's medical records to see whether each billed level is supported. |
| **Prepayment review** | Checking claims *before* paying them, rather than recovering money afterwards. |
| **Billing check (claims edit)** | An automatic rule in the payment system that rejects an invalid combination of codes before the claim is paid. |
| **Panel** | The group of patients a doctor treats. |

### Fraud and getting money back

| Term | Plain English |
|---|---|
| **FWA** | *Fraud, Waste and Abuse*: the umbrella term for improper billing, deliberate or careless. |
| **SIU** | *Special Investigations Unit*: the insurer's in-house fraud investigators. |
| **Fraud referral rate** | The share of a provider's claims that SIU has flagged as suspicious. |
| **Overpayment / recovery** | Money paid that should not have been / getting it back from the provider. |
| **Estimated overpayment (in this case)** | (His share of top-level visits − his peers' share) × what we paid him for office visits. It is an estimate for SIU to confirm, not a bill. |
| **Gross / net** | *Gross* is the full amount. *Net* is what is left after the cost of collecting it and the share the provider successfully disputes. |
| **Est. impact / exposure** | The platform's estimate of the money at stake. |
| **Material** | Big enough to matter to the business as a whole. |
| **Audit / auditor** | An independent check of the company's records, by its own audit team or by government auditors. |

### Regulators and rules

| Term | Plain English |
|---|---|
| **CMS** | *Centers for Medicare & Medicaid Services*: the US government agency that runs Medicare and regulates insurers that sell Medicare Advantage. |
| **OIG** | *Office of Inspector General*: the US health department's fraud watchdog. Its yearly *work plan* lists what it is targeting, and upcoding of office visits is on it. |
| **42 CFR §422 / §423** | The federal regulations for Medicare Advantage (Part 422) and for Medicare drug plans (Part 423). |
| **Prior authorization (PA)** | The insurer's advance approval, required before certain treatments or drugs. |
| **UM** | *Utilization Management*: the insurer's review of whether a requested treatment is medically necessary. |
| **Auto-approve / pended / denied** | Approved automatically / put on hold for a human reviewer / refused. |
| **Decision deadlines and timeliness breaches** | The law gives an insurer a deadline to decide a member's request: 72 hours for a standard drug request (24 hours if urgent, called *expedited*), and 14 days (336 hours) for a standard medical request (72 hours if urgent). Missing the deadline is a **timeliness breach**. |
| **CDAG / ODAG** | The two lists of these decisions that government auditors check: **CDAG** for drug decisions and **ODAG** for medical decisions. CMS calls each complete list a **universe**. |
| **Member notice** | The letter telling the member what was decided. |
| **MLR (Medical Loss Ratio)** | Of every premium dollar collected, how many cents go to paying for care. Medicare Advantage plans must spend at least 85% on care, or pay the difference back. |
| **Basis point (bp)** | One hundredth of a percentage point. 100 bps = 1 percentage point, so 104 bps = 1.04 points. |
| **PBM** | *Pharmacy Benefit Manager*: the company that processes prescription claims for the insurer. |
| **Formulary** | The insurer's list of covered drugs. |
| **NCPDP reject codes 70 / 75 / 76** | Standard reasons a prescription is refused at the pharmacy counter: 70 = drug not covered, 75 = needs prior authorization, 76 = over the plan's quantity limit. |

### Statistics and symbols

| Term | Plain English |
|---|---|
| **Peer group / peer mean** | The doctors he is compared with (other endocrinologists) / their average. |
| **z-score** | How unusual a number is, counted in "typical spreads" (*standard deviations*) from the peer average. 0 is average and 3 is already rare. PR-017 is at 25.6. |
| **Leave-one-out** | The doctor being tested is left out of his peers' average, so he can't pull the benchmark towards himself. |
| **Outlier** | A value far outside the normal range. |
| **2026Q2 / QoQ** | 2026Q2 = April to June 2026. QoQ = compared with the previous quarter. |
| **Symbols** | **Δ** = change · **≥** = at least · **×** = times · **→** = becomes |

### The OpPal platform

| Term | Plain English |
|---|---|
| **OpPal** | The analytics and governance platform being demonstrated. |
| **Domain** | The industry knowledge pack the platform is running: Healthcare Insurance, Medicare Sales or Pharma. |
| **Pillars** | A dashboard of rules that run automatically on the data, before anyone asks. |
| **Chat** | Ask a question in plain English. The platform answers with a chart, the data, and the exact query it ran. |
| **Audience** | A saved, named group of bills, described in plain English, e.g. *Medicare Advantage claims from PR-017 in 2026 Q2*. While it is switched on (*active*), every Chat question is about that group only. Two audiences can be compared side by side. The platform also calls one a *risk pool* or *cohort*. |
| **Context Brain** | The platform's rulebook: plain-text files defining every metric, rule and business term. Anyone can read it, only authorized roles can edit it, and every change is logged. |
| **Governed / certified metric** | A number with an approved definition and a named business owner, e.g. *Fraud Referral Rate*, owned by SIU. |
| **Trust score / trust gate** | The platform's confidence in its own answer (0–100%). It combines four checks: did it understand the question, did the query pass safety checks, was there enough data, and are the definitions certified. Below 85% (*the gate*) it refuses to answer and hands the question to a human. |
| **Grounding** | Whether the platform could match the words in a question to a defined metric. |
| **Withheld** | The platform refused to run its query because confidence was below the gate. |
| **Swarm / agents / Sentry** | A team of specialist software "departments" (Fraud, Network, Medical Economics, Pharmacy and others). The *Sentry* reads the question and decides which departments to wake up. Each one runs its own checks and reports *findings*. |
| **Case** | A tracked work item with an ID, a money value, a severity and a status: *open → reviewing → referred to SIU → closed*. |
| **Severity** | The platform's urgency label: critical, high or medium. |
| **Triage** | Deciding what happens next to a case, e.g. sending it to the fraud team. Only officers may do it. |
| **Action / write-back** | An instruction the platform sends into the insurer's core systems, here "recover this overpayment". |
| **Dry run** | A safe mode used in this demo: the platform records exactly what it would send, but sends nothing. |
| **Dual control (maker–checker)** | Two different authorized people must approve before anything happens, and the person who proposed it can never approve it. This is called *separation of duties*. |
| **Compensate (void/credit)** | Undo an executed action. The undo is itself a new two-person action, and the original record is never edited. |
| **Scope / RBAC** | *Role-Based Access Control*: what each login is allowed to see. Morgan's scope is Medicare Advantage only. |
| **Simulator** | A what-if calculator ("if spending fell 1%, what happens?"). It works on a copy of the rules and never changes real data. The **baseline** is the group it applies to; a **lever** (or *override*) is the number you change. |
| **SQL Log / SELECT** | The list of every database query the platform ran. *SQL* is the standard database language; a *SELECT* query only reads data and cannot change it. |
| **Audit ledger / hash chain** | A log in which each entry carries a digital fingerprint of the one before, like links in a chain. Altering any old entry breaks the chain, and the platform detects it. |
| **Provenance receipt** | A record attached to each answer saying which data, which rule version and which steps produced it, so anyone can re-check it later. |
| **FinOps / tokens / LLM / mock** | The platform *can* use an AI language model (an *LLM*), which is paid for by units of usage (*tokens*). In this demo the AI is switched off (*mock*), so the cost is $0. Every number comes from fixed rules and database queries, and the same input always gives the same answer. |
| **Content-hashed ID** | An ID calculated from a case's content, so re-running the same analysis returns the same case instead of a duplicate. |
| **AG-0027** | The sales agent investigated in the companion Medicare Sales walkthrough. |

### For the HEDIS appendix only

| Term | Plain English |
|---|---|
| **HEDIS** | A standard set of quality measures that health plans report, e.g. "is the member's blood pressure under control?" or "did they have their cancer screening?". |
| **Star Ratings** | CMS scores every Medicare Advantage plan from 1 to 5 stars on quality. Plans at 4 stars or above earn a government bonus, so quality scores are money. |
| **Care gap** | A recommended test or treatment that a member has not had yet. |
| **CBP / TOC** | *Controlling High Blood Pressure*: a HEDIS measure that CMS counts three times (*triple-weighted*) in the Star Rating. *TOC* = *Transitions of Care*, i.e. follow-up after a hospital stay. |
| **Outreach** | Contacting members, by phone or letter, to get them in for the missing care. |
| **RAF score** | *Risk Adjustment Factor*: how sick a member is expected to be, where 1.0 is average. Government payments rise for sicker members. |
| **Vendor file** | A data file supplied by an outside company. |
| **Entity / metric / vocabulary** | In the Context Brain: an *entity* describes a data table, a *metric* defines a number, and *vocabulary* maps everyday words to metrics. |
| **Forecast** | A projection of a number into future quarters, usually with a range (a *prediction interval*) showing how uncertain it is. |
| **Workspace** | A dashboard where findings are pinned for a committee. |
| **Pre-flight** | A test script run before a demo to confirm everything works. |
| **Act** | One section of the manager's HEDIS demo script. |

---

## First — can the HEDIS Stars case do this?

> **💡 In plain English.** Your manager's version of this demo tells a different
> story, about health-plan quality scores (HEDIS and Star Ratings, see the
> glossary). We tested it screen by screen. It is very good at showing the
> platform refuse to guess and then learn a new definition. It **cannot** show
> the journey from investigation to a tracked case, a what-if calculation and a
> two-person approval. That journey is what investors need to see, so this
> document uses a fraud case instead.

The manager's HEDIS document (*The Stars Measure Nobody Was Watching*) was checked
end to end, act by act, through the same screens a presenter uses. The details
are in the **Appendix**. The short version:

| What we need to show | HEDIS Stars case | This case (PR-017) |
|---|---|---|
| Chat, including a refusal at the trust gate | ✅ Its strongest part: refused at 57%, taught, then answered at 100% | ✅ |
| Pillars | ❌ Not used. No HEDIS rule exists in Pillars. | ✅ |
| Audiences | ❌ "CBP" is silently dropped, so the group saves as the whole Southeast MA book | ✅ Saves his 129 spike-quarter bills, narrows later questions, compares two quarters |
| Swarm | ⚠ Routes to Quality/Stars correctly, but **opens 0 cases** | ✅ Opens 3 cases |
| Cases | ❌ Stays empty, so there is nothing to work | ✅ |
| Simulator | ❌ Not in the HEDIS document, and no HEDIS lever exists | ✅ |
| Actions (propose → refused → two signatures → execute) | ❌ No way to do it from the screens. `care_gap_outreach` (a "contact these members" action) is rejected by the platform. | ✅ |
| Context Brain, Governance, SQL Log | ✅ | ✅ |

**Keep the HEDIS demo for what it does best:** a file the platform has never
seen, a refusal, a governed fix, then an answer. **Use this case to show the
full loop, from finding a problem to a two-person approval.** If you run both, do the HEDIS one first (about 15 minutes),
then this one (about 25 minutes).

---

## Before you start (5 minutes)

| # | Do this | Why |
|---|---|---|
| 1 | Context Brain ▸ click **🧠 Context Brain — domains** ▸ **Healthcare Insurance (US Payer / MCO)** | The app is currently set to the Medicare Sales knowledge pack. The header must read **🧠 healthcare payer**. |
| 2 | Sign in as **Morgan Advantage** (`u-ma`). The demo password is shown on the login screen. | She sees Medicare Advantage only, which is the point of the story |
| 3 | **Do not open the Data tab in front of the client** | It currently shows data the user should not see. See *Presenter's notes*. |
| 4 | Have PR-017's provider record ready (Step 2) | Chat refuses to answer "network status for PR-017", correctly, because no approved metric covers it |
| 5 | Collapse the 💰 FinOps widget and ask questions with **Enter** | The widget sits over the Ask button |
| 6 | After the Actions tab, **refresh the page (⌘R) before clicking another tab** | Leaving Actions currently blanks the app. You stay signed in. |
| 7 | Audiences ▸ **delete** any audiences left over from a rehearsal | Otherwise the history shows two cards with the same name |

---

## What Morgan is and is not allowed to do

| | |
|---|---|
| Sees | **Medicare Advantage only**, one of four books |
| Can | ask anything, save audiences (named groups of bills), run every rule, run the swarm (which opens cases), run simulations, **propose** actions |
| Cannot | see Medicaid, Commercial or ACA Exchange · approve or execute any write-back · change a case's status · edit the Context Brain · simulate another book |
| Her job | turn a statistical outlier into a **priced, scoped, evidenced recommendation** that somebody else signs |

---

## The nine steps, at a glance

| # | Tab | What she does | Why this step exists |
|---|---|---|---|
| 1 | **Pillars** | Read 20 timeliness breaches and 3 FWA alerts, then pick one | Choosing is the job. The method is distance past the line. |
| 2 | **Chat** | Ask who this provider is and what changed | A z-score is not a story |
| 3 | **Audiences** | Save his spike-quarter bills as one named group, then compare it with the quarter before | Every later number comes from the same bills |
| 4 | **Context Brain** | Read the rule she is about to rely on | She will be asked to defend the threshold |
| 5 | **Swarm** | Ask in plain English and see what else is going on | A case appears automatically, plus context she did not ask for |
| 6 | **Cases** | Check what was opened and try to triage it | A screen becomes work with an owner |
| 7 | **Simulator** | Size it against the whole book | $116,796 is a headline. Is it material? |
| 8 | **Actions** | Propose the recovery, get refused, hand it over | The control is the product |
| 9 | **SQL Log / Governance** | Confirm nothing was written and the receipts hold | For when audit asks |

---
---

# Step 1 — Pillars. Choosing the case.

> **💡 In plain English.** *Pillars* is a dashboard of rules that have already
> run over Morgan's data. She opens it and sees three kinds of problem: member
> requests decided too late, treatment requests waiting for approval, and
> doctors whose billing looks wrong. Her first job is to choose which problem
> deserves her time, and to be able to defend that choice.
>
> **Words in this step:** **Timeliness breach**: a member's request decided
> after its legal deadline. **CDAG_CD / ODAG_OD**: the drug-decision and
> medical-decision lists that auditors check. **Prior authorization (PA/UM)**:
> advance approval for a treatment. **em_upcoding**: too many visits billed at
> the top price level. **unbundling**: billing parts of a service separately to
> be paid more. **z-score**: how far from normal, in "typical spreads"; 3 is
> already rare. **FWA**: fraud, waste and abuse.

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

**Reading the first row in plain English:** Dr. Ravi R. (PR-017) bills **43%** of
his office visits at the most expensive level. Other endocrinologists bill
**4%**. That gap is **25.6** "typical spreads" from normal, where anything past 3
is already unusual. The platform estimates the excess at **$116,796.16**.

**Why:** this is the only screen that found things without being asked.

**The problem:** 23 findings, and she will have to justify whichever one she
picks.

**The method, and this is the part worth teaching.** She does not sort by money
and she does not sort by count. She sorts by **how far past its own line** each
finding is, because distance past the line is what survives a challenge. "The
line" is the threshold each rule declares: a z-score of 3 for billing outliers,
or the legal deadline for decisions.

| Finding | Measured | The rule's line | How far past |
|---|---|---|---|
| **PR-017 upcoding** | z 25.63 | z 3.0 | **8.5×** |
| Worst timeliness breach (UC-00159) | 126.6 hours | 72 hours | 1.76× |
| PR-045 upcoding | z 3.65 | z 3.0 | 1.2× |
| PR-019 unbundling | 21 NCCI pairs | any pair | an automatic billing check can block it; $1,113.77 |

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

> **💡 In plain English.** Morgan asks four questions in ordinary English. Each
> answer comes with a *trust* score, the platform's confidence in it; anything
> under 85% is refused rather than guessed. She learns three things. The fraud
> team had already flagged this doctor more than anyone else. He suddenly billed
> far more than usual in one quarter. And his bills are small: the money is in
> the volume, not in any single bill.
>
> **Words in this step:** **Fraud referral rate**: the share of his claims the
> fraud team (SIU) flagged. **Claim count / claim severity**: number of bills /
> average size of a bill. **2026 Q2**: April to June 2026. **QoQ**: versus the
> previous quarter. **Specialist visit**: an office visit with a specialist.
> **Cardiac diagnosis**: the bill says the visit was about the heart, which is
> unusual for a hormone specialist. **Out-of-network**: no contract with the
> insurer. **NPI**: a doctor's national ID number.

**What she does:** asks four plain-English questions, one at a time.

**Why:** Pillars told her a statistic broke. It did not tell her whether this
is a one-off billing mistake or a change in behaviour.

### Question 1 — "has anyone else noticed?"

```
which providers have the highest fraud referral rate
```
**Trust 93%.** **Dr. Ravi R. — 38.7%, on 284 claims. Rank 1.** Next are Dr. Anna T.
at 20.3% and Dr. Hugo S. at 11.8%.

This is the **independent check**. *Fraud referral rate* is the share of claims
that SIU itself flagged. It is a certified metric owned by SIU, and the Pillars
rule never reads that flag. Two systems that share no input landed on the same
name.

Chat shows doctors' names and Pillars shows their IDs. Question 3 ties them
together: Dr. Ravi R. *is* PR-017.

### Question 2 — "how busy is he right now?"

```
claim count by provider in 2026 Q2
```
**Trust 93%.** **Dr. Ravi R. — 129 claims. Rank 1 of 59.** The next provider,
Dr. Nina L., has 60. He billed more than twice anyone else in her book that
quarter (59 doctors billed Medicare Advantage that quarter).

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

**In plain English:** his number of bills jumped 344.8% on the previous quarter.
96 of the extra bills were specialist office visits, and 93 were for heart
conditions.

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
billed one level too high.** An analyst who walks in saying "he bills huge
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
PROVIDER_ID). Don't open the Data tab live; see *Before you start*.

### Finding from Step 2

Not "a provider broke a rule." It is now:

> **An out-of-network endocrinologist who billed 14 to 29 claims a quarter for
> seven quarters, then billed more claims than anyone in the book in one quarter,
> mostly cheap specialist visits coded to cardiac diagnoses, while SIU flagged a
> larger share of his claims than anyone else's.**

### What this makes her do next

Most of her questions so far have had to spell out which doctor or which
quarter. The fraud team will need this exact set of bills, and she has more
questions to ask about it. She wants to pin the group down once.

**→ Go to Audiences.**

---
---

# Step 3 — Audiences. Saving the suspicious bills as one group.

> **💡 In plain English.** An *audience* is a group of bills that you describe
> in everyday words, give a name and save. So far Morgan has typed "PR-017" or
> "2026 Q2" into most of her questions. Here she saves that group once, as *PR-017
> spike quarter*. The platform counts the bills, points out what is unusual
> about them, and then answers her next questions about **those bills only**.
> She also puts the group side by side with the quarter before.
>
> **Words in this step:** **Audience**: a saved, named group of bills.
> **Active in chat**: every Chat question is limited to that group. **Whole
> book**: back to all the bills she is allowed to see. **Compare**: two
> audiences side by side. **WHERE line**: the exact condition the platform used
> to pick the bills, written in database language. **Denial rate**: the share
> of bills the insurer refused to pay.

**The problem it solves.** Without an audience, every question has to repeat
the same description: *Medicare Advantage, PR-017, 2026 Q2*. That is slow, and
a small change of wording quietly changes which bills are counted, so two
people can end up quoting two different numbers for "the same" bills. An
audience fixes the group once. It has a name, a bill count and the exact
condition written underneath, so every number she quotes from now on comes
from the same bills, and the fraud team can rebuild exactly the same list.

**What she does:** opens **Audiences** ▸ *Create a new audience*, fills in the
two boxes and clicks **Create + auto-analyze**:

| Box | What she types |
|---|---|
| Audience name | `PR-017 spike quarter` |
| Plain English | `Medicare Advantage claims from PR-017 in 2026 Q2` |

### What happens

The app jumps to Chat and answers:

> **Trust 93%.** Risk pool 'PR-017 spike quarter' saved (3 filters). It matches
> **129 claims** … Select it to scope your next questions.

Under it, a box headed *Auto-detected patterns* lists what the platform worked
out by itself. The lines to read:

| What it says | In plain English |
|---|---|
| 129 claims, **$186,462** allowed | What we paid for his bills that quarter |
| Average severity **$1,445** | His average bill is small |
| ⚠ Fraud referral rate **80.6%** | SIU had already flagged four of every five of these bills |
| Specialist Visit: **80%** of the group | Almost all of it is office visits with a specialist |

These match what Chat told her in Step 2 (129 bills, a $1,445 average, 80.6%
flagged), now in one place under one name. The audience is also switched on at
once: a strip at the top of Chat reads **Audiences: Whole book · PR-017 spike
quarter · 129**, with her audience highlighted.

### One question, about those bills only

She asks, without typing the doctor or the quarter:

```
claim count by diagnosis category
```
> **Trust 97%.** [Audience: PR-017 spike quarter] Here is utilization (9 data points).

**93 of the 129 bills are coded Cardiac.** The next biggest group is
Respiratory, with 12. In plain English: nearly three quarters of his bills that
quarter are about the heart, from a hormone specialist. She never said which
doctor or which quarter; the audience said it for her. The query under the
answer shows the audience's condition built in.

### Compare it with the quarter before

She builds a second audience the same way: name `PR-017 quarter before`, text
`Medicare Advantage claims from PR-017 in 2026 Q1` (it matches 29 claims). On
the Audiences tab she ticks *PR-017 spike quarter*, then *PR-017 quarter
before*, and clicks **Compare selected (2/2)**. The *Side-by-side metrics*
table, in plain English:

| | PR-017 spike quarter (2026 Q2) | PR-017 quarter before (2026 Q1) |
|---|---|---|
| Bills | **129** | 29 |
| Average bill | **$1,445** | $6,579 |
| Bills we refused (denial rate) | **3.1%** | 17.2% |
| Bills flagged by SIU (fraud rate) | **80.6%** | 0% |

In plain English: **the same doctor, one quarter apart.** More than four times
the bills, each about a fifth of the size, and four in five flagged by the
fraud team where none were before. And almost none are refused: these bills
are being paid, which is the argument for checking them *before* paying
(Step 7).

The table also shows the money paid: $186,462 against $190,788. The totals look
alike only because one hospital stay in 2026 Q1 cost $133,785.50 on its own.

### Before you leave this step

Click **Whole book** in the strip at the top of Chat. While an audience is
switched on, **every** Chat question is limited to it, and the Chat questions in
Step 5 need her whole book.

### Be straight about one thing

**Always type "Medicare Advantage" into Morgan's audiences.** Today the
audience builder does not limit the group to her business by itself. Typed as
`PR-017 claims in 2026 Q2`, her audience counts **411** bills: PR-017's bills in
**all four** businesses, three of which she is not allowed to see. Chat,
correctly, counts the same bills as 129. That is a gap in the platform's access
control, to fix before a client sees this screen (see *Presenter's notes*).
Naming her business keeps the count at 129.

The same gap means the card compares her group with **the whole company**
("the book"), not with Medicare Advantage. Read the counts, money and shares
inside her group. Skip the "×" comparisons with the book, and ignore the line
*Lob 'Medicare Advantage' is 3.05x over-represented*.

### What to know before you type

- **Type the words exactly as above.** The builder only understands words from the rulebook's lists, and quietly ignores the rest. It does not know "cardiac" (its word is "Cardiology"), so `Medicare Advantage cardiac specialist visit claims from PR-017 in 2026 Q2` saves all 103 of his specialist visits, heart-related or not, with no warning.
- **Don't type "fraud" or "upcoding".** Either word adds a hidden condition, *only bills SIU already flagged*, and the group shrinks to 104.
- **Read the WHERE line on the card.** It is the honest record of what the platform understood. Hers reads `c.lob = 'Medicare Advantage' AND c.service_quarter = '2026Q2' AND c.provider_id = 'PR-017'`.
- **Her audiences are private.** Casey, signed in as herself, does not see them. Morgan hands over the description and its WHERE line, and anyone with access can rebuild the same group.
- **The comparison shows Trust 83%**, below the 85% bar, and is still shown. That is a quirk of the score, which counts the two groups as only two pieces of data. It is not a doubt about the numbers.
- The *Claim volume in this risk pool* chart shows a single point, because the group covers one quarter.

Checked on 1 October 2026 through the same connections the screens use, on a
copy of this machine's current data.

### Finding from Step 3

> **His spike quarter is now one named group: 129 bills, $186,462, an average of
> $1,445, 80.6% already flagged by SIU, and 93 of them about the heart. The
> quarter before: 29 bills, none flagged.**

### What this makes her do next

She is about to rely on a z-score. The first question in the room will be
**"is 3.0 a fair line, and who is he being compared with?"**

**→ Go to Context Brain.**

---
---

# Step 4 — Context Brain. Reading the rule before using it.

> **💡 In plain English.** Before accusing anyone, Morgan reads the exact rule
> that flagged him. It is stored in plain text that she can read but not change.
> The rule tells her who he is compared with, how far out counts as abnormal,
> which government guidance it is based on, and what to do next: hand it to the
> fraud team, not accuse him.
>
> **Words in this step:** **E/M codes 99205 / 99215**: the top-price office-visit
> codes. **Peer group**: other endocrinologists. **z_threshold 3.0**: the
> "abnormal" line. **Leave-one-out**: he is left out of his own benchmark.
> **CMS / OIG**: the Medicare regulator / the government's fraud watchdog.
> **SIU**: the fraud team. **Dual control**: two different approvers required.
> **Compliance officer**: the only role allowed to approve.

**What she does:** opens Context Brain ▸ **⚖️ Policy rulebook**, or types
`FWA-EM-UPCODE` in the search box, which jumps to `policy_rules.md` line 97. The
file is **🔒 Read-only** for her: *"Your role can view the Context Brain but not
edit it."*

**Why:** "the system said so" is not a defence. This takes ninety seconds.

### What the rule actually declares

| Setting | Value | In plain English |
|---|---|---|
| `high_em_codes` | **99205, 99215** | The two most expensive office-visit levels count as "high" |
| `peer_group` | **specialty** | He is compared with other endocrinologists, not with every doctor |
| `z_threshold` | **3.0** | How far from his peers counts as abnormal |
| `min_claims` | **30** | Doctors with fewer than 30 coded visits are not judged at all |
| `citation` | **CMS E/M documentation guidelines; OIG work plan (E/M upcoding)** | The rule rests on the Medicare regulator's billing guidance and the fraud watchdog's target list, not an internal preference |

The rule is also **leave-one-out**: the doctor being tested is removed from his
own peer average, so he cannot inflate the benchmark he is measured against.

### The remediation is her to-do list, and it is careful

*Remediation* is the rule's instruction for what to do once it fires:

> *Surface an FWACase with peer-relative z-score and estimated overpayment;
> route to SIU when z >= threshold and volume material.*

In plain English: *open a fraud case showing how far he is from his peers and
the estimated overpayment, and send it to the fraud team when he is past the
line and the money is significant.*

**Read it closely.** It says *route to SIU*. It does not say *fraud*, and it does
not say *recover automatically*. A high share of top-level visits can be
legitimate for a doctor whose patients are genuinely complex. Only a
documentation review (checking his medical records) decides that, and the
rulebook leaves that decision to SIU.

### The companion rules she will meet in Step 8

| Rule | What it says |
|---|---|
| `ACT-DUAL-CONTROL` | Two different approvers are required if the impact is **≥ $10,000**, **or** the severity is critical/high, **or** the action type is on the always-two-approvers list. **`overpayment_recovery` is on that list.** |
| `ACT-TRUST-GATE` | Nothing executes below **0.85** trust |
| `ACT-APPROVER-ROLES` | Only a **compliance_officer** may approve |

### Finding from Step 4

Four answers she now has ready:

- *"Is 3.0 arbitrary?"* — It is written down, visible to everyone, and every version is kept. A compliance officer can tune it with one signature, and the change is logged. Morgan cannot touch it.
- *"Small sample?"* — The rule won't judge anyone with fewer than 30 coded visits. He has 284 in her book, most of them coded visits.
- *"Compared with whom?"* — Other endocrinologists, with him excluded from their average.
- *"Is this us or the government?"* — CMS E/M documentation guidelines and the OIG work plan.

### What this makes her do next

Everything so far is her own work: her pick, her questions, her reading. She
wants the platform to turn it into work that someone owns.

**→ Go to Swarm.**

---
---

# Step 5 — Swarm. What it adds, and what it doesn't.

> **💡 In plain English.** Morgan types one sentence. The platform's coordinator
> (the *Sentry*) wakes up the relevant specialist departments: fraud, medical
> costs, doctor network and pharmacy. Each one reports what it sees. Two things
> come out of it. A tracked case is opened automatically. And she learns about a
> big cost spike in the same region, which turns out **not** to be this doctor:
> a trap she avoids.
>
> **Words in this step:** **Agents / departments**: specialist software
> routines, each with one job. **Findings**: what each one reports. **Medical
> Economics**: the department that explains cost movements. **Network
> Management**: manages contracts with doctors. **PBM rejects**: prescriptions
> refused at the pharmacy, a separate issue. **Allowed cost**: total medical
> spending. **ER**: the emergency room.

**What she does:** types one sentence. The box is pre-filled with the domain's
example question, *"Are there billing anomalies or upcoding from any provider?"*,
which produces the same run. She types her own:

```
Is provider PR-017 upcoding and are we overpaying?
```

### What happens

> **Activated 6 of 10 · trust 92% · gate ✅ passed**
> 15 finding(s) from 6 department(s). Lead: Em Upcoding — provider PR-017.

In plain English: 6 of the 10 departments were relevant, the platform's
confidence is 92% (above the 85% bar), and the top finding is the upcoding by
PR-017.

The lead finding, from **FWA / SIU**, is critical: *High-E/M share 43% vs
Endocrinology peer mean 4% (z=25.6)*, est. impact **$116,796.16**. Under the
findings:

> 📁 3 case(s) opened/updated: FWA-3b14d1a6, FWA-bbeecfb5, FWA-80ef701d

### Be straight about one thing

The Swarm is **not** a second opinion on PR-017. The fraud department runs the
same calculation Pillars ran, so of course it agrees. The independent signal was
SIU's own flags in Step 2. If you claim the Swarm "confirmed" it, someone
technical will catch it.

### What the Swarm gives her that nothing else did

**1. A case, automatically, behind a gate.** Cases open only when the run's
trust clears the case-creation floor (a minimum confidence written in the
rulebook) declared in `agents.md` (0.60). This run
scored 92%, which also clears the 85% gate shown on screen.

**2. Two things she was not looking for, and the discipline not to over-read them.**

*Medical Economics:* **"Allowed cost up 121.1% in 2026Q2"** ($10,228,649 vs
$4,625,690), and **"region = Southeast drove 100.0% of the movement."** In plain
English: medical spending in her book more than doubled in one quarter, all of
it in the Southeast. That is PR-017's region and PR-017's quarter. It is
tempting to pin a $5.6 million spike on him. **Don't.** One Chat question,
asked on her **Whole book** (not her audience from Step 3), settles it:

```
why did medical cost jump in 2026 Q2
```
> ⚠ Anomaly in 2026Q2: medical cost jumped 121.1% QoQ (z=2.39) … region =
> Southeast: +5,684,149 … claim type = ER: +5,812,312 vs 2026Q1 (100.0% of the
> increase).

The spike is **emergency-room claims**, while his are specialist visits. His
whole 2026Q2 is **$186,462** (`medical cost by provider in 2026 Q2`, rank 20 of
59, and the same total as his audience in Step 3). It is a different claim type, a different case and a different department.

*Network Management:* **"Out-of-network spend is 17.6% of allowed"**
($8,534,418.62). In plain English: 17.6% of medical spending goes to doctors
with no contract. PR-017 is one of them, so his contract status is Network
Management's conversation, not hers.

The three **PBM reject** findings (NCPDP codes 75/70/76: prescriptions refused at
the pharmacy counter) are a separate drug-coverage story. She leaves them alone
and says so.

**3. A confidence number with its gate shown.** Trust 92% against an 85% gate,
printed on the screen. It is a measured score, not a feeling.

### Finding from Step 5

> **One case worth acting on, opened automatically. Plus one trap she avoided:
> the Southeast spike is real, but it is not his.**

**→ Go to Cases.**

---
---

# Step 6 — Cases. Turning screens into work someone owns.

> **💡 In plain English.** The finding is now a numbered work item, a *case*,
> with a value and a status: something you can put on a meeting agenda. Running
> the analysis twice doesn't create duplicates. And Morgan is not allowed to
> pass the case to the fraud team herself; that is an officer's call.
>
> **Words in this step:** **Case**: a tracked work item. **Severity**: urgency
> (critical, high). **De-duplication**: the same problem never becomes two
> cases. **Triage**: deciding what happens next. **referred_siu**: sent to the
> fraud team.

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

**Triage is not hers.** The case should go to SIU, because that is what the
rule's remediation says. She sets the case's status drop-down to `referred_siu`:

> **Role 'ma_analyst' is not permitted to perform 'review_resolve'**

In plain English: an analyst is not allowed to decide what happens to a case.
Triage is an officer's decision, and Casey will make it in Step 8.

### Finding from Step 6

**FWA-3b14d1a6 is the one to act on.** PR-045 is barely past its line, and
PR-019 is a billing-rule problem worth $1,113.77.

### What this makes her do next

She is one click from proposing a $116,796 recovery. Before she does, she wants
to know whether the number matters.

**→ Go to the Simulator.**

---
---

# Step 7 — Simulator. Is it material, and what is the fix worth?

> **💡 In plain English.** Before proposing anything, Morgan checks whether the
> money matters at company scale. She uses the what-if calculator: "if medical
> spending in this book fell by 1%, what would that be worth?" The answer is
> $484,560, and about one percentage point off the loss ratio. This doctor's case
> is about a quarter of that 1%: real money, but not company-changing. The bigger
> prize is fixing the billing control for every doctor.
>
> **Words in this step:** **MLR (Medical Loss Ratio)**: the cents of each
> premium dollar paid out for care. **Basis point (bp)**: one hundredth of a
> percentage point. **Lever / override**: the number you change in a what-if.
> **Baseline**: the group it applies to. **Gross / net**: before / after
> collection costs and disputes. **Prepayment review**: checking bills before
> paying them.

**Why:** two questions are coming. *"Does $116,796 move our loss ratio?"* and
*"If we fixed the control rather than the provider, what is that worth?"* If she
has no answer, the recommendation stalls for a week.

### First, what the $116,796.16 is

It is the platform's estimate of the **excess**, not his total billing: his
top-level share (43%), minus his peers' (4%), times what Medicare Advantage paid
him for office visits. The case's detail line shows the two shares.

**Be straight about this.** Unlike the Medicare Sales rulebook, which declares a
dispute rate and a recovery cost, **the payer Brain declares no recovery-net
formula.** In other words, nobody has written down how much of a recovery
typically gets disputed or what collecting it costs. So Morgan does not invent
those numbers, and she says so. If the business wants a net figure, the right
fix is for Compliance to declare it in the rulebook (`simulation.md`), where it
is governed and versioned like everything else, rather than a dispute rate made
up in a meeting.

### The Simulator run — exactly what to type

Baseline cohort, then two overrides. Leave the op as **shift by %** on both.

| Field | Value |
|---|---|
| Baseline cohort | `Medicare Advantage` |
| Override 1 | `metrics.medical_cost.stress_pct` · shift by % · `-0.01` · *prepayment E/M documentation review across the MA book* |
| Override 2 | `metrics.mlr.stress_pct` · shift by % · `-0.01` · *the same 1%, on the loss ratio* |

In plain English: "take the whole Medicare Advantage book, cut medical spending
by 1%, and cut the loss ratio by 1% to match". `-0.01` means minus 1%.

Click **▶ Run simulation**:

> **trust 100% ✓ gate cleared** · MLR Δ **−104 bps** (1.036 → 1.0256) ·
> Net $ impact **$484,560** · Affected members 1952

### How to read it

**Every 1% of Medicare Advantage medical spend is $484,560 and about 104 basis
points of loss ratio** (1.04 percentage points). The loss ratio itself moves from
1.036 to 1.0256, i.e. from about 104 cents of care per premium dollar to about
103. PR-017's $116,796.16 is roughly **0.24 of one of those points**, which is
about **25 basis points**.

So say it before someone else does: **this is a real recovery and a weak MLR
story.** It is a payment-integrity case, not a loss-ratio event. The stronger
argument for acting is the second reading: a prepayment review of office-visit
bills that trimmed just 1% across the book would be worth **four times this
whole case.**

### The governance beat, ten seconds

Change the baseline to `Medicaid claims` and run it again:

> **'Medicaid' is outside your authorized scope**

She cannot even *simulate* a book she is not allowed to see.

### What to know before you type

- **The simulator does not derive the loss ratio from cost.** The two levers are independent, so she moves both by the same 1% on purpose. With only the cost lever, MLR Δ reads 0.
- **Only four levers exist:** `medical_cost` and `pharmacy_cost` move dollars, `mlr` moves basis points, and `reject_count` moves admin minutes. `pharmacy_cost` ignores the baseline group and applies to the whole line of business.
- **Affected members counts members, not claims.** A baseline filtered by provider or claim type still reports the whole book (1952). Here the baseline *is* the whole book, so it is correct.
- The MLR card prints its change as `Δ -0.0104 bps`. That is a labelling quirk. Read the summary line (**−104 bps**).

**Do not quote the $484,560 as PR-017's number.** It is the book-wide lever.
Mixing the two up is the easiest way to lose credibility in this demo.

She does **not** click *📤 Promote to Action Queue*, which would turn this what-if
into a formal proposal for approval. That is a policy decision for the committee. If she did, it would land in the same two-approver queue
(impact $484,560 ≥ $10,000).

### Finding from Step 7

> **Recover $116,796.16 gross. It is about a quarter of a point of medical spend,
> so the case is about integrity, not MLR. The book-wide control is worth
> $484,560 for every 1% it saves, and that is a separate conversation.**

**→ Go to Actions.**

---
---

# Step 8 — Actions. She proposes. She gets refused. That is correct.

> **💡 In plain English.** Morgan proposes to recover the money. The platform
> immediately says this needs two independent approvers, for three separate
> reasons. She tries to approve it herself and is refused. The first officer
> approves, then tries to approve again and is refused, because one person
> can't count twice. A second officer approves, and the action runs, in safe
> "dry run" mode for the demo.
>
> **Words in this step:** **Overpayment recovery**: asking the doctor to pay the
> money back. **Dual control / maker–checker**: two different approvers.
> **Separation of duties**: the proposer can't approve, and one person can't
> sign twice. **Write-back**: sending the instruction into the insurer's core
> system. **Dry run**: recording the instruction without sending it.
> **Compensate**: undo, which itself needs two approvers.

**What she does:** back in Cases, she clicks **propose ▸** on FWA-3b14d1a6:

> **Proposed ACT-… (dual control) — review it in the Actions tab**

Action IDs are random for each proposal, so yours will differ. On the Actions
tab, the card reads:

> **overpayment recovery** · PENDING_FIRST_APPROVAL · 👥 dual control ·
> impact $116,796 · severity critical · trust 92%
> Proposed: Remediate em upcoding for PR-017 → PR-017 on dry_run

The amount, severity and trust are taken **from the stored case by the platform itself**,
not typed in by the user. Nobody can enter a smaller number to avoid the second
signature.

### Why two approvers? Open the compliance logic tree.

Click **▸ compliance logic tree**, the panel that explains how the platform
reached its decision. It lists the reasons:

> 1: estimated impact $116,796 ≥ threshold $10,000
> 2: regulatory severity 'critical' is a dual-control trigger
> 3: action type 'overpayment_recovery' always requires dual control

In plain English: the amount is over $10,000, the case is rated critical, and
recovering money from a doctor always needs two approvers.
**Any one of the three would have forced the second signature.** In the AG-0027
case the amount was under the threshold. Here the money, the severity and the
nature of the action all agree.

### Then she tries to approve it herself

She clicks **✍️ Approve**:

> **Role 'ma_analyst' is not permitted to perform 'action_approve'**

**Read it carefully.** It does not say *you cannot approve your own*. It says an
analyst cannot approve **any** write-back. The refusal itself is recorded in the
audit log.

In business language: **the person who found the problem does not decide the
outcome for the doctor.**

### What happens after she hands it over

| Who | What | What the screen says |
|---|---|---|
| **Morgan** (`u-ma`) | propose ▸ | created, dual control, PENDING_FIRST_APPROVAL |
| **Morgan** | ✍️ Approve | **refused:** Role 'ma_analyst' is not permitted to perform 'action_approve' |
| **Casey** (`u-compliance`) | case status → `referred_siu` | FWA-3b14d1a6 → referred_siu |
| **Casey** | ✍️ Approve | approve ok → PENDING_SECOND_APPROVAL |
| **Casey** | ✍️ Approve (2nd) | **refused:** separation of duties: approver_2 must differ from approver_1 |
| **Dana** (`u-compliance2`) | ✍️ Approve (2nd) | approve ok → APPROVED |
| **Dana** | 🚀 Execute write-back | execute ok → **EXECUTED**, with a payload hash (a fingerprint of exactly what was sent) |

**Three refusals, three different reasons:** wrong role to approve, wrong role
to triage, and the same person twice. If trust were below 85%, the execute
button would read **⛔ Below 85% gate**, which is a fourth.

The target is **dry_run**: it records the exact instruction and sends nothing to
an outside system. After execution, the card offers **↩ Compensate
(void/credit)**. An undo is itself a new two-person action and never an edit to
the original record.

### Finding from Step 8

> **Morgan did the whole investigation and cannot touch the outcome. That is not
> a limit of her login. It is the product.**

---
---

# Step 9 — SQL Log and Governance. The receipts.

> **💡 In plain English.** These are the receipts. Every database query the
> platform ran only read data, so nothing could have altered the numbers. Every
> answer has a receipt that can be re-checked. And every proposal, refusal and
> signature sits in a log where tampering would be detected.
>
> **Words in this step:** **SQL / SELECT**: the database language / a read-only
> query. **Provenance receipt**: a record of how an answer was produced.
> **Hash chain**: a log in which tampering is detectable. **FinOps / tokens**:
> the cost of AI usage, zero here because no AI model was used.

**What she does:** thirty seconds in two tabs, as an officer. Refresh first if
you are coming from Actions.

**SQL Log.** Every query the platform ran during the investigation, in full:
the Pillars rules, every Chat question and the simulator's totals. **Every
statement is a SELECT. Nothing was written to the database.** Nothing she did
could have changed a number.

**Governance ▸ Answer provenance.** Every answer she got has a receipt: who
asked, the trust score, the rulebook version (`sha256:…`, a fingerprint of the
exact rules in force), and *"model (deterministic — no model invoked)"*, meaning
no AI model was involved. Click **check** on one and it returns **✓ conditions
unchanged — reproducible.**

**The ledger.** On the Actions tab, signed in as Casey or Dana, the banner reads
**🔗 hash chain intact**, with the number of entries checked. Every proposal,
refusal, signature and execution is in it.

**FinOps:** $0.0000, 0 tokens. The whole investigation ran on approved database
queries, not an AI model.

### Finding from Step 9

> **The analysis could not have altered the data, every answer can be re-run,
> and the approvals cannot be rewritten after the fact.**

---
---

# The one thing Morgan must say when she hands it over

> **💡 In plain English.** Morgan only sees one of the four businesses, so her
> number covers only that one. The officer, who sees all four, finds the same
> doctor billing the same way everywhere: about three times the money. That is
> exactly why the person with the full view must approve.

Her number is **$116,796.16**, and it is **correct for her book.**

When Casey opens **Pillars at full scope** (all four businesses), the same
provider reads:

> em_upcoding · PR-017 · **26.83** · **$351,997.58** · High-E/M share 49% vs
> Endocrinology peer mean 5% (z=26.8)

That is **three times** Morgan's figure, because PR-017 bills Medicaid,
Commercial and ACA Exchange members the same way. Casey also sees an alert
Morgan never sees at all: **PR-018, impossible day, $33,548.88**, a doctor billing
more than 24 hours in a day. And PR-045, the borderline alert Morgan passed over,
**is not flagged at full scope at all**. With every business included, his
z-score falls to 1.11, back inside the normal range. That is the best evidence
that her method was right.

If Casey runs the same swarm question at her own scope, the platform opens
**a separate case, FWA-ee392224, for PR-017 at $351,997.58.** Morgan cannot see
it.

**One caution to say out loud.** The Medicare Advantage claims are *inside*
that $351,997.58. Recover once: the officer decides which case carries the
recovery and rejects the other with a reason.

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

- She does **not** decide it is fraud. The rule sends it to the fraud team, and a high share of top-level visits can be legitimate for a doctor with complex patients. The review of his medical records decides.
- She does **not** contact the doctor, hold his payments, or change a claim.
- She does **not** see three of the four businesses, and never learns her number is a third of the total until Casey tells her.
- She does **not** change the threshold. The rulebook is read-only for her. A compliance officer could change `z_threshold` with one signature, and the change is logged. The controls that decide *who must sign* (the $10,000 threshold, the severity triggers, the approver roles and the trust gate) need two officers.
- She does **not** write anything to the database. She could not if she tried.

---

# The whole thing on one page

| Step | Tab | What she finds | What it forces next |
|---|---|---|---|
| 1 | Pillars | 3 FWA alerts. **PR-017 is 8.5× past its line**; everything else is borderline or a queue. $116,796.16 of $126,546.98. | Needs to know who this is |
| 2 | Chat | **First on SIU referrals (38.7%), first on volume (129 in Q2), last on claim size ($1,445).** The spike is heart-related specialist visits. | Needs one fixed group of bills |
| 3 | Audiences | **129 bills, $186,462, 80.6% already flagged by SIU, 93 about the heart.** The quarter before: 29 bills, none flagged. | Needs to defend the rule |
| 4 | Context Brain | Line 3.0, minimum 30 coded visits, compared with endocrinologists, **CMS + OIG**. The rule sends it to the fraud team and does not accuse. | Needs it to become work |
| 5 | Swarm | 6 of 10 activated, **trust 92%**, 3 cases opened. The Southeast spike is emergency-room claims, **not his**. | Needs to see the cases |
| 6 | Cases | **FWA-3b14d1a6, $116,796**, de-duplicated. Triage refused for her role. | Needs to know if it matters |
| 7 | Simulator | 1% of MA spend = **$484,560 / −104 bps**. His case is about 25 bps: integrity, not MLR. | Ready to propose |
| 8 | Actions | Proposes. **Refused by role.** Casey signs once and is refused a second signature; Dana countersigns; executed. | Hand-off complete |
| 9 | SQL Log / Governance | **Zero writes. Reproducible receipts. Chain intact.** | Close it |

**Nine steps. Roughly twenty-five minutes. One provider.**

And the sentence the whole thing exists to produce:

> *"An out-of-network endocrinologist billed more claims in 2026Q2 than anyone
> in our book, mostly cheap specialist visits coded to heart conditions. Pillars
> puts him 25 standard deviations from his peers, and SIU had already flagged 39%
> of his claims. The Medicare Advantage recovery estimate is $116,796.16, about a
> quarter of a point of medical spend, so this is payment integrity, not an MLR
> event. I've proposed the recovery. I can't approve it. It needs two compliance
> signatures, and when Casey opens it at full scope she'll see $351,997.58."*

---

## If they push — answer honestly

| If they ask… | The honest answer |
|---|---|
| "Is this real data?" | No. It is synthetic insurance data that comes out the same every time, and the PR-017 pattern is planted on purpose (`app/data/generate.py`). The mechanics are real: the rules, the access controls, the trust gate, the two-person approval and the tamper-evident log. |
| "Did an AI find this?" | No. The AI model is switched off (`mock`), at 0 tokens. Every number came from approved database queries and fixed rules. |
| "Isn't a high share of top-level visits sometimes legitimate?" | Yes. That is why he is compared only with other endocrinologists, why the rule sends the case to the fraud team instead of recovering automatically, and why an officer signs. |
| "The rule text lists four codes but the setting lists two." | The declared setting (99205, 99215) is what runs. Counting all four codes, he is still z 11.74 from his peers, on the same claims. Either definition flags him. |
| "Why $116,796 and not his whole billing?" | It is only the excess: (his top-level share − his peers') × what we paid him for office visits. |
| "Could Morgan just change the rule?" | No. The rulebook is read-only for her. Officers can tune business thresholds with one signature, versioned and logged. Changing who must sign needs two officers. |

---

## Presenter's notes

**Run it in this exact order.** Each step creates the question the next one
answers. If you start at the Swarm, Step 2's "first, first, last" lands flat.

**The two moments to slow down on.** Step 2, when the heart-related clause
appears. And Step 8, when the platform refuses the analyst who did all the work.

**Live gotchas, checked in the running app on 1 October 2026:**

1. **Switch the knowledge pack (domain) first.** The app is currently set to Medicare Sales. Any signed-in user can switch it, which is itself a gap worth fixing.
2. **Keep the Data tab closed in front of a client.** Its preview currently shows **every table to every user**: other businesses' claims and members, and the user table with password hashes (scrambled passwords). Fix it before any client sees the platform.
3. **Leaving the Actions tab blanks the app.** Refresh (⌘R) and you are back, still signed in. It is a one-line bug in the screen's code. *(For engineers: `LedgerBanner` in `ActionQueueTab.jsx` passes a Promise-returning function to `useEffect`.)*
4. **As Morgan, the Actions tab banner says "🚨 chain broken at seq undefined." It is false.** Her role is not allowed to read the audit log, and the banner misreads that refusal as a broken chain. Show the chain as Casey: **🔗 hash chain intact**.
5. **Test data left behind by earlier runs is visible.** The payer welcome screen suggests *"How is avg outreach attempts (hedis_measure_results) trending?"*, and the Data Layer lists `evil_name_drop` and `hedis_measure_results`, `_2` and `_3`. Don't click them, and clean the rulebook before a client demo.
6. **Case IDs are calculated from their content** (FWA-3b14d1a6, FWA-bbeecfb5, FWA-80ef701d, and Casey's FWA-ee392224), so they are identical on every clean run. Action IDs and swarm timings are not.
7. **Audiences ignore Morgan's access limit.** An audience she builds without naming her business counts PR-017's bills in all four businesses (411 for 2026 Q2, against 129 in her book), and the card's comparisons with "the book" use the whole company. Always type *Medicare Advantage* into her audiences (Step 3), and fix this before a client sees the screen. *(For engineers: `cohort_insights.analyze()`, `cohort_insights.compare()` and the claim count in `orchestrator.create_cohort()` call `run_query()` without the user's `allowed_lobs`.)*

---
---

# Appendix — The HEDIS Stars demo, checked act by act

> **💡 In plain English.** Your manager's demo tells a different story. A
> Medicare Advantage plan is at risk of losing quality stars, and the bonus money
> that comes with them, because members' blood pressure isn't under control in
> one region. An outside company sends a data file the platform has never seen.
> The platform refuses to answer a blood-pressure question until a governance
> officer writes down what the term means, and then it answers. We ran every
> step through the real screens. The first half works as written. The second
> half (saving a group of members, forecasting, opening a case and approving an
> outreach campaign) does not work from the screens today.
>
> **Words in this appendix:** HEDIS, Star Ratings, care gap, CBP, TOC,
> outreach, RAF score, vendor file, entity/metric/vocabulary, audience,
> forecast, Workspace, pre-flight, act. All are in the glossary at the top.
> **LOB column**: the field that says which business a row belongs to; without
> it, the platform cannot restrict who sees the row.

Checked on 1 October 2026 through the same connections the screens use, on a
copy of this machine's current data. The project's own pre-flight scripts
also pass: `hedis_demo_verify.py` 20/20, `hedis_alltabs_verify.py` 59/59 and
`e2e_case6_hedis_stars.py` 48/48. **But they call the platform's internals
directly, not through the screens**, which is why several of the gaps below never
surfaced.

| Act | The document says | What actually happens | Verdict |
|---|---|---|---|
| 1 | HEDIS gap rate by region: 96%. Northeast 55.0%, Midwest 54.8%, Southeast 54.2%. | Exactly that. | ✅ |
| 1 | RAF by region: 96%. Northeast 0.95, Southeast 0.929, West 0.921. | Exactly that. | ✅ |
| 2 | 9,110 rows import; the join to the member book is discovered | 9,110 rows; 6 joins suggested, including `member_id = members.member_id` (the platform found by itself how the file links to the member list) | ✅ |
| 2 | 178 rows (1.95%) with no service date | 178 of 9,110 (1.95%) | ✅ |
| 2 | "A shape OpPal has never seen"; six candidate metrics, all UNCERTIFIED | **Not on this machine.** From earlier runs, the Brain already holds 176 drafted entity blocks for this file and the six metrics (`avg_gap_open` is `certified: true`). Data Layer lists `hedis_measure_results`, `_2` and `_3` before the import. | ⚠ Clean the Brain first |
| 3 | "What is the CBP gap rate?" refused at 57%, grounding 0% | 57%, grounding 0%, SQL withheld | ✅ |
| 4 | Paste three metrics plus vocabulary, single signature | Saves through 💾 Save & Reload (22 metrics · 87 vocabulary terms), with no dual control | ✅ |
| 5 | CBP gap rate: 100%. Southeast 58.7%, Northeast 24.7%, Midwest 22.4%, Southwest 21.5%, West 19.5%. | Matches, except that on screen Southwest reads 21.4% (0.2145, which the chart rounds down) | ✅ |
| 5 | Star measure gap rate by measure name: 93%. CBP 29.5%, TOC 19.8%, Colorectal 19.8%. | Exactly that. | ✅ |
| 5 | Outreach attempts per gap by region: **100% trust**. West 1.46 … Southeast 0.34. | Values exact, but **trust is 93%** | ⚠ Fix the number |
| 5 | Outreach per gap by measure name: 93% | Exactly that | ✅ |
| 5 | CBP gap rate by age band: 93%, 65+ 29.5% | Exactly that | ✅ |
| 6 | Audiences: 234 MA members, Southeast, open CBP gap | The Audiences tab cannot understand "CBP". That part of the request is **silently dropped**, and the audience saves as the whole Southeast MA book (2,747 claims). The 234 comes only from a test script, not from the screens. | ❌ |
| 6 | Analysis: forecast with prediction intervals | Refused: *'cbp_gap_rate' declares no time_column* (the metric has no date field to forecast along). Act 4 tells you to leave it empty. | ❌ |
| 6 | Swarm: the Quality/Stars agent activates | It does, but the run **opens 0 cases**, so the Cases tab is empty | ⚠ |
| 6 | Action Queue: propose the outreach campaign, dual control | No path from the screens. Cases' *propose* needs a case, and the platform rejects `care_gap_outreach` (*unknown action_type*). The allowed `member_outreach` without a case gets trust 0, so it can never execute. | ❌ |
| 6 | Workspace, FinOps, Governance | Work as described (AI switched off, 0 tokens; the log verifies) | ✅ |
| — | "RBAC-scoped" (each user sees only their business) | A **Medicaid-only analyst** gets the CBP numbers from this Medicare Advantage file at 100% trust. The imported file has no LOB column, so the platform treats it as data anyone may see. | ⚠ Say it before they find it |
| — | "997 automated checks" | Out of date. `CLAUDE.md` quotes 1,643 phase checks. | ⚠ |

**In plain English:**
- **Acts 1 to 5 work.** The numbers match, apart from one confidence figure (93%, not 100%) and one rounding difference on screen.
- **Act 6 mostly does not work from the screens.** You can't save the "234 members" group, forecast the measure, open a case or approve an outreach campaign. Those steps were only ever done in test code.
- **Two things to fix before a client sees it:** clear out the leftovers from earlier runs, so the "never seen this file" moment is true, and close the gap that lets a Medicaid analyst read the Medicare Advantage file.

**One instruction to change.** The HEDIS document's first step is *"Run
`demo/hedis_demo_verify.py` before the meeting."* Run against the live system,
that script appends another copy of the drafted entity and vocabulary to the
live Brain every time. That is how this machine reached 176 entity blocks, and it
is what breaks Act 2's "never seen" moment. Run it against a copy of the system,
or clean the Brain afterwards.
