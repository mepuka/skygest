import { Schema } from "effect";
import {
  AggregationMembers,
  StatisticTypeMembers,
  UnitFamilyMembers
} from "../generated/energyVariableProfile";

export const StatisticType = Schema.Literals(StatisticTypeMembers).annotate({
  description: "Statistical measure type (SDMX-aligned)"
});
export type StatisticType = Schema.Schema.Type<typeof StatisticType>;

export const Aggregation = Schema.Literals(AggregationMembers).annotate({
  description: "Temporal aggregation method"
});
export type Aggregation = Schema.Schema.Type<typeof Aggregation>;

export const UnitFamily = Schema.Literals(UnitFamilyMembers).annotate({
  description: "Unit family grouping for dimensional analysis"
});
export type UnitFamily = Schema.Schema.Type<typeof UnitFamily>;
