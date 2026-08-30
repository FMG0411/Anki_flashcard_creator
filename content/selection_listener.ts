/* ============================================================================
 * WAS SIE MACHT:
 * - Wartet auf Tastendrücke (1 =Front, 2 = Back, 3 = AI source text)
 * - Wenn der Nutzer Text markiert hat und 1/2/3 drückt, wird der
 *   markierte Text an den Background geschickt.
 * - Wenn KEIN Text markiert ist und der Nutzer 1 oder 2 drückt,
 *   wird versucht, ein Bild aus der Zwischenablage zu lesen
 * ============================================================================ */

// Hilfsfunktion: Gibt den aktuell markierten Text auf der Webseite zurück.
function selectedText(): string {
    return (window.getSelection() ?.toString().trim() ?? "");
}


/**
 * Prüft, ob der Nutzer gerade in einem Eingabefeld tippt.
 * Wenn ja, wollen wir unsere Tastenkürzel NICHT auslösen, 
 * sonst könnte der Nutzer keine "1", "2" oder "3" in Formulare eingeben
 *
 * @param target – Das Element, das das Event ausgelöst hat.
 * @returns      – true, wenn der Nutzer in einem Input, Textarea
 *                 oder contentEditable-Element tippt.
 */
function isTyping(target: EventTarget | null): boolean {

    // Wenn target kein HTMLElement ist dann auf jeden Fall false  
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
    );
}

// Liest ein Bild aus der Zwischenablage des Nutzers.
async function clipboardImage(): Promise<string> {
    
    const items = await navigator.clipboard.read();

    for (const item of items) {
        const type = item.types.find(type => type.startsWith("image/"));

        if (!type) {
            continue;
        }

        // Bild als Binary Large Object aus dem ClipboardItem geholt.
        const blob = await item.getType(type);

        // Binary Large Object wird in eine Data-URL verwandelt. 
        return new Promise(
            (resolve, reject) => {

                const reader = new FileReader();

                reader.onload = () => {
                    if (typeof reader.result === "string") {
                        resolve(reader.result);
                    } else {
                        reject(new Error("Could not read image."));
                    }
                };

                reader.onerror = () => reject(new Error("Could not read image."));

                // FileReader verarbeitet hier das Binary Large Object.
                reader.readAsDataURL(blob);
            }
        );
    }
    throw new Error("No image found on the clipboard.");
}

// DER HAUPT-EVENT-LISTENER für Tastendrücke
document.addEventListener("keydown",async event => {

        // Tippcheck
        if (event.isComposing || isTyping(event.target)) {
            return;
        }
        if (!["1", "2", "3"].includes(event.key)) {
            return;
        }

        // Aktuell markierter Text
        const text = selectedText();

        if (text) {

            const type =
                event.key === "1"
                    ? "SET_FRONT"
                    : event.key === "2"
                        ? "SET_BACK"
                        : "SET_SOURCE";

            // SET_FRONT/SET_BACK/SET_SOURCE speichern nur und deswegen wird void benutzt.        
            void browser.runtime.sendMessage({type, text});
            return;
        }

        // Versucht ein Bild zu lesen falls kein Text markiert ist
        if (event.key !== "1" && event.key !== "2") {
            return;
        }

        try {
            const image = await clipboardImage();

            // Bild wird an background.ts geschickt
            await browser.runtime.sendMessage({
                type: "SET_IMAGE",
                target:
                    event.key === "1"
                        ? "front"
                        : "back",
                image
            });
        } catch (error) {
            console.error("Clipboard screenshot unavailable:", error);
        }
    }
);