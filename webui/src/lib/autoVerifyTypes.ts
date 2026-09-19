export type AutoVerifyDecision = "allow" | "ask";

export interface AutoVerifyRule {
  id: string;
  when: string;
  decision: AutoVerifyDecision;
}

export interface AutoVerifySettings {
  enabled: boolean;
  rules: AutoVerifyRule[];
}

export const DEFAULT_AUTO_VERIFY: AutoVerifySettings = { enabled: true, rules: [] };
