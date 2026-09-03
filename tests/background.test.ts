// The browser platform itself is replaced by a small copy (storage + message listener registration). 
// Everything else behind it (validation, storage logic, leak checks) runs for real.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Message } from "../background/types.js";

// A small copy of browser.storage (session and local).
function makeStorage() {
    const data = new Map<string, unknown>();

    return {
        get: async (keys: string | string[]) => {
            const wanted = typeof keys === "string" ? [keys] : keys;
            const found: Record<string, unknown> = {};

            for (const key of wanted) {
                if (data.has(key)) { found[key] = data.get(key); }
            }
            return found;
        },
        set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) { data.set(key, value); }
        },
        remove: async (keys: string | string[]) => {
            for (const key of typeof keys === "string" ? [keys] : keys) { data.delete(key); }
        },
        clear: () => data.clear()
    };
}

const session = makeStorage();
const local = makeStorage();

// The listener that background.ts registers.
let listener: ((message: Message) => Promise<unknown>) | undefined;

vi.stubGlobal("browser", {
    storage: {session, local},
    runtime: {onMessage: {addListener: (fn: (message: Message) => Promise<unknown>) => { listener = fn; }}}
});

// background.ts registers its listener at import time, so this import must happen after the browser stub above exists.
await import("../background/background.js");

// Sends a message through the real listener, like the popup would.
function send(message: Message): Promise<unknown> {
    if (!listener) {
        throw new Error("The message listener was not registered.");
    }
    return listener(message);
}

beforeEach(() => {
    session.clear();
    local.clear();
});

describe("background message hub", () => {
    test("SET_FRONT saves text and GET_CARD returns it", async () => {
        await send({type: "SET_FRONT", text: "Berlin"});

        const card = await send({type: "GET_CARD"}) as {front: string; back: string};

        expect(card.front).toBe("Berlin");
        expect(card.back).toBe("");
    });

    test("rejects text that is too long", async () => {
        const run = () => send({type: "SET_FRONT", text: "a".repeat(20_001)});

        await expect(run).rejects.toThrow("Text is too long.");
    });

    test("SET_IMAGE rejects data that is not an image", async () => {
        const run = () => send({type: "SET_IMAGE", target: "front", image: "not-an-image"});

        await expect(run).rejects.toThrow("supported image");
    });

    test("the Gemini key can be saved and deleted", async () => {
        expect(await send({type: "HAS_GEMINI_KEY"})).toBe(false);

        await send({type: "SAVE_GEMINI_KEY", apiKey: "test-key-12345"});
        expect(await send({type: "HAS_GEMINI_KEY"})).toBe(true);

        await send({type: "DELETE_GEMINI_KEY"});
        expect(await send({type: "HAS_GEMINI_KEY"})).toBe(false);
    });

    test("refuses to save a key that is already inside the card", async () => {
        await send({type: "SET_FRONT", text: "My key is test-key-12345"});

        const run = () => send({type: "SAVE_GEMINI_KEY", apiKey: "test-key-12345"});

        await expect(run).rejects.toThrow("Remove the API key from the card/source first.");
    });
});
