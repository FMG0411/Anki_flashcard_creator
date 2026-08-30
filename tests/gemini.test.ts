import { describe, it, expect, vi } from 'vitest'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'
const mockFetch = (body: object, ok = true, status = 200) =>
    vi.fn().mockResolvedValue({ ok, status, json: async () => body })

const validateCard = (v: unknown): { front: string; back: string } => {
    if (typeof v !== 'object' || v === null || !('front' in v) || !('back' in v)) throw new Error('invalid')
    const f = (v as Record<string, unknown>).front as string, b = (v as Record<string, unknown>).back as string
    if (!f.trim() || !b.trim() || f.length > 20000 || b.length > 20000) throw new Error('invalid')
    if (/<\/?[a-z][^>]*>/i.test(f + b)) throw new Error('html')
    return { front: f.trim(), back: b.trim() }
}

describe('gemini', () => {
    it('sends correct payload', async () => {
        vi.stubGlobal('fetch', mockFetch({ candidates: [{ content: { parts: [{ text: '{"front":"Q","back":"A"}' }] }, finishReason: 'STOP' }] }))
        const r = await fetch(GEMINI_URL, { method: 'POST', headers: { 'x-goog-api-key': 'k' }, body: '{}' })
        const t = (await r.json()).candidates[0].content.parts[0].text
        expect(JSON.parse(t)).toEqual({ front: 'Q', back: 'A' })
    })

    it('handles api errors', async () => {
        vi.stubGlobal('fetch', mockFetch({ error: { message: 'bad key' } }, false, 400))
        expect((await fetch(GEMINI_URL, { method: 'POST' })).ok).toBe(false)
    })

    it('validates cards', () => {
        expect(validateCard({ front: 'Q', back: 'A' })).toEqual({ front: 'Q', back: 'A' })
        expect(() => validateCard({ front: '', back: 'A' })).toThrow('invalid')
        expect(() => validateCard({ front: 'Q', back: '<script>x</script>' })).toThrow('html')
        expect(() => validateCard(null)).toThrow('invalid')
    })
})