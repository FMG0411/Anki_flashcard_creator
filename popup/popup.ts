/* ============================================================================
 * WHAT THIS FILE DOES:
 * - Implements the popup UI logic.
 * - Switches between the manual and the AI mode.
 * - Owns the AI draft run (review/edit/save one card at a time) and persists
 *   it in the session storage so a popup restart resumes the run.
 * - Manages the Gemini API key (save/delete/status display).
 * ============================================================================ */

import {DEFAULT_MODEL} from "../background/types.js";
import type {Card, DraftCard, Message} from "../background/types.js";

type Mode = "manual" | "ai";

// A helper function that finds an HTML element by its ID.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// MODE SELECTION
const manualBtn = $<HTMLButtonElement>("mode-manual-btn");
const aiBtn = $<HTMLButtonElement>("mode-ai-btn");

// MANUAL MODE
const manualPanel = $<HTMLElement>("manual-panel");
const frontInput = $<HTMLTextAreaElement>("front-input");
const backInput = $<HTMLTextAreaElement>("back-input");
const frontImage = $<HTMLImageElement>("front-image");
const backImage = $<HTMLImageElement>("back-image");

// AI MODE
const aiPanel = $<HTMLElement>("ai-panel");
const sourceInput = $<HTMLTextAreaElement>("source-input");
const generateBtn = $<HTMLButtonElement>("generate-btn");
const aiPreview = $<HTMLElement>("ai-preview");
const aiCardProgress = $<HTMLElement>("ai-card-progress");
const aiFrontInput = $<HTMLTextAreaElement>("ai-front-input");
const aiBackInput = $<HTMLTextAreaElement>("ai-back-input");
const aiSaveBtn = $<HTMLButtonElement>("ai-save-btn");
const aiSkipBtn = $<HTMLButtonElement>("ai-skip-btn");

// GEMINI API KEY SECTION
const apiKeyPanel = $<HTMLElement>("api-key-panel");

// CREATE ANKI CARD
const deckSelect = $<HTMLSelectElement>("deck-select");
const createBtn = $<HTMLButtonElement>("create-btn");

// STATUS MESSAGES
const statusMessage = $<HTMLElement>("status-message");

// GEMINI API KEY
const keyInput = $<HTMLInputElement>("gemini-key-input");
const saveKeyBtn = $<HTMLButtonElement>("save-gemini-key-btn");
const deleteKeyBtn = $<HTMLButtonElement>("delete-gemini-key-btn");
const keyStatus = $<HTMLElement>("gemini-key-status");


// Helper function: converts an unknown error into a readable string.
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Something went wrong.";
}

// Shows a status message in the popup.
function setStatus(message: string, error = false): void {
    statusMessage.textContent = message;
    statusMessage.className = error ? "status status--error" : "status";
}

// Remembers the last selected deck and note type for the next popup start.
function rememberSelection(): void {
    void browser.storage.local.set({lastDeck: deckSelect.value, lastModel: modelSelect.value});
}

const modelSelect = $<HTMLSelectElement>("model-select");

// Fills one of the Anki selects (decks or note types): fetches the values from the background, 
// fills the options and restores the last selection or the best preference.
async function fillSelect(
    select: HTMLSelectElement,
    message: Message,
    storageKey: "lastDeck" | "lastModel",
    preferences: string[],
    emptyLabel: string,
    errorLabel: string
): Promise<void> {
    try {
        const values = await Promise.race([
            send<string[]>(message),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5_000))
        ]);
        select.replaceChildren();

        if (!values.length) {
            select.appendChild(new Option(emptyLabel, ""));
            return;
        }

        for (const value of values) {
            select.appendChild(new Option(value, value));
        }

        // Restore the last selection, otherwise the first available preference.
        const stored = await browser.storage.local.get(storageKey);
        const last = typeof stored[storageKey] === "string" ? (stored[storageKey] as string) : "";
        const preferred = [last, ...preferences].find((p) => p && values.includes(p));

        select.value = preferred ?? values[0];
    } catch (error) {
        // Anki is probably not running (or timeout).
        select.replaceChildren(new Option(errorLabel, ""));
        setStatus("Could not connect to Anki. Is it running?", true);
        console.error("Failed to load Anki data:", error);
    }
}

// Loads the list of Anki note types and fills the dropdown menu.
function loadModels(): Promise<void> {
    return fillSelect(
        modelSelect,
        {type: "GET_MODELS"},
        "lastModel",
        [DEFAULT_MODEL, "Basic"],
        "No models available",
        "Could not load models"
    );
}

// Helper function that sends a message to the background.
async function send<T>(message: Message): Promise<T> {
    try {
        return (await browser.runtime.sendMessage(message)) as T;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Receiving end does not exist")) {
            await new Promise(resolve => setTimeout(resolve, 600));
            return (await browser.runtime.sendMessage(message)) as T;
        }
        throw error;
    }
}

// Shows an image in an <img> element or hides it.
function showImage(image: HTMLImageElement, src: string): void {
    image.hidden = !src;

    if (src) {
        image.src = src;
    } else {
        image.removeAttribute("src");
    }
}

// Resets the preview: hide images and clear the AI text fields.
function clearPreview(): void {
    showImage(frontImage, "");
    showImage(backImage, "");

    aiFrontInput.value = "";
    aiBackInput.value = "";

    draftCards = [];
    persistDrafts();
    aiPreview.classList.add("ai-preview--hidden");
}

// AI DRAFTS: state of the one-card-at-a-time run.
// The card currently being edited is always the first in the list (position 0).
let draftCards: DraftCard[] = [];

// Stores the current draft list in the session storage,
// so that a popup restart resumes the run.
function persistDrafts(): void {
    void browser.storage.session.set({draftCards});
}

// Displays the current draft card in the preview (or hides the preview).
function renderCard(): void {
    const card = draftCards[0];

    if (!card) {
        aiPreview.classList.add("ai-preview--hidden");
        return;
    }

    aiFrontInput.value = card.front;
    aiBackInput.value = card.back;
    aiCardProgress.textContent = `${draftCards.length} card${draftCards.length === 1 ? "" : "s"} remaining`;
    aiSaveBtn.textContent = draftCards.length === 1 ? "Save & Finish" : "Save & Next";
    aiPreview.classList.remove("ai-preview--hidden");
}

// Loads drafts when the popup opens and displays the current card.
async function loadDrafts(): Promise<void> {
    try {
        const data = await browser.storage.session.get("draftCards");
        draftCards = Array.isArray(data.draftCards) ? data.draftCards : [];
        renderCard();
    } catch (error) {
        console.error("Failed to load drafts:", error);
    }
}

// Switches between the manual and the AI mode.
function setMode(next: Mode): void {
    const manual = next === "manual";

    manualPanel.classList.toggle("panel--hidden", !manual);
    aiPanel.classList.toggle("panel--hidden",  manual );

    // The API key section: hidden in manual mode, visible in AI mode.
    apiKeyPanel.classList.toggle("panel--hidden", manual);

    // The global "Save Flashcard" button only applies to the manual mode.
    // In AI mode, the buttons in the preview ("Save & Next"/"Skip") take over.
    createBtn.classList.toggle("panel--hidden", !manual);

    manualBtn.classList.toggle("mode-toggle__btn--active", manual );
    aiBtn.classList.toggle("mode-toggle__btn--active", !manual);

    manualBtn.setAttribute("aria-selected", String(manual));
    aiBtn.setAttribute("aria-selected", String(!manual));

    // Reset the status message
    setStatus("");
}

// Event listeners
manualBtn.addEventListener("click",() => setMode("manual"));
aiBtn.addEventListener("click",() => setMode("ai"));

// Loads the current card from the background storage and displays it in the popup. 
// This happens when the popup opens.
async function loadCard(): Promise<void> {
    try {
        const card = await send<Card>({type: "GET_CARD"});

        frontInput.value = card.front;
        backInput.value = card.back;

        // The source text for the AI mode comes with the same response.
        sourceInput.value = card.sourceText;

        // Note: the AI textareas (aiFrontInput/aiBackInput) are NOT
        // filled here – they belong to the draft display (renderCard/loadDrafts).

        showImage(frontImage, card.frontImage);
        showImage(backImage, card.backImage);

    } catch (error) {
        console.error("Failed to load card:", error);
    }
}

// Loads the list of Anki decks and fills the dropdown menu.
function loadDecks(): Promise<void> {
    return fillSelect(
        deckSelect,
        {type: "GET_DECKS"},
        "lastDeck",
        [],
        "No decks available",
        "Could not load decks"
    );
}

// Checks whether an API key is stored and updates the display in the popup accordingly.
async function loadKeyStatus(): Promise<void> {
    try {
        const hasKey = await send<boolean>({type: "HAS_GEMINI_KEY"});

        deleteKeyBtn.disabled = !hasKey;
        keyStatus.textContent = hasKey ? "Gemini key is saved locally." : "No Gemini key saved.";
        keyStatus.className = hasKey ? "api-key-status api-key-status--success" : "api-key-status";
    } catch (error) {
        keyStatus.textContent = "Could not check Gemini key.";
        keyStatus.className = "api-key-status api-key-status--error";

        console.error("Failed to check Gemini key:", error);
    }
}

// Event listener: save the API key.
saveKeyBtn.addEventListener(
    "click",
    async () => {
        const key = keyInput.value.trim();

        if (!key) {
            keyStatus.textContent = "Enter a Gemini API key first.";
            keyStatus.className = "api-key-status api-key-status--error";
            return;
        }

        saveKeyBtn.disabled = true;

        try {
            await send({type: "SAVE_GEMINI_KEY", apiKey: key});

            // After success, clear the input field and update the status.
            keyInput.value = "";
            deleteKeyBtn.disabled = false;
            keyStatus.textContent = "Gemini key saved locally.";
            keyStatus.className = "api-key-status api-key-status--success";
        } catch (error) {
            keyStatus.textContent = errorMessage(error);
            keyStatus.className = "api-key-status api-key-status--error";
        } finally {
            saveKeyBtn.disabled = false;
        }
    }
);

// Event listener: delete the API key.
deleteKeyBtn.addEventListener(
    "click",
    async () => {
        deleteKeyBtn.disabled = true;

        try {
            await send({type: "DELETE_GEMINI_KEY"});

            keyInput.value = "";
            keyStatus.textContent = "Gemini key deleted.";
            keyStatus.className = "api-key-status";
        } catch (error) {
            keyStatus.textContent = errorMessage(error);
            keyStatus.className = "api-key-status api-key-status--error";
            deleteKeyBtn.disabled = false;
        }
    }
);

// Apply edited values directly to the currently displayed draft card.
aiFrontInput.addEventListener("input", () => {
    const card = draftCards[0];
    if (card) {
        card.front = aiFrontInput.value;
        persistDrafts();
    }
});
aiBackInput.addEventListener("input", () => {
    const card = draftCards[0];
    if (card) {
        card.back = aiBackInput.value;
        persistDrafts();
    }
});

// "Save & Next"/"Save & Finish": save the current card to Anki, then continue.
aiSaveBtn.addEventListener("click", async () => {
    const card = draftCards[0];

    if (!card || !card.front.trim() || !card.back.trim()) {
        setStatus("Front and back must not be empty.", true);
        return;
    }

    aiSaveBtn.disabled = true;

    try {
        if (!deckSelect.value) {
            throw new Error("Choose a deck first.");
        }

        await send({
            type: "CREATE_CARD",
            deckName: deckSelect.value,
            modelName: modelSelect.value || undefined,
            cards: [{front: card.front, back: card.back}]
        });

        rememberSelection();

        // Card is saved → remove it from the run and show the next one.
        draftCards.shift();
        persistDrafts();

        if (draftCards.length === 0) {
            aiPreview.classList.add("ai-preview--hidden");
            setStatus("All cards saved.");
            return;
        }

        renderCard();
        setStatus("");
    } catch (error) {
        setStatus(errorMessage(error), true);
    } finally {
        aiSaveBtn.disabled = false;
    }
});

// "Skip": discard the current card (do not save) and continue.
aiSkipBtn.addEventListener("click", () => {
    draftCards.shift();
    persistDrafts();

    if (draftCards.length === 0) {
        aiPreview.classList.add("ai-preview--hidden");
        setStatus("No cards left. Generate new ones.");
        return;
    }

    renderCard();
    setStatus("");
});

// Event listener: generate AI cards.
generateBtn.addEventListener(
    "click",
    async () => {
        const source = sourceInput.value.trim();

        if (!source) {
            setStatus("No source text was captured.", true);
            return;
        }

        generateBtn.disabled = true;
        setStatus("Generating…");

        // Progressive feedback after 10s
        const stillWorkingTimer = setTimeout(
            () => setStatus("Still generating…"),
            10_000
        );

        try {
            // First, the source text is stored in the background, kept ready for generation.
            await send({type: "SET_SOURCE", text: source});

            // The background calls the AI and returns an array of generated cards.
            const cards = await send<DraftCard[]>({type: "GENERATE_CARD"});

            // Adopt the cards as the current run and display the first one.
            draftCards = cards;
            persistDrafts();
            renderCard();

            setStatus(`${cards.length} cards generated. Review, edit or save each card.`);
        } catch (error) {
            if (error instanceof Error && error.name === "TimeoutError") {
                setStatus("Gemini took too long to respond. Please try again.", true);
            } else {
                setStatus(errorMessage(error), true);
            }
        } finally {
            clearTimeout(stillWorkingTimer);
            generateBtn.disabled = false;
        }
    }
);

// Event listener: create the card in Anki.
createBtn.addEventListener(
    "click",
    async () => {
        createBtn.disabled = true;

        try {
            // Always send, even empty fields. Inputs deleted in the storage are really removed.
            await send({type: "SET_FRONT", text: frontInput.value});
            await send({type: "SET_BACK", text: backInput.value});

            // Check: a deck must be selected.
            if (!deckSelect.value) {
                throw new Error("Choose a deck first.");
            }

            await send({type: "CREATE_CARD", deckName: deckSelect.value, modelName: modelSelect.value || undefined});

            // Remember the last deck and note type
            rememberSelection();

            // After successful creation: reset everything
            await send({type: "CLEAR_CARD"});
            frontInput.value = "";
            backInput.value = "";
            sourceInput.value = "";

            clearPreview();

            setStatus("Flashcard created.");
        } catch (error) {
            setStatus(errorMessage(error), true);
        } finally {
            createBtn.disabled = false;
        }
    }
);

// Initialization function
async function init(): Promise<void> {
    await Promise.all([
        loadCard(),
        loadDecks(),
        loadModels(),
        loadKeyStatus(),
        loadDrafts()
    ]);
}

void init();
