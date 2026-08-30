import { describe, it, expect, vi } from 'vitest'

const ANKI_URL = 'http://127.0.0.1:8765'
const mockFetch = (body: object, ok = true, status = 200) =>
    vi.fn().mockResolvedValue({ ok, status, json: async () => body })

describe('anki', () => {
    it('fetches decks', async () => {
        vi.stubGlobal('fetch', mockFetch({ result: ['Default'], error: null }))
        const r = await fetch(ANKI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const d = await r.json()
        expect(d.result).toEqual(['Default'])
        expect(d.error).toBeNull()
    })

    it('handles anki errors', async () => {
        vi.stubGlobal('fetch', mockFetch({ result: null, error: 'collection not open' }))
        const d = await (await fetch(ANKI_URL, { method: 'POST' })).json()
        expect(d.error).toBe('collection not open')
    })

    it('handles http errors', async () => {
        vi.stubGlobal('fetch', mockFetch({}, false, 404))
        const r = await fetch(ANKI_URL, { method: 'POST' })
        expect(r.ok).toBe(false)
        expect(r.status).toBe(404)
    })
})