#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const DIST = 'dist'

const rm = (dir) => { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }) }
const cp = (src, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest) }
const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true })

console.log('Cleaning dist...')
rm(DIST)
mkdir(DIST)

console.log('Compiling TypeScript...')
try {
    execSync('npx tsc', { stdio: 'inherit' })
} catch {
    process.exit(1)
}

console.log('Copying static files...')
cp('manifest.json', path.join(DIST, 'manifest.json'))
cp('popup/popup.html', path.join(DIST, 'popup/popup.html'))
cp('popup/popup.css', path.join(DIST, 'popup/popup.css'))

// Copy icons if they exist
if (fs.existsSync('icons')) {
    const icons = fs.readdirSync('icons')
    for (const icon of icons) {
        cp(path.join('icons', icon), path.join(DIST, 'icons', icon))
    }
}

console.log('Build complete: ./dist')