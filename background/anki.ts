/* ============================================================================
 * WHAT THIS FILE DOES:
 * - Communication layer with AnkiConnect, Anki's local HTTP API
 *   (http://127.0.0.1:8765).
 * - Fetches deck names, model (note type) names and note type field names
 *   (field lookups are cached per model).
 * - Creates new Anki notes from a card, including optional front/back images.
 * ============================================================================ */

import {DEFAULT_MODEL} from "./types.js";
import type {Card} from "./types.js";

// "127.0.0.1" is the localhost IP address.
const env = (globalThis as unknown as {process?: {env: Record<string, string | undefined>}}).process?.env;

// The ANKI_URL environment variable exists only for the tests: they run the
// adapter against a real local HTTP server instead of a mocked fetch.
const ANKI_URL = env?.ANKI_URL ?? "http://127.0.0.1:8765";

// An interface for the response AnkiConnect sends back.
interface AnkiResponse<T> {
    result: T;
    error: string | null;
}

export function getAnkiModels(): Promise<string[]> {
    return invoke<string[]>("modelNames");
}

// Cache: the field names of a note type practically never change.
// In AI mode with multiple cards, this saves one HTTP request to AnkiConnect per card.
const fieldsCache = new Map<string, Promise<string[]>>();

// Only for tests: empties the cache between test cases.
export function resetAnkiFieldsCache(): void {
    fieldsCache.clear();
}

export function getAnkiModelFields(modelName: string): Promise<string[]> {
    let cached = fieldsCache.get(modelName);
    if (!cached) {
        cached = invoke<string[]>("modelFieldNames", {modelName}).catch((error) => {
            fieldsCache.delete(modelName);
            throw error;
        });
        fieldsCache.set(modelName, cached);
    }
    return cached;
}

/**
 * The heart of the communication with AnkiConnect: sends a command
 * and waits for the response.
 *
 * @param action – The name of the command that AnkiConnect understands
 *                 (e.g. "deckNames" or "addNote").
 * @param params – An empty object {} by default, if no parameters are needed.
 *
 * @returns      – A promise with the result of type T.
 */
async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const response =
        await fetch(
            ANKI_URL,
            {
                method: "POST",
                headers: {"Content-Type":"application/json"},
                body: JSON.stringify({action, version: 6, params})
            }
        );
    if (!response.ok) {
        throw new Error(`AnkiConnect HTTP error: ${response.status}`);
    }

    const data = await response.json() as AnkiResponse<T>;

    if (data.error !== null) {
        throw new Error(data.error || "AnkiConnect error.");
    }
    return data.result;
}

// Asks Anki for all available decks.
export function getAnkiDecks(): Promise<string[]> {
    return invoke<string[]>("deckNames");
}

/**
 * A helper function that extracts the pure Base64 part from a data URL.
 * Data URLs look like this: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 * But AnkiConnect needs ONLY the part after the comma.
 *
 * @param dataUrl – The complete data URL (e.g. from the clipboard).
 * @returns       – Only the Base64 part after the comma.
 */
function base64(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");

    if (comma < 0) {
        throw new Error("Invalid image data.");
    }

    // Cuts off everything before and including the comma and returns the rest.
    return dataUrl.slice(comma + 1);
}

// Escapes HTML special characters so that stray <, > and & from the source text
// cannot be interpreted as markup by Anki's HTML renderer. Without this, fragments
// like "3 < 10" swallow the rest of the line and the card becomes unreadable.
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Converts line breaks into HTML <br> tags
function toHtmlLineBreaks(text: string): string {
    // Escape first, THEN normalize/convert: this way the <br> tags we insert
    // ourselves stay real markup while all user/AI text is inert.
    const normalized = escapeHtml(text).replace(/\r\n?/g, "\n");

    return normalized.replace(/\n/g, "<br>");
}

// Determines the front and back fields of an Anki note type.
function resolveCardFields(fields: string[]): {
    frontField: string;
    backField: string;
} {
    if (fields.length < 2) {
        throw new Error("The selected Anki note type must have at least two fields.");
    }

    return {frontField: fields[0], backField: fields[1]};
}

export async function createAnkiCard(card: Card, deckName: string, modelName: string = DEFAULT_MODEL): Promise<number> {
    const modelFields = await getAnkiModelFields(modelName);
    const {frontField, backField} = resolveCardFields(modelFields);

    // AnkiConnect already creates the note with all fields empty (empty string),
    // so it is enough to set only the front and back fields.
    const fields: Record<string, string> = {
        [frontField]: toHtmlLineBreaks(card.front),
        [backField]: toHtmlLineBreaks(card.back)
    };

    const pictures = [];

    if (card.frontImage) {
        pictures.push({
            filename: `anki-front-${Date.now()}.png`,
            data: base64(card.frontImage),
            fields: [frontField]
        });
    }

    if (card.backImage) {
        pictures.push({
            filename: `anki-back-${Date.now()}.png`,
            data: base64(card.backImage),
            fields: [backField]
        });
    }

    const noteId = await invoke<number>(
        "addNote",
        {
            note: {
                deckName,
                modelName,
                fields,
                ...(pictures.length ? {picture: pictures} : {})
            }
        }
    );

    // AnkiConnect returns 0 when the note is a duplicate (no error, but no new card).
    if (noteId === 0) {
        throw new Error("This flashcard already exists in the selected deck.");
    }
    return noteId;
}
