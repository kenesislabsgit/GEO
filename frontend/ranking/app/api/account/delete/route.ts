import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { usingLocalDb } from "@/lib/db/repository";
import { createServiceClient } from "@/lib/db/supabase/service";
import { promises as fs } from "fs";
import path from "path";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (usingLocalDb()) {
    const storePath = path.join(process.cwd(), ".data", "local-store.json");
    try {
      const store = JSON.parse(await fs.readFile(storePath, "utf8"));
      const brandIds = new Set<string>(
        (store.brands || [])
          .filter((brand: { owner_id: string | null }) => brand.owner_id === user.id)
          .map((brand: { id: string }) => brand.id),
      );
      const brandDomains = new Set<string>(
        (store.brands || [])
          .filter((brand: { id: string }) => brandIds.has(brand.id))
          .map((brand: { canonical_domain: string }) =>
            String(brand.canonical_domain || "").toLowerCase(),
          )
          .filter(Boolean),
      );
      const scanIds = new Set<string>(
        (store.scan_runs || [])
          .filter((scan: { brand_id: string }) => brandIds.has(scan.brand_id))
          .map((scan: { id: string }) => scan.id),
      );
      store.brands = (store.brands || []).filter(
        (brand: { id: string }) => !brandIds.has(brand.id),
      );
      store.competitors = (store.competitors || []).filter(
        (row: { brand_id: string }) => !brandIds.has(row.brand_id),
      );
      store.tracked_prompts = (store.tracked_prompts || []).filter(
        (row: { brand_id: string }) => !brandIds.has(row.brand_id),
      );
      store.scan_runs = (store.scan_runs || []).filter(
        (row: { id: string }) => !scanIds.has(row.id),
      );
      store.query_results = (store.query_results || []).filter(
        (row: { scan_run_id: string }) => !scanIds.has(row.scan_run_id),
      );
      store.score_snapshots = (store.score_snapshots || []).filter(
        (row: { brand_id: string; scan_run_id: string }) =>
          !brandIds.has(row.brand_id) && !scanIds.has(row.scan_run_id),
      );
      store.recommendations = (store.recommendations || []).filter(
        (row: { brand_id: string; scan_run_id: string }) =>
          !brandIds.has(row.brand_id) && !scanIds.has(row.scan_run_id),
      );
      store.usage_ledger = (store.usage_ledger || []).filter(
        (row: { user_id: string }) => row.user_id !== user.id,
      );
      store.free_scan_requests = (store.free_scan_requests || []).filter(
        (row: {
          scan_run_id: string | null;
          domain?: string;
          normalized_domain?: string;
        }) =>
          !scanIds.has(row.scan_run_id || "") &&
          !brandDomains.has(String(row.normalized_domain || row.domain || "").toLowerCase()),
      );
      store.subscriptions = (store.subscriptions || []).filter(
        (s: { user_id: string }) => s.user_id !== user.id,
      );
      store.alerts = (store.alerts || []).filter(
        (a: { user_id: string }) => a.user_id !== user.id,
      );
      store.profiles = (store.profiles || []).filter(
        (profile: { id: string }) => profile.id !== user.id,
      );
      if (store.user_onboarding) delete store.user_onboarding[user.id];
      for (const brandId of brandIds) {
        if (store.brand_monitoring) delete store.brand_monitoring[brandId];
      }
      await fs.writeFile(storePath, JSON.stringify(store, null, 2));
    } catch {
      // ignore missing store
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set("rbai_local_user", "", { path: "/", maxAge: 0 });
    return response;
  }

  const supabase = createServiceClient();
  await supabase.from("brands").delete().eq("owner_id", user.id);
  await supabase.from("subscriptions").delete().eq("user_id", user.id);
  await supabase.from("alerts").delete().eq("user_id", user.id);
  await supabase.from("profiles").delete().eq("id", user.id);
  return NextResponse.json({ ok: true });
}
