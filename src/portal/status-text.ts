import type { ApplicantView } from "./decision";

// Neutral status sentences for the applicant (D7: never a reason, a score or a screening term). Shared by the status
// page and the agent tools (spec 10 section 5.1), which never repeat the deposit limit the confirmation page shows.

export const NO_GO_TEXT =
  "We're unable to open an account for you at this time. This follows from our regulatory requirements. If you think this is a mistake, contact support.";

const MESSAGE: Record<ApplicantView["kind"], string> = {
  draft: "Your application is not finished yet. Your completed steps are saved.",
  check: "Your application has been submitted. A member of our team reviews every application.",
  confirmation: "Your account is open.",
  no_go: NO_GO_TEXT,
  edd: "We need a few more documents from you. Please continue on the portal.",
  por_expired: "Your proof of residence needs to be renewed. Please upload a new one on the portal.",
};

export const applicantStatusMessage = (kind: ApplicantView["kind"]) => MESSAGE[kind];
