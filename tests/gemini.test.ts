import { describe, expect, test } from "vitest";
import { assertNoApiKey, containsApiKey } from "../background/gemini.js";

describe("containsApiKey", () => {
    test("finds the exact key inside a text", () => {
        const key = "AIzaSyExampleKey1234567890";

        expect(containsApiKey(`Here is my key: ${key}`, key)).toBe(true);
    });

    test("finds any Gemini key pattern, even a different one", () => {
        expect(containsApiKey("leaked: AIzaAbC123xyz_-4567890123", "another-key")).toBe(true);
    });

    test("returns false for normal card text", () => {
        expect(containsApiKey("The capital of France is Paris.", "")).toBe(false);
    });
});

describe("assertNoApiKey", () => {
    test("throws when the text contains the key", () => {
        const run = () => assertNoApiKey("key: AIzaAbC123xyz_-4567890123", "k", "Front");

        expect(run).toThrow("Front");
    });

    test("allows text without a key", () => {
        const run = () => assertNoApiKey("2 + 2 = 4", "k", "Front");

        expect(run).not.toThrow();
    });
});
