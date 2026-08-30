type Mode = "manual" | "ai";

// sourceText fehlt hier, weil das über GET_SOURCE separat abgeholt wird.
type Card = {
    front: string;
    frontImage: string;
    back: string;
    backImage: string;
};

// Eine Hilfsfunktion, die ein HTML-Element anhand seiner ID sucht.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// MODUS-AUSWAHL
const manualBtn = $<HTMLButtonElement>("mode-manual-btn");
const aiBtn = $<HTMLButtonElement>("mode-ai-btn");

// MANUELLER MODUS
const manualPanel = $<HTMLElement>("manual-panel");
const frontInput = $<HTMLTextAreaElement>("front-input");
const backInput = $<HTMLTextAreaElement>("back-input");
const frontImage = $<HTMLImageElement>("front-image");
const backImage = $<HTMLImageElement>("back-image");

// KI-MODUS
// Die Vorschau besteht aus bearbeitbaren Textfeldern: 
// Nach der Generierung kann der Nutzer den Inhalt vor dem Erstellen noch ändern.
const aiPanel = $<HTMLElement>("ai-panel");
const sourceInput = $<HTMLTextAreaElement>("source-input");
const generateBtn = $<HTMLButtonElement>("generate-btn");
const aiPreview = $<HTMLElement>("ai-preview");
const aiFrontInput = $<HTMLTextAreaElement>("ai-front-input");
const aiBackInput = $<HTMLTextAreaElement>("ai-back-input");

// GEMINI API-KEY-BEREICH
const apiKeyPanel = $<HTMLElement>("api-key-panel");

// ANKI-KARTE ERSTELLEN
const deckSelect = $<HTMLSelectElement>("deck-select");
const createBtn = $<HTMLButtonElement>("create-btn");

// STATUSMELDUNGEN
const statusMessage = $<HTMLElement>("status-message");

// GEMINI API-KEY
const keyInput = $<HTMLInputElement>("gemini-key-input");
const saveKeyBtn = $<HTMLButtonElement>("save-gemini-key-btn");
const deleteKeyBtn = $<HTMLButtonElement>("delete-gemini-key-btn");
const keyStatus = $<HTMLElement>("gemini-key-status");


// Hilfsfunktion: Wandelt einen unbekannten Fehler in einen lesbaren String um.
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Something went wrong.";
}

// Zeigt eine Statusmeldung im Popup an.
function setStatus(message: string, error = false): void {
    statusMessage.textContent = message;
    statusMessage.className = error ? "status status--error" : "status";
}

const modelSelect = $<HTMLSelectElement>("model-select");

async function loadModels(): Promise<void> {
    try {
        const models = await Promise.race([
            send<string[]>({ type: "GET_MODELS" }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5_000))
        ]);
        modelSelect.replaceChildren();

        if (!models.length) {
            modelSelect.appendChild(new Option("No models available", ""));
            return;
        }

        for (const m of models) {
            modelSelect.appendChild(new Option(m, m));
        }

        // Letzten Kartentyp wiederherstellen
        const last = await browser.storage.local.get("lastModel");
        if (typeof last.lastModel === "string" && models.includes(last.lastModel)) {
            modelSelect.value = last.lastModel;
        } else if (models.includes("Einfach")) {
            modelSelect.value = "Einfach";
        } else if (models.includes("Basic")) {
            modelSelect.value = "Basic";
        } else {
            modelSelect.value = models[0];
        }
    } catch {
        // Das komplette "Note Type"-Feld aus der UI entfernen bei Timeout/Fehler.
        modelSelect.closest("label")?.remove();
    }
}


// Hilfsfunktion, die eine Nachricht an den Background schickt.
async function send<T>(message: object): Promise<T> {
    try {
        return await browser.runtime.sendMessage(message) as Promise<T>;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Receiving end does not exist")) {
            await new Promise(resolve => setTimeout(resolve, 600));
            return await browser.runtime.sendMessage(message) as T;
        }
        throw error;
    }
}


// Zeigt ein Bild in einem <img>-Element an oder versteckt es.
function showImage(image: HTMLImageElement, src: string): void {
    image.hidden = !src;

    if (src) {
        image.src = src;
    } else {
        image.removeAttribute("src");
    }
}


// Setzt die Vorschau zurück: Bilder verstecken und KI-Textfelder leeren bei erfolgreicher Kartenerstellung.
function clearPreview(): void {
    showImage(frontImage, "");
    showImage(backImage, "");

    aiFrontInput.value = "";
    aiBackInput.value = "";

    aiPreview.classList.add("ai-preview--hidden");
}


// Wechselt zwischen manuellem und KI-Modus.
function setMode(next: Mode): void {
    const manual = next === "manual";

    manualPanel.classList.toggle("panel--hidden", !manual);
    aiPanel.classList.toggle("panel--hidden",  manual );

    // Der API-Key-Bereich gehört nur zum KI-Modus: versteckt im manuellen Modus, sichtbar im KI-Modus.
    apiKeyPanel.classList.toggle("panel--hidden", manual);

    manualBtn.classList.toggle("mode-toggle__btn--active", manual );
    aiBtn.classList.toggle("mode-toggle__btn--active", !manual);

    manualBtn.setAttribute("aria-selected", String(manual));
    aiBtn.setAttribute("aria-selected", String(!manual));

    // Statusmeldung zurücksetzen
    setStatus("");
}


// Event-Listener
manualBtn.addEventListener("click",() => setMode("manual"));
aiBtn.addEventListener("click",() => setMode("ai"));

// Lädt die aktuelle Karte aus dem Background-Speicher und zeigt sie im Popup an. 
// Das passiert beim Öffnen des Popups.
async function loadCard(): Promise<void> {
    try {
        const card = await send<Card>({type: "GET_CARD"});

        frontInput.value = card.front;
        backInput.value = card.back;

        aiFrontInput.value = card.front;
        aiBackInput.value = card.back;

        showImage(frontImage, card.frontImage);
        showImage(backImage, card.backImage);

    } catch (error) {
        console.error("Failed to load card:", error);
    }
}


//Lädt den gespeicherten Quelltext für die KI.
async function loadSource(): Promise<void> {
    try {
        const result = await send<{sourceText: string;}>({type: "GET_SOURCE"});
        sourceInput.value =result.sourceText;
    } catch (error) {
        console.error("Failed to load source:", error);
    }
}


// Lädt die Liste der Anki-Decks und füllt das Dropdown-Menü.
async function loadDecks(): Promise<void> {
    try {
        const decks = await send<string[]>({type: "GET_DECKS"});

        deckSelect.replaceChildren();

        if (!decks.length) {
            deckSelect.appendChild(new Option("No decks available", ""));
            return;
        }

        for (const deck of decks) {
            deckSelect.appendChild(new Option(deck,deck));
        }

        // Zuletzt ausgewähltes Deck wiederherstellen.
        const lastDeckData = await browser.storage.local.get("lastDeck");

        const lastDeck = typeof lastDeckData.lastDeck === "string" ? lastDeckData.lastDeck : "";

        if (lastDeck && decks.includes(lastDeck)) {
            deckSelect.value = lastDeck;
        }
    } catch (error) {
        deckSelect.replaceChildren(new Option("Could not load decks", ""));
        setStatus("Could not connect to Anki. Is it running?", true);
        console.error("Failed to load decks:", error);
    }
}


// Prüft, ob ein API-Key gespeichert ist, und aktualisiert die Anzeige im Popup entsprechend.
async function loadKeyStatus(): Promise<void> {
    try {
        const hasKey = await send<boolean>({type: "HAS_GEMINI_KEY"});

        deleteKeyBtn.disabled = !hasKey;
        keyStatus.textContent = hasKey ? "Gemini key is saved locally." : "No Gemini key saved.";

        // CSS-Klassen für grünen (erfolg) oder neutralen Text.
        keyStatus.className = hasKey ? "api-key-status api-key-status--success" : "api-key-status";
    } catch (error) {
        keyStatus.textContent = "Could not check Gemini key.";
        keyStatus.className = "api-key-status api-key-status--error";

        console.error("Failed to check Gemini key:", error);
    }
}


// Event-Listener: API-Key speichern.
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

            // Nach dem Erfolg die Eingabefeld leeren, Status aktualisieren.
            keyInput.value = "";
            deleteKeyBtn.disabled = false;
            keyStatus.textContent = "Gemini key saved locally.";
            keyStatus.className = "api-key-status api-key-status--success";
        } catch (error) {
            keyStatus.textContent = errorMessage(error);
            keyStatus.className = "api-key-status api-key-status--error";
        } finally {
            // finally wird IMMER ausgeführt, egal ob Erfolg oder Fehler.
            saveKeyBtn.disabled = false;
        }
    }
);

// Event-Listener: API-Key löschen.
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

// Zwei-Wege-Synchronisation: Die bearbeitbare KI-Vorschau und die
// manuellen Textfelder sollen immer denselben Inhalt haben. So verwendet
// CREATE_CARD automatisch den (ggf. vom Nutzer geänderten) Vorschau-Text,
// und ein Moduswechsel verliert keine Eingaben.
aiFrontInput.addEventListener("input", () => {
    frontInput.value = aiFrontInput.value;
});
aiBackInput.addEventListener("input", () => {
    backInput.value = aiBackInput.value;
});
frontInput.addEventListener("input", () => {
    aiFrontInput.value = frontInput.value;
});
backInput.addEventListener("input", () => {
    aiBackInput.value = backInput.value;
});

// Event-Listener: KI-Karte generieren.
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

        // Progressive Feedbackn nach 10s
        const stillWorkingTimer = setTimeout(
            () => setStatus("Still generating… This may take a while. Please wait."),
            10_000
        );

        try {
            // Zuerst wird Quelltext im Background gespeichert und so für die generierung bereitgehalten.
            await send({type: "SET_SOURCE", text: source});

            // Background soll die KI aufrufen
            const card = await send<{front: string; back: string;}>({type: "GENERATE_CARD"});

            // Textfelder werden mit den generierten Werten ausgefüllt.
            frontInput.value = card.front;
            backInput.value = card.back;

            // Die bearbeitbare Vorschau zeigen und mit denselben Werten füllen.
            aiFrontInput.value = card.front;
            aiBackInput.value = card.back;

            aiPreview.classList.remove("ai-preview--hidden");

            setStatus("Card generated. Review, edit if needed, then create.");
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

// Event-Listener: Karte in Anki erstellen.
createBtn.addEventListener(
    "click",
    async () => {
        createBtn.disabled = true;

        try {
            if (frontInput.value.trim()) {
                await send({type: "SET_FRONT", text: frontInput.value});
            }
            if (backInput.value.trim()) {
                await send({type: "SET_BACK", text: backInput.value});
            }

            // Prüfung: Ein Deck muss ausgewählt sein.
            if (!deckSelect.value) {
                throw new Error("Choose a deck first.");
            }

            await send({type: "SET_MODEL", modelName: modelSelect.value});

            // CREATE_CARD-Befehl wird an background.ts geschickt
            await send({type: "CREATE_CARD", deckName: deckSelect.value, modelName: modelSelect.value});

            // Letztes Deck und Kartentyp merken
            await browser.storage.local.set({lastDeck: deckSelect.value, lastModel: modelSelect.value});

            // Nach erfolgreichem Erstellen: Alles zurücksetzen
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

// Initialisierungsfunktion
async function init(): Promise<void> {
    await Promise.all([
        loadCard(),
        loadSource(),
        loadDecks(),
        loadModels(),
        loadKeyStatus()
    ]);
}

void init();
