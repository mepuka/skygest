import type {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution
} from "../../domain/data-layer";

export type IngestNode =
  | {
      readonly _tag: "agent";
      readonly slug: string;
      readonly data: Agent;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "catalog";
      readonly slug: string;
      readonly data: Catalog;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "data-service";
      readonly slug: string;
      readonly data: DataService;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "dataset";
      readonly slug: string;
      readonly data: Dataset;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "distribution";
      readonly slug: string;
      readonly data: Distribution;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "catalog-record";
      readonly slug: string;
      readonly data: CatalogRecord;
      readonly merged: boolean;
    };
