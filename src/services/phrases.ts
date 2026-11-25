import type { ErrorCode } from '../types/accountBoard'

export const phrase = {
  needName: 'Нужно имя',
  needNick: 'Нужен логин',
  needPassword: 'Нужен пароль',
  nickInvalid: 'Логин не подходит',
  passwordInvalid: 'Пароль не подходит',
  nickTaken: 'Этот логин уже занят',
  signInFailed: 'Не удалось войти',
  needSignIn: 'Нужно войти снова',
  displayNameInvalid: 'Имя не подходит',
  passwordRejected: 'Текущий пароль не подошёл',
  passwordMismatch: 'Пароли не совпадают',
  needTitle: 'Нужно название',
  categoryTooLong: 'Категория не длиннее 32 символов',
  storeUnavailable: 'Данные сейчас недоступны',
  network: 'Нет соединения',
  requestFailed: 'Запрос не выполнен',
  serviceFailed: 'Не получилось выполнить действие. Повторите позже',
  cardNotSaved: 'Карточка не сохранилась',
  cardGone: 'Карточки уже нет',
} as const

const byCode: Record<ErrorCode, string> = {
  nick_taken: phrase.nickTaken,
  nick_invalid: phrase.nickInvalid,
  password_invalid: phrase.passwordInvalid,
  sign_in_failed: phrase.signInFailed,
  no_active_access: phrase.needSignIn,
  foreign_data: phrase.requestFailed,
  display_name_invalid: phrase.displayNameInvalid,
  password_change_rejected: phrase.passwordRejected,
  store_unavailable: phrase.storeUnavailable,
  request_invalid: phrase.requestFailed,
  card_invalid: phrase.cardNotSaved,
  object_missing: phrase.cardNotSaved,
}

export type PhraseAction = 'create-card' | 'delete-card'

export function phraseForCode(code: ErrorCode, action?: PhraseAction): string {
  if (action === 'delete-card' && code === 'object_missing') return phrase.cardGone
  if (action === 'create-card' && (code === 'card_invalid' || code === 'object_missing')) {
    return phrase.cardNotSaved
  }
  return byCode[code]
}
