import {getAnkiDecks, createAnkiCard, getAnkiModels} from "./anki.js";
import {generateCardFromText, assertNoApiKey, containsApiKey} from "./gemini.js";
import type {Card, Message} from "./types.js";

/* ============================================================================
 * WHAT THIS FILE DOES:
 * - Central message hub of the extension: handles all messages from the
 *   popup and the content script.
 * - Manages the card state (text/images/source text) in the session storage
 *   and the Gemini API key in the local storage.
 * - Forwards card creation to the Anki adapter and card generation to Gemini.
 * ============================================================================ */

const MANUAL_CARD_KEYS = ["front", "frontImage", "back", "backImage"] as const;
const CARD_KEYS: string[] = [...MANUAL_CARD_KEYS, "sourceText", "draftCards"];

const MAX_TEXT = 20_000;
const MAX_SOURCE = 100_000;
const MAX_IMAGE = 3_000_000;

// Loads the currently stored card from the session storage.
async function getCard(): Promise<Card> {
    const data = await browser.storage.session.get(CARD_KEYS);

    // Checks whether front and back are set and then returns the card.
    return {
        front: typeof data.front === "string" ? data.front : "",
        frontImage: typeof data.frontImage === "string" ? data.frontImage : "",
        back: typeof data.back === "string" ? data.back : "",
        backImage: typeof data.backImage === "string" ? data.backImage : "",
        sourceText: typeof data.sourceText === "string" ? data.sourceText : ""
    };
}

// Loads the stored Gemini API key from the LOCAL storage.
async function getGeminiKey(): Promise<string> {
    const data = await browser.storage.local.get("geminiApiKey");
    return typeof data.geminiApiKey === "string" ? data.geminiApiKey.trim() : "";
}

// Validates a string: must not be empty and not longer than `limit`.
function text(value: unknown, limit: number): string {
    if (typeof value !== "string") {
        throw new Error("Invalid text.");
    }

    const result = value.trim();

    if (!result) {
        throw new Error("Text cannot be empty.");
    }
    if (result.length > limit) {
        throw new Error("Text is too long.");
    }
    return result;
}

// Throws if the card content contains the API key
function protectCardContent(front: string, back: string, key: string): void {
    if (key) {
        assertNoApiKey(front, key, "Front");
        assertNoApiKey(back, key, "Back");
    }
}

// Stores text in one of the three text fields (front, back, sourceText).
// An empty string is allowed: this way a field can also be cleared again in the popup
async function saveText(field: "front" | "back" | "sourceText", value: string, limit: number): Promise<void> {
    const valueText = typeof value === "string" && value.trim() ? text(value, limit) : "";

    const key = await getGeminiKey();
    if (key) {
        assertNoApiKey(valueText, key, field);
    }
    await browser.storage.session.set({[field]: valueText});
}

// Stores an image for the front or back side.
async function saveImage(target: "front" | "back", image: string): Promise<void> {
    if (!image.startsWith("data:image/") || image.length > MAX_IMAGE) {
        throw new Error(image.length > MAX_IMAGE ? "Screenshot is too large." : "Clipboard does not contain a supported image.");
    }
    await browser.storage.session.set({[`${target}Image`]: image});
}

// The message listener.
// message – (which type, which data).
// sender – Not used.
browser.runtime.onMessage.addListener(
    async (message: Message, _sender) => {

        switch (message.type) {
            case "GET_MODELS":
                return getAnkiModels();
            case "SET_FRONT":
                return saveText("front", message.text, MAX_TEXT);
            case "SET_BACK":
                return saveText("back", message.text, MAX_TEXT);
            case "SET_SOURCE":
                return saveText("sourceText", message.text, MAX_SOURCE);
            case "SET_IMAGE":
                return saveImage(message.target, message.image);
            case "GET_CARD":
                return getCard();
            case "GET_DECKS":
                return getAnkiDecks();
            case "GENERATE_CARD":
                {
                    // Only the source text is needed here, not the whole card.
                    const data = await browser.storage.session.get("sourceText");
                    const sourceText = typeof data.sourceText === "string" ? data.sourceText : "";
                    const key = await getGeminiKey();

                    if (!key) {
                        throw new Error("Gemini API key is not configured.");
                    }
                    if (!sourceText) {
                        throw new Error("No source text was captured.");
                    }
                    assertNoApiKey(sourceText, key, "Source text");

                    // Calls the Gemini API to turn the source text into flashcards.
                    const generated = await generateCardFromText(sourceText, key);

                    // Security checks after the cards have been generated (per card).
                    for (const draft of generated) {
                        assertNoApiKey(draft.front, key, "Generated Front");
                        assertNoApiKey(draft.back, key, "Generated Back");
                    }
                    return generated;
                }
            case "CREATE_CARD":
                {
                    const key = await getGeminiKey();

                    // AI mode: create multiple cards in one go.
                    if (Array.isArray(message.cards) && message.cards.length > 0) {
                        const results: number[] = [];

                        for (const draft of message.cards) {
                            if (!draft.front.trim() || !draft.back.trim()) {
                                throw new Error("Front and back must not be empty.");
                            }

                            // Security check: before the card is sent to Anki.
                            protectCardContent(draft.front, draft.back, key);

                            const card: Card = {
                                front: draft.front,
                                back: draft.back,
                                frontImage: "",
                                backImage: "",
                                sourceText: ""
                            };

                            results.push(await createAnkiCard(card, message.deckName, message.modelName));
                        }

                        // After a successful AI run, remove stale manual card
                        // data from the session storage so that no old
                        // front/back value later accidentally ends up in the manual mode.
                        await browser.storage.session.remove([...MANUAL_CARD_KEYS]);

                        return results.length;
                    }

                    // Manual mode: single card from the session storage (including images).
                    const card = await getCard();
                    if (!card.front && !card.frontImage) {
                        throw new Error("Front is empty.");
                    }
                    if (!card.back && !card.backImage) {
                        throw new Error("Back is empty.");
                    }

                    // Security check: before the card is sent to Anki.
                    protectCardContent(card.front, card.back, key);

                    // Take the note type directly from the message.
                    return createAnkiCard(card, message.deckName, message.modelName);
                }
            case "CLEAR_CARD":
                return browser.storage.session.remove(CARD_KEYS);
            case "SAVE_GEMINI_KEY":
                {
                    const key = text(message.apiKey, 4096);
                    const card = await getCard();

                    if (
                        containsApiKey(card.front, key) ||
                        containsApiKey(card.back, key) ||
                        containsApiKey(card.sourceText, key)
                    ) {
                        throw new Error("Remove the API key from the card/source first.");
                    }

                    // The key is only stored in the LOCAL storage so that it is permanently available.
                    await browser.storage.local.set({geminiApiKey: key});
                    return;
                }
            case "DELETE_GEMINI_KEY":
                return browser.storage.local.remove("geminiApiKey");
            case "HAS_GEMINI_KEY":
                return !!(await getGeminiKey());
        }
    }
);
