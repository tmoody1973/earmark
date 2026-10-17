"use client";
import { useActionState } from "react";
import { createSpace, type SpaceFormState } from "./actions";

const START: SpaceFormState = { error: null };

/** One sentence makes a Space (FR-32). On success the action opens the new Space; Earmark fills it from there. */
export function NewSpaceForm() {
  const [state, action, pending] = useActionState(createSpace, START);
  return (
    <form action={action} className="space-new">
      <label htmlFor="space-sentence" className="space-new-label">Describe a new Space</label>
      <p id="space-sentence-hint" className="space-hint">
        One sentence about what belongs in it. Earmark fills it from your ideas and tips, and keeps it filled.
      </p>
      <div className="space-new-row">
        <input
          id="space-sentence"
          name="sentence"
          required
          minLength={3}
          maxLength={200}
          autoComplete="off"
          placeholder="Places to eat in Milwaukee"
          aria-describedby={state.error ? "space-sentence-hint space-sentence-error" : "space-sentence-hint"}
          aria-invalid={state.error ? true : undefined}
        />
        <button type="submit" className="space-btn space-btn--primary" disabled={pending}>
          {pending ? "Creating…" : "Create Space"}
        </button>
      </div>
      <p id="space-sentence-error" className="space-error" role="alert">{state.error}</p>
    </form>
  );
}
