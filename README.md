# Anki Flashcard Creator

AI-powered Firefox extension that creates Anki flashcards directly from web pages using Google Gemini.

## Features

- **Manual mode**: Select text, press `1` (front) or `2` (back)
- **AI mode**: Select text, press `3`, then open the popup and press `Generate Card` to generate a flashcard with Gemini
- **Clipboard images**: Press `1`/`2` without text selection to paste a screenshot
- **Direct Anki integration**: Creates cards instantly via AnkiConnect

## Prerequisites

1. [Anki](https://apps.ankiweb.net/) desktop app installed and running
2. [AnkiConnect](https://ankiweb.net/shared/info/2055492159) addon installed
3. (Optional) [Gemini API key](https://aistudio.google.com/app/apikey) for AI generation

## Installation

```bash
git clone https://github.com/FMG0411/anki-flashcard-creator.git
cd anki-flashcard-creator
npm install
npm run build
npm run run   # Launches Firefox with extension loaded