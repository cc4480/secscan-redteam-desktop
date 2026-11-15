/**
 * The emitter's public vocabulary: the failure a projection raises and the
 * artifacts one package emits on one face.
 *
 * @module @deepseek-ai/dsh-typert-generator/emitter-model
 */

import type { FaceModel } from './model.ts'

/** Failure to project a modeled construct into an emitted artifact. */
export class TypertEmitError extends Error {
  override name = 'TypertEmitError'
}

/** JavaScript and declaration artifacts for one package on one face. */
export interface ModelEmitResult {
  readonly package: string
  readonly face: FaceModel['face']
  readonly exports: readonly string[]
  readonly js: string
  readonly dts: string
  readonly remote?: RemoteModelEmitResult
}

/** Host-for-Client Remote contribution generated from the Host Program. */
export interface RemoteModelEmitResult {
  readonly js: string
  readonly dts: string
  readonly dtsMap: string
}
