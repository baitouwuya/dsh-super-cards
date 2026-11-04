/**
 * Host-side `superCards` service: read-only introspection of the live block
 * registry and placement vocabulary.
 *
 * The Client half provides the same service name with the *mutable* surface
 * (`blocks.register` / `blocks.replace`), because renderers live in the page.
 * Host plugins use this face for tooling, docs, or to pair a Client registration
 * with a Host one: a new block type is only complete when both halves know it.
 */

import {
  BLOCKS,
  BLOCK_TYPES,
  DOCK_BLOCKS,
  blockContractCatalog,
  blockContractText,
  motionContractText,
} from './blocks.js'
import { MOTION_EFFECTS, MOTION_MEANING } from './shared.js'
import { PLACEMENTS } from './config.js'

/** Service name; the Client half provides the same key. */
export const SERVICE_NAME = 'superCards'

/**
 * Build the read-only Host service face.
 *
 * @returns {object} frozen service: `{ version, blocks, placements }`.
 */
export function createHostService() {
  const blocks = Object.freeze({
    /** @returns {string[]} enabled block types in documentation order. */
    list: () => BLOCK_TYPES.slice(),
    /** @returns {string[]} dock-safe block types in documentation order. */
    dock: () => DOCK_BLOCKS.slice(),
    /**
     * @param {string} type wire block type.
     * @returns {boolean} whether the Host registry knows the type.
     */
    has: (type) => typeof type === 'string' && BLOCK_TYPES.includes(type),
    /**
     * @param {string} type wire block type.
     * @returns {{ type: string, purpose: string, dock: boolean } | undefined} registry summary.
     */
    get(type) {
      const entry = BLOCKS.find((block) => block.type === type)
      if (entry === undefined) return undefined
      return { type: entry.type, purpose: entry.purpose, dock: entry.dock === true }
    },
    /**
     * Exact contract text for one type, several types, or every type.
     * @param {string | string[]} [type] requested type(s).
     * @returns {string} contract text.
     */
    contract(type) {
      if (typeof type === 'string') return blockContractText(type) ?? ''
      if (Array.isArray(type)) return blockContractCatalog(type.filter((item) => typeof item === 'string'))
      return blockContractCatalog(BLOCK_TYPES)
    },
  })
  const placements = Object.freeze({
    /** @returns {string[]} accepted placement names. */
    list: () => PLACEMENTS.slice(),
    /**
     * @param {string} name placement name.
     * @returns {boolean} whether the Host accepts the placement.
     */
    has: (name) => typeof name === 'string' && PLACEMENTS.includes(name),
  })
  const motion = Object.freeze({
    /** @returns {string[]} preset effect names a block may carry. */
    list: () => MOTION_EFFECTS.slice(),
    /**
     * @param {string} effect preset name.
     * @returns {boolean} whether the Host accepts the effect.
     */
    has: (effect) => typeof effect === 'string' && MOTION_EFFECTS.includes(effect),
    /**
     * @param {string} effect preset name.
     * @returns {{ effect: string, meaning: string } | undefined} what the effect animates.
     */
    get(effect) {
      if (typeof effect !== 'string' || !MOTION_EFFECTS.includes(effect)) return undefined
      return { effect, meaning: MOTION_MEANING[effect] }
    },
    /** @returns {string} the model-facing motion contract text. */
    contract: () => motionContractText(),
  })
  return Object.freeze({ version: 1, blocks, placements, motion })
}
