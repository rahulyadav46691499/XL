# General rules

- Dates are ISO text ('YYYY-MM-DD', some with 'THH:MM'). Quarter columns are text like '2025Q3'.
- Flag columns (*_flag, dual_eligible, pa_required, ...) are integers 0/1. Money columns are US dollars.
- lob = line of business: 'Medicare Advantage', 'Medicaid', 'Commercial', 'ACA Exchange'. market / region = US region.
- The database has two separate domains:
  1. Health plan operations: plans, products, benefit_packages, members, claims, pharmacy_claims, providers, formulary, prior_auth, cdag_universe, fwa_cases, ncci_edits.
  2. Medicare sales and distribution: campaigns, leads, lead_activities, applications, enrollments, sales_agents, agent_certifications, agent_commissions, sales_targets, plan_benefit_packages, interactions.
  member_id in the sales tables does NOT refer to the same people as the members table. Never join sales tables to members or claims on member_id.
- The two domains also have unrelated plan hierarchies: operations uses plans -> products -> benefit_packages (members.package_id); sales uses CMS contract/PBP ids in plan_benefit_packages.
- roles, role_lob_access, users and user_attributes are app access-control tables, not business data. Never select users.password_hash or users.email.

## plans
Top of the operations plan hierarchy: plans -> products -> benefit_packages -> members.package_id.
- cms_contract: CMS contract id ('H1234' Medicare Advantage, 'MCD-0042' Medicaid MCO); '' when the plan has no government contract.

## products
- product_type: HMO, PPO, or D-SNP (Dual-eligible Special Needs Plan, for people with both Medicare and Medicaid).
- metal_tier: ACA metal level ('Gold'); '' for non-ACA products.

## benefit_packages
- oop_max: member's annual out-of-pocket maximum.
- pcp_copay: member copay for a primary care visit.
- formulary_id: drug list used by the package -> formulary.formulary_id.

## formulary
Covered drug list.
- rxnorm_code: RxNorm drug id; joins to pharmacy_claims.rxnorm_code.
- tier: cost-sharing tier, 1 (cheapest, generics) to 5 (specialty).
- pa_required: 1 = prior authorization needed before the drug is covered.
- step_therapy: 1 = member must try a cheaper drug first.
- source_doc: citation of the formulary document the row came from.

## providers
- npi: National Provider Identifier.
- network_status: 'In-Network' or 'Out-of-Network'.

## members
One row per health plan member (operations domain).
- mbi: Medicare Beneficiary Identifier; only Medicare Advantage members have one, '' for everyone else.
- package_id -> benefit_packages.package_id.
- age_band: text bucket ('18-34', '35-49', '50-64', '65+').
- raf_score: CMS-HCC risk adjustment factor; 1.0 = average expected cost, higher = sicker. NULL for some members.
- dual_eligible: 1 = has both Medicare and Medicaid.
- hedis_gap_count: number of open HEDIS quality care gaps (e.g. missed screenings).
- monthly_premium: total monthly premium the plan receives for the member. Not the same as enrollments.monthly_premium.
- effective_date: coverage start date.
- acg_risk_band: Johns Hopkins ACG risk band, '1-Healthy' to '4-High'.
- pmpm_cost: medical cost per member per month.
- moop_limit: member's maximum out-of-pocket limit. moop_accum: amount paid toward it so far (can exceed moop_limit in this data).
- reinsurance_attachment: stop-loss attachment point; plan cost above it is covered by reinsurance. (verify)

## claims
Medical claims, one row per claim.
- status: 'Paid', 'Denied', 'Pending'. Only Paid claims have paid_date and paid_amount > 0; Denied and Pending have paid_amount = 0 and paid_date NULL.
- For spend or cost questions use SUM(paid_amount) on status = 'Paid'.
- billed_amount: what the provider charged. allowed_amount: contracted amount the plan recognizes. paid_amount: what the plan paid. member_responsibility: member's share (copay, coinsurance, deductible).
- denial_reason: claim adjustment reason code + text, '' unless status = 'Denied'. CO = contractual obligation (provider writes off), PR = patient responsibility.
- diagnosis_category: clinical grouping, NULL for some claims. Similar labels exist side by side ('Cardiology'/'Cardiac', 'Mental Health'/'Behavioral', 'Diabetes'/'Metabolic'); consider both when filtering by condition.
- fraud_flag: 1 = claim flagged as potential fraud.
- service_quarter: quarter of service_date.
- procedure_code: CPT/HCPCS code of the service.
- em_level: evaluation and management visit code (99212-99215 office visits, 99205 new patient, 99283 ER visit); '' when not an E/M visit.
- revenue_code: facility revenue code (0450 emergency room, 0300 lab, 0101 inpatient room and board); '' on professional claims.
- place_of_service: CMS place-of-service code (11 office, 21 inpatient hospital, 23 hospital ER, 81 independent lab).

## pharmacy_claims
- status: 'Paid' or 'Rejected'. Rejected claims have plan_paid = 0 and a reject_code; reject_code is NULL on Paid claims.
- reject_code: NCPDP code: 70 product not covered, 75 prior authorization required, 76 plan limits exceeded.
- ingredient_cost + dispensing_fee = plan_paid + member_pay on Paid claims.
- formulary_tier: tier 1-5 (see formulary.tier).
- rxnorm_code -> formulary.rxnorm_code.

## prior_auth
Prior authorization requests (approval needed before a service or drug is covered).
- service_or_drug: '<guideline_source>:<service>', e.g. 'InterQual:MRI'. Services: GLP-1, InptStay (inpatient stay), MRI, PT (physical therapy).
- guideline_source: criteria used: InterQual (commercial clinical criteria), CMS_NCD (Medicare National Coverage Determination), formulary.
- criteria_met: 1 = request met the clinical criteria.
- trust_score: 0-1 confidence score attached to the decision. (verify)
- decision: lowercase 'approved', 'denied', 'pended'.
- turnaround_hours: hours from requested_at to decided_at.

## cdag_universe
CMS audit universe of coverage requests.
- universe: 'CDAG_CD' = Part D (drug) coverage determinations; 'ODAG_OD' = Part C (medical) organization determinations.
- standard: 'standard' or 'expedited'.
- threshold_hours: CMS deadline. Part D: 72 standard, 24 expedited. Part C: 336 (14 days) standard, 72 expedited.
- timeliness_hours: hours from received_at to decision_at. A case is timely when timeliness_hours <= threshold_hours.
- notice_sent: 1 = member notice sent.

## fwa_cases
Fraud, waste and abuse cases. Currently EMPTY; for fraud questions use claims.fraud_flag.
- z_score: how unusual the provider's billing is versus peers. estimated_overpayment: dollars. claim_ids: list of claim ids.

## ncci_edits
CMS NCCI procedure-to-procedure pairs. col2 is a CPT code bundled into col1; billing both for the same member on the same date is unbundling. Example: 80053 already includes 80048.

## roles
App access roles; description says which lines of business each role may see.

## role_lob_access
Which lob values each role may access.

## users
App users. Never select password_hash or email.

## user_attributes
Key/value settings per app user (attr_key 'domain' or 'phi_access').

## campaigns
Marketing campaigns that generate leads.
- channel: DTC (direct-to-consumer), Web, Telesales, Broker, Agency, Direct.
- lead_source: source code, joins to leads.lead_source.
- target_cohort: 'New-to-Medicare', 'Existing Member', 'Retention-Risk'.
- spend, impressions, responses, leads_generated: funnel metrics. Cost per lead = spend / leads_generated.
- attribution_model: how leads were credited (First Touch, Last Touch, Multi Touch).

## sales_agents
- npn: National Producer Number (insurance license id).
- agency_id: the agent's agency (there is no agency table).
- agent_type: Captive (employed by the plan), Independent, FMO (Field Marketing Organization), Vendor.
- termination_date: NULL while employed.
- productive_hours_quarter: selling hours in the quarter.

## agent_certifications
Credentials an agent needs to sell in plan_year 2026.
- cert_type: AHIP (annual Medicare sales training), State License, Carrier Appointment.
- carrier_appointed: 1 = appointed with the carrier.
- ce_credits_completed / ce_credits_required: continuing-education credits (may hold decimals).

## plan_benefit_packages
CMS plan catalog used by the sales tables.
- contract_id: CMS contract. H-prefix = Medicare Advantage, S5678 = standalone drug plan (PDP), E7712 = employer group MA, A1001 = ACA.
- pbp_id: Plan Benefit Package id '<contract>-<plan>-<pbp>'; joins to applications.pbp_id and enrollments.pbp_id.
- plan_type: MA (no drug coverage), MAPD (MA with Part D), C-SNP (chronic-condition special needs), D-SNP (dual-eligible special needs), PDP (drug only), Group MA (employer), ACA.
- star_rating: CMS Star Rating, 1-5 in half stars.
- premium: monthly member premium. moop: maximum out-of-pocket.
- part_d_included: 1 = includes drug coverage.
- snp_type: 'Chronic', 'Dual', or NULL when not a special needs plan.
- service_area_states: pipe-separated states like 'AZ|CA|FL'. Match one state with ('|' || service_area_states || '|') LIKE '%|CA|%'.

## sales_targets
Quarterly goals per agent and lob.
- target_enrollments, target_premium, target_retention_rate (0-1).
- selling_days: selling days in the quarter. required_daily_pace = target_enrollments / selling_days.

## leads
One row per sales prospect.
- aep_flag: 1 = created during AEP (Annual Enrollment Period, Oct 15 - Dec 7).
- cohort: New-to-Medicare, Age-In (turning 65), Existing Member, Retention-Risk.
- dual_eligible: Medicare + Medicaid. lis_eligible: eligible for Low-Income Subsidy (Part D Extra Help).
- qualified_flag / qualification_score (0-1): whether the lead passed qualification.
- funnel_stage: furthest stage reached: Lead -> Application -> Approved -> Effectuated, or Lost.
- disposition: last contact outcome. lost_reason: only set on Lost leads.
- duplicate_flag: 1 = duplicate; use duplicate_flag = 0 when counting leads.
- cost_allocated: acquisition cost attributed to the lead.
- assigned_agent_id -> sales_agents.agent_id. days_to_first_contact is NULL when never contacted.

## lead_activities
Every outreach attempt on a lead.
- attempt_number: 1st, 2nd, ... attempt on that lead.
- outcome: No Answer, Voicemail, Connected, Declined, Appointment Set.
- followed_up_within_sla: 1 = follow-up happened by sla_due_date.

## applications
Enrollment applications submitted by agents.
- enrollment_period: AEP (Annual Enrollment Period, Oct 15 - Dec 7), OEP (MA Open Enrollment Period, Jan 1 - Mar 31), SEP (Special Enrollment Period), ICEP (Initial Coverage Election Period, when first eligible).
- soa_on_file / soa_signed_date: Scope of Appointment, which CMS generally requires signed 48 hours before appointment_date.
- status: Approved, Denied, Withdrawn. denial_reason only set when Denied.
- verification_call_completed: 1 = verification call done.
- turnaround_hours: hours from application_date to decision_date.

## enrollments
Approved applications that became enrollments.
- effectuated_flag: 1 = coverage actually started. Use this flag to count effectuated enrollments; 12 rows have status 'Effectuated' but effectuated_flag = 0.
- status: Active, Disenrolled, Cancelled (before coverage started), Effectuated.
- cancel_before_effective_flag / cancel_reason: cancelled before effective_date.
- disenroll_date / disenroll_days: when the member left and days after effective_date; NULL if still enrolled.
- rapid_disenroll_flag: 1 = left within 90 days of effective_date.
- retained_12mo_flag: 1 = still enrolled after 12 months.
- monthly_premium / annual_premium: member-paid premium. Not the same as members.monthly_premium.
- revenue_per_enrollment: expected plan revenue for the enrollment.
- reconciliation_status: Reconciled, Exception, Cancelled, against CMS enrollment records. (verify)

## agent_commissions
Commission payments; several rows per enrollment.
- comm_type: Initial (first year), Renewal, Override (paid to the upline agency or FMO), Bonus.
- commission_paid; override_paid and bonus_paid are additional amounts on the same row.
- fmv_cap: CMS fair-market-value maximum commission for the enrollment. Payments above it are a compliance issue.
- recoupment_due_flag, clawback_amount, clawback_reason, clawback_status: commission to be taken back, e.g. after rapid disenrollment or when never effectuated.

## interactions
Customer contacts.
- channel: IVR, Chat, Inbound, Outbound.
- interaction_type: Service, Sales Call, Grievance, Complaint, CTM.
- ctm_flag: 1 = complaint logged in Medicare's Complaint Tracking Module (CTM); these count against Star Ratings.
- complaint_category: only set for Complaint, Grievance and CTM interactions.
- member_id NULL when the person was not yet a member. resolution_hours NULL when unresolved.
