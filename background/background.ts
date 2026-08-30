/* ============================================================================
 * WAS SIE MACHT:
 * - Empfängt Nachrichten vom Popup und vom Content Script.
 * - Speichert Karten-Daten temporär im Arbeitsspeicher (session storage).
 * - Ruft anki.ts auf, um mit Anki zu sprechen.
 * - Ruft gemini.ts auf, um KI-generierte Karten zu erstellen.
 * - Prüft Berechtigungen und schützt den API-Key.
 * ============================================================================ */

import {getAnkiDecks, createAnkiCard, getAnkiModels} from "./anki.js";
import {generateCardFromText} from "./gemini.js";

// Diese Konstante enthält die Namen aller Felder, die wir im
// session storage speichern. Der session storage vergisst alles,
// wenn der Browser geschlossen wird
const CARD_KEYS = [
    "front",
    "frontImage",
    "back",
    "backImage",
    "sourceText"
];

const MAX_TEXT = 20_000;
const MAX_SOURCE = 100_000;
const MAX_IMAGE = 3_000_000;

type Card = {
    front: string;
    frontImage: string;
    back: string;
    backImage: string;
    sourceText: string;
};

/**
 * Ein "Union Type" – das bedeutet: Eine Nachricht (Message)
 * kann EINE von vielen Formen haben. TypeScript prüft dann
 * automatisch, welche Form es ist, je nachdem, welches
 * "type"-Feld gesetzt ist.
 */
type Message =
    | { type: "SET_FRONT"; text: string }
    | { type: "SET_BACK"; text: string }
    | { type: "SET_SOURCE"; text: string }
    | { type: "SET_IMAGE"; target: "front" | "back"; image: string }
    | { type: "GET_CARD" }
    | { type: "GET_SOURCE" }
    | { type: "GET_DECKS" }
    | { type: "GET_MODELS" }
    | { type: "SET_MODEL"; modelName: string }
    | { type: "GENERATE_CARD" }
    | { type: "CREATE_CARD"; deckName: string }
    | { type: "CLEAR_CARD" }
    | { type: "SAVE_GEMINI_KEY"; apiKey: string }
    | { type: "DELETE_GEMINI_KEY" }
    | { type: "HAS_GEMINI_KEY" };

// Lädt die aktuell gespeicherte Karte aus dem session storage.
async function getCard(): Promise<Card> {
    // browser.storage.session.get() holt mehrere Werte auf einmal.
    const data = await browser.storage.session.get(CARD_KEYS);

    // Prüft ob Front und Back gesetzt sind und gibt dann die Karte zurück.
    return {
        front: typeof data.front === "string" ? data.front : "",
        frontImage: typeof data.frontImage === "string" ? data.frontImage : "",
        back: typeof data.back === "string" ? data.back : "",
        backImage: typeof data.backImage === "string" ? data.backImage : "",
        sourceText: typeof data.sourceText === "string" ? data.sourceText : ""
    };
}

// Lädt den gespeicherten Gemini API-Key aus dem LOCAL storage.
async function getGeminiKey(): Promise<string> {
    const data = await browser.storage.local.get("geminiApiKey");
    return typeof data.geminiApiKey === "string" ? data.geminiApiKey.trim() : "";
}

/**
 * Eine Hilfsfunktion, die einen beliebigen Wert validiert:
 *
 * @param value – Der Wert, der geprüft werden soll.
 * @param limit – Maximale erlaubte Länge.
 * @returns     – Der getrimmte String.
 */
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

// Prüft, ob ein Text den API-Key enthält.
// Der Key fängt immer mit "AIza" an, gefolgt von mindestens 20 Zeichen.
function containsKey(value: string, key: string): boolean {
    return !!key && (value.includes(key) || /AIza[0-9A-Za-z_-]{20,}/.test(value));
}

// Wirft einen Fehler, wenn der Text den API-Key enthält.
function protect(value: string, key: string, name: string): void {
    if (containsKey(value, key)) {
        throw new Error(`${name} appears to contain the Gemini API key.`);
    }
}

// Speichert Text in einem der drei Textfelder (front, back, sourceText).
async function saveText(field: "front" | "back" | "sourceText", value: string, limit: number): Promise<void> {
    const valueText = text(value, limit);
    const key = await getGeminiKey();

    if (key) {
        protect(valueText, key, field);
    }

    // Checkt, ob der Text den API-Key enthält.
    await browser.storage.session.set({[field]: valueText});
}

// Speichert ein Bild für die Vorder- oder Rückseite.
async function saveImage(target: "front" | "back", image: string): Promise<Card> {
    if (!image.startsWith("data:image/") || image.length > MAX_IMAGE) {
        throw new Error(image.length > MAX_IMAGE ? "Screenshot is too large." : "Clipboard does not contain a supported image.");
    }

    await browser.storage.session.set({[`${target}Image`]: image});
    return getCard();
}

// Der Nachrichten-Listener.
// message – Die eigentliche Nachricht (welcher Typ, welche Daten).
// sender – Wird nicht benutzt.
browser.runtime.onMessage.addListener(
    async (message: Message, _sender) => {

        switch (message.type) {
            case "GET_MODELS":
                return getAnkiModels();
            case "SET_MODEL":
                await browser.storage.session.set({ modelName: message.modelName });
                return;

            case "SET_FRONT":
                return saveText("front", message.text, MAX_TEXT);
            case "SET_BACK":
                return saveText("back", message.text, MAX_TEXT);
            case "SET_SOURCE":
                return saveText("sourceText", message.text, MAX_SOURCE);

            case "SET_IMAGE":
                return saveImage(message.target, message.image);

            case "GET_CARD":
                {
                    const card = await getCard();
                    return {
                        front: card.front,
                        frontImage: card.frontImage,
                        back: card.back,
                        backImage: card.backImage
                    };
                }
            case "GET_SOURCE":
                {
                    const data = await browser.storage.session.get("sourceText");
                    return {sourceText: typeof data.sourceText === "string" ? data.sourceText : ""};
                }
            case "GET_DECKS":
                return getAnkiDecks();

            case "GENERATE_CARD":
                {
                    const card = await getCard();
                    const key = await getGeminiKey();

                    if (!key) {
                        throw new Error("Gemini API key is not configured.");
                    }
                    if (!card.sourceText) {
                        throw new Error("No source text was captured.");
                    }
                    protect(card.sourceText, key, "Source text");

                    // Gemini-API, um aus dem Quelltext eine Kartezu machen. 
                    const generated = await generateCardFromText(card.sourceText, key);

                    // Sicherheitsprüfungen nach der Kartenerstellung
                    protect(generated.front, key, "Generated Front");
                    protect(generated.back, key, "Generated Back");

                    // Generierte Karte wird im session storage gespeichert, damit das Popup sie anzeigenkann. 
                    // Bilder werden gelöscht, weil die KI nur Text generiert.
                    await browser.storage.session.set({
                        front: generated.front,
                        frontImage: "",
                        back: generated.back,
                        backImage: ""
                    });
                    return generated;
                }

            case "CREATE_CARD":
                {
                    const card = await getCard();
                    if (!card.front && !card.frontImage) {
                        throw new Error("Front is empty.");
                    }
                    if (!card.back && !card.backImage) {
                        throw new Error("Back is empty.");
                    }

                    const key = await getGeminiKey();

                    // Sicherheitsprüfung: Bevor die Karte an Anki geschickt wird.
                    if (key) {
                        protect(card.front, key, "Front");
                        protect(card.back, key, "Back");
                    }

                    // Kartentyp aus Storage holen oder Fallback
                    const modelData = await browser.storage.session.get("modelName");
                    const modelName = typeof modelData.modelName === "string" ? modelData.modelName : "Einfach";

                    return createAnkiCard(card, message.deckName, modelName);
                }

            case "CLEAR_CARD":
                return browser.storage.session.remove(CARD_KEYS);

            case "SAVE_GEMINI_KEY":
                {
                    const key = text(message.apiKey, 4096);
                    const card = await getCard();

                    if (
                        containsKey(card.front, key) ||
                        containsKey(card.back, key) ||
                        containsKey(card.sourceText, key)
                    ) {
                        throw new Error("Remove the API key from the card/source first.");
                    }

                    // Key wird nur im LOCAL storage gespeichert, damit er dauerhaft verfügbar ist.
                    await browser.storage.local.set({geminiApiKey: key});
                    return;
                }

            case "DELETE_GEMINI_KEY":
                // Löscht den API-Key aus dem local storage.
                return browser.storage.local.remove("geminiApiKey");

            case "HAS_GEMINI_KEY":
                // Gibt true zurück, wenn ein API-Key existiert, sonst false.
                return !!(await getGeminiKey());
        }
    }
);

// Ein Alarm alle 20 Sekunden hält den Worker am Leben, damit das Popup jederzeit mit ihm kommunizieren kann.
browser.alarms.create("keepAlive", { periodInMinutes: 0.33 });

browser.alarms.onAlarm.addListener(() => {
    // Der Alarm selbst weckt den Worker. Wir müssen nichts tun.
});