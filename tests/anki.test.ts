// A small local HTTP server is used and answers exactly like AnkiConnect does (JSON with {result, error})

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, test } from "vitest";
import type { Card } from "../background/types.js";

// Every request the adapter sends is recorded here, so the tests can check what actually arrived at Anki.
const requests: Array<{action: string; params: Record<string, unknown>}> = [];

let nextNoteId = 1234;
let ankiError: string | null = null;

// The fake AnkiConnect: a real HTTP server with a few known answers.
const server: Server = createServer((request, response) => {
    let body = "";

    request.on("data", (chunk: string) => { body += chunk; });

    request.on("end", () => {
        const {action, params} = JSON.parse(body) as {action: string; params: Record<string, unknown>};
        requests.push({action, params});

        let result: unknown = null;
        if (action === "deckNames") {
            result = ["Default", "Test deck"];
        } else if (action === "modelFieldNames") {
            result = ["Front", "Back"];
        } else if (action === "addNote") {
            result = nextNoteId;
        }

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({result, error: ankiError}));
    });
});

// The adapter must be imported AFTER the server runs and ANKI_URL is set.
await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
process.env.ANKI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const {createAnkiCard, getAnkiDecks} = await import("../background/anki.js");

beforeEach(() => {
    requests.length = 0;
    nextNoteId = 1234;
    ankiError = null;
});

describe("anki adapter (against a real local HTTP server)", () => {
    test("fetches the deck names from Anki", async () => {
        const decks = await getAnkiDecks();

        expect(decks).toEqual(["Default", "Test deck"]);
    });

    test("creates a card: escapes HTML, converts line breaks and extracts the image", async () => {
        const card: Card = {
            front: "3 < 10",
            back: "line one\nline two",
            frontImage: "data:image/png;base64,QUJD",
            backImage: "",
            sourceText: ""
        };

        const noteId = await createAnkiCard(card, "Default");

        // The fake Anki answered with a real note id.
        expect(noteId).toBe(1234);

        // What actually arrived at Anki?
        const note = requests[requests.length - 1].params.note as {
            deckName: string;
            modelName: string;
            fields: Record<string, string>;
            picture: Array<{data: string; fields: string[]}>;
        };

        // "<" must be escaped, otherwise Anki swallows the rest of the line.
        expect(note.fields.Front).toBe("3 &lt; 10");

        // A line break becomes a real <br> tag.
        expect(note.fields.Back).toBe("line one<br>line two");
        expect(note.deckName).toBe("Default");
        expect(note.modelName).toBe("Einfach");

        // Only the base64 part after the comma is sent.
        expect(note.picture[0].data).toBe("QUJD");
        expect(note.picture[0].fields).toEqual(["Front"]);
    });

    test("reports a duplicate card (AnkiConnect answers with noteId 0)", async () => {
        nextNoteId = 0;

        const card: Card = {front: "front", back: "back", frontImage: "", backImage: "", sourceText: ""};
        const run = () => createAnkiCard(card, "Default");

        await expect(run).rejects.toThrow("already exists");
    });

    test("passes Anki's own error message on", async () => {
        ankiError = "deck was not found";

        await expect(getAnkiDecks()).rejects.toThrow("deck was not found");
    });
});
