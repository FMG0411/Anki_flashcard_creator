import { describe, it, expect, vi } from 'vitest'

const mockStorage = () => {
    const store: Record<string, unknown> = {}
    return {
        get: vi.fn(async (k: string | string[]) =>
            Array.isArray(k) ? Object.fromEntries(k.map(x => [x, store[x] ?? ''])) : { [k]: store[k] ?? '' }
        ),
        set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(store, v) }),
        remove: vi.fn(async (k: string[]) => { k.forEach(x => { delete store[x] }) }),
    }
}

globalThis.browser = {
    storage: { session: mockStorage(), local: mockStorage() },
    runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
} as unknown as typeof browser

describe('background', () => {
    it('stores and retrieves card data', async () => {
        await browser.storage.session.set({ front: 'F', back: 'B' })
        const d = await browser.storage.session.get(['front', 'back'])
        expect(d).toEqual({ front: 'F', back: 'B' })
    })

    it('stores api key in local storage', async () => {
        await browser.storage.local.set({ geminiApiKey: 'AIzaK' })
        const d = await browser.storage.local.get('geminiApiKey')
        expect(d.geminiApiKey).toBe('AIzaK')
    })

    it('clears card fields', async () => {
        const keys = ['front', 'frontImage', 'back', 'backImage', 'sourceText']
        await browser.storage.session.set({ front: 'x', back: 'y' })
        await browser.storage.session.remove(keys)
        const d = await browser.storage.session.get(keys)
        expect(d.front).toBe('')
    })
})