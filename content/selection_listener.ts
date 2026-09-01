/* ============================================================================
 * WHAT THIS FILE DOES:
 * - Listens for key presses on web pages (1 = front, 2 = back, 3 = AI source
 *   text).
 * - If the user has selected text and presses 1/2/3, the selected text is
 *   sent to the background script.
 * - If NO text is selected and the user presses 1 or 2, it tries to read an
 *   image from the clipboard.
 * ============================================================================ */

// Type-only reference: `import()` types are erased at compile time, so this file
// stays a classic script. Content scripts are NOT ES modules - a real `import`
// or `export` statement would make Firefox throw a SyntaxError and the whole
// listener would never be registered.
type Message = import("../background/types.js").Message;

// Returns the currently selected text on the web page.
function selectedText(): string {
    return (window.getSelection() ?.toString().trim() ?? "");
}


// Checks whether the user is currently typing in an input field.
function isTyping(target: EventTarget | null): boolean {

    // If target is not an HTMLElement, return false in any case.  
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
    );
}

// Reads an image from the user's clipboard.
async function clipboardImage(): Promise<string> {
    
    const items = await navigator.clipboard.read();

    for (const item of items) {
        const type = item.types.find(type => type.startsWith("image/"));

        if (!type) {
            continue;
        }

        // Image fetched as a binary large object (Blob) from the ClipboardItem.
        const blob = await item.getType(type);

        // The binary large object is converted into a data URL. 
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

                // FileReader processes the binary large object here.
                reader.readAsDataURL(blob);
            }
        );
    }
    throw new Error("No image found on the clipboard.");
}

// THE MAIN EVENT LISTENER for key presses
document.addEventListener("keydown",async event => {

        // Typing check
        if (event.isComposing || isTyping(event.target)) {
            return;
        }

        if (!["1", "2", "3"].includes(event.key)) {
            return;
        }

        const text = selectedText();

        if (text) {

            const type =
                event.key === "1"
                    ? "SET_FRONT"
                    : event.key === "2"
                        ? "SET_BACK"
                        : "SET_SOURCE";

            // SET_FRONT/SET_BACK/SET_SOURCE only store data. 
            // Errors are caught here so that no unhandled rejection appears on the web page.
            const message: Message = {type, text};
            browser.runtime.sendMessage(message).catch(
                (error) => console.error("Could not send selection:", error)
            );
            return;
        }

        // Tries to read an image if no text is selected
        if (event.key !== "1" && event.key !== "2") {
            return;
        }

        try {
            const image = await clipboardImage();

            // The image is sent to background.ts
            const message: Message = {
                type: "SET_IMAGE",
                target:
                    event.key === "1"
                        ? "front"
                        : "back",
                image
            };
            await browser.runtime.sendMessage(message);
        } catch (error) {
            console.error("Clipboard screenshot unavailable:", error);
        }
    }
);
