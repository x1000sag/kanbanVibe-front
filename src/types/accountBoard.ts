export type ColumnName = 'ToDo' | 'InProgress' | 'Done'

export type ErrorCode =
  | 'nick_taken'
  | 'nick_invalid'
  | 'password_invalid'
  | 'sign_in_failed'
  | 'no_active_access'
  | 'foreign_data'
  | 'display_name_invalid'
  | 'password_change_rejected'
  | 'store_unavailable'
  | 'request_invalid'
  | 'card_invalid'
  | 'object_missing'

export interface CreateAccount {
  nick: string
  password: string
}

export interface SignIn {
  nick: string
  password: string
}

export interface Session {
  accessToken: string
  expiresAt: string
}

export interface Identity {
  nick: string
  displayName: string
}

export interface DisplayNameChange {
  displayName: string
}

export interface PasswordChange {
  currentPassword: string
  newPassword: string
}

export interface Card {
  id: string
  title: string
  description: string | null
  tags: string[]
  deadline: string | null
  createdAt: string
}

export interface Column {
  name: ColumnName
  cards: Card[]
}

export interface Board {
  columns: [Column, Column, Column]
}

export interface Profile {
  nick: string
  displayName: string
  board: Board
}

export interface CardCreate {
  columnName: ColumnName
  title: string
  description?: string | null
  tags?: string[]
  deadline?: string | null
}

export interface ErrorBody {
  code: ErrorCode
}

export const columnLabel: Record<ColumnName, string> = {
  ToDo: 'To Do',
  InProgress: 'In Progress',
  Done: 'Done',
}
