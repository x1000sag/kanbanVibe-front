export function takeFault(): string | null {
  try {
    if (import.meta.env.PROD === true) return null
  } catch {
    // Imported by the test runner, outside a Vite build.
  }
  if (typeof sessionStorage === 'undefined') return null
  const value = sessionStorage.getItem('accountBoardFault')
  if (value !== null) sessionStorage.removeItem('accountBoardFault')
  return value
}
