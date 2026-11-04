import type { ObligationBasis, ObligationKind, ReasonCode } from "@/engine";

// Labels for the simulator (spec 08 4.3: records carry codes, the UI maps them to words). Analyst-facing only:
// applicants never see records or reason codes (D7).

export const REASON_LABEL: Record<ReasonCode, string> = {
  RC_COUNTRY_CALL_FOR_ACTION_COUNTERMEASURES: "Country: FATF call for action, countermeasures",
  RC_COUNTRY_CALL_FOR_ACTION_EDD: "Country: FATF call for action, enhanced due diligence",
  RC_COUNTRY_INCREASED_MONITORING: "Country: FATF increased monitoring",
  RC_COUNTRY_EU_SANCTIONS_MAP: "Country: EU sanctions map",
  RC_COUNTRY_RECENTLY_DELISTED: "Country: recently delisted, default tier with a note",
  RC_COUNTRY_RECENTLY_DELISTED_HELD: "Country: recently delisted, held at Auto-High",
  RC_COUNTRY_UNASSESSED: "Country: unassessed, conservative default",
  RC_COUNTRY_DEMO_SEED_LOW: "Country: demo seed Low (placeholder)",
  RC_US_TAX_RESIDENT: "US tax resident (hard rule)",
  RC_PEP_FORCES_HIGH: "PEP: at least High (D9)",
  RC_BAND_PROHIBITED: "Band Prohibited",
  RC_BAND_EDD_REQUIRED: "EDD required by band",
  RC_THRESHOLD_DEPOSIT_BAND: "Threshold set by the deposit band",
  RC_THRESHOLD_SOF_OF_INCOME: "Threshold set by source of funds share of income",
  RC_THRESHOLD_CATEGORY_CAP: "Threshold set by the category cap",
  RC_THRESHOLD_HARD_CEILING: "Threshold set by the initial ceiling",
  RC_EDD_NEW_THRESHOLD: "EDD: new threshold",
  RC_EDD_EXCESS_RETURNED: "EDD: excess to be returned",
  RC_EDD_TERMINATED: "EDD: no source of funds, relationship to end",
  LC_POR_EXPIRY_NOTICE: "Proof of residence expires soon: notice",
  LC_POR_EXPIRED: "Proof of residence expired",
  LC_REVIEW_DUE_EDD_ANNUAL: "Annual review due (EDD customer)",
  LC_REVIEW_DUE_STANDARD_5Y: "Periodic review due (standard customer)",
  LC_THRESHOLD_REACHED: "Deposits reached the threshold",
  LC_CIRCUMSTANCE_CHANGE: "Review due: customer circumstances changed",
  LC_POLICY_CHANGE_REVIEW: "Policy change: analyst review, no automatic closure",
};

export const BASIS_LABEL: Record<ObligationBasis, string> = {
  full_v3_por: "Full v3 POR rule",
  full_v3_edd: "Full v3 EDD trigger",
  amlr_26_2_a: "AMLR Art. 26(2)(a)",
  amlr_26_2_b: "AMLR Art. 26(2)(b)",
  amlr_26_3: "AMLR Art. 26(3)",
};

export const OBLIGATION_LABEL: Record<ObligationKind, string> = {
  por_notice: "POR notice",
  por_expired: "POR expired",
  threshold_reached: "Threshold reached",
  review_due: "Review due",
};

export const ROUTE_LABEL: Record<string, string> = {
  standard: "Standard",
  edd_required: "EDD required",
  reject: "Reject",
  analyst_review: "Analyst review",
};

export const CHANGE_LABEL: Record<string, string> = { band: "band", edd: "EDD", threshold: "threshold", route: "route" };

export const EVENT_LABEL = {
  deposit: "Deposit",
  por_replaced: "New proof of residence",
  circumstance_change: "Change of circumstances",
  pep_confirmed: "PEP confirmed",
  edd_outcome: "EDD outcome",
} as const;

export const KNOB_LABEL = {
  call_for_action_treatment: {
    all_prohibited: "Prohibit every call-for-action country (Full v3, default)",
    follow_fatf: "Follow FATF: Myanmar (EDD only) goes to Auto-High",
  },
  recently_delisted_treatment: {
    normal_with_note: "Default tier with an analyst note (default)",
    hold_auto_high: "Hold at Auto-High until the next review",
  },
} as const;
