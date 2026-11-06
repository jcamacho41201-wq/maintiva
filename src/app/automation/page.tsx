import { redirect } from "next/navigation";
import { campaignReviewUrl } from "@/lib/campaign-review";

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(campaignReviewUrl(await searchParams));
}
