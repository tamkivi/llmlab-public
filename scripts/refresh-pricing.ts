import { refreshEstonianMarketPricing } from "@/lib/server/estonian-pricing-service";

async function main() {
  const summary = await refreshEstonianMarketPricing();
  console.log("Pricing refresh complete:");
  console.log(`  processed:       ${summary.checked}`);
  console.log(`  updated:         ${summary.updated}`);
  console.log(`  skipped:         ${summary.skipped}`);
  console.log(`  failed:          ${summary.failed}`);
  console.log(`  historyInserted: ${summary.historyRowsInserted}`);
  console.log(`  historyUpdated:  ${summary.historyRowsUpdated}`);
  console.log(`  lowSampleItems:  ${summary.lowSampleItems.length}`);
  console.log(`  startedAt:       ${summary.startedAt}`);
  console.log(`  finishedAt:      ${summary.finishedAt}`);
  if (summary.failedItems.length > 0) {
    console.log("\nFailed items:");
    for (const item of summary.failedItems) {
      console.log(`  ${item.category}:${item.itemId} (${item.name}) — ${item.reason}`);
    }
  }
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
