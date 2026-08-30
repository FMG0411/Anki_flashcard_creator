/* ============================================================================
 * WAS SIE MACHT:
 * - Verbindet sich mit AnkiConnect (Add-on für Anki, das einen lokalen Webserver auf Port 8765 startet).
 * - Kann alle verfügbaren Anki-Decks abfragen.
 * - Kann neue Lernkarten mit Text und Bildern in Anki erstellen. 
 * ============================================================================ */

// "127.0.0.1" ist die localhost IP-Adresse 
const ANKI_URL = "http://127.0.0.1:8765";

// Notentyp Fallback 
const DEFAULT_MODEL = "Einfach";

export function getAnkiModels(): Promise<string[]> {
    return invoke<string[]>("modelNames");
}

// Ein Interface (eine Art Vertrag/Plan) für die Antwort, die AnkiConnect uns zurückschickt. 
// Das <T> ist ein "Generischer Typparameter" – das bedeutet, das Interface ist flexibel
interface AnkiResponse<T> {
    result: T;
    error: string | null;
}

// Ein Interface, das die Struktur eines Objekts oder einer Klasse zu definiert, 
export interface Card {
    front: string;
    frontImage: string;
    back: string;
    backImage: string;
}

/**
 * Diese Funktion ist das Herzstück der Kommunikation mit AnkiConnect.
 * Sie schickt einen Befehl an die Anki Connect und wartet auf die Antwort.
 *
 * @param action – Der Name des Befehls, den AnkiConnect versteht
 *                 (z.B. "deckNames" oder "addNote").
 * @param params – Standardmäßig ein leeres Objekt {}, falls keine Parameter nötig sind.
 * 
 * @returns      – Ein Promise mit dem Ergebnis vom Typ T.
 */
async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {

    /**
     * Der fetch()-Aufruf erwartet:
     * 1. Die
     * 2. Ein Objekt mit Optionen:
     *    - method: "POST" (wir schicken Daten)
     *    - headers: Wir sagen dem Server, dass wir JSON schicken
     *    - body: Die eigentlichen Daten als JSON-String
     */
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

    // Antwort-Body wird als JSON gelesen.
    const data = await response.json() as AnkiResponse<T>;

    if (data.error !== null) {
        throw new Error(data.error || "AnkiConnect error.");
    }

    // Wir geben das "result"-Feld zurück (z.B. die Liste der Deck-Namen oder die ID der neu erstellten Karte).
    return data.result;
}

// Diese Funktion fragt Anki nach allen verfügbaren Decks.
export function getAnkiDecks(): Promise<string[]> {
    return invoke<string[]>("deckNames");
}

/**
 * Eine Hilfsfunktion, die aus einer Data-URL den reinen Base64-Teil extrahiert. 
 * Data-URLs sehen so aus: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 * AnkiConnect braucht aber NUR den Teil nach dem Komma
 *
 * @param dataUrl – Die komplette Data-URL (z.B. aus der Zwischenablage).
 * @returns       – Nur der Base64-Teil nach dem Komma.
 */
function base64(dataUrl: string): string {

    const comma = dataUrl.indexOf(",");

    if (comma < 0) {
        throw new Error("Invalid image data.");
    }

    // schneidet alles vor und inklusive dem Komma ab und gibt den Rest zurück.
    return dataUrl.slice(comma + 1);
}

/**
 * Diese Funktion erstellt eine neue Lernkarte in Anki.
 * 
 * @param card     – Die Karte mit front, frontImage, back, backImage.
 * @param deckName – Der Name des Anki-Decks, in das die Karte kommt.
 * @returns        – Ein Promise mit der ID der neu erstellten Karte.
 */
export function createAnkiCard(card: Card, deckName: string, modelName: string = DEFAULT_MODEL): Promise<number> {

    const pictures = [];

    // Der Dateiname enthält "Date.now()", das ist der aktuelle Zeitstempel in Millisekunden und damit eindeutig. 
    if (card.frontImage) {
        pictures.push({
            filename:
                `anki-front-${Date.now()}.png`,
            data:
                base64(card.frontImage),
            fields: ["Vorderseite"]
        });
    }

    if (card.backImage) {
        pictures.push({
            filename:
                `anki-back-${Date.now() + 1}.png`, // stellt sicher, dass der Dateiname anders ist als der der Vorderseite
            data:
                base64(card.backImage),
            fields: ["Rückseite"]
        });
    }

    // Wir rufen die invoke-Funktion mit dem Befehl "addNote" auf.
    // Der Spread-Operator: Wenn pictures leer ist, fügen wir gar kein "picture"-Feld hinzu.
    return invoke<number>(
        "addNote",
        {
            note: {
                deckName,
                modelName,
                fields: { Vorderseite: card.front, Rückseite: card.back },
                ...(pictures.length ? { picture: pictures } : {})
            }
        }
    );
}