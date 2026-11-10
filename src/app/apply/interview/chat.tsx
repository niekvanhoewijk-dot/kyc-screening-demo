"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ChatTurn } from "@/agent/interviewer";
import { interviewTurnAction } from "./actions";

// The interviewer chat (docs/spec/10 section 7). The conversation lives in this browser tab only (O-80): it is kept in
// sessionStorage and sent back as plain text each turn. Nothing here decides anything; the server re-reads the state.

const load = (key: string): ChatTurn[] => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
  } catch {
    return [];
  }
};
const save = (key: string, turns: ChatTurn[]) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(turns));
  } catch {
    /* private mode or full storage: the chat still works for this page view */
  }
};

export function InterviewChat({ storageKey, greeting, maxChars, scriptLines }: { storageKey: string; greeting: string; maxChars: number; scriptLines?: string[] }) {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setTurns(load(storageKey)), [storageKey]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    start(async () => {
      const r = await interviewTurnAction({ history: turns, message });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const next: ChatTurn[] = [...turns, { role: "user", text: message }, { role: "assistant", text: r.reply }];
      setTurns(next);
      save(storageKey, next);
      setDraft("");
      router.refresh(); // the card below the chat follows the application's state
      input.current?.focus();
    });
  };

  const nextScripted = scriptLines?.[turns.filter((t) => t.role === "user").length];

  return (
    <section className="stack" aria-labelledby="chat-title">
      <h2 id="chat-title" className="sr-only">Conversation with the AI assistant</h2>
      <ol className="chat-log" aria-live="polite" aria-relevant="additions">
        <li className="chat-msg assistant">
          <span className="sr-only">Assistant: </span>
          {greeting}
        </li>
        {turns.map((t, i) => (
          <li key={i} className={`chat-msg ${t.role}`}>
            <span className="sr-only">{t.role === "user" ? "You: " : "Assistant: "}</span>
            {t.text}
          </li>
        ))}
        {pending && (
          <li className="chat-msg assistant muted" role="status">
            The assistant is writing…
          </li>
        )}
      </ol>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <form
        className="stack"
        style={{ gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="field">
          <label htmlFor="chat-input">Your message</label>
          <textarea
            id="chat-input"
            ref={input}
            rows={3}
            maxLength={maxChars}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            aria-describedby="chat-hint"
          />
          <span className="hint" id="chat-hint">
            Press Enter to send, Shift and Enter for a new line. Please don&apos;t type document numbers here: those go in the secure forms.
          </span>
        </div>
        <div className="actions tight">
          <button className="btn small" type="submit" disabled={pending || !draft.trim()}>
            Send
          </button>
          {nextScripted && (
            <button className="link-btn" type="button" disabled={pending} onClick={() => send(nextScripted)}>
              Send the scripted line: “{nextScripted.length > 60 ? `${nextScripted.slice(0, 60)}…` : nextScripted}”
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
