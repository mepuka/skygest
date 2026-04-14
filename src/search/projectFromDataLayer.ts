import { Effect } from "effect";
import { loadRepoDataLayerSeed } from "../bootstrap/D1DataLayerRegistry";
import { loadPreparedDataLayerRegistry } from "../services/DataLayerRegistry";
import { projectEntitySearchDocs } from "./projectEntitySearchDocs";

export const d1DataLayerSearchProjectionRoot = "d1://entity-search-source";

export const loadProjectedEntitySearchDocsFromDataLayer = (
  root = d1DataLayerSearchProjectionRoot
) =>
  loadPreparedDataLayerRegistry(
    loadRepoDataLayerSeed().pipe(
      Effect.map((seed) => ({
        seed,
        root
      }))
    )
  ).pipe(
    Effect.map(projectEntitySearchDocs)
  );
