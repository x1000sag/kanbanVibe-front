import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createAccountBoardPort } from '../src/services/accountBoardPort'
import { createInMemoryAccountBoard, type MockResult } from '../src/services/mockAccountBoard'
import { phrase, phraseForCode } from '../src/services/phrases'

const TWELVE_HOURS = 12 * 60 * 60 * 1000

function installMemoryStorage(): { set: (key: string, value: string) => void; clear: () => void } {
  const jar = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => jar.get(key) ?? null,
      setItem: (key: string, value: string) => jar.set(key, value),
      removeItem: (key: string) => jar.delete(key),
      clear: () => jar.clear(),
      key: () => null,
      get length() {
        return jar.size
      },
    },
  })
  return {
    set: (key, value) => jar.set(key, value),
    clear: () => jar.clear(),
  }
}

const memoryStorage = installMemoryStorage()

function expectCode(result: MockResult<unknown>, code: string): void {
  expect(result.ok).toBe(false)
  if (result.ok || !('error' in result)) return
  expect(result.error).toEqual({ code })
  expect(JSON.stringify(result)).not.toMatch(/verifier|accessToken|s3cret/)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await expect(page).toHaveScreenshot(name.endsWith('.png') ? name : `${name}.png`)
}

async function createPerson(page: Page, name: string, nick: string, password: string): Promise<void> {
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.getByRole('button', { name: 'Нет аккаунта — создать' }).click()
  await page.getByLabel('Имя', { exact: true }).fill(name)
  await page.getByLabel('Логин', { exact: true }).fill(nick)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('button', { name: `Профиль, ${name}` })).toBeVisible()
}

async function signIn(page: Page, nick: string, password: string): Promise<void> {
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.getByLabel('Логин', { exact: true }).fill(nick)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('dialog').getByRole('button', { name: 'Войти' }).click()
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Профиль, / }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
}

test.beforeEach(() => {
  memoryStorage.clear()
})

test.describe('port contract', () => {
  test('creates an account, reads the profile, and does not leak the secret', async () => {
    const board = createInMemoryAccountBoard()
    const created = await board.createAccount({ nick: '  marina  ', password: 's3cret-marina' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.status).toBe(201)
    expect(created.data).toEqual({ nick: 'marina', displayName: 'marina' })
    expect(Object.keys(created.data)).toEqual(['nick', 'displayName'])

    const extra = await board.createAccount({ nick: 'other', password: 'pw', displayName: 'Nope' })
    expectCode(extra, 'request_invalid')

    const signed = await board.signIn({ nick: 'marina', password: 's3cret-marina' })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    const before = Date.now()
    const again = await board.signIn({ nick: ' marina ', password: 's3cret-marina' })
    const after = Date.now()
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const expires = Date.parse(again.data.expiresAt)
    expect(expires).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + TWELVE_HOURS)
    expect(expires).toBeLessThanOrEqual(Math.floor(after / 1000) * 1000 + TWELVE_HOURS)
    expect(again.data.accessToken).not.toBe('s3cret-marina')
    expect(again.data.accessToken).not.toBe(signed.data.accessToken)

    const profile = await board.getProfile(signed.data.accessToken, 'marina')
    expect(profile.ok).toBe(true)
    if (!profile.ok) return
    expect(profile.data.board.columns.map((column) => column.name)).toEqual(['ToDo', 'InProgress', 'Done'])
    expect(JSON.stringify(profile.data)).not.toContain('s3cret-marina')
    expect(JSON.stringify(profile)).not.toContain('passwordVerifier')

    const foreign = await board.getProfile(signed.data.accessToken, 'Marina')
    expectCode(foreign, 'foreign_data')
    expect(JSON.stringify(foreign)).not.toContain('columns')

    const firstCard = await board.createCard(signed.data.accessToken, 'marina', {
      columnName: 'InProgress',
      title: 'say "hi"',
      description: 'a "quote"',
      tags: ['c"at'],
      deadline: '2026-07-08',
    })
    expect(firstCard.ok).toBe(true)
    if (!firstCard.ok) return
    expect(firstCard.data.tags).toEqual(['c"at'])
    expect(firstCard.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

    const secondCard = await board.createCard(signed.data.accessToken, 'marina', {
      columnName: 'InProgress',
      title: 'later',
      description: '',
      tags: ['UI Design'],
      deadline: null,
    })
    expect(secondCard.ok).toBe(true)
    const reread = await board.getProfile(signed.data.accessToken, 'marina')
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    const titles = reread.data.board.columns[1].cards.map((card) => card.title)
    expect(titles).toEqual(['say "hi"', 'later'])
    expect(reread.data.board.columns[1].cards[1].description).toBeNull()

    const removed = await board.deleteCard(signed.data.accessToken, 'marina', firstCard.data.id)
    expect(removed.ok).toBe(true)
    const missing = await board.deleteCard(signed.data.accessToken, 'marina', firstCard.data.id)
    expectCode(missing, 'object_missing')
    expect(JSON.stringify(missing)).not.toContain('say "hi"')
    const afterDelete = await board.getProfile(again.data.accessToken, 'marina')
    expect(afterDelete.ok).toBe(true)
    if (!afterDelete.ok) return
    expect(JSON.stringify(afterDelete.data)).not.toContain('say "hi"')

    await board.endSession(signed.data.accessToken)
    const ended = await board.getProfile(signed.data.accessToken, 'marina')
    expectCode(ended, 'no_active_access')
    const otherSession = await board.getProfile(again.data.accessToken, 'marina')
    expect(otherSession.ok).toBe(true)

    const quoted = await board.createAccount({ nick: 'say "nick"', password: 'pw' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.data.nick).toBe('say "nick"')
    const quotedSign = await board.signIn({ nick: 'say "nick"', password: 'pw' })
    expect(quotedSign.ok).toBe(true)
    if (!quotedSign.ok) return
    const quotedName = await board.changeDisplayName(quotedSign.data.accessToken, 'say "nick"', {
      displayName: 'Name "quoted"',
    })
    expect(quotedName.ok).toBe(true)
    if (!quotedName.ok) return
    expect(quotedName.data.displayName).toBe('Name "quoted"')
    const notMarina = await board.getProfile(quotedSign.data.accessToken, 'marina')
    expectCode(notMarina, 'foreign_data')
  })

  test('nick and password edges stay exact', async () => {
    const board = createInMemoryAccountBoard()
    const nick64 = 'm'.repeat(64)
    const accepted = await board.createAccount({ nick: nick64, password: 'a'.repeat(1024) })
    expect(accepted.ok).toBe(true)
    const tooLongNick = await board.createAccount({ nick: 'm'.repeat(65), password: 'secret' })
    expectCode(tooLongNick, 'nick_invalid')
    const tooLongPassword = await board.createAccount({ nick: 'short', password: 'a'.repeat(1025) })
    expectCode(tooLongPassword, 'password_invalid')
    const emptyPassword = await board.createAccount({ nick: 'empty-pw', password: '' })
    expectCode(emptyPassword, 'password_invalid')
    const spaces = await board.createAccount({ nick: 'spaces', password: '   ' })
    expect(spaces.ok).toBe(true)
    const spacedNick = await board.createAccount({ nick: 'ma rina', password: 'pw' })
    expect(spacedNick.ok).toBe(true)
    if (!spacedNick.ok) return
    expect(spacedNick.data.nick).toBe('ma rina')
    const lower = await board.createAccount({ nick: 'marina', password: 'one' })
    const upper = await board.createAccount({ nick: 'Marina', password: 'two' })
    expect(lower.ok && upper.ok).toBe(true)
    const taken = await board.createAccount({ nick: ' marina ', password: 'three' })
    expectCode(taken, 'nick_taken')
    const still = await board.signIn({ nick: 'marina', password: 'one' })
    expect(still.ok).toBe(true)
    const notReplaced = await board.signIn({ nick: 'marina', password: 'three' })
    expectCode(notReplaced, 'sign_in_failed')
    const unknown = await board.signIn({ nick: 'nobody', password: 'one' })
    expectCode(unknown, 'sign_in_failed')
    const wrong = await board.signIn({ nick: 'marina', password: 'nope' })
    expectCode(wrong, 'sign_in_failed')
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(unknown))
    const missingSign = await board.signIn({ nick: 'm'.repeat(65), password: 'secret' })
    expectCode(missingSign, 'sign_in_failed')
    const huge = await board.createAccount({ nick: 'huge', password: 'a'.repeat(17_000) })
    expectCode(huge, 'request_invalid')
    const noHuge = await board.signIn({ nick: 'huge', password: 'a'.repeat(17_000) })
    expect(noHuge.ok).toBe(false)
  })

  test('two creates of one nick leave a single account', async () => {
    const board = createInMemoryAccountBoard()
    const [first, second] = await Promise.all([
      board.createAccount({ nick: 'dup', password: 'one' }),
      board.createAccount({ nick: 'dup', password: 'two' }),
    ])
    const wins = [first, second].filter((result) => result.ok)
    expect(wins).toHaveLength(1)
    const loss = [first, second].find((result) => !result.ok)
    expect(loss && 'error' in loss && loss.error.code).toBe('nick_taken')
    const one = await board.signIn({ nick: 'dup', password: 'one' })
    const two = await board.signIn({ nick: 'dup', password: 'two' })
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1)
  })

  test('profile name, password, and card rules', async () => {
    const board = createInMemoryAccountBoard()
    await board.createAccount({ nick: 'marina', password: 'secret' })
    const signed = await board.signIn({ nick: 'marina', password: 'secret' })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    const token = signed.data.accessToken
    const blocked = await board.createCard(token, 'marina', { columnName: 'ToDo', title: 'Early' })
    expectCode(blocked, 'request_invalid')
    await board.getProfile(token, 'marina')
    const name = 'я'.repeat(128)
    const renamed = await board.changeDisplayName(token, 'marina', { displayName: `  ${name}  ` })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.data.displayName).toBe(name)
    const tooLong = await board.changeDisplayName(token, 'marina', { displayName: 'я'.repeat(129) })
    expectCode(tooLong, 'display_name_invalid')
    const blank = await board.changeDisplayName(token, 'marina', { displayName: '   ' })
    expectCode(blank, 'display_name_invalid')
    const stillNamed = await board.getProfile(token, 'marina')
    expect(stillNamed.ok).toBe(true)
    if (!stillNamed.ok) return
    expect(stillNamed.data.displayName).toBe(name)

    const rejected = await board.changePassword(token, 'marina', {
      currentPassword: 'wrong',
      newPassword: 'next',
    })
    expectCode(rejected, 'password_change_rejected')
    const foreignPassword = await board.changePassword(token, 'other', {
      currentPassword: 'secret',
      newPassword: 'next',
    })
    expectCode(foreignPassword, 'foreign_data')
    const same = await board.changePassword(token, 'marina', {
      currentPassword: 'secret',
      newPassword: 'secret',
    })
    expect(same.ok).toBe(true)
    const changed = await board.changePassword(token, 'marina', {
      currentPassword: 'secret',
      newPassword: 'next-secret',
    })
    expect(changed.ok).toBe(true)
    const oldToken = await board.getProfile(token, 'marina')
    expect(oldToken.ok).toBe(true)
    const oldPassword = await board.signIn({ nick: 'marina', password: 'secret' })
    expectCode(oldPassword, 'sign_in_failed')
    const newPassword = await board.signIn({ nick: 'marina', password: 'next-secret' })
    expect(newPassword.ok).toBe(true)

    const badTitle = await board.createCard(token, 'marina', { columnName: 'ToDo', title: '' })
    expectCode(badTitle, 'card_invalid')
    const badDay = await board.createCard(token, 'marina', {
      columnName: 'ToDo',
      title: 'Day',
      deadline: '2026-13-40',
    })
    expectCode(badDay, 'card_invalid')
    const badTag = await board.createCard(token, 'marina', {
      columnName: 'ToDo',
      title: 'Tags',
      tags: ['A', 'a'],
    })
    expectCode(badTag, 'card_invalid')
    const missingColumn = await board.createCard(token, 'marina', { columnName: 'To Do', title: 'Nope' })
    expectCode(missingColumn, 'object_missing')
    const kept = await board.getProfile(token, 'marina')
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(kept.data.board.columns.every((column) => column.cards.length === 0)).toBe(true)
  })

  test('faults do not leave a partial account or board', async () => {
    memoryStorage.set('accountBoardFault', 'store_unavailable')
    const board = createInMemoryAccountBoard()
    const down = await board.createAccount({ nick: 'ghost', password: 'secret' })
    expectCode(down, 'store_unavailable')
    const absent = await board.signIn({ nick: 'ghost', password: 'secret' })
    expectCode(absent, 'sign_in_failed')

    await board.createAccount({ nick: 'marina', password: 'secret' })
    const signed = await board.signIn({ nick: 'marina', password: 'secret' })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    await board.getProfile(signed.data.accessToken, 'marina')
    memoryStorage.set('accountBoardFault', 'network')
    const dropped = await board.createCard(signed.data.accessToken, 'marina', {
      columnName: 'ToDo',
      title: 'Nope',
    })
    expect(dropped).toEqual({ ok: false, network: true })
    const profile = await board.getProfile(signed.data.accessToken, 'marina')
    expect(profile.ok).toBe(true)
    if (!profile.ok) return
    expect(profile.data.board.columns[0].cards).toEqual([])

    memoryStorage.set('accountBoardFault', 'expire')
    const expired = await board.createCard(signed.data.accessToken, 'marina', {
      columnName: 'ToDo',
      title: 'Later',
    })
    expectCode(expired, 'no_active_access')
    const accountRemains = await board.signIn({ nick: 'marina', password: 'secret' })
    expect(accountRemains.ok).toBe(true)
  })

  test('the port strips the token and creates the name after the account', async () => {
    const memory = createInMemoryAccountBoard()
    const port = createAccountBoardPort(memory)
    const opened = await port.openAccount({
      nick: 'marina',
      password: 's3cret-marina',
      displayName: 'Марина',
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.nameAccepted).toBe(true)
    expect(opened.profile).toMatchObject({ nick: 'marina', displayName: 'Марина' })
    expect(JSON.stringify(opened)).not.toContain('accessToken')
    expect(JSON.stringify(opened)).not.toContain('s3cret-marina')

    const taken = await port.openAccount({ nick: 'marina', password: 'other', displayName: 'Other' })
    expect(taken.ok).toBe(false)
    if (taken.ok) return
    expect(taken.signedIn).toBe(false)
    const still = await port.getProfile()
    expect(still.ok).toBe(true)
    if (!still.ok) return
    expect(still.data.displayName).toBe('Марина')

    const spaces = createAccountBoardPort(memory)
    const rejectedName = await spaces.openAccount({ nick: 'spacey', password: 'secret', displayName: '   ' })
    expect(rejectedName.ok).toBe(true)
    if (!rejectedName.ok) return
    expect(rejectedName.nameAccepted).toBe(false)
    expect(rejectedName.nameFailure?.code).toBe('display_name_invalid')
    expect(rejectedName.profile.displayName).toBe('spacey')
    expect(rejectedName.profile.board.columns).toHaveLength(3)

    const signed = await port.signIn({ nick: 'marina', password: 's3cret-marina' })
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    expect(signed.data).toEqual({ expiresAt: signed.data.expiresAt })
    expect(JSON.stringify(signed)).not.toContain('accessToken')
  })

  test('phrases do not include a code or a password', () => {
    expect(phraseForCode('sign_in_failed')).toBe(phrase.signInFailed)
    expect(phraseForCode('object_missing', 'delete-card')).toBe('Карточки уже нет')
    expect(phraseForCode('object_missing', 'create-card')).toBe('Карточка не сохранилась')
    expect(phraseForCode('card_invalid', 'create-card')).toBe('Карточка не сохранилась')
    expect(phrase.network).toBe('Нет соединения')
    expect(phrase.serviceFailed).toBe('Не получилось выполнить действие. Повторите позже')
    const joined = Object.values(phrase).join('\n')
    expect(joined).not.toContain('s3cret')
    expect(joined).not.toMatch(/nick_|password_|sign_in_failed/)
  })
})

test.describe('screen', () => {
  test('guest canvas has no columns and opens sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Board').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить карточку' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
    await expect(page.getByText('Войдите, чтобы открыть свою доску')).toBeVisible()
    await expect(page.locator('h2', { hasText: 'To Do' })).toHaveCount(0)
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
    expect(scheme).toContain('light')
    expect(scheme).not.toContain('dark')
    const width = await page.locator('#app').evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(1126)
    await shot(page, 'guest')
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await expect(page.getByRole('dialog', { name: 'Войти' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
    await expect(page.locator('h2', { hasText: 'To Do' })).toHaveCount(0)
    const scrim = await page.locator('.scrim').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(scrim)
    await shot(page, 'sign-in')
  })

  test('a new account sees three empty columns and not another person', async ({ page }) => {
    await page.goto('/')
    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await expect(page.getByText('М', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible()
    await expect(page.getByText('Пусто')).toHaveCount(3)
    await expect(page.locator('body')).not.toContainText('s3cret-marina')
    await shot(page, 'empty-columns')
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Marina only')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Marina only' })).toBeVisible()
    await signOut(page)
    await expect(page.locator('h3')).toHaveCount(0)
    await expect(page.getByText('Войдите, чтобы открыть свою доску')).toBeVisible()
    await createPerson(page, 'Олег', 'oleg', 'other-secret')
    await expect(page.getByRole('heading', { name: 'Marina only' })).toHaveCount(0)
    await expect(page.getByText('Пусто')).toHaveCount(3)
    await signOut(page)
    await signIn(page, 'marina', 's3cret-marina')
    await expect(page.getByRole('heading', { name: 'Marina only' })).toBeVisible()
  })

  test('spaces-only login is rejected on create and is empty on sign-in', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Нет аккаунта — создать' }).click()
    await page.getByLabel('Имя', { exact: true }).fill('Марина')
    await page.getByLabel('Логин', { exact: true }).fill('   ')
    await page.getByLabel('Пароль', { exact: true }).fill('s3cret-marina')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByText('Логин не подходит')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByRole('button', { name: /Профиль/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('button', { name: 'Нет аккаунта — создать' }).click()
    await page.getByLabel('Имя', { exact: true }).fill('   ')
    await page.getByLabel('Логин', { exact: true }).fill('spacey')
    await page.getByLabel('Пароль', { exact: true }).fill('s3cret-marina')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByRole('button', { name: 'Профиль, spacey' })).toBeVisible()
    await expect(page.getByText('Имя не подходит')).toBeVisible()
    await expect(page.getByText('Пусто')).toHaveCount(3)
    await signOut(page)

    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByLabel('Логин', { exact: true }).fill('   ')
    await page.getByLabel('Пароль', { exact: true }).fill('s3cret-marina')
    await page.getByRole('dialog').getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByText('Нужен логин')).toBeVisible()
    await expect(page.getByText('Не удалось войти')).toHaveCount(0)
  })

  test('a card lands in the chosen column', async ({ page }) => {
    await page.goto('/')
    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await expect(page.getByRole('dialog', { name: 'Новая карточка' })).toBeVisible()
    await shot(page, 'new-card')
    await page.getByLabel('Название').fill('Design homepage mockup')
    await page.getByLabel('Описание').fill('A quiet description')
    await page.getByRole('radio', { name: 'UI Design' }).check()
    await page.getByRole('radio', { name: 'In Progress' }).check()
    await page.getByLabel('Дата').fill('2026-07-08')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    const card = page.locator('.column-progress .card')
    await expect(card.getByRole('heading', { name: 'Design homepage mockup' })).toBeVisible()
    await expect(card.getByText('UI Design')).toBeVisible()
    await expect(card.getByText('A quiet description')).toBeVisible()
    await expect(card.getByText('8 Jul')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Edit, Design homepage mockup' })).toBeVisible()
    await expect(page.locator('.column-progress').getByText('Пусто')).toHaveCount(0)
    await expect(page.locator('.column-todo').getByText('Пусто')).toBeVisible()
    await shot(page, 'board-with-card')

    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Нужно название')).toBeVisible()
    await expect(page.getByLabel('Название')).toBeFocused()
    await expect(page.locator('h3', { hasText: 'Design homepage mockup' })).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()

    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Research note')
    await page.getByRole('textbox', { name: 'Новая', exact: true }).fill('Research')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Research', { exact: true })).toBeVisible()
    await expect(page.getByText('UX Design')).toHaveCount(0)

    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Too long')
    await page.getByRole('textbox', { name: 'Новая', exact: true }).fill('R'.repeat(33))
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Категория не длиннее 32 символов')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Too long' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Bare card')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    const bare = page.locator('.card', { hasText: 'Bare card' })
    await expect(bare.locator('.card-description')).toHaveCount(0)
    await expect(bare.locator('.card-date')).toHaveCount(0)
  })

  test('an open card can be deleted and cannot be saved', async ({ page }) => {
    await page.goto('/')
    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('First card')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Second card')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    const first = await page.getByRole('heading', { name: 'First card' }).boundingBox()
    const second = await page.getByRole('heading', { name: 'Second card' }).boundingBox()
    expect(first && second && first.y < second.y).toBe(true)
    await expect(page.locator('[draggable=true]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Edit, First card' }).click()
    const dialog = page.getByRole('dialog', { name: 'Редактирование' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Удалить' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible()
    await expect(dialog.getByLabel('Название')).not.toBeEditable()
    await shot(page, 'open-card')
    await dialog.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByRole('heading', { name: 'First card' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Second card' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit, Second card' }).click()
    await page.getByRole('dialog', { name: 'Редактирование' }).getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByRole('heading', { name: 'Second card' })).toHaveCount(0)
    await expect(page.locator('.column-todo').getByText('Пусто')).toBeVisible()
    expect(phraseForCode('object_missing', 'delete-card')).toBe('Карточки уже нет')
  })

  test('profile renames, changes the password, and has no cancel', async ({ page }) => {
    await page.goto('/')
    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await page.getByRole('button', { name: 'Профиль, Марина' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('М', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Профиль')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Марина' })).toBeVisible()
    await expect(dialog.getByLabel('Логин')).toHaveValue('marina')
    await expect(dialog.getByLabel('Логин')).not.toBeEditable()
    await expect(dialog.getByRole('button', { name: 'Сменить пароль' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Назад' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Закрыть' }).first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveCount(0)
    await shot(page, 'profile')

    await dialog.getByLabel('Имя на доске').fill('Не сохранять')
    await dialog.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('button', { name: 'Профиль, Марина' })).toBeVisible()

    await page.getByRole('button', { name: 'Профиль, Марина' }).click()
    await page.getByLabel('Имя на доске').fill('Марина К.')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('heading', { name: 'Марина К.' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('button', { name: 'Профиль, Марина К.' })).toBeVisible()

    await page.getByRole('button', { name: 'Профиль, Марина К.' }).click()
    await page.getByLabel('Имя на доске').fill('Другое')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await page.getByLabel('Текущий пароль').fill('s3cret-marina')
    await page.getByLabel('Новый пароль').fill('next-secret')
    await page.getByLabel('Повтор').fill('nope')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Пароли не совпадают')).toBeVisible()
    await expect(page.getByLabel('Текущий пароль')).toHaveValue('')
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('button', { name: 'Профиль, Марина К.' })).toBeVisible()

    await page.getByRole('button', { name: 'Профиль, Марина К.' }).click()
    await page.getByLabel('Имя на доске').fill('Другое')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await page.getByLabel('Текущий пароль').fill('wrong')
    await page.getByLabel('Новый пароль').fill('next-secret')
    await page.getByLabel('Повтор').fill('next-secret')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Текущий пароль не подошёл')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Марина К.' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()

    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Kept')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await page.getByRole('button', { name: 'Профиль, Марина К.' }).click()
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await page.getByLabel('Текущий пароль').fill('s3cret-marina')
    await page.getByLabel('Новый пароль').fill('next-secret')
    await page.getByLabel('Повтор').fill('next-secret')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('heading', { name: 'Марина К.' })).toBeVisible()
    await expect(page.getByText('Текущий пароль не подошёл')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible()
    await signOut(page)
    await expect(page.locator('h3')).toHaveCount(0)

    await signIn(page, 'marina', 's3cret-marina')
    await expect(page.getByText('Не удалось войти')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('s3cret-marina')
    await page.getByRole('button', { name: 'Отмена' }).click()
    await signIn(page, 'marina', 'next-secret')
    await expect(page.getByRole('button', { name: 'Профиль, Марина К.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible()

    await page.getByRole('button', { name: 'Профиль, Марина К.' }).click()
    await page.getByLabel('Имя на доске').fill('   ')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await page.getByLabel('Текущий пароль').fill('next-secret')
    await page.getByLabel('Новый пароль').fill('later-secret')
    await page.getByLabel('Повтор').fill('later-secret')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Имя не подходит')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Марина К.' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('button', { name: 'Профиль, Марина К.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible()
    await signOut(page)
    await signIn(page, 'marina', 'next-secret')
    await expect(page.getByText('Не удалось войти')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await signIn(page, 'marina', 'later-secret')
    await expect(page.getByRole('button', { name: 'Профиль, Марина К.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible()
  })

  test('a bad sign-in and a dropped board stay distinct from an empty column', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByLabel('Логин', { exact: true }).fill('nobody')
    await page.getByLabel('Пароль', { exact: true }).fill('s3cret-marina')
    await page.getByRole('dialog').getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByText('Не удалось войти')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('s3cret-marina')
    await page.getByRole('button', { name: 'Отмена' }).click()

    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByLabel('Логин', { exact: true }).fill('m'.repeat(65))
    await page.getByLabel('Пароль', { exact: true }).fill('s3cret-marina')
    await page.getByRole('dialog').getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByText('Не удалось войти')).toBeVisible()
    await expect(page.getByText('Логин не подходит')).toHaveCount(0)
    await page.getByRole('button', { name: 'Отмена' }).click()

    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await signOut(page)
    await signIn(page, 'marina', 'wrong-password')
    await expect(page.getByText('Не удалось войти')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await signIn(page, 'marina', 's3cret-marina')

    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Design homepage mockup')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await page.evaluate(() => sessionStorage.setItem('accountBoardFault', 'network'))
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Should not land')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Нет соединения')).toBeVisible()
    await expect(page.locator('h3', { hasText: 'Design homepage mockup' })).toBeVisible()
    await expect(page.locator('h3', { hasText: 'Should not land' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Отмена' }).click()

    await page.evaluate(() => sessionStorage.setItem('accountBoardFault', 'store_unavailable'))
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('Still no')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Данные сейчас недоступны')).toBeVisible()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.locator('h3', { hasText: 'Design homepage mockup' })).toBeVisible()
    await expect(page.getByText('Пусто')).toHaveCount(2)
    await shot(page, 'unavailable')

    await page.evaluate(() => sessionStorage.setItem('accountBoardFault', 'expire'))
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    await page.getByLabel('Название').fill('After expiry')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Нужно войти снова')).toBeVisible()
    await expect(page.getByText('Войдите, чтобы открыть свою доску')).toBeVisible()
    await expect(page.locator('h3')).toHaveCount(0)
    await signIn(page, 'marina', 's3cret-marina')
    await expect(page.getByRole('heading', { name: 'Design homepage mockup' })).toBeVisible()
  })

  test('keyboard, reduced motion, and a narrow board', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Войти' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Войти' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Войти' })).toBeFocused()

    await createPerson(page, 'Марина', 'marina', 's3cret-marina')
    await page.getByRole('button', { name: 'Добавить карточку' }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type('From keys')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Keyed description')
    await page.keyboard.press('Tab')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2026-07-08')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.locator('.column-progress').getByRole('heading', { name: 'From keys' })).toBeVisible()
    await expect(page.locator('.column-progress').getByText('UI Design')).toBeVisible()
    await expect(page.getByText('8 Jul')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    const dialog = page.getByRole('dialog')
    const motion = await dialog.evaluate((el) => {
      const style = getComputedStyle(el)
      return { name: style.animationName, duration: style.animationDuration, transform: style.transform }
    })
    expect(motion.name === 'none' || motion.duration === '0s').toBe(true)
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(motion.transform)
    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.locator('.card').first().hover()
    const hovered = await page.locator('.card').first().evaluate((el) => getComputedStyle(el).transform)
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(hovered)

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: 'Добавить карточку' }).click()
    const duration = await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).animationDuration)
    expect(duration).toBe('0.2s')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Добавить карточку' })).toBeFocused()

    await page.setViewportSize({ width: 719, height: 900 })
    await shot(page, 'narrow')
    const columns = page.locator('.column')
    const firstBox = await columns.nth(0).boundingBox()
    const secondBox = await columns.nth(1).boundingBox()
    expect(firstBox && secondBox && secondBox.y > firstBox.y + firstBox.height - 1).toBe(true)
  })
})

test('delivery stays inside the mock', () => {
  const roots = ['src/services', 'src/components', 'src/views', 'src/stores']
  const files = roots.flatMap((dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? [] : [full]
    }),
  )
  const services = files.filter((file) => file.startsWith('src/services/')).map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  expect(services).not.toMatch(/\bfetch\s*\(/)
  expect(services).not.toContain('msw')
  expect(services).not.toContain('serviceWorker')
  expect(services).not.toContain('VITE_BOARD_TRANSPORT')
  expect(services).not.toContain('VITE_API_BASE_URL')
  const ui = files
    .filter((file) => file.startsWith('src/components/') || file.startsWith('src/views/'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
  expect(ui).not.toContain('mockAccountBoard')
  expect(ui).not.toContain('localStorage')
  expect(ui).not.toContain('sessionStorage')
  expect(ui).not.toContain('accessToken')
  const store = fs.readFileSync('src/stores/accountStore.ts', 'utf8')
  expect(store).not.toContain('localStorage')
  expect(store).not.toContain('sessionStorage')
  expect(store).not.toContain('accessToken')
  expect(store).not.toContain('passwordVerifier')
  const src = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  expect(src).not.toContain('http://localhost:5000')
  const css = fs.readFileSync('src/style.css', 'utf8')
  expect(css).not.toMatch(/\.dialog\s*\{[^}]*width:\s*\d+px/)
  expect(css).toContain('background: none')

  const dist = path.join('dist', 'assets')
  expect(fs.existsSync(dist)).toBe(true)
  const bundle = fs
    .readdirSync(dist)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(dist, name), 'utf8'))
    .join('\n')
  expect(bundle).not.toContain('accountBoardFault')
})
