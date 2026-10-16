export interface ProofOptions {
  /** Where captions and check marks sit. Pick the edge the app's own toasts do not use. */
  captions: "top" | "bottom";
  /** Hosts the page may call besides the app's own. Any other host is blocked and fails the flow. */
  allowedHosts: string[];
  /** CSS selectors hidden in every flow, such as a framework's dev badge. */
  hideSelectors: string[];
  /**
   * Variables every `terminal()` command gets, on top of the caller's.
   * Put the proof database here: a command that loads the app's own
   * `.env` would otherwise reach the shared dev database.
   */
  terminalEnv: Record<string, string>;
  /** Strings `terminal()` never shows, such as the values in the app's `.env`. */
  secrets: string[];
}

export type ProofEventKind = "scene" | "say" | "check" | "problem";

export interface ProofEvent {
  kind: ProofEventKind;
  text: string;
  /** Milliseconds since the flow started. */
  atMs: number;
  /** Checks only. */
  passed?: boolean;
  /** Why a check failed, or what the problem was. */
  detail?: string;
}

/** What one flow hands to the reporter. */
export interface FlowPayload {
  recording: boolean;
  /** Absolute path of the flow's clip, when recording. */
  clip: string | null;
  /** Wall-clock length of the recording, used to line events up with the clip. */
  wallMs: number;
  events: ProofEvent[];
}

export const EVENTS_ATTACHMENT = "proof-events";

export function isRecording(): boolean {
  return process.env.PROOF_RECORD === "1";
}
