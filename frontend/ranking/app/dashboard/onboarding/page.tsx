import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getCompetitors,
  getUserOnboarding,
  listAllPrompts,
  listBrandsForOwner,
  upsertUserOnboarding,
} from "@/lib/db/repository";
import { createInitialOnboardingState } from "@/lib/onboarding/state";
import { OnboardingWizard } from "@/components/dashboard/onboarding-wizard";
import { routes } from "@/lib/routes";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const entitlements = await getAccountEntitlements(user.id);
  if (!isPaidSubscription(entitlements)) {
    redirect(routes.newScan());
  }

  const brands = await listBrandsForOwner(user.id);
  if (brands.length === 0) {
    redirect(routes.newScan());
  }

  const brand = brands[0]!;
  let state = await getUserOnboarding(user.id);
  if (!state) {
    const [competitors, prompts] = await Promise.all([
      getCompetitors(brand.id),
      listAllPrompts(brand.id),
    ]);
    state = await upsertUserOnboarding(
      user.id,
      createInitialOnboardingState({
        brand,
        plan: entitlements.plan,
        competitors: competitors.map((c) => ({
          name: c.name,
          domain: c.domain,
        })),
        promptIds: prompts.filter((p) => p.active).map((p) => p.id),
      }),
    );
  }

  if (state.completed) {
    redirect(routes.dashboard);
  }

  const prompts = await listAllPrompts(state.brandId ?? brand.id);
  const plan = PLAN_CONFIG[entitlements.plan];

  return (
    <OnboardingWizard
      initialState={state}
      initialPlan={{
        id: entitlements.plan,
        name: entitlements.planName,
        providers: plan.features.providers,
        competitorsPerBrand: plan.features.competitorsPerBrand,
        countries: plan.features.countries,
        languages: plan.features.languages,
        weeklyMonitoring: plan.features.weeklyMonitoring,
        dailyMonitoring: plan.features.dailyMonitoring,
        emailAlerts: plan.features.emailAlerts,
      }}
      initialPrompts={prompts}
    />
  );
}
