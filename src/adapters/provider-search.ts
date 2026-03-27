import type { ServiceType } from "../domain/types.js";
import { logger } from "../utils/logger.js";

export type ProviderCandidate = {
  name: string;
  phone: string;
};

const STUB_PROVIDERS: Record<string, ProviderCandidate[]> = {
  plumber: [
    { name: "Mike's Plumbing", phone: "+15555550101" },
    { name: "AquaFix Pro", phone: "+15555550102" },
    { name: "DrainMaster Services", phone: "+15555550103" },
  ],
  electrician: [
    { name: "Spark Electric Co", phone: "+15555550104" },
    { name: "Watts Up Electrical", phone: "+15555550105" },
    { name: "PowerLine Pros", phone: "+15555550106" },
  ],
  handyman: [
    { name: "FixIt All Handyman", phone: "+15555550107" },
    { name: "HomeRight Services", phone: "+15555550108" },
    { name: "Mr. Reliable", phone: "+15555550109" },
  ],
  cleaner: [
    { name: "SparkleClean Co", phone: "+15555550110" },
    { name: "FreshStart Cleaning", phone: "+15555550111" },
    { name: "TidyPro Services", phone: "+15555550112" },
  ],
  junk_removal: [
    { name: "HaulAway Junk", phone: "+15555550113" },
    { name: "CleanSlate Removal", phone: "+15555550114" },
    { name: "GotJunk Express", phone: "+15555550115" },
  ],
  unknown: [
    { name: "AllPro Home Services", phone: "+15555550116" },
    { name: "HandyHelp General", phone: "+15555550117" },
    { name: "QuickFix Solutions", phone: "+15555550118" },
  ],
};

export async function searchProviders(input: {
  serviceType: ServiceType;
  locationText: string;
}): Promise<ProviderCandidate[]> {
  logger.info(`[provider-search] Searching for ${input.serviceType} near ${input.locationText}`);
  return STUB_PROVIDERS[input.serviceType] ?? STUB_PROVIDERS["unknown"]!;
}
