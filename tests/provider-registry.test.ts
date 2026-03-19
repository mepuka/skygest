import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  energyProviderRegistry,
  energyProviderRegistryManifest
} from "../src/bootstrap/CheckedInProviderRegistry";
import { ProviderRegistryManifest } from "../src/domain/source";
import { ProviderRegistry } from "../src/services/ProviderRegistry";
import { assertValidProviderRegistryManifest } from "../src/source/registry";

const decodeManifest = Schema.decodeUnknownSync(ProviderRegistryManifest);

describe("provider registry", () => {
  it("rejects duplicate aliases after normalization", () => {
    const manifest = decodeManifest({
      domain: "energy",
      version: "test",
      providers: [
        {
          providerId: "ercot",
          providerLabel: "ERCOT",
          aliases: [],
          domains: ["ercot.com"],
          sourceFamilies: []
        },
        {
          providerId: "eia",
          providerLabel: "EIA",
          aliases: ["  ercot  "],
          domains: ["eia.gov"],
          sourceFamilies: []
        }
      ]
    });

    expect(() => assertValidProviderRegistryManifest(manifest)).toThrow(
      /duplicate alias "ercot"/u
    );
  });

  it("rejects duplicate domains after normalization", () => {
    const manifest = decodeManifest({
      domain: "energy",
      version: "test",
      providers: [
        {
          providerId: "bc-hydro",
          providerLabel: "BC Hydro",
          aliases: ["BCH"],
          domains: ["bchydro.com"],
          sourceFamilies: []
        },
        {
          providerId: "caiso",
          providerLabel: "CAISO",
          aliases: ["California ISO"],
          domains: ["www.bchydro.com"],
          sourceFamilies: []
        }
      ]
    });

    expect(() => assertValidProviderRegistryManifest(manifest)).toThrow(
      /duplicate domain "bchydro\.com"/u
    );
  });

  it("loads the checked-in curated energy registry", () => {
    expect(energyProviderRegistryManifest.domain).toBe("energy");
    expect(energyProviderRegistryManifest.providers.length).toBeGreaterThanOrEqual(12);
    expect(
      energyProviderRegistryManifest.providers.some(
        (provider) => provider.providerId === "ercot"
      )
    ).toBe(true);
    expect(
      energyProviderRegistry.providerByDomain.get("ercot.com")?.providerId
    ).toBe("ercot");
    expect(
      energyProviderRegistry.providerByDomain.get("atb.nrel.gov")?.providerId
    ).toBe("nrel");
    expect(
      energyProviderRegistry.providerByDomain.get("webportal.tp.entsoe.eu")?.providerId
    ).toBe("entso-e");
    expect(energyProviderRegistry.providerByAlias.get("ferc")?.providerId).toBe("ferc");
    expect(
      energyProviderRegistry.providerByAlias.get("caiso")?.providerId
    ).toBe("caiso");
    expect(
      energyProviderRegistry.providerByDomain.get("services.pjm.com")?.providerId
    ).toBe("pjm");
  });

  it.effect("resolves exact provider lookups through the service layer", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;

      const ercot = yield* registry.getProvider("ercot");
      const ercotByAlias = yield* registry.findByAlias(
        "Electric Reliability Council of Texas"
      );
      const eiaByDomain = yield* registry.findByDomain("www.eia.gov");
      const entsoeByAlias = yield* registry.findByAlias("ENTSO-E");
      const entsoeBySourceFamily = yield* registry.findBySourceFamily(
        " transparency platform "
      );
      const aeso = yield* registry.getProvider("aeso");
      const bcHydro = yield* registry.getProvider("bc-hydro");
      const caiso = yield* registry.getProvider("caiso");
      const resourceAdequacyProviders = yield* registry.findBySourceFamily(
        "Resource Adequacy"
      );
      const dailyRenewableReportProviders = yield* registry.findBySourceFamily(
        "daily renewable report"
      );
      const planningOutlookProviders = yield* registry.findBySourceFamily(
        "annual planning outlook"
      );
      const eia = yield* registry.getProvider("eia");
      const ferc = yield* registry.getProvider("ferc");
      const iea = yield* registry.getProvider("iea");
      const nrel = yield* registry.getProvider("nrel");
      const pjm = yield* registry.getProvider("pjm");
      const nrelByDomain = yield* registry.findByDomain("scenarioviewer.nrel.gov");
      const fercByAlias = yield* registry.findByAlias(
        "federal energy regulatory commission"
      );
      const sppByAlias = yield* registry.findByAlias("spp");

      expect(ercot?.providerLabel).toBe("ERCOT");
      expect(ercotByAlias?.providerId).toBe("ercot");
      expect(eiaByDomain?.providerId).toBe("eia");
      expect(entsoeByAlias?.providerId).toBe("entso-e");
      expect(entsoeBySourceFamily.map((provider) => provider.providerId)).toEqual([
        "entso-e"
      ]);
      expect(aeso?.sourceFamilies).toEqual([
        "Annual Market Statistics",
        "Long-Term Adequacy Metrics",
        "Current Supply and Demand"
      ]);
      expect(bcHydro?.sourceFamilies).toEqual([
        "Balancing Authority Load Data",
        "Area Control Error Annual Reports",
        "Integrated Resource Plan"
      ]);
      expect(caiso?.providerLabel).toBe("California ISO");
      expect(caiso?.sourceFamilies).toEqual([
        "Daily Renewable Report",
        "Curtailed and non-operational generators",
        "Monthly Renewables Performance Report"
      ]);
      expect(eia?.sourceFamilies).toEqual([
        "Short-Term Energy Outlook",
        "Electric Power Monthly",
        "Natural Gas Monthly",
        "Weekly Natural Gas Storage Report"
      ]);
      expect(ferc?.sourceFamilies).toEqual([
        "State of the Markets Report",
        "Winter Energy Market and Reliability Assessment",
        "Summer Energy Market and Electric Reliability Assessment",
        "Energy Primer"
      ]);
      expect(iea?.sourceFamilies).toEqual([
        "World Energy Outlook",
        "Electricity",
        "Renewables",
        "Global Energy Review"
      ]);
      expect(nrel?.sourceFamilies).toEqual([
        "Annual Technology Baseline",
        "Standard Scenarios",
        "Cambium",
        "Scenario Viewer"
      ]);
      expect(pjm?.sourceFamilies).toEqual([
        "Load Forecast Report",
        "Annual Markets Report",
        "Annual Report"
      ]);
      expect(nrelByDomain?.providerId).toBe("nrel");
      expect(fercByAlias?.providerId).toBe("ferc");
      expect(
        dailyRenewableReportProviders.map((provider) => provider.providerId)
      ).toEqual(["caiso"]);
      expect(
        planningOutlookProviders.map((provider) => provider.providerId)
      ).toEqual(["ieso"]);
      expect(
        resourceAdequacyProviders.some((provider) => provider.providerId === "miso")
      ).toBe(true);
      expect(sppByAlias?.providerId).toBe("spp");
    }).pipe(Effect.provide(ProviderRegistry.layer))
  );
});
