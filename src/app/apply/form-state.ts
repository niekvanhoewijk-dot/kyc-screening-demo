import type { FieldErrors } from "@/portal/errors";

export type FormState = {
  message?: string;
  ok?: boolean;
  fieldErrors?: FieldErrors;
  /** Echo of the submitted text fields so the form keeps what the applicant typed. */
  values?: Record<string, string>;
};

export const initialState: FormState = {};
