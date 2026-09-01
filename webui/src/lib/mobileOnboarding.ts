export const MOBILE_ONBOARDING_STEPS = ["profile", "notifications", "ready"] as const;

export type MobileOnboardingStep = (typeof MOBILE_ONBOARDING_STEPS)[number];

export function nextMobileOnboardingStep(step: MobileOnboardingStep): MobileOnboardingStep {
  const index = MOBILE_ONBOARDING_STEPS.indexOf(step);
  return MOBILE_ONBOARDING_STEPS[Math.min(index + 1, MOBILE_ONBOARDING_STEPS.length - 1)];
}
