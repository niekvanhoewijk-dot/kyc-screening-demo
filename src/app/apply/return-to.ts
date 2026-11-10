// A step finished from the interviewer's card goes back to the chat (docs/spec/10 section 7). The form field holds
// one fixed value, never a URL, so it cannot become an open redirect.

export const RETURN_FIELD = "returnTo";
export const RETURN_VALUE = "interview";
export const INTERVIEW_PATH = "/apply/interview";

export function returnPath(fd: FormData): string | null {
  return fd.get(RETURN_FIELD) === RETURN_VALUE ? INTERVIEW_PATH : null;
}
