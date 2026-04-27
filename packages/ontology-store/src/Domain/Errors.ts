/**
 * Re-export of cross-package tagged errors used inside ontology-store.
 *
 * The canonical error definitions live in the worker's domain layer
 * (`src/domain/errors.ts`) so the worker bundle has a single source of
 * truth for all tagged errors. Modules under `packages/ontology-store/`
 * import them through this barrel rather than reaching into the worker
 * tree directly.
 */
export { RdfMappingError } from "../../../../src/domain/errors";
