/* ============================================================================
 * WHAT THIS FILE DOES:
 * - Single source of truth for the types shared between the content script,
 *   the background script and the popup.
 * - "Card" is exchanged between the content script, the background and the
 *   popup and stored in the session storage.
 * - "DraftCard" is a single AI-generated text card (front and back).
 * - "Message" is the message protocol of the extension: the exact shapes that
 *   the popup and the content script may send to the background script.
 * - "DEFAULT_MODEL" is the Anki note type used when none is selected. It is
 *   shared so that the background and the popup agree on the fallback.
 * ============================================================================ */

/** The Anki note type that is used when the user has not selected one. */
export const DEFAULT_MODEL = "Einfach";

/** A card captured from the clipboard or via keyboard shortcuts. */
export interface Card {
    front: string;
    frontImage: string;
    back: string;
    backImage: string;
    sourceText: string;
}

/** An AI-generated text card (front and back). */
export interface DraftCard {
    front: string;
    back: string;
}

/**
 * A "union type" – it means: a message can have ONE of many shapes.
 * TypeScript then automatically checks which shape it is, depending
 * on which "type" field is set.
 */
export type Message =
    | { type: "SET_FRONT"; text: string }
    | { type: "SET_BACK"; text: string }
    | { type: "SET_SOURCE"; text: string }
    | { type: "SET_IMAGE"; target: "front" | "back"; image: string }
    | { type: "GET_CARD" }
    | { type: "GET_DECKS" }
    | { type: "GET_MODELS" }
    | { type: "GENERATE_CARD" }
    | { type: "CREATE_CARD"; deckName: string; modelName?: string; cards?: DraftCard[] }
    | { type: "CLEAR_CARD" }
    | { type: "SAVE_GEMINI_KEY"; apiKey: string }
    | { type: "DELETE_GEMINI_KEY" }
    | { type: "HAS_GEMINI_KEY" };